import 'server-only';

import { CONTROL, decide, guestTooLoud, type ActiveAlert, type AlertKind, type ControlEvent, type ZoneEstimate } from '../acoustic/control';
import { getDb } from '../db';
import { HALL_TABLES } from '../hall-layout';
import { bucketize, median } from '../stats';
import type { Atmosphere, Booking, FeedbackType, HallEvent, Reading, Tempo, Zone, ZoneId } from '../types';
import { ATMOSPHERE_ZONE, isZoneId, round1, TEMPOS, ZONE_IDS } from '../zones';
import { serverEnv } from './env';
import { HttpError } from './errors';

const iso = (ms: number) => new Date(ms).toISOString();
const t = (s: string) => Date.parse(s);

export { HttpError };

// ---------------------------------------------------------------- зоны

export async function listZones(): Promise<Zone[]> {
  const zones = await getDb().select('zones', { order: [{ col: 'id' }] });
  return zones.map(normalizeZone);
}

function normalizeZone(z: Zone): Zone {
  return { ...z, music_volume: Number(z.music_volume), target_min_db: Number(z.target_min_db), target_max_db: Number(z.target_max_db) };
}

export async function getZone(id: ZoneId): Promise<Zone> {
  const rows = await getDb().select('zones', { filters: [['id', 'eq', id]] });
  if (!rows[0]) throw new HttpError(404, `Зона ${id} не найдена`);
  return normalizeZone(rows[0]);
}

/** Обновление с оптимистичной блокировкой по version. null — кто-то успел раньше. */
async function updateZoneVersioned(zone: Zone, patch: Partial<Zone>): Promise<Zone | null> {
  const rows = await getDb().update(
    'zones',
    { ...patch, version: zone.version + 1, updated_at: new Date().toISOString() },
    [
      ['id', 'eq', zone.id],
      ['version', 'eq', zone.version],
    ],
  );
  return rows[0] ? normalizeZone(rows[0]) : null;
}

/** Повторяет «прочитал → вычислил → записал», пока не победит гонку. */
async function mutateZone(
  id: ZoneId,
  fn: (z: Zone) => { patch: Partial<Zone>; events: ControlEvent[] } | null,
): Promise<{ zone: Zone; events: ControlEvent[] } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const zone = await getZone(id);
    const res = fn(zone);
    if (!res) return { zone, events: [] };
    const updated = Object.keys(res.patch).length ? await updateZoneVersioned(zone, res.patch) : zone;
    if (!updated) continue;
    if (res.events.length) {
      await getDb().insert(
        'events',
        res.events.map((e) => ({ zone_id: id, type: e.type, payload: e.payload })),
      );
    }
    return { zone: updated, events: res.events };
  }
  return null;
}

// ---------------------------------------------------------------- показания

export async function insertReading(input: { zone_id: ZoneId; sensor_id: string; table_no: number | null; db: number }) {
  const [row] = await getDb().insert('readings', {
    zone_id: input.zone_id,
    sensor_id: input.sensor_id.slice(0, 40),
    table_no: input.table_no,
    db: round1(input.db),
  });
  return row;
}

// ---------------------------------------------------------------- алгоритм

export interface ZoneControlResult {
  zone_id: ZoneId;
  estimate: Omit<ZoneEstimate, 'sensors'> & { sensors: number };
  alerts: ActiveAlert[];
  state: Zone['control_state'];
  decisions: ControlEvent[];
  upcomingGuests30m: number;
}

const g = globalThis as unknown as { __hallControl?: { at: number; result: ZoneControlResult[] }; __hallPrune?: number };

export async function runControl(now = Date.now()): Promise<ZoneControlResult[]> {
  // Несколько открытых дашбордов не должны принимать решения дважды
  if (g.__hallControl && now - g.__hallControl.at < 2_000) return g.__hallControl.result;

  const db = getDb();
  const [zones, readings, events, presses, bookings] = await Promise.all([
    listZones(),
    db.select('readings', { filters: [['created_at', 'gte', iso(now - CONTROL.WINDOW_MS - 5_000)]] }),
    db.select('events', { filters: [['created_at', 'gte', iso(now - CONTROL.FORECAST_REPEAT_MS)]] }),
    db.select('feedback', {
      filters: [
        ['created_at', 'gte', iso(now - 10 * 60_000)],
        ['type', 'eq', 'too_loud'],
      ],
    }),
    db.select('bookings', {
      filters: [
        ['time', 'gte', iso(now - 2 * 3600_000)],
        ['time', 'lte', iso(now + CONTROL.FORECAST_WINDOW_MS)],
      ],
    }),
  ]);

  const results: ZoneControlResult[] = [];
  for (const zone of zones) {
    const zr = readings
      .filter((r) => r.zone_id === zone.id)
      .map((r) => ({ sensor_id: r.sensor_id, table_no: r.table_no, db: Number(r.db), t: t(r.created_at) }));
    const ze = events.filter((e) => e.zone_id === zone.id);
    const lastAlertAt: Partial<Record<AlertKind, number>> = {};
    let lastForecastAt: number | null = null;
    let autoDowns10m = 0;
    for (const e of ze) {
      const et = t(e.created_at);
      if (e.type === 'alert') {
        const k = e.payload.kind as AlertKind;
        lastAlertAt[k] = Math.max(lastAlertAt[k] ?? 0, et);
      }
      if (e.type === 'auto_volume_down' && e.payload.reason === 'forecast') lastForecastAt = Math.max(lastForecastAt ?? 0, et);
      if (e.type === 'auto_volume_down' && e.payload.reason === 'sensor' && et >= now - 10 * 60_000) autoDowns10m++;
    }
    const zb = bookings.filter((b) => b.zone_id === zone.id);
    const upcoming = zb.filter((b) => t(b.time) > now && t(b.time) <= now + CONTROL.FORECAST_WINDOW_MS);
    const upcomingGuests30m = upcoming.reduce((s, b) => s + b.party_size, 0);
    const seated = zb.filter((b) => t(b.time) <= now).sort((a, b) => b.party_size - a.party_size)[0];

    const out = decide({
      zone,
      now,
      readings: zr,
      tooLoudPresses10m: presses.filter((f) => f.zone_id === zone.id).length,
      autoDowns10m,
      lastAlertAt,
      lastForecastAt,
      upcomingGuests30m,
      suspect: seated ? { table_no: seated.table_no, party_size: seated.party_size, guest_name: seated.guest_name } : null,
      forecastThreshold: serverEnv.forecastGuests,
    });

    let applied = true;
    if (Object.keys(out.patch).length) applied = (await updateZoneVersioned(zone, out.patch)) !== null;
    if (applied && out.events.length) {
      await db.insert(
        'events',
        out.events.map((e) => ({ zone_id: zone.id, type: e.type, payload: e.payload })),
      );
    }
    const { sensors, ...est } = out.estimate;
    results.push({
      zone_id: zone.id,
      estimate: { ...est, sensors: sensors.length },
      alerts: out.alerts,
      state: (out.patch.control_state ?? zone.control_state) as Zone['control_state'],
      decisions: applied ? out.events : [],
      upcomingGuests30m,
    });
  }

  g.__hallControl = { at: now, result: results };

  // Хранение показаний 24 часа (страховка, если в Supabase нет pg_cron)
  if (!g.__hallPrune || now - g.__hallPrune > 10 * 60_000) {
    g.__hallPrune = now;
    db.remove('readings', [['created_at', 'lt', iso(now - 24 * 3600_000)]]).catch((e) => console.warn('[prune]', e));
  }
  return results;
}

// ---------------------------------------------------------------- гости

export async function addFeedback(input: { type: FeedbackType; zone_id: ZoneId; table_no: number | null }) {
  const db = getDb();
  await db.insert('feedback', input);
  if (input.type !== 'too_loud') return { ok: true as const };
  const now = Date.now();
  const res = await mutateZone(input.zone_id, (zone) => guestTooLoud(zone, now, input.table_no));
  const ev = res?.events[0]?.payload as { from: number; to: number } | undefined;
  return { ok: true as const, from: ev?.from ?? null, to: ev?.to ?? null };
}

// ---------------------------------------------------------------- менеджер

export interface ManualChanges {
  music_volume?: number;
  tempo?: Tempo;
  auto_mode?: boolean;
  target_min_db?: number;
  target_max_db?: number;
}

export async function manualUpdate(id: ZoneId, changes: ManualChanges) {
  const now = new Date().toISOString();
  const res = await mutateZone(id, (zone) => {
    const patch: Partial<Zone> = {};
    const from: Record<string, unknown> = {};
    if (changes.music_volume !== undefined) {
      const v = Math.round(Math.min(1, Math.max(0, changes.music_volume)) * 100) / 100;
      if (v !== zone.music_volume) {
        patch.music_volume = v;
        patch.last_change_at = now;
        from.music_volume = zone.music_volume;
      }
    }
    if (changes.tempo && TEMPOS.includes(changes.tempo) && changes.tempo !== zone.tempo) {
      patch.tempo = changes.tempo;
      patch.last_change_at = now;
      patch.last_tempo_change_at = now;
      from.tempo = zone.tempo;
    }
    if (changes.auto_mode !== undefined && changes.auto_mode !== zone.auto_mode) {
      patch.auto_mode = changes.auto_mode;
      from.auto_mode = zone.auto_mode;
    }
    const min = changes.target_min_db ?? zone.target_min_db;
    const max = changes.target_max_db ?? zone.target_max_db;
    if (min !== zone.target_min_db || max !== zone.target_max_db) {
      if (!(min >= 30 && max <= 100 && max - min >= 2)) throw new HttpError(400, 'Цель: от 30 до 100 дБ, ширина не меньше 2 дБ');
      patch.target_min_db = min;
      patch.target_max_db = max;
      from.target = [zone.target_min_db, zone.target_max_db];
    }
    if (!Object.keys(patch).length) return null;
    const to = Object.fromEntries(Object.keys(from).map((k) => [k, k === 'target' ? [min, max] : patch[k as keyof Zone]]));
    return { patch, events: [{ type: 'manual', payload: { from, to } }] };
  });
  if (!res) throw new HttpError(409, 'Не удалось сохранить: попробуйте ещё раз');
  return res.zone;
}

/** Калибровка «пустой зал»: текущая медиана = вклад музыки при текущей громкости. */
export async function calibrateEmptyHall(id: ZoneId) {
  const now = Date.now();
  const readings = await getDb().select('readings', {
    filters: [
      ['zone_id', 'eq', id],
      ['created_at', 'gte', iso(now - CONTROL.WINDOW_MS)],
    ],
  });
  if (readings.length < CONTROL.MIN_READINGS) throw new HttpError(400, 'Нет данных датчика за последние 30 секунд');
  const level = round1(median(readings.map((r) => Number(r.db))) as number);
  const res = await mutateZone(id, (zone) => ({
    patch: { music_ref_db: level, music_ref_volume: zone.music_volume },
    events: [{ type: 'manual', payload: { calibrated: true, music_ref_db: level, volume: zone.music_volume } }],
  }));
  if (!res) throw new HttpError(409, 'Не удалось сохранить калибровку');
  return res.zone;
}

// ---------------------------------------------------------------- снимки для страниц

export async function hallSnapshot(minutes = 15) {
  const db = getDb();
  const now = Date.now();
  const [zones, readings, events, feedback, bookings] = await Promise.all([
    listZones(),
    db.select('readings', { filters: [['created_at', 'gte', iso(now - minutes * 60_000)]], order: [{ col: 'created_at' }] }),
    db.select('events', { order: [{ col: 'created_at', asc: false }], limit: 80 }),
    db.select('feedback', { filters: [['created_at', 'gte', iso(now - 24 * 3600_000)]] }),
    db.select('bookings', {
      filters: [
        ['time', 'gte', iso(now - 3 * 3600_000)],
        ['time', 'lte', iso(now + 6 * 3600_000)],
      ],
      order: [{ col: 'time' }],
    }),
  ]);
  return {
    now,
    zones,
    tables: HALL_TABLES,
    readings: readings.map(slimReading),
    events,
    feedback,
    bookings,
  };
}

export type SlimReading = Pick<Reading, 'zone_id' | 'sensor_id' | 'table_no' | 'db' | 'created_at'>;
export const slimReading = (r: Reading): SlimReading => ({
  zone_id: r.zone_id,
  sensor_id: r.sensor_id,
  table_no: r.table_no,
  db: Number(r.db),
  created_at: r.created_at,
});

/** Публичная «пробочная» карта для гостей: без имён и броней. */
export async function publicHall() {
  const db = getDb();
  const now = Date.now();
  const [zones, readings, bookings] = await Promise.all([
    listZones(),
    db.select('readings', { filters: [['created_at', 'gte', iso(now - 60_000)]] }),
    db.select('bookings', {
      filters: [
        ['time', 'gte', iso(now - 2 * 3600_000)],
        ['time', 'lte', iso(now + 2 * 3600_000)],
      ],
    }),
  ]);
  return {
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      target_min_db: z.target_min_db,
      target_max_db: z.target_max_db,
      level: levelOf(readings.filter((r) => r.zone_id === z.id), now),
    })),
    tables: HALL_TABLES,
    busyTables: [...new Set(bookings.map((b) => b.table_no))],
  };
}

function levelOf(rows: Reading[], now: number): number | null {
  const recent = rows.filter((r) => t(r.created_at) >= now - CONTROL.WINDOW_MS);
  const m = median(recent.map((r) => Number(r.db)));
  return m === null ? null : round1(m);
}

export async function hallMetrics() {
  const db = getDb();
  const now = Date.now();
  const [zones, feedback, readings] = await Promise.all([
    listZones(),
    db.select('feedback', { filters: [['created_at', 'gte', iso(now - 24 * 3600_000)]] }),
    db.select('readings', { filters: [['created_at', 'gte', iso(now - 60 * 60_000)]] }),
  ]);
  return {
    zones: zones.map((z) => {
      const fb = feedback.filter((f) => f.zone_id === z.id);
      const yes = fb.filter((f) => f.type === 'could_hear_yes').length;
      const no = fb.filter((f) => f.type === 'could_hear_no').length;
      const tooLoud = fb.filter((f) => f.type === 'too_loud').length;
      const buckets = bucketize(
        readings.filter((r) => r.zone_id === z.id).map((r) => ({ t: t(r.created_at), db: Number(r.db) })),
        30_000,
      );
      const inTarget = buckets.filter((b) => b.db >= z.target_min_db && b.db <= z.target_max_db).length;
      return {
        zone_id: z.id,
        heard_yes: yes,
        heard_no: no,
        heard_pct: yes + no ? yes / (yes + no) : null,
        too_loud_24h: tooLoud,
        in_target_pct: buckets.length ? inTarget / buckets.length : null,
        minutes_measured: Math.round((buckets.length * 30) / 60),
      };
    }),
  };
}

// ---------------------------------------------------------------- брони

const ZONE_PREFS: Record<Atmosphere, ZoneId[]> = {
  talk: ['A', 'B'],
  background: ['B', 'A', 'C'],
  lively: ['C', 'B'],
};
const BOOKING_HOURS = 2;

export async function createBooking(input: { guest_name: string; party_size: number; time: string; atmosphere: Atmosphere }) {
  const when = t(input.time);
  if (Number.isNaN(when)) throw new HttpError(400, 'Некорректное время');
  if (input.party_size < 1 || input.party_size > 8) throw new HttpError(400, 'Онлайн-бронь — до 8 гостей. Для большой компании позвоните нам.');
  const db = getDb();
  const busy = await db.select('bookings', {
    filters: [
      ['time', 'gt', iso(when - BOOKING_HOURS * 3600_000)],
      ['time', 'lt', iso(when + BOOKING_HOURS * 3600_000)],
    ],
  });
  const busySet = new Set(busy.map((b) => b.table_no));
  const preferred = ATMOSPHERE_ZONE[input.atmosphere];
  for (const zone of ZONE_PREFS[input.atmosphere]) {
    const table = HALL_TABLES.filter((x) => x.zone_id === zone && x.shape !== 'bar' && x.seats >= input.party_size && !busySet.has(x.table_no)).sort(
      (a, b) => a.seats - b.seats || a.table_no - b.table_no,
    )[0];
    if (!table) continue;
    const [booking] = await db.insert('bookings', {
      guest_name: input.guest_name.slice(0, 60),
      party_size: input.party_size,
      time: iso(when),
      atmosphere: input.atmosphere,
      zone_id: zone,
      table_no: table.table_no,
    });
    return { booking: booking as Booking, moved: zone !== preferred, preferred };
  }
  throw new HttpError(409, 'На это время свободных столов нет — попробуйте другое время');
}

export function assertZone(v: unknown): ZoneId {
  if (!isZoneId(v)) throw new HttpError(400, 'Неизвестная зона');
  return v;
}

export { ZONE_IDS };
export type { HallEvent };
