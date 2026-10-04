import { t } from '../i18n';
import type { Answer, Company, ContentItem, Episode, EpisodeMode, EpisodePlan, Member, Mission, Occasion } from '../types';
import { buildPlan, shuffle, type Rng } from './plan';
import { normalizeName, templateSummary, type SummaryInput } from './summary';
import {
  emptyRoom,
  HOST_CLAIM_MS,
  HOST_STALE_MS,
  INACTIVE_RESET_MS,
  isActive,
  MAX_PLAYERS,
  QUESTIONS_PER_ROUND,
  ROUNDS,
  SUMMARY_RESET_MS,
  type FinalState,
  type MissionRef,
  type Player,
  type QItem,
  type RoomState,
  type RoundKind,
  type VoteRound,
} from './types';

// Движок Table Mode: чистая функция (состояние, действие, контекст) → новое состояние + эффекты.
// Сервер применяет эффекты (записи в БД, вызовы AI) только после успешной записи состояния.

export type Action =
  | { type: 'join'; name: string }
  | { type: 'ping' }
  | { type: 'leave' }
  | { type: 'claim_host' }
  | {
      type: 'setup';
      companyMode: 'new' | 'continue';
      companyName?: string;
      code?: string;
      occasion: Occasion;
      mode: EpisodeMode;
      heroId?: string | null;
    }
  | { type: 'start' }
  | { type: 'vote'; target: string }
  | { type: 'reveal' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'mission_done'; done?: boolean }
  | { type: 'guess'; option: number }
  | { type: 'quote'; text: string }
  | { type: 'quote_vote'; quoteId: string }
  | { type: 'reset' }
  | { type: 'simulate' }
  | { type: 'plan_adapted'; episodeId: string; ok: boolean; questions?: Partial<Record<VoteRound, QItem[]>> }
  | { type: 'summary_ready'; episodeId: string; text: string; source: 'ai' | 'template' };

export type ActionType = Action['type'];

export interface Ctx {
  now: number;
  rng: Rng;
  uuid: () => string;
  tableNo: number;
  aiEnabled: boolean;
  actorId: string | null; // проверенный игрок (null — служебные действия)
  newPlayer?: { id: string; keyHash: string };
  // данные, подгруженные сервером до вызова
  company?: Company | null;
  newCompany?: { id: string; code: string; season: string };
  members?: Member[];
  prevEpisodes?: Episode[];
  library?: ContentItem[];
  plan?: EpisodePlan | null;
  missionRows?: Mission[];
}

export type Effect =
  | { kind: 'createCompany'; row: Partial<Company> }
  | { kind: 'createMembers'; rows: Partial<Member>[] }
  | { kind: 'createEpisode'; row: Partial<Episode> }
  | { kind: 'insertAnswers'; rows: Partial<Answer>[] }
  | { kind: 'insertMissions'; rows: Partial<Mission>[] }
  | { kind: 'updateMission'; id: string; status: Mission['status'] }
  | { kind: 'updatePlan'; episodeId: string; plan: EpisodePlan }
  | { kind: 'finishEpisode'; episodeId: string; patch: Partial<Episode>; gains: { memberId: string; gained: number }[] }
  | { kind: 'abandonEpisode'; episodeId: string }
  | {
      kind: 'adaptPlan';
      episodeId: string;
      occasion: Occasion;
      heroName: string | null;
      names: string[];
      questions: Record<VoteRound, QItem[]>;
      missions: QItem[];
    }
  | { kind: 'summarize'; episodeId: string; input: SummaryInput };

export type ReduceResult =
  | { ok: true; state: RoomState; effects: Effect[]; data?: Record<string, unknown> }
  | { ok: false; error: string; status: number };

const fail = (error: string, status = 400): ReduceResult => ({ ok: false, error, status });

const PASSIVE: ActionType[] = ['ping', 'plan_adapted', 'summary_ready'];

// ------------------------------------------------------------------ помощники

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function activePlayers(s: RoomState, now: number) {
  return s.players.filter((p) => isActive(p, now));
}

function roundKind(s: RoomState): RoundKind | null {
  return s.rounds[s.roundIdx] ?? null;
}

const isVoteRound = (k: RoundKind | null): k is VoteRound => k === 'warmup' || k === 'vote2' || k === 'vote3';

function playerName(s: RoomState, id: string | null | undefined) {
  return s.players.find((p) => p.id === id)?.name ?? '—';
}

function uniqueName(s: RoomState, name: string) {
  const base = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  const taken = new Set(s.players.map((p) => normalizeName(p.name)));
  if (!taken.has(normalizeName(base))) return base;
  for (let i = 2; i < 50; i++) {
    const n = `${base} ${i}`;
    if (!taken.has(normalizeName(n))) return n;
  }
  return base;
}

/** Хост ушёл (давно не был онлайн) — ведущим становится следующий активный по времени входа. */
function ensureHost(s: RoomState, now: number) {
  if (!s.players.length) {
    s.hostId = null;
    return;
  }
  const host = s.players.find((p) => p.id === s.hostId);
  if (host && now - host.lastSeen <= HOST_STALE_MS) return;
  const next = [...s.players].sort((a, b) => a.joinedAt - b.joinedAt).find((p) => isActive(p, now) && p.id !== s.hostId);
  if (!host) s.hostId = next?.id ?? s.players[0].id;
  else if (next) s.hostId = next.id;
}

function answer(s: RoomState, playerId: string, payload: Record<string, unknown>): Partial<Answer> | null {
  if (!s.episodeId) return null;
  const p = s.players.find((x) => x.id === playerId);
  return { episode_id: s.episodeId, member_id: p?.memberId ?? null, round: s.roundIdx, payload };
}

// ------------------------------------------------------------------ раунды

function enterRound(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  const kind = roundKind(s);
  if (!kind) return finish(s, ctx, effects);
  s.phase = kind;
  if (isVoteRound(kind)) {
    if (!s.questions[kind].length) return advanceRound(s, ctx, effects);
    s.vote = { idx: 0, stage: 'vote', votes: {} };
    return null;
  }
  s.vote = null;
  if (kind === 'missions') return assignMissions(s, ctx, effects);
  if (kind === 'final') return startFinal(s, ctx);
  return null;
}

function advanceRound(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  s.roundIdx += 1;
  if (s.roundIdx >= s.rounds.length) return finish(s, ctx, effects);
  return enterRound(s, ctx, effects);
}

function assignMissions(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  if (!ctx.plan) return 'Нет плана эпизода';
  const plan = ctx.plan;
  const have = new Set(s.missions.map((m) => m.playerId));
  const players = shuffle(
    s.players.filter((p) => !have.has(p.id)),
    ctx.rng,
  );
  if (!players.length) return null;
  const usedTexts = new Set<string>();
  const rows: Partial<Mission>[] = [];
  // Одна миссия на стол — с участием персонала
  const staffTaken = s.missions.some((m) => m.staff);
  const pool = [...plan.missions];
  players.forEach((p, i) => {
    const useStaff = !staffTaken && i === 0 && plan.staffMission && s.players.length >= 2;
    const item = useStaff ? plan.staffMission! : pool.shift();
    if (!item) return;
    usedTexts.add(item.text);
    const id = ctx.uuid();
    s.missions.push({ playerId: p.id, missionId: id, staff: Boolean(useStaff), done: false });
    rows.push({ id, episode_id: s.episodeId!, member_id: p.memberId, text: item.text, staff: Boolean(useStaff), status: 'assigned' });
  });
  // Чтобы опоздавшие не получили те же миссии — убираем выданные из плана
  const left: EpisodePlan = {
    ...plan,
    missions: plan.missions.filter((m) => !usedTexts.has(m.text)),
    staffMission: s.missions.some((m) => m.staff) ? null : plan.staffMission,
  };
  if (rows.length) effects.push({ kind: 'insertMissions', rows });
  effects.push({ kind: 'updatePlan', episodeId: s.episodeId!, plan: left });
  return null;
}

function missionText(ctx: Ctx, ref: MissionRef): string | null {
  return ctx.missionRows?.find((m) => m.id === ref.missionId)?.text ?? null;
}

function startFinal(s: RoomState, ctx: Ctx): string | null {
  const order = shuffle(
    s.missions.filter((m) => s.players.some((p) => p.id === m.playerId)).map((m) => m.playerId),
    ctx.rng,
  );
  s.final = {
    stage: 'guess',
    order,
    idx: 0,
    options: [],
    guesses: {},
    correct: null,
    results: [],
    quotes: [],
    quoteVotes: {},
  };
  if (!order.length) {
    s.final.stage = 'quotes';
    return null;
  }
  return prepareGuess(s, ctx);
}

function prepareGuess(s: RoomState, ctx: Ctx): string | null {
  const f = s.final!;
  const owner = f.order[f.idx];
  const ref = s.missions.find((m) => m.playerId === owner);
  const real = ref ? missionText(ctx, ref) : null;
  if (!ref || !real) return 'Нет данных миссии';
  const others = new Set<string>();
  for (const d of shuffle(ctx.plan?.decoys ?? [], ctx.rng)) {
    if (d.text !== real) others.add(d.text);
    if (others.size >= 3) break;
  }
  // Запасной вариант: другие выданные миссии (если приманок не хватило)
  if (others.size < 3) {
    for (const m of ctx.missionRows ?? []) {
      if (m.text !== real) others.add(m.text);
      if (others.size >= 3) break;
    }
  }
  f.options = shuffle([real, ...others], ctx.rng);
  f.guesses = {};
  f.correct = null;
  f.stage = 'guess';
  return null;
}

function revealMission(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  const f = s.final!;
  const owner = f.order[f.idx];
  const ref = s.missions.find((m) => m.playerId === owner);
  if (!ref) return 'Нет миссии';
  const real = missionText(ctx, ref);
  const correct = real ? f.options.indexOf(real) : -1;
  const guessedBy = Object.entries(f.guesses)
    .filter(([pid, opt]) => pid !== owner && opt === correct)
    .map(([pid]) => pid);
  const gained: Record<string, number> = {};
  for (const pid of guessedBy) gained[pid] = (gained[pid] ?? 0) + 1;
  if (ref.done && guessedBy.length === 0) gained[owner] = (gained[owner] ?? 0) + 3;
  for (const [pid, pts] of Object.entries(gained)) s.points[pid] = (s.points[pid] ?? 0) + pts;
  f.correct = correct;
  f.stage = 'reveal';
  f.results.push({ playerId: owner, text: real ?? '', staff: ref.staff, done: ref.done, guessedBy, gained });
  effects.push({ kind: 'updateMission', id: ref.missionId, status: guessedBy.length ? 'guessed' : ref.done ? 'done' : 'assigned' });
  const rows = Object.entries(f.guesses)
    .map(([pid, opt]) => answer(s, pid, { kind: 'guess', mission: ref.missionId, option: opt, correct: opt === correct }))
    .filter((x): x is Partial<Answer> => x !== null);
  if (rows.length) effects.push({ kind: 'insertAnswers', rows });
  return null;
}

function afterQuotes(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  const f = s.final!;
  if (f.quotes.length >= 2) {
    f.stage = 'quote_vote';
    f.quoteVotes = {};
    return null;
  }
  return finish(s, ctx, effects);
}

function finish(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  const f: FinalState =
    s.final ?? { stage: 'quotes', order: [], idx: 0, options: [], guesses: {}, correct: null, results: [], quotes: [], quoteVotes: {} };
  // Фраза вечера: больше всего голосов, при равенстве — раньше написанная
  const tally = new Map<string, number>();
  Object.values(f.quoteVotes).forEach((qid) => tally.set(qid, (tally.get(qid) ?? 0) + 1));
  const bestQuote = [...f.quotes].sort((a, b) => (tally.get(b.id) ?? 0) - (tally.get(a.id) ?? 0))[0] ?? null;

  // MVP: больше всего очков → больше угаданных миссий → раньше пришёл
  const correctGuesses = (pid: string) => f.results.filter((r) => r.guessedBy.includes(pid)).length;
  const ranked = [...s.players].sort(
    (a, b) => (s.points[b.id] ?? 0) - (s.points[a.id] ?? 0) || correctGuesses(b.id) - correctGuesses(a.id) || a.joinedAt - b.joinedAt,
  );
  let mvp: Player | null = ranked[0] ?? null;
  if (mvp && (s.points[mvp.id] ?? 0) === 0 && bestQuote) mvp = s.players.find((p) => p.id === bestQuote.playerId) ?? mvp;

  const members = ctx.members ?? [];
  const gains = s.players
    .filter((p) => p.memberId)
    .map((p) => ({ memberId: p.memberId as string, gained: s.points[p.id] ?? 0 }));
  const season = members
    .map((m) => {
      const g = gains.find((x) => x.memberId === m.id)?.gained ?? 0;
      return { memberId: m.id, name: m.display_name, total: (m.total_points ?? 0) + g, gained: g };
    })
    .concat(
      // участники, которых ещё нет в members (запись создаётся параллельно)
      s.players
        .filter((p) => p.memberId && !members.some((m) => m.id === p.memberId))
        .map((p) => ({ memberId: p.memberId as string, name: p.name, total: s.points[p.id] ?? 0, gained: s.points[p.id] ?? 0 })),
    )
    .sort((a, b) => b.total - a.total || b.gained - a.gained);

  const quote = bestQuote ? { text: bestQuote.text, by: playerName(s, bestQuote.playerId) } : null;
  const input: SummaryInput = {
    company: s.company?.name ?? 'Компания',
    season: s.company?.season ?? '',
    episodeNo: s.episodeNo,
    occasion: s.occasion ?? 'meetup',
    players: s.players.map((p) => ({ name: p.name, points: s.points[p.id] ?? 0 })),
    mvp: mvp?.name ?? null,
    mvpPoints: mvp ? (s.points[mvp.id] ?? 0) : 0,
    quote,
    missions: f.results.map((r) => ({ name: playerName(s, r.playerId), text: r.text, done: r.done, guessed: r.guessedBy.length > 0 })),
    prev: (ctx.prevEpisodes ?? []).slice(0, 3).map((e) => ({
      episodeNo: e.episode_no,
      summary: e.summary_text,
      mvp: members.find((m) => m.id === e.mvp_member_id)?.display_name ?? null,
      quote: e.quote_of_night,
    })),
    heroName: s.heroId ? playerName(s, s.heroId) : null,
  };
  const text = templateSummary(input);
  const modes = t.game.teaserModes;
  s.phase = 'summary';
  s.vote = null;
  s.final = { ...f, stage: f.stage };
  s.summary = {
    mvpId: mvp?.id ?? null,
    mvpName: mvp?.name ?? null,
    quote,
    text,
    source: ctx.aiEnabled ? 'pending' : 'template',
    since: ctx.now,
    season,
    teaser: modes[(s.episodeNo - 1 + modes.length) % modes.length],
  };
  if (s.episodeId) {
    effects.push({
      kind: 'finishEpisode',
      episodeId: s.episodeId,
      patch: {
        status: 'finished',
        ended_at: new Date(ctx.now).toISOString(),
        mvp_member_id: mvp?.memberId ?? null,
        quote_of_night: quote?.text ?? null,
        summary_text: text,
      },
      gains,
    });
    if (ctx.aiEnabled) effects.push({ kind: 'summarize', episodeId: s.episodeId, input });
  }
  return null;
}

/** Автопереходы: все проголосовали / угадали / написали. */
function autoAdvance(s: RoomState, ctx: Ctx, effects: Effect[]): string | null {
  const active = activePlayers(s, ctx.now);
  const kind = roundKind(s);
  if (isVoteRound(kind) && s.phase === kind && s.vote?.stage === 'vote') {
    const voted = active.filter((p) => s.vote!.votes[p.id]);
    if (voted.length > 0 && voted.length >= active.length) s.vote.stage = 'result';
    return null;
  }
  if (s.phase !== 'final' || !s.final) return null;
  const f = s.final;
  if (f.stage === 'guess') {
    const owner = f.order[f.idx];
    const guessers = active.filter((p) => p.id !== owner);
    if (guessers.length > 0 && guessers.every((p) => f.guesses[p.id] !== undefined)) return revealMission(s, ctx, effects);
  } else if (f.stage === 'quotes') {
    if (active.length > 0 && active.every((p) => f.quotes.some((q) => q.playerId === p.id))) return afterQuotes(s, ctx, effects);
  } else if (f.stage === 'quote_vote') {
    const voters = active.filter((p) => f.quotes.some((q) => q.playerId !== p.id));
    if (voters.length > 0 && voters.every((p) => f.quoteVotes[p.id])) return finish(s, ctx, effects);
  }
  return null;
}

/** Сброс по неактивности (4 часа) и после итога (через 45 минут). */
function maintenance(s: RoomState, ctx: Ctx, effects: Effect[]): RoomState {
  if (s.phase === 'idle') return s;
  const idle = ctx.now - s.lastActivity;
  const stale = idle > INACTIVE_RESET_MS || (s.phase === 'summary' && idle > SUMMARY_RESET_MS);
  if (!stale) return s;
  if (s.episodeId && s.phase !== 'summary') effects.push({ kind: 'abandonEpisode', episodeId: s.episodeId });
  return emptyRoom(ctx.now);
}

const BOT_QUOTES = [
  'Пингвин в пятницу — это сила',
  'Кто заказал десерт без меня?',
  'Как говорила моя бабушка — ешь, пока горячее',
  'Это был лучший тост без слов',
  'Миссия невыполнима, но очень вкусна',
  'Сначала фото, потом еда',
];

// ------------------------------------------------------------------ редьюсер

export function reduce(prev: RoomState, action: Action, ctx: Ctx): ReduceResult {
  const effects: Effect[] = [];
  let s = maintenance(clone(prev), ctx, effects);
  const now = ctx.now;
  const actor = ctx.actorId ? s.players.find((p) => p.id === ctx.actorId) : undefined;
  if (actor) actor.lastSeen = now;
  const isHost = Boolean(actor && s.hostId === actor.id);
  const data: Record<string, unknown> = {};
  let err: string | null = null;

  const needPlayer = () => (actor ? null : 'Сначала войдите за стол');
  const needHost = () => (isHost ? null : 'Это делает ведущий');

  switch (action.type) {
    case 'join': {
      if (actor) {
        data.playerId = actor.id;
        break;
      }
      const name = action.name?.trim();
      if (!name) return fail(t.game.errorName);
      if (!ctx.newPlayer) return fail('Нет данных игрока', 500);
      if (s.players.length >= MAX_PLAYERS) return fail('За столом уже 12 игроков');
      const display = uniqueName(s, name);
      const player: Player = { id: ctx.newPlayer.id, name: display, memberId: null, joinedAt: now, lastSeen: now, keyHash: ctx.newPlayer.keyHash };
      if (s.company) {
        // Продолжение сезона: узнаём участника по имени, иначе — новый участник компании
        const match = (ctx.members ?? []).find(
          (m) => normalizeName(m.display_name) === normalizeName(display) && !s.players.some((p) => p.memberId === m.id),
        );
        if (match) player.memberId = match.id;
        else {
          player.memberId = ctx.uuid();
          effects.push({ kind: 'createMembers', rows: [{ id: player.memberId, company_id: s.company.id, display_name: display, total_points: 0 }] });
        }
      }
      s.players.push(player);
      if (s.phase === 'idle') s.phase = 'lobby';
      if (!s.hostId) s.hostId = player.id;
      // Опоздавший к миссиям получает свою
      if (s.missions.length && ['missions', 'vote2', 'vote3'].includes(s.phase) && ctx.plan) {
        err = assignMissions(s, ctx, effects);
        if (err) err = null; // без миссии тоже можно играть
      }
      data.playerId = player.id;
      break;
    }

    case 'ping': {
      if ((err = needPlayer())) break;
      break;
    }

    case 'leave': {
      if ((err = needPlayer())) break;
      s.players = s.players.filter((p) => p.id !== actor!.id);
      if (!s.players.length) {
        if (s.episodeId && s.phase !== 'summary') effects.push({ kind: 'abandonEpisode', episodeId: s.episodeId });
        s = emptyRoom(now);
      } else if (s.hostId === actor!.id) {
        s.hostId = [...s.players].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
      }
      break;
    }

    case 'claim_host': {
      if ((err = needPlayer())) break;
      const host = s.players.find((p) => p.id === s.hostId);
      if (host && now - host.lastSeen <= HOST_CLAIM_MS && host.id !== actor!.id) return fail('Ведущий за столом');
      s.hostId = actor!.id;
      break;
    }

    case 'setup': {
      if ((err = needPlayer() ?? needHost())) break;
      if (s.phase !== 'lobby') return fail('Эпизод уже идёт');
      if (!['meetup', 'birthday', 'reunion', 'success'].includes(action.occasion)) return fail('Неизвестный повод');
      if (!['short', 'full'].includes(action.mode)) return fail('Неизвестная длина');
      const prevEpisodes = ctx.prevEpisodes ?? [];
      const newMembers: Partial<Member>[] = [];
      if (action.companyMode === 'new') {
        const name = action.companyName?.trim().slice(0, 40);
        if (!name) return fail('Введите название компании');
        if (!ctx.newCompany) return fail('Нет кода компании', 500);
        s.company = {
          id: ctx.newCompany.id,
          name,
          code: ctx.newCompany.code,
          season: ctx.newCompany.season,
          isNew: true,
          prevSummary: null,
          prevMvp: null,
          prevEpisodes: 0,
        };
        effects.push({ kind: 'createCompany', row: { id: ctx.newCompany.id, name, code: ctx.newCompany.code, season_name: ctx.newCompany.season } });
        for (const p of s.players) {
          p.memberId = ctx.uuid();
          newMembers.push({ id: p.memberId, company_id: ctx.newCompany.id, display_name: p.name, total_points: 0 });
        }
      } else {
        const c = ctx.company;
        if (!c) return fail('Компания с таким кодом не найдена', 404);
        const members = ctx.members ?? [];
        const last = prevEpisodes[0];
        s.company = {
          id: c.id,
          name: c.name,
          code: c.code,
          season: c.season_name,
          isNew: false,
          prevSummary: last?.summary_text ?? null,
          prevMvp: members.find((m) => m.id === last?.mvp_member_id)?.display_name ?? null,
          prevEpisodes: prevEpisodes.length,
        };
        const claimed = new Set<string>();
        for (const p of s.players) {
          const match = members.find((m) => normalizeName(m.display_name) === normalizeName(p.name) && !claimed.has(m.id));
          if (match) {
            p.memberId = match.id;
            claimed.add(match.id);
          } else {
            p.memberId = ctx.uuid();
            newMembers.push({ id: p.memberId, company_id: c.id, display_name: p.name, total_points: 0 });
          }
        }
      }
      if (newMembers.length) effects.push({ kind: 'createMembers', rows: newMembers });

      const used = prevEpisodes.flatMap((e) => e.plan?.contentIds ?? []);
      const plan = buildPlan(ctx.library ?? [], action.occasion, action.mode, used, ctx.rng);
      if (!plan.questions.warmup.length) return fail('Библиотека контента пуста', 500);
      const episodeId = ctx.uuid();
      s.episodeId = episodeId;
      s.episodeNo = prevEpisodes.length + 1;
      s.occasion = action.occasion;
      s.mode = action.mode;
      s.heroId = action.heroId && s.players.some((p) => p.id === action.heroId) ? action.heroId : null;
      s.rounds = ROUNDS[action.mode];
      s.roundIdx = 0;
      s.questions = plan.questions;
      s.adapted = ctx.aiEnabled ? 'pending' : 'fallback';
      s.missions = [];
      s.final = null;
      s.points = {};
      s.summary = null;
      s.vote = null;
      s.startedAt = now;
      s.phase = 'intro';
      effects.push({
        kind: 'createEpisode',
        row: {
          id: episodeId,
          company_id: s.company.id,
          table_no: ctx.tableNo,
          episode_no: s.episodeNo,
          occasion: action.occasion,
          mode: action.mode,
          status: 'active',
          started_at: new Date(now).toISOString(),
          plan: { ...plan.server, contentIds: plan.contentIds },
        },
      });
      if (ctx.aiEnabled) {
        effects.push({
          kind: 'adaptPlan',
          episodeId,
          occasion: action.occasion,
          heroName: s.heroId ? playerName(s, s.heroId) : null,
          names: s.players.map((p) => p.name),
          questions: plan.questions,
          missions: [...plan.server.missions, ...(plan.server.staffMission ? [plan.server.staffMission] : [])],
        });
      }
      break;
    }

    case 'start': {
      if ((err = needPlayer() ?? needHost())) break;
      if (s.phase !== 'intro') return fail('Сначала настройте эпизод');
      s.roundIdx = 0;
      err = enterRound(s, ctx, effects);
      break;
    }

    case 'vote': {
      if ((err = needPlayer())) break;
      const kind = roundKind(s);
      if (!isVoteRound(kind) || s.phase !== kind || s.vote?.stage !== 'vote') return fail('Голосование закрыто');
      if (!s.players.some((p) => p.id === action.target)) return fail('Нет такого игрока');
      s.vote.votes[actor!.id] = action.target;
      const target = s.players.find((p) => p.id === action.target);
      const q = s.questions[kind][s.vote.idx];
      const row = answer(s, actor!.id, { kind: 'vote', q: q?.id, target: target?.memberId ?? null });
      if (row) effects.push({ kind: 'insertAnswers', rows: [row] });
      break;
    }

    case 'reveal': {
      if ((err = needPlayer() ?? needHost())) break;
      const kind = roundKind(s);
      if (isVoteRound(kind) && s.phase === kind && s.vote) s.vote.stage = 'result';
      else if (s.phase === 'final' && s.final?.stage === 'guess') err = revealMission(s, ctx, effects);
      else return fail('Нечего раскрывать');
      break;
    }

    case 'skip':
    case 'next': {
      if ((err = needPlayer() ?? needHost())) break;
      const kind = roundKind(s);
      if (s.phase === 'intro') {
        s.roundIdx = 0;
        err = enterRound(s, ctx, effects);
      } else if (isVoteRound(kind) && s.phase === kind && s.vote) {
        if (s.vote.idx + 1 < Math.min(QUESTIONS_PER_ROUND, s.questions[kind].length)) s.vote = { idx: s.vote.idx + 1, stage: 'vote', votes: {} };
        else err = advanceRound(s, ctx, effects);
      } else if (s.phase === 'missions') {
        err = advanceRound(s, ctx, effects);
      } else if (s.phase === 'final' && s.final) {
        const f = s.final;
        if (f.stage === 'guess') err = revealMission(s, ctx, effects);
        else if (f.stage === 'reveal') {
          if (f.idx + 1 < f.order.length) {
            f.idx += 1;
            err = prepareGuess(s, ctx);
          } else f.stage = 'quotes';
        } else if (f.stage === 'quotes') err = afterQuotes(s, ctx, effects);
        else if (f.stage === 'quote_vote') err = finish(s, ctx, effects);
      } else return fail('Сейчас нечего переключать');
      break;
    }

    case 'mission_done': {
      if ((err = needPlayer())) break;
      const ref = s.missions.find((m) => m.playerId === actor!.id);
      if (!ref) return fail('У тебя нет миссии');
      if (s.final?.results.some((r) => r.playerId === actor!.id)) return fail('Миссия уже раскрыта');
      ref.done = action.done !== false;
      effects.push({ kind: 'updateMission', id: ref.missionId, status: ref.done ? 'done' : 'assigned' });
      break;
    }

    case 'guess': {
      if ((err = needPlayer())) break;
      const f = s.final;
      if (s.phase !== 'final' || f?.stage !== 'guess') return fail('Сейчас не угадываем');
      if (f.order[f.idx] === actor!.id) return fail('Свою миссию не угадывают');
      if (!Number.isInteger(action.option) || action.option < 0 || action.option >= f.options.length) return fail('Нет такого варианта');
      f.guesses[actor!.id] = action.option;
      break;
    }

    case 'quote': {
      if ((err = needPlayer())) break;
      const f = s.final;
      if (s.phase !== 'final' || f?.stage !== 'quotes') return fail('Сейчас не время фраз');
      const text = action.text?.trim().replace(/\s+/g, ' ').slice(0, 120);
      if (!text) return fail('Напишите фразу');
      const existing = f.quotes.find((q) => q.playerId === actor!.id);
      if (existing) existing.text = text;
      else f.quotes.push({ id: ctx.uuid(), playerId: actor!.id, text });
      const row = answer(s, actor!.id, { kind: 'quote', text });
      if (row) effects.push({ kind: 'insertAnswers', rows: [row] });
      break;
    }

    case 'quote_vote': {
      if ((err = needPlayer())) break;
      const f = s.final;
      if (s.phase !== 'final' || f?.stage !== 'quote_vote') return fail('Голосование за фразу закрыто');
      const q = f.quotes.find((x) => x.id === action.quoteId);
      if (!q) return fail('Нет такой фразы');
      if (q.playerId === actor!.id) return fail('За свою фразу голосовать нельзя');
      f.quoteVotes[actor!.id] = q.id;
      break;
    }

    case 'reset': {
      if ((err = needPlayer())) break;
      if (!isHost && s.phase !== 'summary') return fail('Сбросить стол может ведущий');
      if (s.episodeId && s.phase !== 'summary') effects.push({ kind: 'abandonEpisode', episodeId: s.episodeId });
      const keep = s.players;
      const host = s.hostId;
      s = emptyRoom(now);
      s.players = keep;
      s.hostId = host;
      s.phase = keep.length ? 'lobby' : 'idle';
      break;
    }

    case 'simulate': {
      // Демо: «боты» делают ход за всех, кто ещё не походил
      s.players.forEach((p) => (p.lastSeen = now));
      const kind = roundKind(s);
      if (isVoteRound(kind) && s.phase === kind && s.vote?.stage === 'vote') {
        for (const p of s.players) {
          if (s.vote.votes[p.id]) continue;
          const others = s.players.filter((o) => o.id !== p.id);
          const target = (others.length ? others : s.players)[Math.floor(ctx.rng() * Math.max(1, others.length || s.players.length))];
          s.vote.votes[p.id] = target.id;
        }
      } else if (['missions', 'vote2', 'vote3'].includes(s.phase)) {
        for (const m of s.missions) if (!m.done && ctx.rng() < 0.8) m.done = true;
      } else if (s.phase === 'final' && s.final) {
        const f = s.final;
        if (f.stage === 'guess') {
          const owner = f.order[f.idx];
          const ref = s.missions.find((m) => m.playerId === owner);
          if (ref && !ref.done && ctx.rng() < 0.7) ref.done = true;
          for (const p of s.players) if (p.id !== owner && f.guesses[p.id] === undefined) f.guesses[p.id] = Math.floor(ctx.rng() * f.options.length);
        } else if (f.stage === 'quotes') {
          s.players.forEach((p, i) => {
            if (!f.quotes.some((q) => q.playerId === p.id)) f.quotes.push({ id: ctx.uuid(), playerId: p.id, text: BOT_QUOTES[(i + f.quotes.length) % BOT_QUOTES.length] });
          });
        } else if (f.stage === 'quote_vote') {
          for (const p of s.players) {
            if (f.quoteVotes[p.id]) continue;
            const options = f.quotes.filter((q) => q.playerId !== p.id);
            if (options.length) f.quoteVotes[p.id] = options[Math.floor(ctx.rng() * options.length)].id;
          }
        }
      }
      break;
    }

    case 'plan_adapted': {
      if (s.episodeId !== action.episodeId || s.adapted !== 'pending') break;
      s.adapted = action.ok ? 'ai' : 'fallback';
      if (!action.ok || !action.questions) break;
      const currentKind = roundKind(s);
      const started = s.phase !== 'intro' && s.phase !== 'lobby';
      for (const r of ['warmup', 'vote2', 'vote3'] as VoteRound[]) {
        const adapted = action.questions[r];
        if (!adapted) continue;
        const roundPos = s.rounds.indexOf(r);
        s.questions[r] = s.questions[r].map((q, i) => {
          const shown = started && (roundPos < s.roundIdx || (r === currentKind && s.vote !== null && i <= s.vote.idx));
          const a = adapted.find((x) => x.id === q.id);
          return !shown && a ? { ...q, text: a.text } : q;
        });
      }
      break;
    }

    case 'summary_ready': {
      if (s.episodeId !== action.episodeId || !s.summary) break;
      s.summary.text = action.text;
      s.summary.source = action.source;
      break;
    }
  }

  if (err) return fail(err);
  ensureHost(s, now);
  const autoErr = autoAdvance(s, ctx, effects);
  if (autoErr) return fail(autoErr);
  if (!PASSIVE.includes(action.type)) s.lastActivity = now;
  return { ok: true, state: s, effects, data };
}

/** Какие данные нужны серверу заранее для этого действия в этом состоянии. */
export function needs(state: RoomState, action: Action) {
  const phase = state.phase;
  const inEpisode = Boolean(state.episodeId);
  return {
    companyByCode: action.type === 'setup' && action.companyMode === 'continue' ? (action.code ?? '') : null,
    newCompany: action.type === 'setup' && action.companyMode === 'new',
    library: action.type === 'setup',
    members: Boolean(state.company && (action.type === 'join' || phase === 'final' || action.type === 'next' || action.type === 'simulate')),
    prevEpisodes: action.type === 'setup' || phase === 'final',
    plan: inEpisode && ['warmup', 'missions', 'vote2', 'vote3', 'final'].includes(phase),
    missionRows: inEpisode && ['missions', 'vote2', 'vote3', 'final'].includes(phase),
  };
}
