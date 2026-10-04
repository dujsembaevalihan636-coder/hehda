'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';
import { ZONES } from '@/lib/zones';

const COOLDOWN_S = 20;

export default function TableClient({ zone, table }: { zone: ZoneId; table: number | null }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [atMin, setAtMin] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const press = async () => {
    if (state === 'sending' || left > 0) return;
    setState('sending');
    try {
      const r = await api<{ from: number | null; to: number | null }>('/api/feedback', {
        body: { type: 'too_loud', zone, table_no: table },
      });
      setAtMin(r.from !== null && r.to !== null && r.to >= r.from);
      setState('done');
      setLeft(COOLDOWN_S);
      navigator.vibrate?.(40);
    } catch {
      setState('error');
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-between px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8 text-center">
      <p className="text-sm text-muted">
        {table ? `${t.common.table} ${table} · ` : ''}
        {ZONES[zone].title}
      </p>

      <div className="flex flex-col items-center">
        <button
          onClick={press}
          disabled={state === 'sending' || left > 0}
          className={`grid h-64 w-64 place-items-center rounded-full text-4xl font-extrabold transition active:scale-95 ${
            state === 'done' ? 'bg-ok text-white' : 'bg-accent text-accent-ink shadow-[0_0_90px_-10px] shadow-accent'
          } disabled:cursor-default`}
        >
          {state === 'done' ? '✓' : t.table.question}
        </button>
        <div className="mt-8 min-h-24">
          {state === 'done' ? (
            <div className="animate-rise">
              <p className="text-2xl font-bold">{atMin ? t.table.atMin : t.table.done}</p>
              {!atMin ? <p className="mt-2 text-muted">{t.table.doneHint}</p> : null}
              {left > 0 ? <p className="mt-2 text-xs text-faint">ещё раз — через {left} с</p> : null}
            </div>
          ) : state === 'error' ? (
            <p className="text-bad">{t.common.offline}</p>
          ) : (
            <p className="text-lg text-muted">{t.table.hint}</p>
          )}
        </div>
      </div>

      {table ? (
        <Link href={`/t/${table}`} className="rounded-full border border-line px-5 py-2.5 text-muted">
          🎲 {t.table.playGame}
        </Link>
      ) : (
        <span />
      )}
    </main>
  );
}
