import { getDb } from '@/lib/db';
import { route } from '@/lib/server/http';
import { isZoneId } from '@/lib/zones';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const zone = sp.get('zone')?.toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? 30)));
  const events = await getDb().select('events', {
    filters: isZoneId(zone) ? [['zone_id', 'eq', zone]] : [],
    order: [{ col: 'created_at', asc: false }],
    limit,
  });
  return { events };
});
