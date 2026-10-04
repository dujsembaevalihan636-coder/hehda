'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';

import { useGame } from './context';
import { BigButton, HostBar, PhonesDown, Screen } from './ui';

// Секретная миссия: текст приходит только своему телефону и прячется под шторкой.

export interface MyMission {
  text: string;
  staff: boolean;
  done: boolean;
}

const MissionCtx = createContext<{ mission: MyMission | null; loading: boolean }>({ mission: null, loading: false });

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const { state, me, table, credentials } = useGame();
  const ref = state.missions.find((m) => m.playerId === me.id);
  const missionId = ref?.missionId ?? null;
  const [mission, setMission] = useState<MyMission | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!missionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- сброс при смене эпизода
      setMission(null);
      return;
    }
    let alive = true;
    let tries = 0;
    const load = async () => {
      setLoading(true);
      try {
        const r = await api<{ mission: MyMission | null; pending?: boolean }>(`/api/room/${table}/mission`, { body: credentials });
        if (!alive) return;
        if (r.mission) setMission(r.mission);
        else if (r.pending && tries++ < 5) setTimeout(load, 700); // строка миссии ещё записывается
      } catch {
        if (alive && tries++ < 5) setTimeout(load, 1000);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [missionId, table, credentials]);

  const done = ref?.done ?? false;
  const value = { mission: mission ? { ...mission, done } : null, loading };
  return <MissionCtx.Provider value={value}>{children}</MissionCtx.Provider>;
}

export const useMyMission = () => useContext(MissionCtx);

/** Шторка: потяни вверх (или удерживай), чтобы прочитать; отпусти — закроется. */
export function MissionShutter({ text, staff }: { text: string; staff: boolean }) {
  const H = 230;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = () => {
    startY.current = null;
    if (hold.current) clearTimeout(hold.current);
    setDragging(false);
    setOffset(0);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-surface-2" style={{ height: H }}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        {staff ? <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">🤝 {t.game.staffMission}</span> : null}
        <p className="text-xl leading-snug font-semibold">{text}</p>
      </div>
      <div
        role="button"
        aria-label={t.game.swipeToReveal}
        tabIndex={0}
        onPointerDown={(e) => {
          startY.current = e.clientY;
          setDragging(true);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          hold.current = setTimeout(() => setOffset(-H), 380);
        }}
        onPointerMove={(e) => {
          if (startY.current === null) return;
          const dy = e.clientY - startY.current;
          if (Math.abs(dy) > 6 && hold.current) {
            clearTimeout(hold.current);
            hold.current = null;
          }
          if (Math.abs(dy) > 6) setOffset(Math.max(-H, Math.min(0, dy)));
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => e.key === ' ' && setOffset(-H)}
        onKeyUp={release}
        className="absolute inset-0 flex touch-none flex-col items-center justify-center gap-2 select-none"
        style={{
          transform: `translateY(${offset}px)`,
          transition: dragging ? 'none' : 'transform 320ms cubic-bezier(.2,.8,.2,1)',
          background: 'repeating-linear-gradient(135deg, #2f241d 0 14px, #2a2019 14px 28px)',
        }}
      >
        <span className="text-5xl" aria-hidden>
          🤫
        </span>
        <span className="text-lg font-semibold">↑ {t.game.yourMission}</span>
        <span className="px-6 text-center text-sm text-muted">
          {t.game.swipeToReveal} {t.game.holdToReveal}
        </span>
        <span className="absolute bottom-3 h-1.5 w-14 rounded-full bg-faint/60" />
      </div>
    </div>
  );
}

export function MissionsScreen() {
  const { state, act, busy } = useGame();
  const { mission, loading } = useMyMission();
  const doneCount = state.missions.filter((m) => m.done).length;
  const fullMode = state.mode === 'full';

  return (
    <>
      <Screen kicker={`${t.game.rounds.missions} · ${state.roundIdx + 1}/${state.rounds.length}`} title={mission?.done ? t.game.missionDoneShort : t.game.yourMission}>
        {mission ? (
          mission.done ? (
            <PhonesDown
              title={fullMode ? 'Уберите телефоны — ведущий позовёт к следующему раунду' : t.game.phonesDownFinal}
              hint={t.game.phonesDownFinalHint}
            />
          ) : (
            <>
              <MissionShutter text={mission.text} staff={mission.staff} />
              <p className="text-center text-sm text-muted">Выполни незаметно за вечер. Получится — +3 очка в финале.</p>
              <BigButton onClick={() => act({ type: 'mission_done' })} disabled={busy}>
                ✓ {t.game.missionDone}
              </BigButton>
            </>
          )
        ) : loading ? (
          <div className="skeleton h-56 rounded-3xl" />
        ) : (
          <PhonesDown title="Миссий на всех не хватило" hint="Ничего: в финале ты угадываешь чужие миссии и тоже зарабатываешь очки." />
        )}
        <p className="text-center text-xs text-faint">
          {t.game.missionDone}: {doneCount} из {state.missions.length}
        </p>
      </Screen>
      <HostBar>
        <BigButton onClick={() => act({ type: 'next' })} disabled={busy}>
          {fullMode ? `${t.game.toNextRound} →` : `🍰 ${t.game.toFinal}`}
        </BigButton>
      </HostBar>
    </>
  );
}

/** Кнопка «Моя миссия» в раундах после выдачи миссий. */
export function MissionPeek() {
  const { act, busy } = useGame();
  const { mission } = useMyMission();
  const [open, setOpen] = useState(false);
  if (!mission) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-sm">
        <span>🤫 {t.game.myMission}</span>
        <span className={mission.done ? 'text-ok' : 'text-muted'}>{mission.done ? '✓ выполнена' : open ? 'скрыть' : 'показать'}</span>
      </button>
      {open ? (
        <div className="space-y-3 px-3 pb-3">
          <MissionShutter text={mission.text} staff={mission.staff} />
          {!mission.done ? (
            <BigButton onClick={() => act({ type: 'mission_done' })} disabled={busy}>
              ✓ {t.game.missionDone}
            </BigButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
