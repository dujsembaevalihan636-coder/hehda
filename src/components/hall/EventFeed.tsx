'use client';

import { formatEvent, type EventTone } from '@/lib/acoustic/format';
import { t } from '@/lib/i18n';
import type { HallEvent } from '@/lib/types';

const ICON: Record<EventTone, { icon: string; cls: string; label: string }> = {
  down: { icon: '↓', cls: 'bg-accent-soft text-accent', label: 'тише' },
  up: { icon: '↑', cls: 'bg-surface-3 text-ink', label: 'громче' },
  tempo: { icon: '♩', cls: 'bg-surface-3 text-ink', label: 'темп' },
  alert: { icon: '⚠', cls: 'bg-bad/20 text-bad', label: 'алерт' },
  manual: { icon: '✎', cls: 'bg-surface-3 text-muted', label: 'вручную' },
  info: { icon: '•', cls: 'bg-surface-3 text-muted', label: '' },
};

export function EventFeed({ events, max = 30, className = '' }: { events: HallEvent[]; max?: number; className?: string }) {
  if (!events.length) return <p className="text-sm text-faint">{t.dashboard.noEvents}</p>;
  return (
    <ul className={`space-y-2 ${className}`}>
      {events.slice(0, max).map((e) => {
        const f = formatEvent(e);
        const ic = ICON[f.tone];
        return (
          <li key={e.id} className="flex animate-rise items-start gap-2.5 text-sm">
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-sm font-bold ${ic.cls}`} title={ic.label}>
              {ic.icon}
            </span>
            <span className="min-w-0 leading-snug">
              <span className="tabular text-faint">{f.time}</span> {f.zone ? <span className="font-semibold">{f.zone}</span> : null}{' '}
              <span className={f.tone === 'alert' ? 'text-bad' : 'text-ink/90'}>{f.text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
