'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, storageGet, storageSet } from '@/lib/client/api';
import { useZones } from '@/lib/client/use-zones';
import { EnergyWindow, LevelMeter } from '@/lib/audio/meter';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';
import { levelStatus, STATUS_COLOR, STATUS_LABEL, ZONE_IDS, ZONES } from '@/lib/zones';

const DEFAULT_OFFSET = 100; // dBFS → дБ до калибровки (типичный телефон)
const SEND_EVERY_MS = 2_000;
const SAMPLE_EVERY_MS = 50;

type Status = 'idle' | 'starting' | 'running' | 'error';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

export default function SensorClient({ zone, table }: { zone: ZoneId; table: number | null }) {
  const { zones } = useZones(15_000);
  const z = zones?.find((x) => x.id === zone);
  const min = z?.target_min_db ?? ZONES[zone].targetMin;
  const max = z?.target_max_db ?? ZONES[zone].targetMax;

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<number | null>(null);
  const [lastSent, setLastSent] = useState<{ db: number; at: number; ok: boolean } | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [offset, setOffset] = useState(DEFAULT_OFFSET);
  const [sensorId, setSensorId] = useState('');
  const [wake, setWake] = useState<'on' | 'off' | 'na'>('off');
  const [refInput, setRefInput] = useState('');
  const [now, setNow] = useState(0);

  const meterRef = useRef<LevelMeter | null>(null);
  const sendWin = useRef(new EnergyWindow());
  const showWin = useRef(new EnergyWindow());
  const calWin = useRef<number[]>([]); // dBFS последних 2-с окон для калибровки
  const offsetRef = useRef(offset);
  const sensorIdRef = useRef('');
  const wakeRef = useRef<WakeLockSentinelLike | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => {
    offsetRef.current = offset;
    sensorIdRef.current = sensorId;
  }, [offset, sensorId]);

  // ID датчика и оффсет живут на телефоне
  useEffect(() => {
    let id = storageGet('hall:sensor:id');
    if (!id) {
      id = `s-${Math.random().toString(36).slice(2, 6)}`;
      storageSet('hall:sensor:id', id);
    }
    const saved = Number(storageGet('hall:sensor:offset'));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- чтение localStorage после гидрации
    setSensorId(id);
    if (Number.isFinite(saved) && saved !== 0) setOffset(saved);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const requestWake = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) {
      setWake('na');
      return;
    }
    try {
      const lock = await nav.wakeLock.request('screen');
      wakeRef.current = lock;
      setWake('on');
      lock.addEventListener('release', () => setWake('off'));
    } catch {
      setWake('off');
    }
  }, []);

  const stop = useCallback(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    meterRef.current?.stop();
    meterRef.current = null;
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => stop, [stop]);

  // Возврат на вкладку: снова будим экран и аудио
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && meterRef.current) {
        meterRef.current.resume();
        requestWake();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [requestWake]);

  const start = async () => {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? t.sensor.noMic : t.sensor.needHttps);
      setStatus('error');
      return;
    }
    setStatus('starting');
    try {
      const meter = await LevelMeter.start();
      meterRef.current = meter;
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? t.sensor.denied : t.sensor.noMic);
      setStatus('error');
      return;
    }
    setStatus('running');
    requestWake();
    sendWin.current.reset();
    showWin.current.reset();

    // Сэмплирование ~20 раз в секунду: только средний квадрат, сразу в окна усреднения
    timers.current.push(
      setInterval(() => {
        const m = meterRef.current;
        if (!m) return;
        const ms = m.sampleMeanSquare();
        sendWin.current.add(ms);
        showWin.current.add(ms);
      }, SAMPLE_EVERY_MS),
    );
    // Крупная цифра — 4 раза в секунду
    timers.current.push(
      setInterval(() => {
        const dbfs = showWin.current.dbfs();
        showWin.current.reset();
        if (dbfs !== null) setDisplay(Math.max(0, Math.round((dbfs + offsetRef.current) * 10) / 10));
      }, 250),
    );
    // Раз в 2 секунды — Leq за 2 секунды на сервер
    timers.current.push(
      setInterval(async () => {
        const dbfs = sendWin.current.dbfs();
        sendWin.current.reset();
        if (dbfs === null) return;
        calWin.current = [...calWin.current.slice(-4), dbfs];
        const db = Math.max(0, Math.min(140, Math.round((dbfs + offsetRef.current) * 10) / 10));
        setHistory((h) => [...h.slice(-89), db]);
        try {
          await api('/api/readings', {
            body: { zone, sensor_id: sensorIdRef.current, table_no: table, db },
          });
          setLastSent({ db, at: Date.now(), ok: true });
        } catch {
          setLastSent({ db, at: Date.now(), ok: false });
        }
      }, SEND_EVERY_MS),
    );
  };

  const saveOffset = (v: number) => {
    const r = Math.round(v * 10) / 10;
    setOffset(r);
    storageSet('hall:sensor:offset', String(r));
  };

  const calibrate = () => {
    const ref = Number(refInput.replace(',', '.'));
    const last = calWin.current.at(-1);
    if (!Number.isFinite(ref) || ref < 20 || ref > 130 || last === undefined) return;
    saveOffset(ref - last);
    setRefInput('');
  };

  const st = levelStatus(display, min, max);
  const color = STATUS_COLOR[st];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-faint">{t.sensor.title}</p>
          <h1 className="text-lg font-semibold">
            {ZONES[zone].title}
            {table ? <span className="text-muted"> · {t.sensor.tableLabel} {table}</span> : null}
          </h1>
        </div>
        <nav className="flex gap-1">
          {ZONE_IDS.map((id) => (
            <Link
              key={id}
              href={`/sensor?zone=${id}${table ? `&t=${table}` : ''}`}
              className={`grid h-9 w-9 place-items-center rounded-full border text-sm font-semibold ${
                id === zone ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted'
              }`}
              aria-label={`${t.sensor.chooseZone} ${id}`}
            >
              {id}
            </Link>
          ))}
        </nav>
      </header>

      {/* Приватность — крупно, это жёсткое требование */}
      <section className="rounded-2xl border border-ok/40 bg-ok/10 p-4">
        <p className="flex items-center gap-2 text-xl font-bold text-ok">
          <span aria-hidden>🔒</span> {t.sensor.privacyTitle}
        </p>
        <p className="mt-2 text-base leading-snug text-ink/90">{t.sensor.privacyText}</p>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-line bg-surface px-4 py-6 text-center">
        {status === 'running' ? (
          <>
            <div className="tabular font-bold leading-none transition-colors" style={{ color, fontSize: 'min(34vw, 150px)' }}>
              {display === null ? '—' : Math.round(display)}
            </div>
            <div className="mt-1 text-2xl font-semibold" style={{ color }}>
              {t.common.db} · {STATUS_LABEL[st]}
            </div>
            <p className="mt-3 text-muted">
              {t.sensor.target}: <span className="tabular text-ink">{min}–{max} дБ</span>
            </p>
            <Sparkline values={history} min={min} max={max} />
            <p className={`mt-2 text-sm ${lastSent && !lastSent.ok ? 'text-bad' : 'text-faint'}`}>
              {lastSent
                ? lastSent.ok
                  ? `${t.sensor.sent} ${Math.round(lastSent.db)} дБ · ${Math.max(0, Math.round((now - lastSent.at) / 1000))} с назад`
                  : t.sensor.sendError
                : '…'}
            </p>
            <p className="mt-1 text-xs text-faint">
              {wake === 'on' ? `☀️ ${t.sensor.wakeOn}` : `⚠️ ${t.sensor.wakeOff}`}
            </p>
            <button onClick={stop} className="mt-5 rounded-full border border-line px-6 py-2 text-muted">
              {t.sensor.stop}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={start}
              disabled={status === 'starting'}
              className="h-44 w-44 rounded-full bg-accent text-xl font-bold text-accent-ink shadow-[0_0_60px_-10px] shadow-accent transition active:scale-95 disabled:opacity-60"
            >
              {status === 'starting' ? t.sensor.starting : t.sensor.start}
            </button>
            {error ? <p className="mt-5 max-w-xs text-bad">{error}</p> : null}
            <p className="mt-5 text-sm text-faint">
              {t.sensor.target}: {min}–{max} дБ
            </p>
          </>
        )}
      </section>

      <details className="rounded-2xl border border-line bg-surface p-4">
        <summary className="cursor-pointer select-none font-semibold">
          {t.sensor.calibration} · <span className="tabular text-muted">{t.sensor.offset} {offset > 0 ? '+' : ''}{offset}</span>
        </summary>
        <p className="mt-2 text-sm text-muted">{t.sensor.calibrationHint}</p>
        <div className="mt-3 flex gap-2">
          <input
            inputMode="decimal"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            placeholder={t.sensor.referenceDb}
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink placeholder:text-faint"
          />
          <button
            onClick={calibrate}
            disabled={status !== 'running' || !refInput}
            className="rounded-xl bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-40"
          >
            {t.sensor.calibrate}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <button onClick={() => saveOffset(offset - 1)} className="rounded-lg border border-line px-3 py-1">
            −1
          </button>
          <button onClick={() => saveOffset(offset + 1)} className="rounded-lg border border-line px-3 py-1">
            +1
          </button>
          <button onClick={() => saveOffset(DEFAULT_OFFSET)} className="ml-auto text-muted underline">
            {t.sensor.reset}
          </button>
        </div>
        <p className="mt-3 text-xs text-faint">
          {t.sensor.sensorId}: <span className="font-mono">{sensorId}</span>
        </p>
      </details>
    </main>
  );
}

function Sparkline({ values, min, max }: { values: number[]; min: number; max: number }) {
  const W = 280;
  const H = 56;
  const lo = Math.min(min - 10, ...values);
  const hi = Math.max(max + 10, ...values);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const step = W / 89; // 90 точек = 3 минуты, новые справа
  const pts = values.map((v, i) => `${(W - (values.length - 1 - i) * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-14 w-full max-w-xs" aria-hidden>
      <rect x={0} y={y(max)} width={W} height={Math.max(1, y(min) - y(max))} fill="#22c55e22" />
      {values.length > 1 ? <polyline points={pts} fill="none" stroke="#f6ece2" strokeWidth={2} strokeLinejoin="round" /> : null}
    </svg>
  );
}
