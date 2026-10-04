import { z } from 'zod';

import { deleteContent, setApproved } from '@/lib/game/admin';
import { requireAdmin } from '@/lib/server/admin-auth';
import { body, route } from '@/lib/server/http';

const Body = z.object({ action: z.enum(['approve', 'unapprove', 'delete']), id: z.string().max(64) });

export const POST = route(async (req) => {
  await requireAdmin();
  const { action, id } = await body(req, Body);
  if (action === 'delete') {
    await deleteContent(id);
    return { ok: true };
  }
  return { item: await setApproved(id, action === 'approve') };
});
