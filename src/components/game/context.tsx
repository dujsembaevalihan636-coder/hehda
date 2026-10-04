'use client';

import { createContext, useContext } from 'react';

import type { Action } from '@/lib/game/engine';
import type { PublicPlayer, PublicRoomState } from '@/lib/game/types';
import type { ZoneId } from '@/lib/types';

export type ClientAction = Exclude<Action, { type: 'plan_adapted' } | { type: 'summary_ready' }>;

export interface GameCtx {
  table: number;
  zone: ZoneId | null;
  state: PublicRoomState;
  me: PublicPlayer;
  isHost: boolean;
  host: PublicPlayer | null;
  now: number;
  busy: boolean;
  act: (a: ClientAction) => Promise<boolean>;
  credentials: { playerId: string; key: string };
}

const Ctx = createContext<GameCtx | null>(null);

export const GameProvider = Ctx.Provider;

/** Контекст может отсутствовать (шапка до входа в игру). */
export function useMaybeGame(): GameCtx | null {
  return useContext(Ctx);
}

export function useGame(): GameCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame вне GameProvider');
  return v;
}

export function nameOf(state: PublicRoomState, id: string | null | undefined) {
  return state.players.find((p) => p.id === id)?.name ?? '—';
}
