import { describe, expect, it } from 'vitest';

import { seedContent } from '../db/seed';
import type { Answer, Company, Episode, Member, Mission } from '../types';
import { needs, reduce, type Action, type Ctx, type Effect } from './engine';
import { emptyRoom, type RoomState } from './types';

// Мини-«сервер» для теста: применяет эффекты к массивам и подгружает данные по needs().
function harness() {
  let now = Date.parse('2026-10-09T17:00:00Z');
  let n = 0;
  const uuid = () => `id-${++n}`;
  let seed = 7;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const db = {
    companies: [] as Company[],
    members: [] as Member[],
    episodes: [] as Episode[],
    missions: [] as Mission[],
    answers: [] as Partial<Answer>[],
  };
  let state: RoomState = emptyRoom(now);

  const apply = (effects: Effect[]) => {
    for (const e of effects) {
      if (e.kind === 'createCompany') db.companies.push({ created_at: '', ...e.row } as Company);
      if (e.kind === 'createMembers') db.members.push(...(e.rows.map((r) => ({ total_points: 0, created_at: '', ...r })) as Member[]));
      if (e.kind === 'createEpisode') db.episodes.push({ ended_at: null, summary_text: null, mvp_member_id: null, quote_of_night: null, ...e.row } as Episode);
      if (e.kind === 'insertMissions') db.missions.push(...(e.rows as Mission[]));
      if (e.kind === 'insertAnswers') db.answers.push(...e.rows);
      if (e.kind === 'updateMission') db.missions.find((m) => m.id === e.id)!.status = e.status;
      if (e.kind === 'updatePlan') db.episodes.find((x) => x.id === e.episodeId)!.plan = e.plan;
      if (e.kind === 'abandonEpisode') db.episodes.find((x) => x.id === e.episodeId)!.status = 'abandoned';
      if (e.kind === 'finishEpisode') {
        Object.assign(db.episodes.find((x) => x.id === e.episodeId)!, e.patch);
        for (const g of e.gains) db.members.find((m) => m.id === g.memberId)!.total_points += g.gained;
      }
    }
  };

  const act = (actorId: string | null, action: Action, extra: Partial<Ctx> = {}) => {
    const need = needs(state, action);
    const company = need.companyByCode !== null ? (db.companies.find((c) => c.code === need.companyByCode) ?? null) : undefined;
    const companyId = company?.id ?? state.company?.id;
    const ctx: Ctx = {
      now,
      rng,
      uuid,
      tableNo: 7,
      aiEnabled: false,
      actorId,
      newPlayer: action.type === 'join' ? { id: uuid(), keyHash: 'hash' } : undefined,
      company,
      newCompany: need.newCompany ? { id: uuid(), code: 'K7QM', season: 'Осень 2026' } : undefined,
      members: companyId ? db.members.filter((m) => m.company_id === companyId) : [],
      prevEpisodes: companyId ? db.episodes.filter((e) => e.company_id === companyId && e.status === 'finished').reverse() : [],
      library: need.library ? seedContent() : undefined,
      plan: state.episodeId ? db.episodes.find((e) => e.id === state.episodeId)?.plan : undefined,
      missionRows: state.episodeId ? db.missions.filter((m) => m.episode_id === state.episodeId) : undefined,
      ...extra,
    };
    const r = reduce(state, action, ctx);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
    apply(r.effects);
    return r;
  };

  return {
    db,
    act,
    get state() {
      return state;
    },
    tick(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

function joinFour(h: ReturnType<typeof harness>) {
  return ['Аня', 'Борис', 'Вика', 'Гоша'].map((name) => h.act(null, { type: 'join', name }).data!.playerId as string);
}

describe('Table Mode: полный эпизод', () => {
  it('4 телефона проходят короткий эпизод от входа до итога', () => {
    const h = harness();
    const [anya, boris, vika, gosha] = joinFour(h);
    const all = [anya, boris, vika, gosha];
    expect(h.state.phase).toBe('lobby');
    expect(h.state.hostId).toBe(anya);

    // Только ведущий настраивает эпизод
    expect(() => h.act(boris, { type: 'setup', companyMode: 'new', companyName: 'Клуб', occasion: 'birthday', mode: 'short' })).toThrow();
    h.act(anya, { type: 'setup', companyMode: 'new', companyName: 'Пятничный клуб', occasion: 'birthday', mode: 'short', heroId: vika });
    expect(h.state.phase).toBe('intro');
    expect(h.state.company?.code).toBe('K7QM');
    expect(h.db.members).toHaveLength(4);
    expect(h.state.questions.warmup).toHaveLength(3);
    expect(h.state.questions.warmup.some((q) => q.text.includes('именинник'))).toBe(true); // вопрос под повод

    h.act(anya, { type: 'start' });
    expect(h.state.phase).toBe('warmup');
    for (let q = 0; q < 3; q++) {
      all.forEach((p, i) => h.act(p, { type: 'vote', target: all[(i + 1) % 4] }));
      expect(h.state.vote?.stage).toBe('result'); // все проголосовали — результат сам
      h.act(anya, { type: 'next' });
    }

    // Секретные миссии: у каждого своя, одна — с персоналом; тексты не попадают в общее состояние
    expect(h.state.phase).toBe('missions');
    expect(h.state.missions).toHaveLength(4);
    expect(h.state.missions.filter((m) => m.staff)).toHaveLength(1);
    const stateJson = JSON.stringify(h.state);
    for (const m of h.db.missions) expect(stateJson).not.toContain(m.text);

    h.act(anya, { type: 'mission_done' });
    h.act(boris, { type: 'mission_done' });
    h.act(vika, { type: 'mission_done' });
    h.act(anya, { type: 'next' });

    expect(h.state.phase).toBe('final');
    const f = () => h.state.final!;
    expect(f().stage).toBe('guess');
    for (let i = 0; i < 4; i++) {
      const owner = f().order[f().idx];
      const real = h.db.missions.find((m) => m.id === h.state.missions.find((x) => x.playerId === owner)!.missionId)!.text;
      expect(f().options).toHaveLength(4);
      expect(f().options).toContain(real);
      // первый игрок угадывает верно, остальные мимо
      const correct = f().options.indexOf(real);
      const guessers = all.filter((p) => p !== owner);
      guessers.forEach((p, k) => h.act(p, { type: 'guess', option: k === 0 ? correct : (correct + 1) % 4 }));
      expect(f().stage).toBe('reveal');
      expect(f().results.at(-1)!.guessedBy).toEqual([guessers[0]]);
      h.act(anya, { type: 'next' });
    }

    expect(f().stage).toBe('quotes');
    all.forEach((p, i) => h.act(p, { type: 'quote', text: `Фраза ${i}` }));
    expect(f().stage).toBe('quote_vote');
    const quoteOfBoris = f().quotes.find((q) => q.playerId === boris)!.id;
    all.filter((p) => p !== boris).forEach((p) => h.act(p, { type: 'quote_vote', quoteId: quoteOfBoris }));
    h.act(boris, { type: 'quote_vote', quoteId: f().quotes.find((q) => q.playerId === anya)!.id });

    expect(h.state.phase).toBe('summary');
    const sum = h.state.summary!;
    expect(sum.quote).toEqual({ text: 'Фраза 1', by: 'Борис' });
    expect(sum.mvpName).toBeTruthy();
    expect(sum.text.length).toBeGreaterThan(40);
    expect(sum.season).toHaveLength(4);
    // каждый угадал ровно одну миссию (+1), миссии угаданы — бонус +3 никому
    expect(Object.values(h.state.points).reduce((a, b) => a + b, 0)).toBe(4);
    expect(h.db.episodes[0].status).toBe('finished');
    expect(h.db.members.reduce((a, m) => a + m.total_points, 0)).toBe(4);
    expect(h.db.answers.length).toBeGreaterThan(12);
  });

  it('по коду компании второй эпизод видит очки и итог первого', () => {
    const h = harness();
    const [anya, boris, vika, gosha] = joinFour(h);
    h.act(anya, { type: 'setup', companyMode: 'new', companyName: 'Клуб', occasion: 'meetup', mode: 'short' });
    h.act(anya, { type: 'start' });
    for (let q = 0; q < 3; q++) h.act(anya, { type: 'skip' });
    h.act(anya, { type: 'mission_done' }); // Аня выполнит незаметно → +3
    h.act(anya, { type: 'next' });
    while (h.state.final?.stage === 'guess' || h.state.final?.stage === 'reveal') {
      const owner = h.state.final.order[h.state.final.idx];
      if (h.state.final.stage === 'guess') {
        const real = h.db.missions.find((m) => m.id === h.state.missions.find((x) => x.playerId === owner)!.missionId)!.text;
        const wrong = (h.state.final.options.indexOf(real) + 1) % 4;
        [anya, boris, vika, gosha].filter((p) => p !== owner).forEach((p) => h.act(p, { type: 'guess', option: wrong }));
      } else h.act(anya, { type: 'next' });
    }
    h.act(anya, { type: 'next' }); // без фраз — сразу итог
    expect(h.state.phase).toBe('summary');
    expect(h.state.points[anya]).toBe(3);
    const code = h.state.company!.code;

    // Тот же стол, через неделю: «Новая игра» → продолжить сезон по коду
    h.act(anya, { type: 'reset' });
    expect(h.state.phase).toBe('lobby');
    h.act(anya, { type: 'setup', companyMode: 'continue', code, occasion: 'success', mode: 'full' });
    expect(h.state.episodeNo).toBe(2);
    expect(h.state.company?.isNew).toBe(false);
    expect(h.state.company?.prevSummary).toBeTruthy();
    expect(h.state.company?.prevMvp).toBe('Аня');
    expect(h.db.members).toHaveLength(4); // узнали всех по именам
    expect(h.state.rounds).toEqual(['warmup', 'missions', 'vote2', 'vote3', 'final']);
    // вопросы второго эпизода не повторяют первый
    const first = h.db.episodes[0].plan!.contentIds!;
    expect(h.state.questions.warmup.every((q) => !first.includes(q.id))).toBe(true);
  });

  it('неверный код компании — понятная ошибка', () => {
    const h = harness();
    const [anya] = joinFour(h);
    expect(() => h.act(anya, { type: 'setup', companyMode: 'continue', code: 'ZZZZ', occasion: 'meetup', mode: 'short' })).toThrow(/не найдена/);
  });
});

describe('Table Mode: надёжность', () => {
  it('если ведущий ушёл — ведущим становится следующий', () => {
    const h = harness();
    const [anya, boris] = joinFour(h);
    h.tick(3 * 60_000);
    h.act(boris, { type: 'ping' });
    expect(h.state.hostId).toBe(boris);
    expect(anya).not.toBe(boris);
  });

  it('«Стать ведущим» доступно, если ведущий молчит больше 30 секунд', () => {
    const h = harness();
    const [, boris] = joinFour(h);
    expect(() => h.act(boris, { type: 'claim_host' })).toThrow();
    h.tick(40_000);
    h.act(boris, { type: 'claim_host' });
    expect(h.state.hostId).toBe(boris);
  });

  it('комната сбрасывается через 4 часа неактивности', () => {
    const h = harness();
    const [anya] = joinFour(h);
    h.act(anya, { type: 'setup', companyMode: 'new', companyName: 'Клуб', occasion: 'meetup', mode: 'short' });
    h.tick(4 * 3600_000 + 1000);
    h.act(null, { type: 'join', name: 'Новый гость' });
    expect(h.state.players.map((p) => p.name)).toEqual(['Новый гость']);
    expect(h.state.phase).toBe('lobby');
    expect(h.db.episodes[0].status).toBe('abandoned');
  });

  it('одинаковые имена получают номер, а за другого проголосовать нельзя без входа', () => {
    const h = harness();
    h.act(null, { type: 'join', name: 'Саша' });
    h.act(null, { type: 'join', name: 'саша' });
    expect(h.state.players.map((p) => p.name)).toEqual(['Саша', 'саша 2']);
    expect(() => h.act('чужой-id', { type: 'vote', target: h.state.players[0].id })).toThrow(/войдите/);
  });

  it('«Симулировать голоса» проводит раунд за всех', () => {
    const h = harness();
    const [anya] = joinFour(h);
    h.act(anya, { type: 'setup', companyMode: 'new', companyName: 'Клуб', occasion: 'meetup', mode: 'short' });
    h.act(anya, { type: 'start' });
    h.act(null, { type: 'simulate' });
    expect(h.state.vote?.stage).toBe('result');
  });
});
