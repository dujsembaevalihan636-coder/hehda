'use client';

import type { ActiveAlert } from '@/lib/acoustic/control';
import { formatEvent } from '@/lib/acoustic/format';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';

const HINT: Record<ActiveAlert['kind'], string> = {
  above_5min: 'Громче цели дольше 5 минут — загляните в зону',
  guest_presses: 'Гости просят тише — подойдите к столам',
  relocate: 'Музыку дальше не убавляем: предложите компании пересадку в зону C «Движ»',
};

export function AlertsPanel({ alerts }: { alerts: { zone: ZoneId; alert: ActiveAlert }[] }) {
  if (!alerts.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
        <span aria-hidden>✓</span> {t.dashboard.noAlerts}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {alerts.map(({ zone, alert }) => {
        const f = formatEvent({ type: 'alert', zone_id: zone, payload: { kind: alert.kind, ...alert.data }, created_at: new Date().toISOString() });
        return (
          <li key={`${zone}-${alert.kind}`} className="animate-pop rounded-xl border border-bad/50 bg-bad/15 px-3 py-2.5 animate-pulse-ring">
            <p className="text-sm font-semibold text-ink">
              <span aria-hidden>⚠ </span>Зона {zone}: {f.text}
            </p>
            <p className="mt-0.5 text-xs text-muted">{HINT[alert.kind]}</p>
          </li>
        );
      })}
    </ul>
  );
}
