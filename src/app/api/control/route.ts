import { runControl } from '@/lib/server/hall';
import { route } from '@/lib/server/http';

// Алгоритм управления. Вызывается дашбордом раз в 5 секунд.
export const dynamic = 'force-dynamic';

export const POST = route(async () => ({ at: Date.now(), zones: await runControl() }));
