import { activeRooms, analytics, listContent } from '@/lib/game/admin';
import { requireAdmin } from '@/lib/server/admin-auth';
import { aiEnabled, serverEnv } from '@/lib/server/env';
import { route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  await requireAdmin();
  const [rooms, stats, content] = await Promise.all([activeRooms(), analytics(), listContent()]);
  return { rooms, analytics: stats, content, ai: aiEnabled(), model: aiEnabled() ? serverEnv.anthropicModel : null, pinDefault: serverEnv.adminPinIsDefault };
});
