import { z } from 'zod';

import { zoneOfTable } from '@/lib/hall-layout';
import { addFeedback, HttpError } from '@/lib/server/hall';
import { body, route } from '@/lib/server/http';
import { isZoneId } from '@/lib/zones';

const Feedback = z.object({
  type: z.enum(['too_loud', 'could_hear_yes', 'could_hear_no']),
  zone: z.string().optional(),
  table_no: z.number().int().positive().nullable().optional(),
});

export const POST = route(async (req) => {
  const f = await body(req, Feedback);
  const tableNo = f.table_no ?? null;
  const zone = f.zone?.toUpperCase();
  const zoneId = isZoneId(zone) ? zone : tableNo ? zoneOfTable(tableNo) : null;
  if (!zoneId) throw new HttpError(400, 'Не указана зона или стол');
  return addFeedback({ type: f.type, zone_id: zoneId, table_no: tableNo });
});
