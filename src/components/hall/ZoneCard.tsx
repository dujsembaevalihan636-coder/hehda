'use client';

import { useEffect, useRef, useState } from 'react';

import type { ZoneControl, ZoneMetrics } from '@/lib/client/use-hall';
import { t } from '@/lib/i18n';
import type { Tempo, Zone } from '@/lib/types';
import { levelStatus, pct, STATUS_COLOR, STATUS_LABEL, TEMPO_LABEL, TEMPOS, ZONES } from '@/lib/zones';

import { ZoneChart } from './ZoneChart';

interface Props {
  zone: Zone;
  latest: number | null;
  series: { t: number; db: number | null }[];
  control?: ZoneControl;
  metrics?: ZoneMetrics;
  onPatch: (changes: Partial<Pick<Zone, 'music_volume' | 'tempo' | 'auto_mode' | 'target_min_db' | 'target_max_db'>>) => void;
  onCalibrate: () => Promise<unknown>;
  big?: boolean;
  chartHeight?: number;
}

export function ZoneCard({ zone, latest, series, control, metrics, onPatch, onCalibrate, big = false, chartHeight = 150 }: Props) {
  const meta = ZONES[zone.id];
  const min = zone.target_min_db;
  const max = zone.target_max_db;
  const st = levelStatus(latest, min, max);
  const color = STATUS_COLOR[st];
  const est = control?.estimate;

  // Ползунок громкости: локально при перетаскивании, в базу — после паузы 350 мс
  const [vol, setVol] = useState(zone.music_volume);
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dragging.current) setVol(zone.music_volume);
  }, [zone.music_volume]);

  const onVol = (v: number) => {
    dragging.current = true;
    setVol(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dragging.current = false;
      onPatch({ music_volume: v });
    }, 350);
  };

  const [calMsg, setCalMsg] = useState<string | null>(null);
  const calibrate = async () => {
    setCalMsg('…');
    try {
      await onCalibrate();
      setCalMsg('✓ записано');
    } catch (e) {
      setCalMsg((e as Error).message);
    }
    setTimeout(() => setCalMsg(null), 4000);
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className={`${big ? 'text-2xl' : 'text-lg'} font-semibold`}>
            <span className="mr-1.5 inline-block h-3 w-3 rounded-full align-middle" style={{ background: meta.hue }} aria-hidden />
            {meta.title}
          </h3>
          <p className="text-xs text-muted">
            {t.dashboard.target} {min}–{max} дБ · {control?.state === 'loud' ? 'алгоритм: громко' : control?.state === 'quiet' ? 'алгоритм: тихо' : 'алгоритм: норма'}
          </p>
        </div>
        <div className="text-right">
          <div className={`tabular font-extrabold leading-none ${big ? 'text-7xl' : 'text-5xl'}`} style={{ color: latest === null ? '#7d6d61' : color }}>
            {latest === null ? '—' : Math.round(latest)}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {STATUS_LABEL[st]}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label={t.dashboard.median30} value={est?.median30 != null ? `${est.median30.toFixed(1)}` : '—'} />
        <Stat label={`${t.dashboard.music} ≈`} value={est?.musicDb != null ? `${Math.round(est.musicDb)}` : '—'} />
        <Stat
          label={`${t.dashboard.guests} ≈`}
          value={est?.guestDb != null ? `${Math.round(est.guestDb)}` : est?.musicDominant ? '<' : '—'}
          hint={est?.musicDominant ? t.dashboard.mostlyMusic : undefined}
        />
      </div>

      <ZoneChart series={series} min={min} max={max} height={chartHeight} />

      <div className="space-y-3 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <button
              role="switch"
              aria-checked={zone.auto_mode}
              onClick={() => onPatch({ auto_mode: !zone.auto_mode })}
              className={`relative h-6 w-11 rounded-full transition-colors ${zone.auto_mode ? 'bg-accent' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all ${zone.auto_mode ? 'left-5.5' : 'left-0.5'}`} />
            </button>
            {zone.auto_mode ? t.dashboard.auto : t.dashboard.manual}
          </label>
          <div className="flex gap-1">
            {TEMPOS.map((tp: Tempo) => (
              <button
                key={tp}
                onClick={() => onPatch({ tempo: tp })}
                className={`rounded-md px-2 py-1 text-xs ${zone.tempo === tp ? 'bg-accent font-semibold text-accent-ink' : 'bg-surface-3 text-muted'}`}
              >
                {TEMPO_LABEL[tp]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-muted">
            <span>{t.dashboard.volume}</span>
            <span className="tabular text-ink">{pct(vol)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            onChange={(e) => onVol(Number(e.target.value))}
            className="mt-1 w-full"
            aria-label={t.dashboard.volume}
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{t.dashboard.targetRange}</span>
          <span className="flex items-center gap-1">
            <Stepper value={min} onChange={(v) => v < max - 1 && onPatch({ target_min_db: v })} />
            <span className="text-faint">–</span>
            <Stepper value={max} onChange={(v) => v > min + 1 && onPatch({ target_max_db: v })} />
            <span className="text-muted">дБ</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button onClick={calibrate} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink" title={t.dashboard.calibrateHint}>
            {t.dashboard.calibrate}
          </button>
          <span className="truncate text-xs text-faint">{calMsg ?? (est ? `${est.sensors} ${t.dashboard.sensors}` : '')}</span>
        </div>

        {metrics ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label={t.dashboard.heard} value={metrics.heard_pct === null ? '—' : pct(metrics.heard_pct)} hint={`${metrics.heard_yes} да · ${metrics.heard_no} нет`} />
            <Stat label={t.dashboard.inTarget} value={metrics.in_target_pct === null ? '—' : pct(metrics.in_target_pct)} hint={`${metrics.minutes_measured} мин данных`} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5">
      <div className="tabular text-base font-semibold text-ink">{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      {hint ? <div className="text-[10px] text-faint">{hint}</div> : null}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-3">
      <button className="px-1.5 py-0.5 text-muted" onClick={() => onChange(value - 1)} aria-label="меньше">
        −
      </button>
      <span className="tabular w-6 text-center text-ink">{value}</span>
      <button className="px-1.5 py-0.5 text-muted" onClick={() => onChange(value + 1)} aria-label="больше">
        +
      </button>
    </span>
  );
}
