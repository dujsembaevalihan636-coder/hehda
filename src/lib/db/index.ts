import 'server-only';

import { DATA_MODE } from '../config';
import { serverEnv } from '../server/env';
import { getMemoryDb, type MemoryDb } from './memory';
import { SupabaseDb } from './supabase';
import type { Db } from './types';

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  if (DATA_MODE === 'supabase') {
    const key = serverEnv.supabaseServiceKey || serverEnv.supabaseAnonKey;
    if (!serverEnv.supabaseServiceKey) {
      console.warn('[db] SUPABASE_SERVICE_ROLE_KEY не задан — запись через anon key упрётся в RLS.');
    }
    cached = new SupabaseDb(serverEnv.supabaseUrl, key);
  } else {
    cached = getMemoryDb(serverEnv.localDbFile);
  }
  return cached;
}

/** Шина изменений локального режима (для SSE). null в режиме Supabase. */
export function getLocalDb(): MemoryDb | null {
  const db = getDb();
  return db.kind === 'local' ? (db as MemoryDb) : null;
}

export * from './types';
