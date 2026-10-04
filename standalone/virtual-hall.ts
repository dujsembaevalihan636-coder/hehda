import { useSyncExternalStore } from 'react';

import { getDb, getLocalDb } from '@/lib/db';
import { HALL_TABLES } from '@/lib/hall-layout';
import { insertReading, listZones, runControl } from '@/lib/server/hall';
import type { Tempo, Zone, ZoneId } from '@/lib/types';
import { musicDbAt, round1, sumDb, ZONE_IDS, ZONES } from '@/lib/zones';

import { clearCookies } from './shims/next-headers';

// Виртуальный зал HTML-версии: в каждой зоне два «телефона-датчика», гости говорят громче
// на фоне музыки (эффект Ломбарда, как в «Симуляции пятницы»), а решения принимает
// настоящий алгоритм runControl() — тот же, что за /api/control.

const MODEL: Record<ZoneId, { base: number; theta: number }> = {
  A: { base: 57.5, theta: 54 },
  B: { base: 62.5, theta: 57 },
  C: { base: 66, theta: 61 },
};
const LOMBARD = 0.5;
const TEMPO_EFFECT: Record<Tempo, number> = { slow: -1.2, mid: 0, fast: 1.2 };
// До включения системы музыку «прибавили на глаз» — алгоритму есть что исправлять
const BARTENDER: Partial<Record<ZoneId, number>> = { A: 0.8, B: 0.9 };
const STEP_MS = 3000;
const CONTROL_MS = 5000;
const HISTORY_MS = 10 * 60_000;
const ENABLED_KEY = 'hehda:sensors';

const SENSORS = Object.fromEntries(
  ZONE_IDS.map((id) => [
    id,
    HALL_TABLES.filter((t) => t.zone_id === id)
      .slice(0, 2)
      .map((t, i) => ({ sensor_id: `демо-${id}${i + 1}`, table_no: t.table_no })),
  ]),
) as Record<ZoneId, { sensor_id: string; table_no: number }[]>;

const lastLevel: Record<ZoneId, number> = { A: 62, B: 68, C: 74 };
let burst: { zone: ZoneId; until: number; db: number } | null = null;
let nextBurstAt = 0;

function gauss() {
  const u = Math.max(1e-9, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/** Всплески вечера: то день рождения, то шумный стол — раз в 4–6 минут в случайной зоне. */
function updateBurst(now: number) {
  if (!nextBurstAt) nextBurstAt = now + 90_000;
  if (burst && now >= burst.until) burst = null;
  if (burst || now < nextBurstAt) return;
  const r = Math.random();
  const zone: ZoneId = r < 0.45 ? 'A' : r < 0.8 ? 'B' : 'C';
  const duration = 70_000 + Math.random() * 40_000;
  burst = { zone, until: now + duration, db: 4 + Math.random() * 2 };
  nextBurstAt = now + duration + 240_000 + Math.random() * 120_000;
}

function levelAt(z: Zone, now: number): number {
  const m = MODEL[z.id];
  const occupancy = 0.93 + 0.07 * Math.sin(now / 300_000 + ZONE_IDS.indexOf(z.id) * 2.1);
  let talk = m.base + 8 * Math.log10(occupancy) + TEMPO_EFFECT[z.tempo];
  if (burst && burst.zone === z.id && now < burst.until) talk += burst.db;
  const music = musicDbAt(
    Number(z.music_volume),
    Number(z.music_ref_db ?? ZONES[z.id].musicRefDb),
    Number(z.music_ref_volume ?? ZONES[z.id].musicRefVolume),
  );
  const guests = talk + LOMBARD * Math.max(0, lastLevel[z.id] - m.theta);
  const level = (sumDb(music, guests) ?? guests) + gauss() * 0.6;
  lastLevel[z.id] = level;
  return level;
}

async function tick() {
  const now = Date.now();
  updateBurst(now);
  for (const z of await listZones()) {
    const level = levelAt(z, now);
    for (const s of SENSORS[z.id]) {
      await insertReading({ zone_id: z.id, sensor_id: s.sensor_id, table_no: s.table_no, db: level + gauss() * 0.8 });
    }
  }
}

/** Первый запуск: «бармен прибавил музыку» 10 минут назад — с этого начинается лента решений. */
async function prepareFreshHall(now: number) {
  const db = getDb();
  const [anyEvent] = await db.select('events', { limit: 1 });
  const [anyReading] = await db.select('readings', { limit: 1 });
  if (anyEvent || anyReading) return;
  const at = new Date(now - HISTORY_MS).toISOString();
  for (const [id, volume] of Object.entries(BARTENDER) as [ZoneId, number][]) {
    const [z] = await db.select('zones', { filters: [['id', 'eq', id]] });
    if (!z) continue;
    await db.update('zones', { music_volume: volume, version: z.version + 1, updated_at: at }, [['id', 'eq', id]]);
    await db.insert('events', {
      zone_id: id,
      type: 'manual',
      payload: { from: { music_volume: Number(z.music_volume) }, to: { music_volume: volume } },
      created_at: at,
    });
  }
}

/** Если показаний давно не было — дорисовываем последние 10 минут, чтобы графики не были пустыми. */
async function seedHistory(now: number) {
  const db = getDb();
  const recent = await db.select('readings', {
    filters: [['created_at', 'gte', new Date(now - 2 * 60_000).toISOString()]],
    limit: 1,
  });
  if (recent.length) return;
  const zones = await listZones();
  const rows = [];
  for (let t = now - HISTORY_MS; t < now; t += STEP_MS) {
    for (const z of zones) {
      const level = levelAt(z, t);
      for (const s of SENSORS[z.id]) {
        rows.push({ zone_id: z.id, sensor_id: s.sensor_id, table_no: s.table_no, db: round1(level + gauss() * 0.8), created_at: new Date(t).toISOString() });
      }
    }
  }
  await db.insert('readings', rows);
}

// ---------------------------------------------------------------- включение и выключение

let timers: ReturnType<typeof setInterval>[] = [];
let enabled = readEnabled();
const listeners = new Set<() => void>();

function readEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

function startLoops() {
  if (timers.length) return;
  const report = (e: unknown) => console.error('[виртуальный зал]', e);
  timers = [
    setInterval(() => void tick().catch(report), STEP_MS),
    setInterval(() => void runControl().catch(report), CONTROL_MS),
  ];
}

function stopLoops() {
  timers.forEach(clearInterval);
  timers = [];
}

/** Запуск при загрузке страницы: история, первое решение алгоритма и циклы датчиков. */
export async function bootVirtualHall() {
  if (!enabled) return;
  const now = Date.now();
  await prepareFreshHall(now);
  await seedHistory(now);
  await runControl();
  startLoops();
}

export async function setSensorsEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    /* только на эту вкладку */
  }
  listeners.forEach((l) => l());
  if (on) await bootVirtualHall();
  else stopLoops();
}

export function useSensorsEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
    () => enabled,
  );
}

/** Полный сброс демо: база к сиду, игроки и вход в админку забыты, зал начинает вечер заново. */
export async function resetDemo() {
  stopLoops();
  getLocalDb()?.reset();
  (globalThis as { __hallControl?: unknown }).__hallControl = undefined;
  clearCookies();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('tm:')) localStorage.removeItem(key);
  } catch {
    /* хранилище недоступно */
  }
  Object.assign(lastLevel, { A: 62, B: 68, C: 74 });
  burst = null;
  nextBurstAt = 0;
  await bootVirtualHall();
}
