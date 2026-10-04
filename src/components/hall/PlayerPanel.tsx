'use client';

import { useEffect, useRef, useState } from 'react';

import { formatEvent } from '@/lib/acoustic/format';
import { loadManifest, ZonePlayer, type Manifest } from '@/lib/audio/zone-player';
import { useHallEvents } from '@/lib/client/use-events';
import { useZones } from '@/lib/client/use-zones';
import { t } from '@/lib/i18n';
import type { ZoneId } from '@/lib/types';
import { TEMPO_BPM, TEMPO_LABEL, TEMPOS, VOLUME_RANGE_DB, ZONES } from '@/lib/zones';
import { LiveDot } from '@/components/ui/LiveDot';

/** Обратное к gainFromVolume: какую «громкость» сейчас реально слышно (с учётом рампы). */
function volumeFromGain(g: number) {
  if (g <= 0.0001) return 0;
  return Math.max(0, Math.min(1, 1 + (20 * Math.log10(g)) / VOLUME_RANGE_DB));
}

export function PlayerPanel({ zone, big = true }: { zone: ZoneId; big?: boolean }) {
  const { zones } = useZones(5_000);
  const z = zones?.find((x) => x.id === zone) ?? null;
  const { events } = useHallEvents(zone, 6);

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState({ level: -100, heard: 0, playing: '', files: false });
  const playerRef = useRef<ZonePlayer | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest);
    return () => {
      playerRef.current?.close();
      playerRef.current = null;
    };
  }, []);

  // Реакция на изменения зоны в реальном времени
  const volume = z?.music_volume;
  const tempo = z?.tempo;
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !started || volume === undefined) return;
    if (Math.abs(p.volume - volume) > 0.001) p.setVolume(volume, 3);
  }, [volume, started]);
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !started || !tempo) return;
    p.setTempo(tempo, 4);
  }, [tempo, started]);

  // Индикаторы ~15 раз в секунду
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 66) return;
      last = ts;
      const p = playerRef.current;
      if (!p) return;
      setView({ level: p.level(), heard: volumeFromGain(p.currentGain()), playing: p.nowPlaying(), files: p.usesFiles() });
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => {
      if (document.visibilityState === 'visible') playerRef.current?.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [started]);

  const start = () => {
    if (!z) return;
    const p = new ZonePlayer(manifest ?? { slow: [], mid: [], fast: [] });
    playerRef.current = p;
    p.setVolume(z.music_volume, 1.5);
    p.setTempo(z.tempo);
    setStarted(true);
  };

  const togglePause = async () => {
    const p = playerRef.current;
    if (!p) return;
    if (paused) await p.resume();
    else await p.pause();
    setPaused(!paused);
  };

  const meta = ZONES[zone];
  const target = z?.music_volume ?? meta.defaultVolume;
  const ramping = started && Math.abs(view.heard - target) > 0.012;
  const lvl = Math.max(0, Math.min(1, (view.level + 60) / 54));
  const manifestCount = manifest ? manifest.slow.length + manifest.mid.length + manifest.fast.length : 0;

  return (
    <section className="flex h-full flex-col rounded-3xl border border-line bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-faint">{t.player.title}</p>
          <h2 className={`${big ? 'text-2xl' : 'text-xl'} font-semibold`}>{meta.title}</h2>
        </div>
        <LiveDot />
      </header>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
          <button
            onClick={start}
            disabled={!z}
            className="h-40 w-40 rounded-full bg-accent text-lg font-bold text-accent-ink shadow-[0_0_80px_-10px] shadow-accent transition active:scale-95 disabled:opacity-50"
          >
            ▶︎ {t.player.start}
          </button>
          <p className="text-sm text-muted">{t.player.startHint}</p>
          <p className="text-xs text-faint">
            {manifestCount ? `${manifestCount} ${t.player.files} в /public/music` : t.player.synth}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-5 pt-4">
          <div className="flex items-center gap-6">
            <div className="relative grid h-40 w-40 shrink-0 place-items-center">
              <div
                className="absolute inset-0 rounded-full bg-accent/20 transition-transform duration-100"
                style={{ transform: `scale(${0.55 + lvl * 0.45})` }}
              />
              <div
                className="absolute inset-3 rounded-full border-2 border-accent/50"
                style={{ transform: `scale(${0.6 + view.heard * 0.4})`, transition: 'transform 120ms linear' }}
              />
              <div className="relative text-center">
                <div className="tabular text-5xl font-bold">{Math.round(view.heard * 100)}%</div>
                <div className="text-xs text-muted">{t.player.volume}</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <div className="flex justify-between text-xs text-muted">
                  <span>{t.player.volume}</span>
                  <span className="tabular">
                    {ramping ? '↘︎ ' : ''}
                    {Math.round(target * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-100" style={{ width: `${view.heard * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="text-xs text-muted">{t.player.tempo}</div>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {TEMPOS.map((tp) => (
                    <div
                      key={tp}
                      className={`rounded-lg px-2 py-1.5 text-center text-sm transition-colors ${
                        tp === z?.tempo ? 'bg-accent font-semibold text-accent-ink' : 'bg-surface-3 text-faint'
                      }`}
                    >
                      {TEMPO_LABEL[tp]}
                      <div className="text-[10px] opacity-70">{TEMPO_BPM[tp]} BPM</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="truncate text-sm">
                <span className="text-muted">{t.player.nowPlaying}: </span>
                {view.playing || '…'}
                {!view.files ? <span className="text-faint"> · синтез</span> : null}
              </div>
            </div>
          </div>

          <div className="flex h-10 items-end gap-[3px]" aria-hidden>
            {Array.from({ length: 32 }, (_, i) => {
              const on = i / 32 < lvl;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-sm transition-[height] duration-75"
                  style={{
                    height: `${on ? 30 + ((i * 37) % 70) * lvl : 12}%`,
                    background: on ? (i > 26 ? '#ef4444' : i > 20 ? '#eab308' : '#f59e4c') : '#2f241d',
                  }}
                />
              );
            })}
          </div>

          <div>
            <p className="text-xs uppercase tracking-widest text-faint">{t.player.lastChange}</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {events.slice(0, big ? 4 : 2).map((e) => {
                const f = formatEvent(e);
                return (
                  <li key={e.id} className="animate-fade-in">
                    <span className="tabular text-faint">{f.time}</span> <span className={f.tone === 'alert' ? 'text-bad' : ''}>{f.text}</span>
                  </li>
                );
              })}
              {!events.length ? <li className="text-faint">—</li> : null}
            </ul>
          </div>

          <button onClick={togglePause} className="self-start rounded-full border border-line px-4 py-1.5 text-sm text-muted">
            {paused ? `▶︎ ${t.player.resume}` : `❚❚ ${t.player.stop}`}
          </button>
        </div>
      )}
    </section>
  );
}
