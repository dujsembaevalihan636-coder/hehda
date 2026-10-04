import { z } from 'zod';

import { generateNewContent } from '@/lib/game/admin';
import { adaptEpisode, summarizeEpisode } from '@/lib/game/ai';
import { templateSummary } from '@/lib/game/summary';
import { requireAdmin } from '@/lib/server/admin-auth';
import { aiEnabled } from '@/lib/server/env';
import { body, route } from '@/lib/server/http';

// AI-роут Table Mode (только для админки; в игре те же функции вызываются на сервере напрямую).
//  • library — «Сгенерировать 20 новых» в библиотеку на модерацию;
//  • episode — адаптация готовых элементов под повод и имена;
//  • summary — тёплый итог эпизода.
// Без ключа или при сбое AI — сид и шаблон: демо не ломается.

export const maxDuration = 60;

const Item = z.object({ id: z.string(), text: z.string().max(300) });

const Body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library') }),
  z.object({
    kind: z.literal('episode'),
    occasion: z.enum(['meetup', 'birthday', 'reunion', 'success']),
    heroName: z.string().max(40).nullable().optional(),
    names: z.array(z.string().max(40)).max(12),
    questions: z.array(Item).max(12),
    missions: z.array(Item).max(12),
  }),
  z.object({
    kind: z.literal('summary'),
    input: z.object({
      company: z.string().max(60),
      season: z.string().max(40),
      episodeNo: z.number().int().min(1),
      occasion: z.enum(['meetup', 'birthday', 'reunion', 'success']),
      players: z.array(z.object({ name: z.string(), points: z.number() })).max(12),
      mvp: z.string().nullable(),
      mvpPoints: z.number(),
      quote: z.object({ text: z.string(), by: z.string() }).nullable(),
      missions: z.array(z.object({ name: z.string(), text: z.string(), done: z.boolean(), guessed: z.boolean() })).max(12),
      prev: z.array(z.object({ episodeNo: z.number(), summary: z.string().nullable(), mvp: z.string().nullable(), quote: z.string().nullable() })).max(5),
      heroName: z.string().nullable(),
    }),
  }),
]);

export const POST = route(async (req) => {
  await requireAdmin();
  const b = await body(req, Body);
  if (b.kind === 'library') return generateNewContent();
  if (b.kind === 'episode') {
    const res = await adaptEpisode({
      occasion: b.occasion,
      heroName: b.heroName ?? null,
      names: b.names,
      questions: { warmup: b.questions, vote2: [], vote3: [] },
      missions: b.missions,
    });
    return res
      ? { source: 'ai', questions: res.questions.warmup, missions: res.missions }
      : { source: 'fallback', questions: b.questions, missions: b.missions, ai: aiEnabled() };
  }
  const text = await summarizeEpisode(b.input);
  return { source: text ? 'ai' : 'template', text: text ?? templateSummary(b.input), ai: aiEnabled() };
});
