'use client';

import { useCallback, useEffect, useState } from 'react';

import { StaffNav } from '@/components/ui/StaffNav';
import { api } from '@/lib/client/api';
import type { PublicRoomState } from '@/lib/game/types';
import { t } from '@/lib/i18n';
import { useRealtime } from '@/lib/realtime/client';
import type { Room } from '@/lib/types';

// Питч Table Mode на одном ноутбуке: четыре «телефона» за столом 7 и синхронизация в реальном времени.

const TABLE = 7;
const NAMES = ['Аня', 'Борис', 'Вика', 'Гоша'];

const PHASE_LABEL: Record<string, string> = {
  idle: 'стол свободен',
  lobby: 'лобби',
  intro: 'знакомство с эпизодом',
  warmup: 'разогрев',
  missions: 'секретные миссии',
  vote2: 'второй круг',
  vote3: 'про повод',
  final: 'финал',
  summary: 'итог эпизода',
};

export default function DemoTableClient() {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [version, setVersion] = useState(0);
  const [frameKey, setFrameKey] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ state: PublicRoomState; version: number }>(`/api/room/${TABLE}`);
      setState(r.state);
      setVersion(r.version);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  useRealtime<Room>('rooms', `table_no=eq.${TABLE}`, (c) => {
    if (c.new && c.new.version >= version) {
      setState(c.new.state as PublicRoomState);
      setVersion(c.new.version);
    }
  });

  const simulate = async () => {
    try {
      await api(`/api/room/${TABLE}`, { body: { action: { type: 'simulate' } } });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const reset = async () => {
    await api('/api/demo', { body: { action: 'reset_room', table: TABLE } });
    // Чистим «телефоны»: у каждого iframe свой ключ игрока в localStorage
    NAMES.forEach((_, i) => {
      try {
        localStorage.removeItem(`tm:${TABLE}:${i + 1}`);
      } catch {
        /* ignore */
      }
    });
    setFrameKey((k) => k + 1);
    setMsg('Стол 7 свободен — телефоны входят заново');
    setTimeout(() => setMsg(null), 4000);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1700px] flex-col gap-4 p-4 lg:p-6">
      <StaffNav title={t.demo.table} active="/demo" />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
        <div className="text-sm">
          <span className="text-muted">Стол {TABLE}: </span>
          <span className="font-semibold">{state ? PHASE_LABEL[state.phase] ?? state.phase : '…'}</span>
          {state?.company ? (
            <span className="text-muted">
              {' '}
              · «{state.company.name}» · код <span className="font-mono text-accent">{state.company.code}</span> · эпизод {state.episodeNo}
            </span>
          ) : null}
          <span className="text-faint"> · v{version}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={simulate} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            🤖 {t.demo.simulateVotes}
          </button>
          <button onClick={reset} className="rounded-full border border-line px-4 py-2 text-sm text-muted">
            ↺ {t.demo.resetRoom}
          </button>
        </div>
        {msg ? <p className="w-full text-sm text-accent">{msg}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {NAMES.map((name, i) => (
          <div key={`${frameKey}-${i}`} className="flex flex-col items-center gap-2">
            <div className="text-sm text-muted">
              📱 {name}
              {state?.hostId && state.players.find((p) => p.id === state.hostId)?.name === name ? ' · ведущий 👑' : ''}
            </div>
            <div className="overflow-hidden rounded-[2.2rem] border-[10px] border-[#2a201a] bg-bg shadow-2xl" style={{ width: 360, height: 720 }}>
              <iframe
                title={`Телефон ${name}`}
                src={`/t/${TABLE}?slot=${i + 1}&name=${encodeURIComponent(name)}&embed=1`}
                className="h-full w-full"
              />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
