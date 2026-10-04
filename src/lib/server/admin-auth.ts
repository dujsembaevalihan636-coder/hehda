import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { serverEnv } from './env';
import { HttpError } from './errors';

// Простая защита админки PIN-кодом из env (ADMIN_PIN): после входа — httpOnly-cookie.

export const ADMIN_COOKIE = 'tm_admin';

const token = (pin: string) => createHash('sha256').update(`table-mode-admin:${pin}`).digest('hex');

export function pinMatches(pin: string): boolean {
  const a = Buffer.from(token(pin));
  const b = Buffer.from(token(serverEnv.adminPin));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminCookieValue() {
  return token(serverEnv.adminPin);
}

export async function isAdmin(): Promise<boolean> {
  const v = (await cookies()).get(ADMIN_COOKIE)?.value;
  return Boolean(v) && v === adminCookieValue();
}

export async function requireAdmin() {
  if (!(await isAdmin())) throw new HttpError(401, 'Нужен PIN администратора');
}
