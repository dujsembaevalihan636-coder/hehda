import { DATA_MODE } from '@/lib/config';
import { aiEnabled, serverEnv } from '@/lib/server/env';
import { route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  mode: DATA_MODE,
  ai: aiEnabled(),
  model: aiEnabled() ? serverEnv.anthropicModel : null,
  serviceKey: Boolean(serverEnv.supabaseServiceKey),
  // На Vercel локальный режим не работает: у каждой функции своя память
  warning:
    DATA_MODE === 'local' && process.env.VERCEL
      ? 'Supabase не настроен: на Vercel нужен NEXT_PUBLIC_SUPABASE_URL/ANON_KEY и SUPABASE_SERVICE_ROLE_KEY'
      : DATA_MODE === 'supabase' && !serverEnv.supabaseServiceKey
        ? 'Нет SUPABASE_SERVICE_ROLE_KEY — запись в базу не пройдёт RLS'
        : null,
}));
