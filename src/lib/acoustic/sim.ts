import { seedZones } from '../db/seed';
import type { HallEvent, Tempo, Zone, ZoneId } from '../types';
import { musicDbAt, round1, sumDb, ZONE_IDS, ZONES } from '../zones';
import { decide, type AlertKind, type ControlReading } from './control';

// «Симуляция пятницы 20:00–23:00»: синтетический зал, где гости говорят громче на фоне
// музыки и друг друга (эффект Ломбарда). Без системы музыка стоит как есть; с системой
// каждую виртуальную минуту работает тот же алгоритм decide(), что и в /api/control.

export const SIM_MINUTES = 180;
const START = Date.UTC(2026, 9, 9, 17, 0, 0); // 20:00 по Алматы (UTC+5) — для меток берём локальные HH:MM ниже

interface ZoneModel {
  base: number; // уровень разговоров при полной посадке без фона, дБ
  theta: number; // порог, с которого гости начинают перекрикивать фон
  occupancy: [number, number][]; // [минута, доля занятых мест]
}

const MODEL: Record<ZoneId, ZoneModel> = {
  A: { base: 57.5, theta: 54, occupancy: [[0, 0.35], [55, 1], [135, 1], [180, 0.7]] },
  B: { base: 62.5, theta: 57, occupancy: [[0, 0.4], [70, 1], [150, 0.95], [180, 0.8]] },
  C: { base: 66, theta: 61, occupancy: [[0, 0.3], [60, 0.75], [110, 1], [180, 1]] },
};

const LOMBARD = 0.5; // +0.5 дБ голоса на каждый дБ фона выше порога
const TEMPO_EFFECT: Record<Tempo, number> = { slow: -1.2, mid: 0, fast: 1.2 };

// Всплески вечера: [зона, начало, конец, +дБ, подпись]
const BURSTS: [ZoneId, number, number, number, string][] = [
  ['B', 100, 106, 5, 'день рождения за столом 21'],
  ['A', 125, 150, 4, 'шумная компания за столом 7'],
  ['C', 150, 162, 3, 'гол на экране у бара'],
];

// Без системы музыку крутят «на глаз»: зал наполняется — бармен прибавляет звук.
const MANUAL_SCHEDULE: [number, Record<ZoneId, number>][] = [
  [55, { A: 0.75, B: 0.8, C: 0.85 }],
  [115, { A: 0.8, B: 0.85, C: 0.9 }],
];

// Брони: волна гостей (зона, минута прихода, гостей)
const BOOKINGS: [ZoneId, number, number][] = [
  ['A', 60, 18],
  ['B', 75, 20],
];

export interface SimPoint {
  m: number;
  A: number;
  B: number;
  C: number;
  volA: number;
  volB: number;
  volC: number;
}

export interface SimStats {
  inTarget: number; // доля минут в цели
  red: number; // минут громче цели + 3
  mean: number;
  max: number;
}

export interface SimResult {
  points: SimPoint[];
  stats: Record<ZoneId, SimStats>;
  events: (Pick<HallEvent, 'type' | 'zone_id' | 'payload' | 'created_at'> & { m: number })[];
}

function interp(points: [number, number][], m: number) {
  for (let i = 1; i < points.length; i++) {
    const [m0, v0] = points[i - 1];
    const [m1, v1] = points[i];
    if (m <= m1) return v0 + ((v1 - v0) * (m - m0)) / (m1 - m0);
  }
  return points[points.length - 1][1];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export const simTime = (m: number) => START + m * 60_000;

/** Метка времени «20:00 + m минут» независимо от часового пояса браузера. */
export function simLabel(m: number) {
  const total = 20 * 60 + Math.round(m);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function simulateFriday(withSystem: boolean, seed = 42): SimResult {
  const r = rng(seed);
  const zones: Record<ZoneId, Zone> = Object.fromEntries(seedZones(new Date(START).toISOString()).map((z) => [z.id, z])) as Record<
    ZoneId,
    Zone
  >;
  const lastL: Record<ZoneId, number> = { A: 55, B: 58, C: 64 };
  const relocated: Partial<Record<ZoneId, number>> = {};
  const lastAlert: Record<ZoneId, Partial<Record<AlertKind, number>>> = { A: {}, B: {}, C: {} };
  const lastForecast: Record<ZoneId, number | null> = { A: null, B: null, C: null };
  const downs: Record<ZoneId, number[]> = { A: [], B: [], C: [] };
  const points: SimPoint[] = [];
  const events: SimResult['events'] = [];
  const levels: Record<ZoneId, number[]> = { A: [], B: [], C: [] };

  for (let m = 0; m <= SIM_MINUTES; m++) {
    const now = simTime(m);
    const row = { m } as SimPoint;
    if (!withSystem) {
      for (const [at, vols] of MANUAL_SCHEDULE) {
        if (at !== m) continue;
        for (const id of ZONE_IDS) {
          events.push({
            m,
            type: 'manual',
            zone_id: id,
            payload: { from: { music_volume: zones[id].music_volume }, to: { music_volume: vols[id] } },
            created_at: new Date(now).toISOString(),
          });
          zones[id] = { ...zones[id], music_volume: vols[id] };
        }
      }
    }
    for (const id of ZONE_IDS) {
      const z = zones[id];
      const model = MODEL[id];
      const occ = interp(model.occupancy, m);
      let g0 = model.base + 8 * Math.log10(Math.max(occ, 0.05)) + TEMPO_EFFECT[z.tempo];
      for (const [bz, b0, b1, db] of BURSTS) {
        if (bz !== id || m < b0 || m > b1) continue;
        // Менеджер пересадил шумную компанию по алерту — всплеск в зоне заканчивается
        if (relocated[id] !== undefined && m >= (relocated[id] as number) + 3) continue;
        g0 += db;
      }
      if (id === 'C' && relocated.A !== undefined && m >= relocated.A + 3 && m <= 150) g0 += 1; // компания пересела к бару

      const music = musicDbAt(z.music_volume, z.music_ref_db ?? ZONES[id].musicRefDb, z.music_ref_volume ?? ZONES[id].musicRefVolume);
      const guests = g0 + LOMBARD * Math.max(0, lastL[id] - model.theta);
      const L = (sumDb(music, guests) as number) + gauss(r) * 0.7;
      lastL[id] = L;
      levels[id].push(L);
      row[id] = round1(L);
      row[`vol${id}` as 'volA'] = z.music_volume;

      if (!withSystem) continue;
      // Синтетические показания датчика за последние 30 секунд
      const readings: ControlReading[] = Array.from({ length: 15 }, (_, i) => ({
        sensor_id: 'sim',
        table_no: null,
        db: L + gauss(r) * 0.8,
        t: now - i * 2000,
      }));
      const upcoming = BOOKINGS.filter(([bz, at]) => bz === id && at > m && at <= m + 30).reduce((s, [, , n]) => s + n, 0);
      const out = decide({
        zone: z,
        now,
        readings,
        tooLoudPresses10m: 0,
        autoDowns10m: downs[id].filter((t) => t >= now - 10 * 60_000).length,
        lastAlertAt: lastAlert[id],
        lastForecastAt: lastForecast[id],
        upcomingGuests30m: upcoming,
        suspect: id === 'A' && m >= 125 && m <= 150 ? { table_no: 7, party_size: 6 } : null,
      });
      zones[id] = { ...z, ...out.patch };
      for (const e of out.events) {
        events.push({ m, type: e.type, zone_id: id, payload: e.payload, created_at: new Date(now).toISOString() });
        if (e.type === 'auto_volume_down' && e.payload.reason === 'sensor') downs[id].push(now);
        if (e.type === 'auto_volume_down' && e.payload.reason === 'forecast') lastForecast[id] = now;
        if (e.type === 'alert') {
          const kind = e.payload.kind as AlertKind;
          lastAlert[id][kind] = now;
          if (kind === 'relocate' && relocated[id] === undefined) relocated[id] = m;
        }
      }
    }
    points.push(row);
  }

  const stats = Object.fromEntries(
    ZONE_IDS.map((id) => {
      const z = ZONES[id];
      const ls = levels[id];
      const inTarget = ls.filter((l) => l >= z.targetMin && l <= z.targetMax).length / ls.length;
      const red = ls.filter((l) => l > z.targetMax + 3).length;
      const mean = 10 * Math.log10(ls.reduce((s, l) => s + Math.pow(10, l / 10), 0) / ls.length);
      return [id, { inTarget, red, mean: round1(mean), max: round1(Math.max(...ls)) }];
    }),
  ) as Record<ZoneId, SimStats>;

  return { points, stats, events };
}
