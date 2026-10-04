'use client';

import { AlertsPanel } from '@/components/hall/AlertsPanel';
import { EventFeed } from '@/components/hall/EventFeed';
import { HallMap } from '@/components/hall/HallMap';
import { ZoneCard } from '@/components/hall/ZoneCard';
import { StaffNav } from '@/components/ui/StaffNav';
import { timeHM } from '@/lib/acoustic/format';
import { useHall } from '@/lib/client/use-hall';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';
import { pct, ZONE_IDS, ZONES } from '@/lib/zones';

export default function DashboardClient() {
  const hall = useHall({ runControl: true });
  const { zones, derived, control, metrics, now } = hall;

  const alerts = ZONE_IDS.flatMap((id) => (control[id]?.alerts ?? []).map((alert) => ({ zone: id as ZoneId, alert })));
  const hotTables = ZONE_IDS.map((id) => control[id]?.estimate.hotSensor?.table_no).filter((x): x is number => typeof x === 'number');
  const upcoming = hall.bookings.filter((b) => Date.parse(b.time) > now && Date.parse(b.time) <= now + 90 * 60_000);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1500px] flex-col gap-4 p-4 lg:p-6">
      <StaffNav title={t.dashboard.title} active="/dashboard">
        <span className="text-xs text-muted">
          {t.dashboard.algoEvery}
          {hall.lastRun ? ` · ${t.dashboard.lastRun} ${Math.max(0, Math.round((now - hall.lastRun) / 1000))} с назад` : ''}
        </span>
      </StaffNav>

      {hall.error ? <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{hall.error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-7">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{t.dashboard.hall}</h2>
            <span className="text-xs text-faint">● красная обводка — «Громко?» за 10 мин · тёмные столы — брони</span>
          </div>
          <HallMap
            zones={zones.map((z) => ({ id: z.id, level: derived[z.id]?.latest ?? null, min: z.target_min_db, max: z.target_max_db }))}
            busyTables={hall.busyTables}
            pressedTables={hall.pressedTables}
            hotTables={hotTables}
          />
        </section>

        <section className="flex flex-col gap-4 lg:col-span-5">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-semibold">{t.dashboard.alerts}</h2>
            <AlertsPanel alerts={alerts} />
          </div>
          <div className="min-h-0 flex-1 rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-3 font-semibold">{t.dashboard.feed}</h2>
            <div className="max-h-[360px] overflow-y-auto pr-1">
              <EventFeed events={hall.events} />
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {zones.map((z) => (
          <ZoneCard
            key={z.id}
            zone={z}
            latest={derived[z.id]?.latest ?? null}
            series={derived[z.id]?.series ?? []}
            control={control[z.id]}
            metrics={metrics.find((m) => m.zone_id === z.id)}
            onPatch={(c) => hall.patchZone(z.id, c)}
            onCalibrate={() => hall.calibrate(z.id)}
          />
        ))}
        {!hall.loaded ? <div className="skeleton h-96 rounded-2xl md:col-span-2 xl:col-span-3" /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-7">
          <h2 className="mb-3 font-semibold">{t.dashboard.metrics}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ZONE_IDS.map((id) => {
              const m = metrics.find((x) => x.zone_id === id);
              return (
                <div key={id} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-sm font-semibold">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: ZONES[id].hue }} aria-hidden />
                    {ZONES[id].title}
                  </p>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <Row k={t.dashboard.heard} v={m?.heard_pct == null ? '—' : pct(m.heard_pct)} sub={m ? `${m.heard_yes}/${m.heard_yes + m.heard_no}` : ''} />
                    <Row k={t.dashboard.inTarget} v={m?.in_target_pct == null ? '—' : pct(m.in_target_pct)} />
                    <Row k={t.dashboard.tooLoud} v={String(m?.too_loud_24h ?? 0)} />
                    <Row k={t.dashboard.forecast} v={`${control[id]?.upcomingGuests30m ?? 0} гостей`} />
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4 lg:col-span-5">
          <h2 className="mb-3 font-semibold">{t.dashboard.bookings}</h2>
          {upcoming.length ? (
            <ul className="space-y-1.5 text-sm">
              {upcoming.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="tabular text-faint">{timeHM(b.time)}</span> {b.guest_name}
                  </span>
                  <span className="shrink-0 text-muted">
                    {b.party_size} чел. · зона {b.zone_id} · стол {b.table_no}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-faint">{t.dashboard.noBookings}</p>
          )}
        </section>
      </div>
    </main>
  );
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular font-semibold">
        {v} {sub ? <span className="text-xs font-normal text-faint">{sub}</span> : null}
      </dd>
    </div>
  );
}
