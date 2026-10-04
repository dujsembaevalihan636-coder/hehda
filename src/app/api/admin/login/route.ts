import { cookies } from 'next/headers';
import { z } from 'zod';

import { ADMIN_COOKIE, adminCookieValue, pinMatches } from '@/lib/server/admin-auth';
import { HttpError } from '@/lib/server/errors';
import { body, route } from '@/lib/server/http';

export const POST = route(async (req) => {
  const { pin } = await body(req, z.object({ pin: z.string().max(32) }));
  if (!pinMatches(pin.trim())) {
    await new Promise((r) => setTimeout(r, 400)); // притормозим перебор
    throw new HttpError(401, 'Неверный PIN');
  }
  (await cookies()).set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 3600,
    secure: req.url.startsWith('https://'),
  });
  return { ok: true };
});

export const DELETE = route(async () => {
  (await cookies()).delete(ADMIN_COOKIE);
  return { ok: true };
});
