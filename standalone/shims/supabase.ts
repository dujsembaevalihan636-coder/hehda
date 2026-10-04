// Заглушка Supabase: HTML-версия всегда работает в локальном режиме.
export function createClient(): never {
  throw new Error('Supabase недоступен в HTML-версии');
}
