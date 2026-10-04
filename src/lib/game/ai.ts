import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { aiEnabled, serverEnv } from '../server/env';
import type { ContentOccasion, ContentType, Occasion } from '../types';
import type { SummaryInput } from './summary';
import type { QItem, VoteRound } from './types';

// AI только на сервере (ключ в ANTHROPIC_API_KEY). Ответы — строго JSON по zod-схеме.
// Любая ошибка, отказ или таймаут → null, и вызывающий код берёт сид/шаблон: демо не ломается.

const SYSTEM = `Ты — сценарист Table Mode: доброй игры для компании друзей за столом в ресторане среднего+ класса.
Пиши по-русски, коротко, тепло и с добрым юмором.

Жёсткие правила:
- только добрый юмор; никого не высмеивать и не ставить в неловкое положение;
- запрещено: политика, религия, интимные темы, алкоголь и любые челленджи с алкоголем;
- запрещены насмешки над внешностью, весом, возрастом, деньгами, работой, отношениями и семейным положением;
- никаких опасных или навязчивых действий; с персоналом — только вежливые короткие вопросы;
- не придумывай факты о людях: используй только переданные имена и данные.

Отвечай строго в формате JSON по заданной схеме.`;

const OCCASION_LABEL: Record<Occasion, string> = {
  meetup: 'просто встреча друзей',
  birthday: 'день рождения',
  reunion: 'кто-то из компании вернулся (давно не виделись)',
  success: 'отмечаем успех',
};

// Второй рубеж безопасности поверх промпта
const BANNED =
  /(?<![а-яё])(алкогол|водк|пив[оа](?![а-яё])|вин[оа](?![а-яё])|шот(?![а-яё])|коньяк|виски|текил|опьян|пьян|политик|президент|религ|церк[ов]|секс|интим|постел|бывш|развод|зарплат|деньг|кредит|толст|худе|лыс|морщин)/i;
const safe = (s: string) => !BANNED.test(s);

const MODELS_WITH_FALLBACK = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

let cached: Anthropic | null = null;
function client() {
  if (!cached) cached = new Anthropic({ apiKey: serverEnv.anthropicKey, timeout: 25_000, maxRetries: 1 });
  return cached;
}

async function callJson<S extends z.ZodType>(schema: S, user: string, maxTokens: number): Promise<z.infer<S> | null> {
  if (!aiEnabled()) return null;
  const model = serverEnv.anthropicModel;
  const base = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: 'user' as const, content: user }],
  };
  try {
    if (MODELS_WITH_FALLBACK.has(model)) {
      try {
        // Серверный фолбэк: если модель откажет по политике безопасности, запрос продолжит другая модель
        const msg = await client().beta.messages.parse({
          ...base,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
        });
        if (msg.stop_reason === 'refusal') return null;
        return (msg.parsed_output as z.infer<S> | null) ?? null;
      } catch (e) {
        if (!(e instanceof Anthropic.BadRequestError)) throw e;
        // Бета недоступна для этого ключа — повторяем без неё
      }
    }
    const msg = await client().messages.parse({
      ...base,
      output_config: { effort: 'low', format: zodOutputFormat(schema) },
    });
    if (msg.stop_reason === 'refusal') return null;
    return (msg.parsed_output as z.infer<S> | null) ?? null;
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.warn(`[ai] ${e.status ?? ''} ${e.message}`);
    else console.warn('[ai]', (e as Error).message);
    return null;
  }
}

// ------------------------------------------------------------------ адаптация эпизода

const ItemSchema = z.object({ id: z.string(), text: z.string() });
const AdaptSchema = z.object({ questions: z.array(ItemSchema), missions: z.array(ItemSchema) });

export interface AdaptInput {
  occasion: Occasion;
  heroName: string | null;
  names: string[];
  questions: Record<VoteRound, QItem[]>;
  missions: QItem[];
}

export async function adaptEpisode(input: AdaptInput): Promise<{ questions: Record<VoteRound, QItem[]>; missions: QItem[] } | null> {
  const all = [...input.questions.warmup, ...input.questions.vote2, ...input.questions.vote3];
  const user = `Повод: ${OCCASION_LABEL[input.occasion]}.
${input.heroName ? `Герой вечера: ${input.heroName}.` : 'Героя вечера нет.'}
Игроки: ${input.names.join(', ')}.

Адаптируй готовые элементы под повод и компанию, не придумывая новое с нуля:
- вопросы оставь в форме «Кто из нас…» (голосуют за имя игрока); часть вопросов сделай про повод${
    input.heroName ? ` и про героя вечера (имя в правильном падеже)` : ''
  };
- миссии — тайные, выполнимые за ужином незаметно; миссию с персоналом оставь вежливой;
- сохрани id каждого элемента, длина текста — до 140 символов.

Вопросы:
${all.map((q) => `${q.id}: ${q.text}`).join('\n')}

Миссии:
${input.missions.map((m) => `${m.id}: ${m.text}`).join('\n')}`;

  const out = await callJson(AdaptSchema, user, 4000);
  if (!out) return null;
  const clean = (items: { id: string; text: string }[], allowed: QItem[]) => {
    const map = new Map(items.map((x) => [x.id, x.text.trim()]));
    return allowed.map((q) => {
      const t = map.get(q.id);
      return t && t.length >= 8 && t.length <= 160 && safe(t) ? { id: q.id, text: t } : q;
    });
  };
  return {
    questions: {
      warmup: clean(out.questions, input.questions.warmup),
      vote2: clean(out.questions, input.questions.vote2),
      vote3: clean(out.questions, input.questions.vote3),
    },
    missions: clean(out.missions, input.missions),
  };
}

// ------------------------------------------------------------------ итог эпизода

const SummarySchema = z.object({ summary: z.string() });

export async function summarizeEpisode(input: SummaryInput): Promise<string | null> {
  const user = `Напиши тёплый итог эпизода для общего чата компании: 2–3 предложения, добрый юмор,
упомяни MVP и фразу вечера, а если были прошлые эпизоды — сделай отсылку к ним. Ничего не выдумывай.

Данные эпизода (JSON):
${JSON.stringify(
  {
    компания: input.company,
    сезон: input.season,
    эпизод: input.episodeNo,
    повод: OCCASION_LABEL[input.occasion],
    герой: input.heroName,
    игроки: input.players,
    mvp: input.mvp,
    очки_mvp: input.mvpPoints,
    фраза_вечера: input.quote,
    миссии: input.missions.map((m) => ({ игрок: m.name, выполнена: m.done, разгадана: m.guessed })),
    прошлые_эпизоды: input.prev,
  },
  null,
  1,
)}`;
  const out = await callJson(SummarySchema, user, 1200);
  const text = out?.summary?.trim();
  if (!text || text.length < 30 || text.length > 700 || !safe(text)) return null;
  return text;
}

// ------------------------------------------------------------------ пополнение библиотеки

const LibrarySchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(['question', 'mission', 'staff_mission']),
      occasion: z.enum(['any', 'meetup', 'birthday', 'reunion', 'success']),
      text: z.string(),
    }),
  ),
});

export async function generateLibraryItems(existing: string[]): Promise<{ type: ContentType; occasion: ContentOccasion; text: string }[] | null> {
  const user = `Сгенерируй 20 новых элементов для библиотеки:
- 10 вопросов-голосований, каждый начинается с «Кто из нас…»;
- 8 секретных миссий: незаметные действия за столом на один ужин;
- 2 миссии с участием персонала: вежливые вопросы официанту или бармену.
Поводы: any (подходит всегда), meetup, birthday, reunion, success — используй разные.
Не повторяй существующие:
${existing.slice(0, 80).map((x) => `- ${x}`).join('\n')}`;
  const out = await callJson(LibrarySchema, user, 4000);
  if (!out) return null;
  const seen = new Set(existing.map((x) => x.toLowerCase()));
  return out.items
    .map((x) => ({ ...x, text: x.text.trim() }))
    .filter((x) => x.text.length >= 10 && x.text.length <= 160 && safe(x.text) && !seen.has(x.text.toLowerCase()))
    .filter((x) => x.type !== 'question' || /^кто из нас/i.test(x.text))
    .slice(0, 20);
}
