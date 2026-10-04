import { z } from 'zod';

import { assertZone, insertReading } from '@/lib/server/hall';
import { body, route } from '@/lib/server/http';

// Датчик присылает только число (дБ) раз в 2 секунды. Звук не передаётся никогда.

const Reading = z.object({
  zone: z.string(),
  sensor_id: z.string().min(1).max(40),
  table_no: z.number().int().positive().nullable().optional(),
  db: z.number().min(0).max(140),
});

export const POST = route(async (req) => {
  const r = await body(req, Reading);
  const row = await insertReading({ zone_id: assertZone(r.zone), sensor_id: r.sensor_id, table_no: r.table_no ?? null, db: r.db });
  return { ok: true, id: row?.id ?? null };
});
