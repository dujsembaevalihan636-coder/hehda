'use client';

import { DATA_MODE } from '@/lib/config';
import { t } from '@/lib/i18n';
import { useRealtimeStatus } from '@/lib/realtime/client';

export function LiveDot({ className = '' }: { className?: string }) {
  const s = useRealtimeStatus();
  if (s === 'idle') return null;
  const color = s === 'live' ? 'bg-ok' : s === 'offline' ? 'bg-bad' : 'bg-warn';
  const label = s === 'live' ? t.common.live : s === 'offline' ? t.common.offline : t.common.connecting;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-muted ${className}`} title={DATA_MODE === 'local' ? t.common.modeLocal : t.common.modeSupabase}>
      <span className={`h-2 w-2 rounded-full ${color} ${s === 'live' ? 'animate-pulse' : ''}`} />
      {label}
      {DATA_MODE === 'local' ? <span className="rounded bg-surface-3 px-1 text-[10px] uppercase tracking-wide text-faint">local</span> : null}
    </span>
  );
}
