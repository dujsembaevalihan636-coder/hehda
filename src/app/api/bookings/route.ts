import { z } from 'zod';

import { createBooking } from '@/lib/server/hall';
import { body, route } from '@/lib/server/http';
import { ZONES } from '@/lib/zones';

const Booking = z.object({
  guest_name: z.string().trim().min(1).max(60),
  party_size: z.number().int().min(1).max(20),
  time: z.string(),
  atmosphere: z.enum(['talk', 'background', 'lively']),
});

export const POST = route(async (req) => {
  const b = await body(req, Booking);
  const res = await createBooking(b);
  return { ...res, zone: ZONES[res.booking.zone_id], preferredZone: ZONES[res.preferred] };
});
