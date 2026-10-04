import 'server-only';

// Серверные секреты. Никогда не импортировать в клиентские компоненты.
export const serverEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  adminPin: process.env.ADMIN_PIN || '1234',
  adminPinIsDefault: !process.env.ADMIN_PIN,
  forecastGuests: Number(process.env.FORECAST_GUESTS || 16),
  localDbFile: process.env.LOCAL_DB_FILE || '.data/local-db.json',
};

export const aiEnabled = () => Boolean(serverEnv.anthropicKey);
