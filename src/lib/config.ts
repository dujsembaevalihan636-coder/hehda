// Публичная конфигурация (безопасна для клиента). NEXT_PUBLIC_* встраиваются при сборке.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * supabase — данные в Supabase (Postgres + Realtime), нужен для Vercel и нескольких устройств.
 * local    — данные в памяти Next.js-сервера (+ файл .data/local-db.json), realtime через SSE.
 *            Запасной план для зала без интернета: ноутбук = сервер, телефоны по локальной сети.
 */
export const DATA_MODE: 'supabase' | 'local' =
  process.env.NEXT_PUBLIC_DATA_MODE === 'local' || !SUPABASE_URL || !SUPABASE_ANON_KEY
    ? 'local'
    : 'supabase';
