import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after } from 'next/server';

import { getDb } from '../db';
import { HttpError } from '../server/errors';
import { aiEnabled } from '../server/env';
import type { Company, Episode, Member, Room } from '../types';
import { adaptEpisode, summarizeEpisode } from './ai';
import { needs, reduce, type Action, type Ctx, type Effect } from './engine';
import { makeCode, normalizeCode, seasonName, templateSummary } from './summary';
import { emptyRoom, parseRoomState, toPublic, type PublicRoomState, type RoomState } from './types';

// Комната стола: «прочитал → вычислил редьюсером → записал с проверкой версии → применил эффекты».

const iso = (ms: number) => new Date(ms).toISOString();
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function parseTable(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new HttpError(404, 'Нет такого стола');
  return n;
}

async function loadRoom(tableNo: number): Promise<Room> {
  const db = getDb();
  const rows = await db.select('rooms', { filters: [['table_no', 'eq', tableNo]] });
  if (rows[0]) return rows[0];
  // Столы вне 1–12 создаются по первому сканированию QR
  const now = Date.now();
  const created = await db.upsert('rooms', { table_no: tableNo, phase: 'idle', state: emptyRoom(now), version: 0, updated_at: iso(now) }, 'table_no');
  return created[0];
}

export async function getRoomState(tableNo: number): Promise<{ state: PublicRoomState; version: number }> {
  const room = await loadRoom(tableNo);
  return { state: toPublic(parseRoomState(room.state, Date.now())), version: room.version };
}

async function freshCode(): Promise<string> {
  const db = getDb();
  for (let i = 0; i < 8; i++) {
    const code = makeCode(Math.random);
    const exists = await db.select('companies', { filters: [['code', 'eq', code]], limit: 1 });
    if (!exists.length) return code;
  }
  throw new HttpError(500, 'Не удалось выдать код компании');
}

async function buildCtx(tableNo: number, state: RoomState, action: Action, base: Pick<Ctx, 'actorId' | 'newPlayer'>): Promise<Ctx> {
  const db = getDb();
  const need = needs(state, action);
  const ctx: Ctx = {
    now: Date.now(),
    rng: Math.random,
    uuid: randomUUID,
    tableNo,
    aiEnabled: aiEnabled(),
    ...base,
  };
  if (need.companyByCode !== null) {
    const code = normalizeCode(need.companyByCode);
    ctx.company = code.length === 4 ? ((await db.select('companies', { filters: [['code', 'eq', code]], limit: 1 }))[0] ?? null) : null;
  }
  if (need.newCompany) ctx.newCompany = { id: randomUUID(), code: await freshCode(), season: seasonName(new Date()) };
  const companyId = ctx.company?.id ?? state.company?.id ?? null;
  const loads: Promise<void>[] = [];
  if (companyId && (need.members || action.type === 'setup')) {
    loads.push(
      db.select('members', { filters: [['company_id', 'eq', companyId]] }).then((m) => {
        ctx.members = m as Member[];
      }),
    );
  }
  if (companyId && need.prevEpisodes) {
    loads.push(
      db
        .select('episodes', {
          filters: [
            ['company_id', 'eq', companyId],
            ['status', 'eq', 'finished'],
          ],
          order: [{ col: 'started_at', asc: false }],
          limit: 10,
        })
        .then((e) => {
          ctx.prevEpisodes = (e as Episode[]).filter((x) => x.id !== state.episodeId);
        }),
    );
  }
  if (need.library) {
    loads.push(
      db.select('content_library', { filters: [['approved', 'eq', true]] }).then((c) => {
        ctx.library = c;
      }),
    );
  }
  if (need.plan && state.episodeId) {
    loads.push(
      db.select('episodes', { filters: [['id', 'eq', state.episodeId]], limit: 1 }).then((e) => {
        ctx.plan = e[0]?.plan ?? null;
      }),
    );
  }
  if (need.missionRows && state.episodeId) {
    loads.push(
      db.select('missions', { filters: [['episode_id', 'eq', state.episodeId]] }).then((m) => {
        ctx.missionRows = m;
      }),
    );
  }
  await Promise.all(loads);
  return ctx;
}

export interface ActionInput {
  action: Action;
  playerId?: string | null;
  key?: string | null;
}

export interface ActionOutput {
  state: PublicRoomState;
  version: number;
  playerId?: string;
  key?: string;
}

export async function roomAction(tableNo: number, input: ActionInput, internal = false): Promise<ActionOutput> {
  const db = getDb();
  const { action } = input;
  if (!internal && (action.type === 'plan_adapted' || action.type === 'summary_ready')) throw new HttpError(400, 'Служебное действие');

  for (let attempt = 0; attempt < 8; attempt++) {
    const room = await loadRoom(tableNo);
    const state = parseRoomState(room.state, Date.now());

    // Проверка игрока по секретному ключу (знает только его телефон)
    let actorId: string | null = null;
    if (input.playerId) {
      const p = state.players.find((x) => x.id === input.playerId);
      if (p) {
        if (!input.key || hashKey(input.key) !== p.keyHash) throw new HttpError(403, 'Это место занято другим телефоном');
        actorId = p.id;
      }
    }
    let newKey: string | undefined;
    let newPlayer: Ctx['newPlayer'];
    if (action.type === 'join') {
      newKey = randomBytes(16).toString('hex');
      newPlayer = { id: randomUUID(), keyHash: hashKey(newKey) };
    }

    const ctx = await buildCtx(tableNo, state, action, { actorId, newPlayer });
    const r = reduce(state, action, ctx);
    if (!r.ok) throw new HttpError(r.status, r.error);

    const updated = await db.update(
      'rooms',
      {
        state: r.state,
        phase: r.state.phase,
        current_episode_id: r.state.episodeId,
        version: room.version + 1,
        updated_at: iso(ctx.now),
      },
      [
        ['table_no', 'eq', tableNo],
        ['version', 'eq', room.version],
      ],
    );
    if (!updated.length) {
      await new Promise((res) => setTimeout(res, 20 + Math.random() * 60));
      continue; // кто-то успел раньше — пересчитываем на свежем состоянии
    }

    await runEffects(tableNo, r.effects);
    const playerId = r.data?.playerId as string | undefined;
    return {
      state: toPublic(r.state),
      version: room.version + 1,
      playerId,
      key: playerId && newPlayer && playerId === newPlayer.id ? newKey : undefined,
    };
  }
  throw new HttpError(409, 'Слишком много одновременных действий — попробуйте ещё раз');
}

async function runEffects(tableNo: number, effects: Effect[]) {
  const db = getDb();
  for (const e of effects) {
    try {
      switch (e.kind) {
        case 'createCompany':
          await db.insert('companies', e.row);
          break;
        case 'createMembers':
          await db.insert('members', e.rows);
          break;
        case 'createEpisode':
          await db.insert('episodes', e.row);
          break;
        case 'insertAnswers':
          await db.insert('answers', e.rows);
          break;
        case 'insertMissions':
          await db.insert('missions', e.rows);
          break;
        case 'updateMission':
          await db.update('missions', { status: e.status }, [['id', 'eq', e.id]]);
          break;
        case 'updatePlan':
          await db.update('episodes', { plan: e.plan }, [['id', 'eq', e.episodeId]]);
          break;
        case 'abandonEpisode':
          await db.update('episodes', { status: 'abandoned', ended_at: iso(Date.now()) }, [
            ['id', 'eq', e.episodeId],
            ['status', 'eq', 'active'],
          ]);
          break;
        case 'finishEpisode': {
          await db.update('episodes', e.patch, [['id', 'eq', e.episodeId]]);
          for (const g of e.gains) {
            if (!g.gained) continue;
            const [m] = await db.select('members', { filters: [['id', 'eq', g.memberId]], limit: 1 });
            if (m) await db.update('members', { total_points: (m.total_points ?? 0) + g.gained }, [['id', 'eq', g.memberId]]);
          }
          break;
        }
        case 'adaptPlan':
          after(() => adaptInBackground(tableNo, e));
          break;
        case 'summarize':
          after(() => summarizeInBackground(tableNo, e));
          break;
      }
    } catch (err) {
      console.error(`[room ${tableNo}] эффект ${e.kind}:`, (err as Error).message);
    }
  }
}

async function adaptInBackground(tableNo: number, e: Extract<Effect, { kind: 'adaptPlan' }>) {
  const res = await adaptEpisode({ occasion: e.occasion, heroName: e.heroName, names: e.names, questions: e.questions, missions: e.missions });
  try {
    if (res) {
      const db = getDb();
      const [ep] = await db.select('episodes', { filters: [['id', 'eq', e.episodeId]], limit: 1 });
      if (ep?.plan) {
        const byId = new Map(res.missions.map((m) => [m.id, m.text]));
        const plan = {
          ...ep.plan,
          missions: ep.plan.missions.map((m) => ({ ...m, text: byId.get(m.id) ?? m.text })),
          staffMission: ep.plan.staffMission ? { ...ep.plan.staffMission, text: byId.get(ep.plan.staffMission.id) ?? ep.plan.staffMission.text } : null,
        };
        await db.update('episodes', { plan }, [['id', 'eq', e.episodeId]]);
      }
    }
    await roomAction(tableNo, { action: { type: 'plan_adapted', episodeId: e.episodeId, ok: Boolean(res), questions: res?.questions } }, true);
  } catch (err) {
    console.error('[adapt]', (err as Error).message);
  }
}

async function summarizeInBackground(tableNo: number, e: Extract<Effect, { kind: 'summarize' }>) {
  const text = await summarizeEpisode(e.input);
  try {
    if (text) await getDb().update('episodes', { summary_text: text }, [['id', 'eq', e.episodeId]]);
    await roomAction(
      tableNo,
      { action: { type: 'summary_ready', episodeId: e.episodeId, text: text ?? templateSummary(e.input), source: text ? 'ai' : 'template' } },
      true,
    );
  } catch (err) {
    console.error('[summary]', (err as Error).message);
  }
}

/** Служебный сброс стола (демо, админка): пустая комната, незавершённый эпизод — «брошен». */
export async function resetRoom(tableNo: number) {
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await loadRoom(tableNo);
    const state = parseRoomState(room.state, Date.now());
    const now = Date.now();
    const rows = await db.update(
      'rooms',
      { state: emptyRoom(now), phase: 'idle', current_episode_id: null, version: room.version + 1, updated_at: iso(now) },
      [
        ['table_no', 'eq', tableNo],
        ['version', 'eq', room.version],
      ],
    );
    if (!rows.length) continue;
    if (state.episodeId && state.phase !== 'summary') {
      await db.update('episodes', { status: 'abandoned', ended_at: iso(now) }, [
        ['id', 'eq', state.episodeId],
        ['status', 'eq', 'active'],
      ]);
    }
    return { ok: true };
  }
  throw new HttpError(409, 'Не удалось сбросить стол');
}

/** Секретная миссия игрока — только ему, по ключу. */
export async function getMyMission(tableNo: number, playerId: string, key: string) {
  const room = await loadRoom(tableNo);
  const state = parseRoomState(room.state, Date.now());
  const p = state.players.find((x) => x.id === playerId);
  if (!p || hashKey(key) !== p.keyHash) throw new HttpError(403, 'Нет доступа');
  const ref = state.missions.find((m) => m.playerId === playerId);
  if (!ref) return { mission: null };
  const [row] = await getDb().select('missions', { filters: [['id', 'eq', ref.missionId]], limit: 1 });
  if (!row) return { mission: null, pending: true };
  return { mission: { text: row.text, staff: row.staff, done: ref.done } };
}

export type { Company };
