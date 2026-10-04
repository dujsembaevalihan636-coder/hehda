import { z } from 'zod';

import { resetRoom } from '@/lib/game/room-service';
import { requireAdmin } from '@/lib/server/admin-auth';
import { body, route } from '@/lib/server/http';

export const POST = route(async (req) => {
  await requireAdmin();
  const { table } = await body(req, z.object({ action: z.literal('reset'), table: z.number().int().min(1).max(999) }));
  return resetRoom(table);
});
