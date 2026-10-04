import { z } from 'zod';

import { assertZone, listZones, manualUpdate } from '@/lib/server/hall';
import { body, route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ zones: await listZones() }));

const Patch = z.object({
  id: z.string(),
  music_volume: z.number().min(0).max(1).optional(),
  tempo: z.enum(['slow', 'mid', 'fast']).optional(),
  auto_mode: z.boolean().optional(),
  target_min_db: z.number().min(30).max(100).optional(),
  target_max_db: z.number().min(30).max(100).optional(),
});

export const PATCH = route(async (req) => {
  const { id, ...changes } = await body(req, Patch);
  return { zone: await manualUpdate(assertZone(id), changes) };
});
