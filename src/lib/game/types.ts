import type { EpisodeMode, Occasion } from '../types';

// Общее состояние комнаты стола (rooms.state). Публично для всех за столом,
// поэтому тексты секретных миссий здесь не хранятся — только ссылки на них.

export type Phase = 'idle' | 'lobby' | 'intro' | 'warmup' | 'missions' | 'vote2' | 'vote3' | 'final' | 'summary';
export type VoteRound = 'warmup' | 'vote2' | 'vote3';
export type RoundKind = VoteRound | 'missions' | 'final';

export const ROUNDS: Record<EpisodeMode, RoundKind[]> = {
  short: ['warmup', 'missions', 'final'],
  full: ['warmup', 'missions', 'vote2', 'vote3', 'final'],
};

export const QUESTIONS_PER_ROUND = 3;
export const MAX_PLAYERS = 12;
export const ACTIVE_MS = 60_000; // игрок «за столом», если был онлайн последнюю минуту
export const HOST_STALE_MS = 2 * 60_000; // автоматическая смена ведущего
export const HOST_CLAIM_MS = 30_000; // кнопка «Стать ведущим» доступна раньше
export const INACTIVE_RESET_MS = 4 * 3600_000;
export const SUMMARY_RESET_MS = 45 * 60_000;

export interface Player {
  id: string;
  name: string;
  memberId: string | null;
  joinedAt: number;
  lastSeen: number;
  keyHash: string; // sha256 секретного ключа игрока (сам ключ знает только его телефон)
}

export interface QItem {
  id: string;
  text: string;
}

export interface VoteState {
  idx: number;
  stage: 'vote' | 'result';
  votes: Record<string, string>; // кто → за кого
}

export interface MissionRef {
  playerId: string;
  missionId: string;
  staff: boolean;
  done: boolean;
}

export interface FinalResult {
  playerId: string;
  text: string;
  staff: boolean;
  done: boolean;
  guessedBy: string[];
  gained: Record<string, number>;
}

export interface FinalState {
  stage: 'guess' | 'reveal' | 'quotes' | 'quote_vote';
  order: string[];
  idx: number;
  options: string[];
  guesses: Record<string, number>;
  correct: number | null;
  results: FinalResult[];
  quotes: { id: string; playerId: string; text: string }[];
  quoteVotes: Record<string, string>;
}

export interface SeasonRow {
  memberId: string;
  name: string;
  total: number;
  gained: number;
}

export interface SummaryState {
  mvpId: string | null;
  mvpName: string | null;
  quote: { text: string; by: string } | null;
  text: string;
  source: 'pending' | 'ai' | 'template';
  since: number;
  season: SeasonRow[];
  teaser: string;
}

export interface CompanyInfo {
  id: string;
  name: string;
  code: string;
  season: string;
  isNew: boolean;
  prevSummary: string | null;
  prevMvp: string | null;
  prevEpisodes: number;
}

export interface RoomState {
  v: 1;
  phase: Phase;
  players: Player[];
  hostId: string | null;
  company: CompanyInfo | null;
  episodeId: string | null;
  episodeNo: number;
  occasion: Occasion | null;
  mode: EpisodeMode | null;
  heroId: string | null;
  rounds: RoundKind[];
  roundIdx: number;
  questions: Record<VoteRound, QItem[]>;
  adapted: 'none' | 'pending' | 'ai' | 'fallback';
  vote: VoteState | null;
  missions: MissionRef[];
  final: FinalState | null;
  points: Record<string, number>;
  summary: SummaryState | null;
  startedAt: number | null;
  lastActivity: number;
}

export function emptyRoom(now: number): RoomState {
  return {
    v: 1,
    phase: 'idle',
    players: [],
    hostId: null,
    company: null,
    episodeId: null,
    episodeNo: 0,
    occasion: null,
    mode: null,
    heroId: null,
    rounds: [],
    roundIdx: 0,
    questions: { warmup: [], vote2: [], vote3: [] },
    adapted: 'none',
    vote: null,
    missions: [],
    final: null,
    points: {},
    summary: null,
    startedAt: null,
    lastActivity: now,
  };
}

/** Состояние из БД (может быть пустым объектом у новой комнаты). */
export function parseRoomState(raw: unknown, now: number): RoomState {
  if (raw && typeof raw === 'object' && (raw as RoomState).v === 1) return raw as RoomState;
  return emptyRoom(now);
}

export const isActive = (p: Player, now: number) => now - p.lastSeen <= ACTIVE_MS;

/** То, что безопасно отдать клиенту (без хэшей ключей). */
export type PublicPlayer = Omit<Player, 'keyHash'>;
export type PublicRoomState = Omit<RoomState, 'players'> & { players: PublicPlayer[] };

export function toPublic(state: RoomState): PublicRoomState {
  return {
    ...state,
    players: state.players.map((p) => ({ id: p.id, name: p.name, memberId: p.memberId, joinedAt: p.joinedAt, lastSeen: p.lastSeen })),
  };
}
