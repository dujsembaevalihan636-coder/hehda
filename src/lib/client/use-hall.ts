'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ActiveAlert, ControlEvent } from '../acoustic/control';
import { useRealtime, useRealtimeStatus } from '../realtime/client';
import { bucketize, median } from '../stats';
import type { Booking, Feedback, HallEvent, HallTable, Reading, Zone, ZoneId } from '../types';
import { ZONE_IDS } from '../zones';
import { api } from './api';
import { mergeEvents } from './use-events';
import { usePolling } from './use-polling';

// Живые данные зала для дашборда и демо: снимок + realtime + цикл алгоритма раз в 5 секунд.

type SlimReading = Pick<Reading, 'zone_id' | 'sensor_id' | 'table_no' | 'db' | 'created_at'>;

interface Snapshot {
  now: number;
  zones: Zone[];
  tables: HallTable[];
  readings: SlimReading[];
  events: HallEvent[];
  feedback: Feedback[];
  bookings: Booking[];
}

export interface ZoneControl {
  zone_id: ZoneId;
  estimate: {
    median30: number | null;
    latest: number | null;
    musicDb: number | null;
    guestDb: number | null;
    musicDominant: boolean;
    sensors: number;
    hotSensor: { sensor_id: string; table_no: number | null; median: number } | null;
  };
  alerts: ActiveAlert[];
  state: Zone['control_state'];
  decisions: ControlEvent[];
  upcomingGuests30m: number;
}

export interface ZoneMetrics {
  zone_id: ZoneId;
  heard_yes: number;
  heard_no: number;
  heard_pct: number | null;
  too_loud_24h: number;
  in_target_pct: number | null;
  minutes_measured: number;
}

const WINDOW_MS = 15 * 60_000;
const BUCKET_MS = 10_000;

const normZone = (z: Zone): Zone => ({
  ...z,
  music_volume: Number(z.music_volume),
  target_min_db: Number(z.target_min_db),
  target_max_db: Number(z.target_max_db),
});

export function useHall({ runControl = false }: { runControl?: boolean } = {}) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [tables, setTables] = useState<HallTable[]>([]);
  const [readings, setReadings] = useState<SlimReading[]>([]);
  const [events, setEvents] = useState<HallEvent[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [control, setControl] = useState<Record<string, ZoneControl>>({});
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<ZoneMetrics[]>([]);
  const [now, setNow] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rt = useRealtimeStatus();

  const mergeZones = useCallback((incoming: Zone[]) => {
    setZones((prev) =>
      incoming.map((z) => {
        const cur = prev.find((p) => p.id === z.id);
        return cur && cur.version > z.version ? cur : normZone(z);
      }),
    );
  }, []);

  const upsertZone = useCallback((z: Zone) => {
    setZones((prev) => prev.map((p) => (p.id === z.id && z.version >= p.version ? normZone(z) : p)));
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api<Snapshot>('/api/hall?minutes=15');
      mergeZones(s.zones);
      setTables(s.tables);
      setReadings(s.readings);
      setEvents((prev) => mergeEvents(prev, s.events, 80));
      setFeedback(s.feedback);
      setBookings(s.bookings);
      setLoaded(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [mergeZones]);

  const loadMetrics = useCallback(async () => {
    try {
      const m = await api<{ zones: ZoneMetrics[] }>('/api/metrics');
      setMetrics(m.zones);
    } catch {
      /* не критично */
    }
  }, []);

  // Первичная загрузка и страховочный опрос: часто — если realtime недоступен
  const live = rt === 'live';
  usePolling(load, live ? 60_000 : 5_000);
  usePolling(loadMetrics, 30_000);
  usePolling(() => setNow(Date.now()), 2_000);

  // Алгоритм управления — раз в 5 секунд
  const runningRef = useRef(false);
  useEffect(() => {
    if (!runControl) return;
    const run = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const r = await api<{ at: number; zones: ZoneControl[] }>('/api/control', { method: 'POST' });
        setControl(Object.fromEntries(r.zones.map((z) => [z.zone_id, z])));
        setLastRun(r.at);
      } catch {
        /* следующая попытка через 5 с */
      } finally {
        runningRef.current = false;
      }
    };
    run();
    const id = setInterval(run, 5_000);
    return () => clearInterval(id);
  }, [runControl]);

  useRealtime<Zone>('zones', null, (c) => {
    if (c.new) upsertZone(c.new);
  });

  useRealtime<Reading>('readings', null, (c) => {
    if (c.eventType !== 'INSERT' || !c.new) return;
    const r = c.new;
    setReadings((prev) => {
      const cutoff = Date.now() - WINDOW_MS;
      const next = prev.length > 5000 ? prev.filter((x) => Date.parse(x.created_at) >= cutoff) : prev.slice();
      next.push({ zone_id: r.zone_id, sensor_id: r.sensor_id, table_no: r.table_no, db: Number(r.db), created_at: r.created_at });
      return next;
    });
  });

  useRealtime<HallEvent>('events', null, (c) => {
    if (c.eventType === 'INSERT' && c.new) setEvents((prev) => mergeEvents(prev, [c.new as HallEvent], 80));
  });

  useRealtime<Feedback>('feedback', null, (c) => {
    if (c.eventType === 'INSERT' && c.new) setFeedback((prev) => [...prev, c.new as Feedback]);
  });

  // Производные: серии для графиков и «текущий» уровень по зонам
  const derived = useMemo(() => {
    const out = {} as Record<
      ZoneId,
      { series: { t: number; db: number | null }[]; latest: number | null; lastAt: number | null; sensors: string[] }
    >;
    for (const id of ZONE_IDS) {
      const pts = readings
        .filter((r) => r.zone_id === id)
        .map((r) => ({ t: Date.parse(r.created_at), db: Number(r.db), s: r.sensor_id }))
        .filter((p) => !now || p.t >= now - WINDOW_MS);
      const buckets = bucketize(pts, BUCKET_MS);
      // Пустые корзины — разрывы линии (датчик молчал)
      const series: { t: number; db: number | null }[] = [];
      if (now) {
        const start = Math.floor((now - WINDOW_MS) / BUCKET_MS) * BUCKET_MS;
        const map = new Map(buckets.map((b) => [b.t, b.db]));
        for (let t = start; t <= now; t += BUCKET_MS) series.push({ t, db: map.get(t) ?? null });
      }
      const lastAt = pts.length ? pts[pts.length - 1].t : null;
      const recent = pts.filter((p) => lastAt !== null && p.t >= lastAt - 6_000);
      const stale = lastAt === null || (now && now - lastAt > 20_000);
      out[id] = {
        series,
        latest: stale ? null : median(recent.map((p) => p.db)),
        lastAt,
        sensors: [...new Set(pts.filter((p) => now && p.t >= now - 30_000).map((p) => p.s))],
      };
    }
    return out;
  }, [readings, now]);

  const pressedTables = useMemo(() => {
    const cutoff = now - 10 * 60_000;
    return [...new Set(feedback.filter((f) => f.type === 'too_loud' && Date.parse(f.created_at) >= cutoff && f.table_no).map((f) => f.table_no as number))];
  }, [feedback, now]);

  const busyTables = useMemo(() => {
    return [...new Set(bookings.filter((b) => Math.abs(Date.parse(b.time) - now) <= 2 * 3600_000).map((b) => b.table_no))];
  }, [bookings, now]);

  const patchZone = useCallback(
    async (id: ZoneId, changes: Partial<Pick<Zone, 'music_volume' | 'tempo' | 'auto_mode' | 'target_min_db' | 'target_max_db'>>) => {
      setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...changes } : z)));
      try {
        const r = await api<{ zone: Zone }>('/api/zones', { method: 'PATCH', body: { id, ...changes } });
        upsertZone(r.zone);
      } catch (e) {
        setError((e as Error).message);
        load();
      }
    },
    [load, upsertZone],
  );

  const calibrate = useCallback(
    async (id: ZoneId) => {
      const r = await api<{ zone: Zone }>('/api/zones/calibrate', { body: { id } });
      upsertZone(r.zone);
      return r.zone;
    },
    [upsertZone],
  );

  return {
    loaded,
    error,
    now,
    zones,
    tables,
    readings,
    events,
    feedback,
    bookings,
    control,
    lastRun,
    metrics,
    derived,
    pressedTables,
    busyTables,
    patchZone,
    calibrate,
    reload: load,
  };
}

export type HallData = ReturnType<typeof useHall>;
