import type { ContentItem, EpisodeMode, EpisodePlan, Occasion } from '../types';
import { QUESTIONS_PER_ROUND, type QItem, type VoteRound } from './types';

// Подбор контента эпизода из одобренной библиотеки: вопросы по раундам, миссии, приманки
// для угадывания. Сначала берём то, чего компания ещё не видела.

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T extends { id: string }>(pool: T[], n: number, used: Set<string>, rng: Rng, taken: Set<string>): T[] {
  const fresh = shuffle(
    pool.filter((x) => !used.has(x.id) && !taken.has(x.id)),
    rng,
  );
  const stale = shuffle(
    pool.filter((x) => used.has(x.id) && !taken.has(x.id)),
    rng,
  );
  const out = [...fresh, ...stale].slice(0, n);
  out.forEach((x) => taken.add(x.id));
  return out;
}

export interface BuiltPlan {
  questions: Record<VoteRound, QItem[]>;
  server: EpisodePlan;
  contentIds: string[];
}

export function buildPlan(library: ContentItem[], occasion: Occasion, mode: EpisodeMode, used: string[], rng: Rng): BuiltPlan {
  const usedSet = new Set(used);
  const ok = library.filter((c) => c.approved && c.lang === 'ru');
  const fits = (c: ContentItem) => c.occasion === 'any' || c.occasion === occasion;
  const qAll = ok.filter((c) => c.type === 'question' && fits(c));
  const qOccasion = qAll.filter((c) => c.occasion === occasion);
  const qAny = qAll.filter((c) => c.occasion === 'any');
  const taken = new Set<string>();
  const toItem = (c: ContentItem): QItem => ({ id: c.id, text: c.text });

  // Разогрев: один вопрос про повод (если есть) + общие
  const warm = [...pick(qOccasion, 1, usedSet, rng, taken), ...pick(qAny, QUESTIONS_PER_ROUND, usedSet, rng, taken)].slice(0, QUESTIONS_PER_ROUND);
  if (warm.length < QUESTIONS_PER_ROUND) warm.push(...pick(qAll, QUESTIONS_PER_ROUND - warm.length, usedSet, rng, taken));
  const questions: Record<VoteRound, QItem[]> = { warmup: shuffle(warm, rng).map(toItem), vote2: [], vote3: [] };

  if (mode === 'full') {
    questions.vote2 = pick(qAny, QUESTIONS_PER_ROUND, usedSet, rng, taken).map(toItem);
    // «Про повод»: сначала вопросы под повод, остальное — общие
    const v3 = [...pick(qOccasion, QUESTIONS_PER_ROUND, usedSet, rng, taken)];
    if (v3.length < QUESTIONS_PER_ROUND) v3.push(...pick(qAll, QUESTIONS_PER_ROUND - v3.length, usedSet, rng, taken));
    questions.vote3 = v3.map(toItem);
  }

  const mAll = ok.filter((c) => c.type === 'mission' && fits(c));
  const missions = pick(mAll, 12, usedSet, rng, taken).map(toItem);
  const decoys = shuffle(
    mAll.filter((c) => !taken.has(c.id)),
    rng,
  )
    .slice(0, 12)
    .map(toItem);
  const staffPool = ok.filter((c) => c.type === 'staff_mission');
  const staff = pick(staffPool, 1, usedSet, rng, taken)[0];

  const contentIds = [
    ...questions.warmup,
    ...questions.vote2,
    ...questions.vote3,
    ...missions,
    ...(staff ? [staff] : []),
  ].map((x) => x.id);

  return {
    questions,
    server: { missions, staffMission: staff ? toItem(staff) : null, decoys },
    contentIds,
  };
}
