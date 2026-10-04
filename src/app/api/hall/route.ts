import { hallSnapshot } from '@/lib/server/hall';
import { route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const minutes = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get('minutes') ?? 15)));
  return hallSnapshot(minutes);
});
