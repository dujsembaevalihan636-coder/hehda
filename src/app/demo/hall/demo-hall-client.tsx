'use client';

import { useEffect, useRef, useState } from 'react';

import { AlertsPanel } from '@/components/hall/AlertsPanel';
import { EventFeed } from '@/components/hall/EventFeed';
import { FridaySimulation } from '@/components/hall/FridaySimulation';
import { PlayerPanel } from '@/components/hall/PlayerPanel';
import { ZoneCard } from '@/components/hall/ZoneCard';
import { QrCode, useOrigin } from '@/components/ui/QrCode';
import { StaffNav } from '@/components/ui/StaffNav';
import { api } from '@/lib/client/api';
import { useHall } from '@/lib/client/use-hall';
import { t } from '@/lib/i18n';

// Режим питча: слева «колонки» зоны A, справа дашборд зоны A крупно, ниже — симуляция пятницы.

export default function DemoHallClient() {
  const hall = useHall({ runControl: true });
  const zoneA = hall.zones.find((z) => z.id === 'A');
  const origin = useOrigin();
  const [fake, setFake] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fakeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // «Шумная компания» без телефона: синтетический датчик у стола 7
  useEffect(() => {
    if (!fake) return;
    const send = () =>
      api('/api/readings', { body: { zone: 'A', sensor_id: 'имитация', table_no: 7, db: 72 + Math.random() * 4 } }).catch(() => {});
    send();
    fakeTimer.current = setInterval(send, 2000);
    return () => {
      if (fakeTimer.current) clearInterval(fakeTimer.current);
    };
  }, [fake]);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 5000);
  };

  const forecast = async () => {
    const r = await api<{ guests: number }>('/api/demo', { body: { action: 'forecast' } });
    flash(`Добавлены брони: ${r.guests} гостей в зону A через 20 минут — алгоритм заранее убавит музыку`);
  };

  const reset = async () => {
    if (!window.confirm(t.demo.resetConfirm)) return;
    setFake(false);
    await api('/api/demo', { body: { action: 'reset_hall' } });
    await hall.reload();
    flash('Зал сброшен к исходным настройкам');
  };

  const alerts = (hall.control.A?.alerts ?? []).map((alert) => ({ zone: 'A' as const, alert }));
  const eventsA = hall.events.filter((e) => e.zone_id === 'A');

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <StaffNav title={t.demo.hall} active="/demo" />

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-3">
        <div className="flex items-center gap-3">
          <QrCode value="/sensor?zone=A&t=7" size={92} />
          <div className="max-w-[16rem] text-sm">
            <p className="font-semibold">{t.demo.scanSensor}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-faint">{origin}/sensor?zone=A&amp;t=7</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => setFake((v) => !v)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${fake ? 'bg-bad text-white' : 'border border-line text-ink'}`}
          >
            {fake ? `■ ${t.demo.fakeNoiseStop}` : `🗣 ${t.demo.fakeNoise}`}
          </button>
          <button onClick={forecast} className="rounded-full border border-line px-4 py-2 text-sm">
            📅 {t.demo.forecast}
          </button>
          <button onClick={reset} className="rounded-full border border-line px-4 py-2 text-sm text-muted">
            ↺ {t.demo.reset}
          </button>
        </div>
        {msg ? <p className="w-full animate-fade-in text-sm text-accent">{msg}</p> : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <PlayerPanel zone="A" />
        </div>
        <div className="grid gap-4 xl:col-span-7">
          {zoneA ? (
            <ZoneCard
              zone={zoneA}
              latest={hall.derived.A?.latest ?? null}
              series={hall.derived.A?.series ?? []}
              control={hall.control.A}
              metrics={hall.metrics.find((m) => m.zone_id === 'A')}
              onPatch={(c) => hall.patchZone('A', c)}
              onCalibrate={() => hall.calibrate('A')}
              big
              chartHeight={230}
            />
          ) : (
            <div className="skeleton h-96 rounded-2xl" />
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 font-semibold">{t.dashboard.alerts}</h2>
              <AlertsPanel alerts={alerts} />
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 font-semibold">{t.dashboard.feed}</h2>
              <div className="max-h-56 overflow-y-auto pr-1">
                <EventFeed events={eventsA} max={12} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <FridaySimulation />
    </main>
  );
}
