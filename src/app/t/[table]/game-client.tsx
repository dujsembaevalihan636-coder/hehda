'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GameProvider, useGame, useMaybeGame, type ClientAction, type GameCtx } from '@/components/game/context';
import { FinalScreen } from '@/components/game/FinalScreen';
import { IntroScreen, LobbyWaiting, SetupWizard } from '@/components/game/LobbyScreens';
import { MissionProvider, MissionsScreen } from '@/components/game/MissionScreens';
import { SummaryScreen } from '@/components/game/SummaryScreen';
import { Avatar, BigButton, Screen } from '@/components/game/ui';
import { VoteScreen } from '@/components/game/VoteScreen';
import { api, ApiError, storageGet, storageSet } from '@/lib/client/api';
import { useNow, usePolling } from '@/lib/client/use-polling';
import type { PublicRoomState, RoomState } from '@/lib/game/types';
import { fmt, t } from '@/lib/i18n';
import { useRealtime, useRealtimeStatus } from '@/lib/realtime/client';
import type { Room, ZoneId } from '@/lib/types';
import { ZONES } from '@/lib/zones';

interface Identity {
  playerId: string;
  key: string;
  name: string;
}

interface RoomSnap {
  state: PublicRoomState;
  version: number;
}

interface ActResult extends RoomSnap {
  playerId?: string;
  key?: string;
}

function stripKeys(state: RoomState | PublicRoomState): PublicRoomState {
  return { ...state, players: state.players.map((p) => ({ id: p.id, name: p.name, memberId: p.memberId, joinedAt: p.joinedAt, lastSeen: p.lastSeen })) };
}

export default function GameClient({
  table,
  zone,
  slot,
  autoName,
  embedded,
}: {
  table: number;
  zone: ZoneId | null;
  slot: string | null;
  autoName: string | null;
  embedded: boolean;
}) {
  const storeKey = `tm:${table}:${slot ?? 'main'}`;
  const [me, setMe] = useState<Identity | null | undefined>(undefined);
  const [room, setRoom] = useState<RoomSnap | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [name, setName] = useState('');
  const rt = useRealtimeStatus();

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Личность игрока живёт в localStorage: перезагрузка не выкидывает из игры
  useEffect(() => {
    const raw = storageGet(storeKey);
    let ident: Identity | null = null;
    try {
      ident = raw ? (JSON.parse(raw) as Identity) : null;
    } catch {
      ident = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage доступен только в браузере
    setMe(ident);
    setName(ident?.name ?? autoName ?? '');
  }, [storeKey, autoName]);

  const applyRoom = useCallback((snap: RoomSnap) => {
    setRoom((prev) => (!prev || snap.version >= prev.version ? snap : prev));
  }, []);

  const load = useCallback(async () => {
    try {
      applyRoom(await api<RoomSnap>(`/api/room/${table}`));
    } catch {
      /* следующая попытка по таймеру */
    }
  }, [table, applyRoom]);

  const live = rt === 'live';
  usePolling(load, live ? 15_000 : 3_000);
  const now = useNow(3_000);

  useRealtime<Room>('rooms', `table_no=eq.${table}`, (c) => {
    if (!c.new) return;
    applyRoom({ state: stripKeys(c.new.state as RoomState), version: c.new.version });
  });

  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  const act = useCallback(
    async (action: ClientAction, joinName?: string): Promise<boolean> => {
      setBusy(true);
      try {
        const ident = meRef.current;
        const r = await api<ActResult>(`/api/room/${table}`, {
          body: { action, playerId: ident?.playerId ?? null, key: ident?.key ?? null },
        });
        applyRoom(r);
        if (r.playerId && r.key) {
          const next: Identity = { playerId: r.playerId, key: r.key, name: joinName ?? ident?.name ?? '' };
          storageSet(storeKey, JSON.stringify(next));
          meRef.current = next;
          setMe(next);
        }
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          // Ключ не подошёл (стол сбросили) — начинаем как новый игрок
          storageSet(storeKey, null);
          meRef.current = null;
          setMe(null);
        }
        flash((e as Error).message);
        load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [table, applyRoom, storeKey, flash, load],
  );

  const join = useCallback(
    async (n: string) => {
      const clean = n.trim();
      if (!clean) return flash(t.game.errorName);
      await act({ type: 'join', name: clean }, clean);
    },
    [act, flash],
  );

  const state = room?.state ?? null;
  const myPlayer = state && me ? state.players.find((p) => p.id === me.playerId) : undefined;

  // Возвращение после сброса стола или авто-вход в демо (iframe с ?name=).
  // Таймер зависит только от факта «нужно войти», иначе каждое обновление комнаты его сбрасывало бы.
  const autoTried = useRef(false);
  const autoJoinName = me?.name || autoName || '';
  const needAutoJoin = Boolean(state) && me !== undefined && !myPlayer && Boolean(autoJoinName);
  const autoNameRef = useRef(autoJoinName);
  useEffect(() => {
    autoNameRef.current = autoJoinName;
  }, [autoJoinName]);
  useEffect(() => {
    if (!needAutoJoin || autoTried.current) return;
    const delay = slot ? Math.max(0, Number(slot.replace(/\D/g, '')) - 1) * 350 : 0;
    const id = setTimeout(() => {
      if (autoTried.current) return;
      autoTried.current = true;
      join(autoNameRef.current);
    }, delay);
    return () => clearTimeout(id);
  }, [needAutoJoin, slot, join]);

  // Присутствие: пинг раз в 20 секунд, пока экран открыт
  const inRoom = Boolean(myPlayer);
  useEffect(() => {
    if (!inRoom) return;
    const ping = () => {
      if (document.visibilityState === 'visible') act({ type: 'ping' }).catch(() => {});
    };
    const id = setInterval(ping, 20_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        load();
        ping();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [inRoom, act, load]);

  const credentials = useMemo(() => ({ playerId: me?.playerId ?? '', key: me?.key ?? '' }), [me?.playerId, me?.key]);

  if (!state || me === undefined) {
    return (
      <Shell table={table} zone={zone} embedded={embedded}>
        <div className="skeleton mt-10 h-40 rounded-3xl" />
      </Shell>
    );
  }

  if (!myPlayer) {
    return (
      <Shell table={table} zone={zone} embedded={embedded} toast={toast}>
        <Screen kicker={`${t.game.brand} · ${fmt(t.game.tableN, { n: table })}`} title="Игра для вашего стола">
          <p className="text-muted">{t.game.tagline}: короткие действия на телефоне, всё остальное — вслух. Прогресс компании сохраняется на весь сезон.</p>
          {state.players.length ? (
            <div className="flex flex-wrap gap-2">
              {state.players.map((p) => (
                <span key={p.id} className="rounded-full bg-surface-2 px-3 py-1 text-sm">
                  {p.name}
                </span>
              ))}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              join(name);
            }}
            className="flex flex-col gap-3"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              placeholder={t.game.yourName}
              autoComplete="given-name"
              className="w-full rounded-2xl border border-line bg-surface px-4 py-4 text-xl"
            />
            <BigButton disabled={busy || !name.trim()}>{busy ? t.game.rejoin : t.game.enter}</BigButton>
          </form>
        </Screen>
      </Shell>
    );
  }

  const ctx: GameCtx = {
    table,
    zone,
    state,
    me: myPlayer,
    isHost: state.hostId === myPlayer.id,
    host: state.players.find((p) => p.id === state.hostId) ?? null,
    now,
    busy,
    act: (a) => act(a),
    credentials,
  };

  return (
    <GameProvider value={ctx}>
      <MissionProvider>
        <Shell table={table} zone={zone} embedded={embedded} toast={toast} onLeave={() => act({ type: 'leave' }).then(() => storageSet(storeKey, null))}>
          <div key={`${state.phase}-${state.vote?.idx ?? ''}-${state.final?.stage ?? ''}-${state.final?.idx ?? ''}`} className="flex flex-1 flex-col gap-5">
            <PhaseView />
          </div>
        </Shell>
      </MissionProvider>
    </GameProvider>
  );
}

function PhaseView() {
  const { state, isHost } = useGame();
  switch (state.phase) {
    case 'idle':
    case 'lobby':
      return isHost ? <SetupWizard /> : <LobbyWaiting />;
    case 'intro':
      return <IntroScreen />;
    case 'warmup':
    case 'vote2':
    case 'vote3':
      return <VoteScreen round={state.phase} />;
    case 'missions':
      return <MissionsScreen />;
    case 'final':
      return <FinalScreen />;
    case 'summary':
      return <SummaryScreen />;
    default:
      return null;
  }
}

function Shell({
  table,
  zone,
  embedded,
  toast,
  onLeave,
  children,
}: {
  table: number;
  zone: ZoneId | null;
  embedded: boolean;
  toast?: string | null;
  onLeave?: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className={`mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 ${embedded ? 'pt-3' : 'pt-[max(0.75rem,env(safe-area-inset-top))]'}`}>
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">{t.game.brand}</p>
          <p className="truncate text-sm text-muted">
            {fmt(t.game.tableN, { n: table })}
            {zone ? ` · ${ZONES[zone].title.replace('Зона ', 'зона ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PlayersMini />
          {zone ? <LoudButton table={table} zone={zone} /> : null}
          {onLeave ? (
            <button onClick={onLeave} className="rounded-full px-2 py-1 text-xs text-faint" title={t.game.leave}>
              ⎋
            </button>
          ) : null}
        </div>
      </header>
      {children}
      {toast ? (
        <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90vw] animate-pop rounded-full bg-ink px-5 py-2.5 text-center text-sm font-medium text-bg shadow-xl">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function PlayersMini() {
  const ctx = useMaybeGame();
  if (!ctx) return null;
  return (
    <div className="flex -space-x-2">
      {ctx.state.players.slice(0, 6).map((p) => (
        <Avatar key={p.id} player={p} size={26} />
      ))}
    </div>
  );
}

/** «Громко?» прямо из игры: связка Table Mode с акустикой зала. */
function LoudButton({ table, zone }: { table: number; zone: ZoneId }) {
  const [state, setState] = useState<'idle' | 'done'>('idle');
  const press = async () => {
    if (state === 'done') return;
    try {
      await api('/api/feedback', { body: { type: 'too_loud', zone, table_no: table } });
      setState('done');
      setTimeout(() => setState('idle'), 20_000);
    } catch {
      /* без сети просто ничего не делаем */
    }
  };
  return (
    <button
      onClick={press}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${state === 'done' ? 'bg-ok/20 text-ok' : 'bg-surface-2 text-ink'}`}
    >
      {state === 'done' ? `✓ ${t.game.tooLoudDone}` : `🔊 ${t.game.tooLoud}`}
    </button>
  );
}
