import { z } from 'zod';

import { getRoomState, parseTable, roomAction } from '@/lib/game/room-service';
import { body, route } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ table: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const table = parseTable((await ctx.params).table);
  return getRoomState(table);
});

const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), name: z.string().max(40) }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('claim_host') }),
  z.object({
    type: z.literal('setup'),
    companyMode: z.enum(['new', 'continue']),
    companyName: z.string().max(60).optional(),
    code: z.string().max(12).optional(),
    occasion: z.enum(['meetup', 'birthday', 'reunion', 'success']),
    mode: z.enum(['short', 'full']),
    heroId: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('vote'), target: z.string() }),
  z.object({ type: z.literal('reveal') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('mission_done'), done: z.boolean().optional() }),
  z.object({ type: z.literal('guess'), option: z.number().int().min(0).max(9) }),
  z.object({ type: z.literal('quote'), text: z.string().max(200) }),
  z.object({ type: z.literal('quote_vote'), quoteId: z.string() }),
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('simulate') }),
]);

const Body = z.object({
  action: ActionSchema,
  playerId: z.string().max(64).nullable().optional(),
  key: z.string().max(128).nullable().optional(),
});

export const POST = route<Ctx>(async (req, ctx) => {
  const table = parseTable((await ctx.params).table);
  const b = await body(req, Body);
  return roomAction(table, b);
});
