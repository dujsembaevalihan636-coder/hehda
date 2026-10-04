import type { HallTable, ZoneId } from './types';

// План зала на 200 мест: SVG viewBox 1000×680. x, y — центр стола.
// Зона A (окна, слева) — столы 1–14, зона B (центр) — 15–30, зона C (бар, справа) — 31–41.

export const HALL_VIEWBOX = { w: 1000, h: 680 };

export const ZONE_RECTS: Record<ZoneId, { x: number; y: number; w: number; h: number }> = {
  A: { x: 12, y: 16, w: 318, h: 640 },
  B: { x: 338, y: 16, w: 318, h: 640 },
  C: { x: 664, y: 16, w: 324, h: 640 },
};

type Shape = HallTable['shape'];
const SIZE: Record<number, { w: number; h: number; shape: Shape }> = {
  2: { w: 32, h: 32, shape: 'round' },
  4: { w: 44, h: 44, shape: 'round' },
  6: { w: 64, h: 38, shape: 'rect' },
  8: { w: 84, h: 42, shape: 'rect' },
};

function t(table_no: number, zone_id: ZoneId, seats: number, x: number, y: number): HallTable {
  const s = SIZE[seats];
  return { table_no, zone_id, seats, x, y, w: s.w, h: s.h, shape: s.shape };
}

export const HALL_TABLES: HallTable[] = [
  // Зона A «Поговорить» — 56 мест
  t(1, 'A', 4, 75, 140),
  t(2, 'A', 4, 165, 140),
  t(3, 'A', 4, 255, 140),
  t(4, 'A', 4, 75, 240),
  t(5, 'A', 2, 165, 240),
  t(6, 'A', 2, 255, 240),
  t(7, 'A', 6, 75, 340),
  t(8, 'A', 6, 165, 340),
  t(9, 'A', 4, 255, 340),
  t(10, 'A', 4, 75, 440),
  t(11, 'A', 2, 165, 440),
  t(12, 'A', 2, 255, 440),
  t(13, 'A', 6, 110, 545),
  t(14, 'A', 6, 220, 545),
  // Зона B «Фон» — 76 мест
  t(15, 'B', 4, 395, 130),
  t(16, 'B', 4, 495, 130),
  t(17, 'B', 4, 595, 130),
  t(18, 'B', 6, 395, 220),
  t(19, 'B', 6, 495, 220),
  t(20, 'B', 6, 595, 220),
  t(21, 'B', 8, 430, 310),
  t(22, 'B', 8, 565, 310),
  t(23, 'B', 4, 395, 400),
  t(24, 'B', 4, 495, 400),
  t(25, 'B', 4, 595, 400),
  t(26, 'B', 6, 395, 490),
  t(27, 'B', 4, 495, 490),
  t(28, 'B', 2, 595, 490),
  t(29, 'B', 2, 395, 580),
  t(30, 'B', 4, 495, 580),
  // Зона C «Движ» у бара — 68 мест
  t(31, 'C', 6, 725, 130),
  t(32, 'C', 6, 840, 130),
  t(33, 'C', 4, 725, 220),
  t(34, 'C', 4, 840, 220),
  t(35, 'C', 8, 725, 310),
  t(36, 'C', 8, 840, 310),
  t(37, 'C', 6, 725, 400),
  t(38, 'C', 6, 840, 400),
  t(39, 'C', 4, 725, 490),
  t(40, 'C', 4, 840, 490),
  { table_no: 41, zone_id: 'C', seats: 12, x: 950, y: 375, w: 36, h: 430, shape: 'bar' },
];

export const TOTAL_SEATS = HALL_TABLES.reduce((s, x) => s + x.seats, 0);

export function zoneOfTable(tableNo: number): ZoneId | null {
  return HALL_TABLES.find((x) => x.table_no === tableNo)?.zone_id ?? null;
}

export function zoneSeats(zone: ZoneId): number {
  return HALL_TABLES.filter((x) => x.zone_id === zone).reduce((s, x) => s + x.seats, 0);
}
