import { plural } from '../acoustic/format';
import type { Occasion } from '../types';

// Шаблонный итог эпизода — запасной вариант, если AI недоступен (демо не ломается).

export interface SummaryInput {
  company: string;
  season: string;
  episodeNo: number;
  occasion: Occasion;
  players: { name: string; points: number }[];
  mvp: string | null;
  mvpPoints: number;
  quote: { text: string; by: string } | null;
  missions: { name: string; text: string; done: boolean; guessed: boolean }[];
  prev: { episodeNo: number; summary: string | null; mvp: string | null; quote: string | null }[];
  heroName: string | null;
}

export function templateSummary(i: SummaryInput): string {
  const n = i.episodeNo;
  const opening: Record<Occasion, string> = {
    meetup: `Эпизод ${n} у компании «${i.company}» удался на славу.`,
    birthday: `День рождения стал эпизодом ${n} сезона «${i.season}» — и каким!`,
    reunion: `«${i.company}» снова в сборе — эпизод ${n} это доказал.`,
    success: `Успех отметили с размахом: эпизод ${n} сезона «${i.season}» в копилке.`,
  };
  const parts = [opening[i.occasion]];

  const unnoticed = i.missions.filter((m) => m.done && !m.guessed).length;
  const mvp = i.mvp
    ? `MVP вечера — ${i.mvp}${i.mvpPoints ? ` (${i.mvpPoints} ${plural(i.mvpPoints, ['очко', 'очка', 'очков'])})` : ''}`
    : 'MVP в этот раз не определился';
  const missions = unnoticed
    ? `, а ${unnoticed} ${plural(unnoticed, ['секретная миссия так и осталась', 'секретные миссии так и остались', 'секретных миссий так и остались'])} незамеченными.`
    : i.missions.length
      ? ', а секретные миссии раскусили все до одной.'
      : '.';
  parts.push(mvp + missions);

  if (i.quote) parts.push(`Фраза вечера: «${i.quote.text}» — ${i.quote.by}.`);
  const prev = i.prev[0];
  if (prev?.mvp) parts.push(`MVP прошлого эпизода — ${prev.mvp}; посмотрим, кто заберёт титул в эпизоде ${n + 1}.`);
  else parts.push(`Это только начало сезона — до встречи в эпизоде ${n + 1}.`);
  return parts.join(' ');
}

export function seasonName(date: Date): string {
  const m = date.getMonth();
  const word = m === 11 || m <= 1 ? 'Зима' : m <= 4 ? 'Весна' : m <= 7 ? 'Лето' : 'Осень';
  const year = m === 11 ? date.getFullYear() + 1 : date.getFullYear();
  return `${word} ${year}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(rng: () => number): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

// Код вводят и с русской раскладки: похожие кириллические буквы превращаем в латинские
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y' };

export const normalizeCode = (s: string) =>
  s
    .toUpperCase()
    .replace(/[АВСЕНКМОРТХУ]/g, (ch) => LOOKALIKE[ch] ?? ch)
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);

export const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
