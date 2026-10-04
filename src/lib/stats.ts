// Небольшие статистические помощники для уровней шума.

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Энергетическое среднее уровней в дБ (Leq). */
export function energyMean(dbs: number[]): number | null {
  if (!dbs.length) return null;
  const e = dbs.reduce((s, d) => s + Math.pow(10, d / 10), 0) / dbs.length;
  return 10 * Math.log10(e);
}

export interface Point {
  t: number; // ms
  db: number;
}

/** Группировка точек по корзинам времени; значение корзины — медиана. */
export function bucketize(points: Point[], bucketMs: number): Point[] {
  const map = new Map<number, number[]>();
  for (const p of points) {
    const k = Math.floor(p.t / bucketMs) * bucketMs;
    const arr = map.get(k);
    if (arr) arr.push(p.db);
    else map.set(k, [p.db]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, arr]) => ({ t, db: median(arr) as number }));
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
