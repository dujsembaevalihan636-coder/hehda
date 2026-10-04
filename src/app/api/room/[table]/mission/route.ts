import { z } from 'zod';

import { getMyMission, parseTable } from '@/lib/game/room-service';
import { body, route } from '@/lib/server/http';

// Секретная миссия отдаётся только её владельцу (по ключу игрока), POST — чтобы ключ не попадал в URL.

type Ctx = { params: Promise<{ table: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  const table = parseTable((await ctx.params).table);
  const { playerId, key } = await body(req, z.object({ playerId: z.string().max(64), key: z.string().max(128) }));
  return getMyMission(table, playerId, key);
});
