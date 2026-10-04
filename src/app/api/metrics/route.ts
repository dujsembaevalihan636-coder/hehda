import { hallMetrics } from '@/lib/server/hall';
import { route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => hallMetrics());
