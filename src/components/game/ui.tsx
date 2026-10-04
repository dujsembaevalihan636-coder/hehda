'use client';

import type { ReactNode } from 'react';

import { ACTIVE_MS, type PublicPlayer } from '@/lib/game/types';
import { t } from '@/lib/i18n';

import { useGame } from './context';

// Базовые кирпичики игровых экранов: крупно, тепло, максимум три касания на экран.

export function BigButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  const styles = {
    primary: 'bg-accent text-accent-ink shadow-[0_10px_40px_-12px] shadow-accent',
    secondary: 'border border-line bg-surface-2 text-ink',
    ghost: 'text-muted',
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl px-5 py-4 text-lg font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

const COLORS = ['#f59e4c', '#3987e5', '#d55181', '#199e70', '#c98500', '#9085e9', '#e66767', '#1baf7a'];

export function avatarColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ player, size = 36, ring = false }: { player: PublicPlayer; size?: number; ring?: boolean }) {
  const { now, state } = useGame();
  const active = now - player.lastSeen <= ACTIVE_MS;
  const initials = player.name
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" title={player.name}>
      <span
        className={`grid place-items-center rounded-full font-bold text-[#1a1008] ${ring ? 'ring-2 ring-ink' : ''}`}
        style={{ width: size, height: size, background: avatarColor(player.id), opacity: active ? 1 : 0.4, fontSize: size * 0.38 }}
      >
        {initials}
      </span>
      {state.hostId === player.id ? (
        <span className="absolute -top-2 -right-1 text-sm" aria-label={t.game.host}>
          👑
        </span>
      ) : null}
    </span>
  );
}

export function Screen({ title, kicker, children }: { title?: ReactNode; kicker?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex animate-rise flex-col gap-5">
      {kicker ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{kicker}</p> : null}
      {title ? <h1 className="text-[1.7rem] leading-tight font-bold">{title}</h1> : null}
      {children}
    </section>
  );
}

/** Нижняя панель ведущего. Остальные видят подсказку. */
export function HostBar({ children }: { children: ReactNode }) {
  const { isHost } = useGame();
  return (
    <div className="sticky bottom-0 -mx-4 mt-auto border-t border-line bg-bg/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
      {isHost ? <div className="flex gap-2">{children}</div> : <p className="py-2 text-center text-sm text-faint">{t.game.hostSwitches}</p>}
    </div>
  );
}

export function PhonesDown({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-line bg-surface px-6 py-10 text-center">
      <div className="animate-breathe text-6xl" aria-hidden>
        📵
      </div>
      <p className="text-2xl font-bold leading-snug">{title}</p>
      {hint ? <p className="text-muted">{hint}</p> : null}
    </div>
  );
}
