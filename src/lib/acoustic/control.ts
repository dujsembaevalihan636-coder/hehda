import { median } from '../stats';
import type { EventType, Tempo, Zone } from '../types';
import { musicDbAt, round1, round2, subtractDb, TEMPOS, tempoIndex, ZONES } from '../zones';

// Алгоритм удержания целевого уровня шума в зоне. Чистая функция: один и тот же код
// работает в /api/control (реальные датчики) и в «Симуляции пятницы» (виртуальное время).

export const CONTROL = {
  WINDOW_MS: 30_000, // медиана за 30 секунд
  LATEST_MS: 6_000, // «текущее» значение для крупной цифры
  MIN_READINGS: 3,
  LOUD_MARGIN_DB: 3, // громко: медиана > target_max + 3
  LOUD_EXIT_DB: 1, // гистерезис: «громко» снимается ниже target_max + 1
  QUIET_EXIT_DB: 2, // «тихо» снимается выше target_min + 2
  ABOVE_EXIT_DB: 1,
  PAUSE_MS: 60_000, // пауза между изменениями, чтобы музыка не «дёргалась»
  TEMPO_AFTER_MS: 120_000, // громко дольше 2 минут → темп слабее
  STEP_DOWN: 0.1,
  STEP_UP: 0.05,
  GUEST_STEP: 0.05, // кнопка «Громко?»
  MIN_VOLUME: 0.15,
  MAX_AUTO_VOLUME: 0.9,
  ALERT_ABOVE_MS: 5 * 60_000,
  ALERT_PRESSES: 3,
  ALERT_REPEAT_MS: 10 * 60_000,
  GUEST_DOMINANT_DB: 6, // гости громче музыки на 6+ дБ
  HOT_SENSOR_DB: 6, // один датчик громче остальных на 6+ дБ
  STUCK_DOWNS: 3, // 3 снижения за 10 минут без эффекта
  FORECAST_WINDOW_MS: 30 * 60_000,
  FORECAST_GUESTS: 16,
  FORECAST_STEP: 0.1,
  FORECAST_FLOOR: 0.35,
  FORECAST_REPEAT_MS: 30 * 60_000,
} as const;

export type AlertKind = 'above_5min' | 'guest_presses' | 'relocate';

export interface ControlReading {
  sensor_id: string;
  table_no: number | null;
  db: number;
  t: number; // ms
}

export interface SensorStat {
  sensor_id: string;
  table_no: number | null;
  median: number;
  count: number;
}

export interface ZoneEstimate {
  median30: number | null;
  latest: number | null;
  musicDb: number | null;
  guestDb: number | null;
  musicDominant: boolean;
  sensors: SensorStat[];
  hotSensor: SensorStat | null;
}

export interface Suspect {
  table_no: number;
  party_size: number;
  guest_name?: string;
}

export interface ControlInput {
  zone: Zone;
  now: number;
  readings: ControlReading[];
  tooLoudPresses10m: number;
  autoDowns10m: number;
  lastAlertAt: Partial<Record<AlertKind, number>>;
  lastForecastAt: number | null;
  upcomingGuests30m: number;
  suspect?: Suspect | null;
  forecastThreshold?: number;
}

export interface ActiveAlert {
  kind: AlertKind;
  data: Record<string, unknown>;
}

export interface ControlEvent {
  type: EventType;
  payload: Record<string, unknown>;
}

export interface ControlOutput {
  patch: Partial<Zone>;
  events: ControlEvent[];
  alerts: ActiveAlert[];
  estimate: ZoneEstimate;
}

const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const iso = (ms: number) => new Date(ms).toISOString();

export function estimateZone(zone: Zone, readings: ControlReading[], now: number): ZoneEstimate {
  const recent = readings.filter((r) => r.t >= now - CONTROL.WINDOW_MS && r.t <= now + 5_000);
  const latestPts = recent.filter((r) => r.t >= now - CONTROL.LATEST_MS);
  const median30 = recent.length >= CONTROL.MIN_READINGS ? median(recent.map((r) => r.db)) : null;
  const latest = median((latestPts.length ? latestPts : recent).map((r) => r.db));

  // Медианы по датчикам — чтобы заметить, что шумит одна компания
  const bySensor = new Map<string, ControlReading[]>();
  for (const r of recent) {
    const arr = bySensor.get(r.sensor_id);
    if (arr) arr.push(r);
    else bySensor.set(r.sensor_id, [r]);
  }
  const sensors: SensorStat[] = [...bySensor.entries()]
    .filter(([, arr]) => arr.length >= CONTROL.MIN_READINGS)
    .map(([sensor_id, arr]) => ({
      sensor_id,
      table_no: arr[arr.length - 1].table_no,
      median: median(arr.map((r) => r.db)) as number,
      count: arr.length,
    }));
  let hotSensor: SensorStat | null = null;
  if (sensors.length >= 2) {
    for (const s of sensors) {
      const others = median(sensors.filter((o) => o !== s).map((o) => o.median)) as number;
      if (s.median - others >= CONTROL.HOT_SENSOR_DB && (!hotSensor || s.median > hotSensor.median)) hotSensor = s;
    }
  }

  const meta = ZONES[zone.id];
  const musicDb = musicDbAt(
    zone.music_volume,
    zone.music_ref_db ?? meta.musicRefDb,
    zone.music_ref_volume ?? meta.musicRefVolume,
  );
  const level = median30 ?? latest;
  const guestDb = level === null ? null : subtractDb(level, musicDb);
  return {
    median30,
    latest,
    musicDb: musicDb === null ? null : round1(musicDb),
    guestDb: guestDb === null ? null : round1(guestDb),
    musicDominant: level !== null && guestDb === null,
    sensors,
    hotSensor,
  };
}

export function decide(input: ControlInput): ControlOutput {
  const z = input.zone;
  const now = input.now;
  const est = estimateZone(z, input.readings, now);
  const patch: Partial<Zone> = {};
  const events: ControlEvent[] = [];
  const alerts: ActiveAlert[] = [];
  const L = est.median30;
  const max = z.target_max_db;
  const min = z.target_min_db;

  let state = z.control_state;
  let stateSince = ts(z.state_since) ?? now;
  let aboveSince = ts(z.above_since);
  let relocate = false;
  let changed = false;

  if (L !== null) {
    // «Выше цели» — для алерта «больше 5 минут»
    if (L > max) {
      if (aboveSince === null) {
        aboveSince = now;
        patch.above_since = iso(now);
      }
    } else if (L <= max - CONTROL.ABOVE_EXIT_DB && aboveSince !== null) {
      aboveSince = null;
      patch.above_since = null;
    }

    // Состояния с гистерезисом
    let next = state;
    if (state === 'loud') {
      if (L < max + CONTROL.LOUD_EXIT_DB) next = L < min ? 'quiet' : 'ok';
    } else if (state === 'quiet') {
      if (L > max + CONTROL.LOUD_MARGIN_DB) next = 'loud';
      else if (L > min + CONTROL.QUIET_EXIT_DB) next = 'ok';
    } else {
      if (L > max + CONTROL.LOUD_MARGIN_DB) next = 'loud';
      else if (L < min) next = 'quiet';
    }
    if (next !== state) {
      state = next;
      stateSince = now;
      patch.control_state = next;
      patch.state_since = iso(now);
    }

    // «Предложите пересадку» вместо бесконечного снижения музыки:
    //  • один датчик (стол) громче остальных на 6+ дБ и сам выше порога «громко»;
    //  • или зона громкая из-за гостей (не музыки), а снижать уже бесполезно.
    const guestDominant =
      est.guestDb !== null && (est.musicDb === null || est.guestDb - est.musicDb >= CONTROL.GUEST_DOMINANT_DB);
    const atMin = z.music_volume <= CONTROL.MIN_VOLUME + 1e-6;
    const stuck = atMin || input.autoDowns10m >= CONTROL.STUCK_DOWNS;
    const hotLoud = est.hotSensor !== null && est.hotSensor.median > max + CONTROL.LOUD_MARGIN_DB;
    relocate = hotLoud || (state === 'loud' && guestDominant && stuck);

    const lastChange = ts(z.last_change_at);
    const canChange = lastChange === null || now - lastChange >= CONTROL.PAUSE_MS;

    if (z.auto_mode && canChange && !relocate) {
      const lastTempo = ts(z.last_tempo_change_at);
      const tempoReady = lastTempo === null || now - lastTempo >= CONTROL.TEMPO_AFTER_MS;
      const inStateFor = now - stateSince;

      if (state === 'loud') {
        const from = z.music_volume;
        const to = round2(Math.max(CONTROL.MIN_VOLUME, from - CONTROL.STEP_DOWN));
        let tempoTo: Tempo = z.tempo;
        if (inStateFor >= CONTROL.TEMPO_AFTER_MS && tempoReady && tempoIndex(z.tempo) > 0) {
          tempoTo = TEMPOS[tempoIndex(z.tempo) - 1];
        }
        if (to < from || tempoTo !== z.tempo) {
          patch.music_volume = to;
          patch.last_change_at = iso(now);
          if (tempoTo !== z.tempo) {
            patch.tempo = tempoTo;
            patch.last_tempo_change_at = iso(now);
          }
          events.push({
            type: to < from ? 'auto_volume_down' : 'tempo_change',
            payload: {
              reason: 'sensor',
              db: round1(L),
              from,
              to,
              tempo_from: z.tempo,
              tempo_to: tempoTo,
              guest_db: est.guestDb,
              music_db: est.musicDb,
              loud_for_s: Math.round(inStateFor / 1000),
            },
          });
          changed = true;
        }
      } else if (state === 'quiet') {
        const from = z.music_volume;
        const to = round2(Math.min(CONTROL.MAX_AUTO_VOLUME, from + CONTROL.STEP_UP));
        const maxTempo = ZONES[z.id].maxTempo;
        let tempoTo: Tempo = z.tempo;
        if (inStateFor >= CONTROL.TEMPO_AFTER_MS && tempoReady && tempoIndex(z.tempo) < tempoIndex(maxTempo)) {
          tempoTo = TEMPOS[tempoIndex(z.tempo) + 1];
        }
        if (to > from || tempoTo !== z.tempo) {
          patch.music_volume = to;
          patch.last_change_at = iso(now);
          if (tempoTo !== z.tempo) {
            patch.tempo = tempoTo;
            patch.last_tempo_change_at = iso(now);
          }
          events.push({
            type: to > from ? 'auto_volume_up' : 'tempo_change',
            payload: { reason: 'too_quiet', db: round1(L), from, to, tempo_from: z.tempo, tempo_to: tempoTo },
          });
          changed = true;
        }
      }
    }
  }

  // Прогноз по броням: большая волна гостей через ≤30 минут → заранее снижаем стартовую громкость
  const threshold = input.forecastThreshold ?? CONTROL.FORECAST_GUESTS;
  const lastChange = ts(patch.last_change_at ?? z.last_change_at);
  const canChangeNow = lastChange === null || now - lastChange >= CONTROL.PAUSE_MS;
  if (
    z.auto_mode &&
    !changed &&
    canChangeNow &&
    state !== 'quiet' &&
    input.upcomingGuests30m >= threshold &&
    (input.lastForecastAt === null || now - input.lastForecastAt >= CONTROL.FORECAST_REPEAT_MS) &&
    z.music_volume > CONTROL.FORECAST_FLOOR + 1e-6
  ) {
    const from = z.music_volume;
    const to = round2(Math.max(CONTROL.FORECAST_FLOOR, from - CONTROL.FORECAST_STEP));
    patch.music_volume = to;
    patch.last_change_at = iso(now);
    events.push({
      type: 'auto_volume_down',
      payload: { reason: 'forecast', guests: input.upcomingGuests30m, from, to, db: L === null ? null : round1(L) },
    });
  }

  // Алерты менеджеру
  if (aboveSince !== null && now - aboveSince > CONTROL.ALERT_ABOVE_MS) {
    alerts.push({ kind: 'above_5min', data: { minutes: Math.floor((now - aboveSince) / 60_000), db: L === null ? null : round1(L) } });
  }
  if (input.tooLoudPresses10m >= CONTROL.ALERT_PRESSES) {
    alerts.push({ kind: 'guest_presses', data: { count: input.tooLoudPresses10m } });
  }
  if (relocate) {
    const hot = est.hotSensor;
    alerts.push({
      kind: 'relocate',
      data: {
        db: L === null ? null : round1(L),
        guest_db: est.guestDb,
        music_db: est.musicDb,
        sensor_id: hot?.sensor_id ?? null,
        table_no: hot?.table_no ?? input.suspect?.table_no ?? null,
        party_size: input.suspect && (!hot?.table_no || hot.table_no === input.suspect.table_no) ? input.suspect.party_size : null,
        music_at_min: z.music_volume <= CONTROL.MIN_VOLUME + 1e-6,
      },
    });
  }
  for (const a of alerts) {
    const last = input.lastAlertAt[a.kind];
    if (last === undefined || now - last >= CONTROL.ALERT_REPEAT_MS) {
      events.push({ type: 'alert', payload: { kind: a.kind, ...a.data } });
    }
  }

  return { patch, events, alerts, estimate: est };
}

/** Мгновенная реакция на кнопку «Громко?»: −5% громкости. */
export function guestTooLoud(zone: Zone, now: number, tableNo: number | null): ControlOutput {
  const from = zone.music_volume;
  const to = round2(Math.max(CONTROL.MIN_VOLUME, from - CONTROL.GUEST_STEP));
  const patch: Partial<Zone> = to < from ? { music_volume: to, last_change_at: iso(now) } : {};
  return {
    patch,
    events: [{ type: 'auto_volume_down', payload: { reason: 'guest', table_no: tableNo, from, to } }],
    alerts: [],
    estimate: { median30: null, latest: null, musicDb: null, guestDb: null, musicDominant: false, sensors: [], hotSensor: null },
  };
}
