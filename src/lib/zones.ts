import type { Atmosphere, Tempo, ZoneId } from './types';

// Мета-информация о зонах и общие акустические формулы (используются и на сервере, и в браузере).

export const ZONE_IDS: ZoneId[] = ['A', 'B', 'C'];

export interface ZoneMeta {
  id: ZoneId;
  name: string;
  title: string;
  atmosphere: Atmosphere;
  targetMin: number;
  targetMax: number;
  defaultVolume: number;
  defaultTempo: Tempo;
  maxTempo: Tempo;
  musicRefDb: number; // ориентир «пустой зал» до калибровки
  musicRefVolume: number;
  hue: string; // фирменный цвет зоны на графиках
}

export const ZONES: Record<ZoneId, ZoneMeta> = {
  A: {
    id: 'A',
    name: 'Поговорить',
    title: 'Зона A «Поговорить»',
    atmosphere: 'talk',
    targetMin: 60,
    targetMax: 65,
    defaultVolume: 0.6,
    defaultTempo: 'mid',
    maxTempo: 'mid',
    musicRefDb: 60,
    musicRefVolume: 0.6,
    hue: '#3987e5',
  },
  B: {
    id: 'B',
    name: 'Фон',
    title: 'Зона B «Фон»',
    atmosphere: 'background',
    targetMin: 65,
    targetMax: 72,
    defaultVolume: 0.65,
    defaultTempo: 'mid',
    maxTempo: 'mid',
    musicRefDb: 64,
    musicRefVolume: 0.65,
    hue: '#d55181',
  },
  C: {
    id: 'C',
    name: 'Движ',
    title: 'Зона C «Движ» у бара',
    atmosphere: 'lively',
    targetMin: 72,
    targetMax: 80,
    defaultVolume: 0.75,
    defaultTempo: 'fast',
    maxTempo: 'fast',
    musicRefDb: 71,
    musicRefVolume: 0.75,
    hue: '#c98500',
  },
};

export const ATMOSPHERE_ZONE: Record<Atmosphere, ZoneId> = {
  talk: 'A',
  background: 'B',
  lively: 'C',
};

export const TEMPOS: Tempo[] = ['slow', 'mid', 'fast'];
export const TEMPO_LABEL: Record<Tempo, string> = {
  slow: 'медленный',
  mid: 'средний',
  fast: 'быстрый',
};
export const TEMPO_BPM: Record<Tempo, number> = { slow: 72, mid: 96, fast: 120 };

export const tempoIndex = (t: Tempo) => TEMPOS.indexOf(t);

export function isZoneId(v: unknown): v is ZoneId {
  return v === 'A' || v === 'B' || v === 'C';
}

export function parseZone(v: unknown, fallback: ZoneId = 'A'): ZoneId {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  return isZoneId(s) ? s : fallback;
}

// ---------- Громкость ----------

/** Диапазон регулятора громкости в дБ: 1.0 → 0 дБ, 0.5 → −20 дБ, 0.15 → −34 дБ. */
export const VOLUME_RANGE_DB = 40;

/** Перевод «громкости» 0..1 (как на пульте) в линейное усиление для GainNode. */
export function gainFromVolume(v: number): number {
  if (v <= 0.001) return 0;
  return Math.pow(10, (-VOLUME_RANGE_DB * (1 - Math.min(1, v))) / 20);
}

/** Оценка вклада музыки (дБ) по калибровке «пустой зал». */
export function musicDbAt(volume: number, refDb: number, refVolume: number): number | null {
  if (volume <= 0.001) return null;
  return refDb + VOLUME_RANGE_DB * (volume - refVolume);
}

/** Энергетическое вычитание: уровень «гостей» = измеренный − музыка. */
export function subtractDb(totalDb: number, musicDb: number | null): number | null {
  if (musicDb === null) return totalDb;
  if (totalDb - musicDb <= 0.5) return null; // почти всё — музыка
  return 10 * Math.log10(Math.pow(10, totalDb / 10) - Math.pow(10, musicDb / 10));
}

export function sumDb(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return 10 * Math.log10(Math.pow(10, a / 10) + Math.pow(10, b / 10));
}

// ---------- Цвет уровня ----------

export type LevelStatus = 'ok' | 'warn' | 'bad' | 'none';

/** Зелёный — в цели, жёлтый — выход до 3 дБ (или тише цели), красный — громче цели больше чем на 3 дБ. */
export function levelStatus(db: number | null | undefined, min: number, max: number): LevelStatus {
  if (db === null || db === undefined || Number.isNaN(db)) return 'none';
  if (db > max + 3) return 'bad';
  if (db > max) return 'warn';
  if (db < min) return 'warn';
  return 'ok';
}

// Статусная палитра фиксирована и не пересекается с цветами зон; всегда идёт с подписью.
export const STATUS_COLOR: Record<LevelStatus, string> = {
  ok: '#0ca30c',
  warn: '#fab219',
  bad: '#d03b3b',
  none: '#6b5d52',
};

export const STATUS_LABEL: Record<LevelStatus, string> = {
  ok: 'в цели',
  warn: 'на грани',
  bad: 'громко',
  none: 'нет данных',
};

/** «Пробки» для гостей: тихо / умеренно / шумно — по абсолютному уровню. */
export function trafficLabel(db: number | null): { label: string; color: string } {
  if (db === null) return { label: 'нет данных', color: STATUS_COLOR.none };
  if (db < 64) return { label: 'тихо', color: STATUS_COLOR.ok };
  if (db < 72) return { label: 'умеренно', color: STATUS_COLOR.warn };
  return { label: 'шумно', color: STATUS_COLOR.bad };
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;
