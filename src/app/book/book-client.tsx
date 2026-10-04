'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { HallMap } from '@/components/hall/HallMap';
import { timeHM } from '@/lib/acoustic/format';
import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import type { Atmosphere, Booking, HallTable, ZoneId } from '@/lib/types';
import { trafficLabel, ZONE_IDS, ZONES } from '@/lib/zones';

interface PublicHall {
  zones: { id: ZoneId; name: string; target_min_db: number; target_max_db: number; level: number | null }[];
  tables: HallTable[];
  busyTables: number[];
}

interface BookingResult {
  booking: Booking;
  moved: boolean;
  zone: { title: string };
}

const CARDS: { id: Atmosphere; zone: ZoneId; icon: string }[] = [
  { id: 'talk', zone: 'A', icon: '💬' },
  { id: 'background', zone: 'B', icon: '🍷' },
  { id: 'lively', zone: 'C', icon: '🎶' },
];

/** Слоты на сегодня с шагом 30 минут до 23:00 (или завтрашний вечер, если уже поздно). */
function slots(now: Date): Date[] {
  const out: Date[] = [];
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60);
  if (start.getHours() < 12) start.setHours(12, 0);
  let d = new Date(start);
  const end = new Date(now);
  end.setHours(23, 0, 0, 0);
  if (d > end) {
    d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    end.setDate(end.getDate() + 1);
  }
  while (d <= end && out.length < 24) {
    out.push(new Date(d));
    d = new Date(d.getTime() + 30 * 60_000);
  }
  return out;
}

export default function BookClient() {
  const [hall, setHall] = useState<PublicHall | null>(null);
  const [atmosphere, setAtmosphere] = useState<Atmosphere | null>(null);
  const [name, setName] = useState('');
  const [party, setParty] = useState(2);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setHall(await api<PublicHall>('/api/hall/public'));
    } catch {
      /* карта подождёт */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- время берём только в браузере (без расхождения с SSR)
    setNow(new Date());
  }, []);

  const options = useMemo(() => (now ? slots(now) : []), [now]);
  const chosenTime = time ?? options[0]?.toISOString() ?? null;

  const submit = async () => {
    if (!atmosphere) return setError('Выберите атмосферу');
    if (!name.trim()) return setError('Как вас зовут?');
    if (!chosenTime) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<BookingResult>('/api/bookings', {
        body: { guest_name: name.trim(), party_size: party, time: chosenTime, atmosphere },
      });
      setResult(r);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mapZones = (hall?.zones ?? []).map((z) => ({ id: z.id, level: z.level, min: z.target_min_db, max: z.target_max_db }));

  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:py-10">
      <section className="order-2 min-w-0 lg:order-1">
        <p className="text-xs uppercase tracking-widest text-faint">{t.common.appName}</p>
        <h1 className="mt-1 text-3xl font-bold">{t.book.title}</h1>

        {result ? (
          <div className="mt-6 animate-pop rounded-3xl border border-accent/50 bg-accent-soft p-6">
            <p className="text-sm text-muted">{t.book.done}</p>
            <p className="mt-2 text-5xl font-extrabold">
              {t.book.yourTable} №{result.booking.table_no}
            </p>
            <p className="mt-2 text-lg">{result.zone.title}</p>
            <p className="mt-1 text-muted">
              {timeHM(result.booking.time)} · {result.booking.party_size} {result.booking.party_size === 1 ? 'гость' : result.booking.party_size < 5 ? 'гостя' : 'гостей'}
            </p>
            {result.moved ? <p className="mt-3 text-sm text-warn">{t.book.moved}</p> : null}
            <p className="mt-4 text-sm text-muted">🎲 {t.book.tableModeHint}</p>
            <button
              onClick={() => {
                setResult(null);
                setAtmosphere(null);
              }}
              className="mt-6 rounded-full border border-line px-5 py-2 text-muted"
            >
              {t.book.another}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div>
              <h2 className="mb-2 font-semibold">{t.book.atmosphere}</h2>
              <div className="grid gap-3">
                {CARDS.map((c) => {
                  const z = hall?.zones.find((x) => x.id === c.zone);
                  const tr = trafficLabel(z?.level ?? null);
                  const active = atmosphere === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setAtmosphere(c.id)}
                      aria-pressed={active}
                      className={`flex items-start gap-4 rounded-2xl border p-4 text-left transition ${
                        active ? 'border-accent bg-accent-soft ring-2 ring-accent/40' : 'border-line bg-surface hover:border-faint'
                      }`}
                    >
                      <span className="text-3xl leading-none" aria-hidden>
                        {c.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-semibold">{t.book.cards[c.id].title}</span>
                        <span className="mt-0.5 block text-sm leading-snug text-muted">{t.book.cards[c.id].text}</span>
                        <span className="mt-2 flex items-center gap-1.5 text-xs text-faint">
                          <span className="h-2 w-2 rounded-full" style={{ background: tr.color }} />
                          сейчас {tr.label} · цель {ZONES[c.zone].targetMin}–{ZONES[c.zone].targetMax} дБ
                        </span>
                      </span>
                      <span
                        className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-sm ${active ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}
                        aria-hidden
                      >
                        {active ? '✓' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="block">
                <span className="text-sm text-muted">{t.book.name}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="given-name"
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 text-lg"
                />
              </label>
              <div>
                <span className="text-sm text-muted">{t.book.party}</span>
                <div className="mt-1 flex items-center rounded-xl border border-line bg-surface">
                  <button onClick={() => setParty((p) => Math.max(1, p - 1))} className="px-4 py-3 text-xl text-muted" aria-label="меньше гостей">
                    −
                  </button>
                  <span className="tabular w-8 text-center text-lg font-semibold">{party}</span>
                  <button onClick={() => setParty((p) => Math.min(8, p + 1))} className="px-4 py-3 text-xl text-muted" aria-label="больше гостей">
                    +
                  </button>
                </div>
              </div>
            </div>

            <div>
              <span className="text-sm text-muted">{t.book.time}</span>
              <div className="mt-1 flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {options.map((d) => {
                  const iso = d.toISOString();
                  const active = iso === chosenTime;
                  return (
                    <button
                      key={iso}
                      onClick={() => setTime(iso)}
                      className={`tabular shrink-0 rounded-xl border px-3 py-2 ${active ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface'}`}
                    >
                      {timeHM(iso)}
                    </button>
                  );
                })}
              </div>
            </div>

            {error ? <p className="text-bad">{error}</p> : null}

            <button
              onClick={submit}
              disabled={busy}
              className="w-full rounded-2xl bg-accent py-4 text-lg font-bold text-accent-ink transition active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? '…' : t.book.submit}
            </button>
          </div>
        )}
      </section>

      <aside className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-3xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">{t.book.liveMap}</h2>
            <span className="hidden text-xs text-faint sm:inline">{t.book.liveHint}</span>
          </div>
          <HallMap
            zones={mapZones}
            mode="traffic"
            busyTables={hall?.busyTables ?? []}
            highlightTable={result?.booking.table_no ?? null}
            focusZone={result ? result.booking.zone_id : atmosphere ? CARDS.find((c) => c.id === atmosphere)!.zone : null}
          />
          <div className="mt-3 flex justify-center gap-4 text-xs text-muted">
            {['тихо', 'умеренно', 'шумно'].map((l, i) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ['#0ca30c', '#fab219', '#d03b3b'][i] }} />
                {l}
              </span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {ZONE_IDS.map((id) => {
              const z = hall?.zones.find((x) => x.id === id);
              return (
                <div key={id} className="rounded-xl bg-surface-2 p-2">
                  <div className="text-xs text-muted">{ZONES[id].name}</div>
                  <div className="tabular text-xl font-bold">{z?.level != null ? Math.round(z.level) : '—'}</div>
                  <div className="text-[10px] text-faint">дБ сейчас</div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-faint">
          <Link href="/" className="underline">
            {t.common.appName}
          </Link>
        </p>
      </aside>
    </main>
  );
}
