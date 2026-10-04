import { z } from 'zod';

import { assertZone, calibrateEmptyHall } from '@/lib/server/hall';
import { body, route } from '@/lib/server/http';

export const POST = route(async (req) => {
  const { id } = await body(req, z.object({ id: z.string() }));
  return { zone: await calibrateEmptyHall(assertZone(id)) };
});
