'use client';

import { useState } from 'react';

import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';

/** Послевизитный вопрос «Было слышно друг друга?» — на /feedback и в итоге эпизода Table Mode. */
export function HeardQuestion({
  zone,
  table,
  big = false,
  onDone,
}: {
  zone: ZoneId | null;
  table: number | null;
  big?: boolean;
  onDone?: () => void;
}) {
  const [state, setState] = useState<'ask' | 'sending' | 'done'>('ask');

  const answer = async (yes: boolean) => {
    setState('sending');
    try {
      await api('/api/feedback', { body: { type: yes ? 'could_hear_yes' : 'could_hear_no', zone: zone ?? undefined, table_no: table } });
    } catch {
      /* ответ не критичен — благодарим всё равно */
    }
    setState('done');
    onDone?.();
  };

  if (state === 'done') {
    return (
      <div className="animate-pop">
        <p className={`${big ? 'text-4xl' : 'text-xl'} font-bold`}>{t.feedback.thanks}</p>
        <p className="mt-2 text-muted">{t.feedback.thanksHint}</p>
      </div>
    );
  }

  return (
    <div>
      <p className={`${big ? 'text-4xl leading-tight' : 'text-lg'} font-bold`}>{t.feedback.question}</p>
      <div className={`mt-6 grid grid-cols-2 ${big ? 'gap-4' : 'gap-3'}`}>
        <button
          onClick={() => answer(true)}
          disabled={state === 'sending'}
          className={`rounded-3xl bg-ok font-bold text-white transition active:scale-95 ${big ? 'py-10 text-3xl' : 'py-4 text-xl'}`}
        >
          {t.feedback.yes}
        </button>
        <button
          onClick={() => answer(false)}
          disabled={state === 'sending'}
          className={`rounded-3xl bg-surface-3 font-bold text-ink transition active:scale-95 ${big ? 'py-10 text-3xl' : 'py-4 text-xl'}`}
        >
          {t.feedback.no}
        </button>
      </div>
    </div>
  );
}
