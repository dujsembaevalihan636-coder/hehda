'use client';

import type { Tempo } from '../types';
import { gainFromVolume, TEMPOS } from '../zones';
import { AmbientSynth, SynthKit, type TempoSource } from './synth';

// «Колонки зоны»: громкость плавно меняется за 3 секунды, темп — кроссфейдом между папками
// slow/mid/fast. Если в папке нет треков, играет генеративный эмбиент нужного темпа.

export type Manifest = Record<Tempo, string[]>;

export const EMPTY_MANIFEST: Manifest = { slow: [], mid: [], fast: [] };

class FilePlaylist implements TempoSource {
  private el: HTMLAudioElement | null = null;
  private node: MediaElementAudioSourceNode | null = null;
  private idx: number;
  private failures = 0;
  private stopped = false;

  constructor(
    private ctx: AudioContext,
    private bus: AudioNode,
    private files: string[],
    private onDead: () => void,
  ) {
    this.idx = Math.floor(Math.random() * files.length);
  }

  label() {
    const f = this.files[this.idx] ?? '';
    return decodeURIComponent(f.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
  }

  start() {
    this.play(this.idx);
  }

  private play(i: number) {
    if (this.stopped) return;
    this.idx = i;
    const el = new Audio(this.files[i]);
    el.preload = 'auto';
    const node = this.ctx.createMediaElementSource(el);
    node.connect(this.bus);
    const next = () => {
      node.disconnect();
      this.play((i + 1) % this.files.length);
    };
    el.onended = () => {
      this.failures = 0;
      next();
    };
    el.onerror = () => {
      this.failures++;
      if (this.failures >= this.files.length) {
        node.disconnect();
        this.onDead();
      } else setTimeout(next, 300);
    };
    el.play().catch(() => {});
    this.el = el;
    this.node = node;
  }

  stop(fadeOutAt?: number) {
    this.stopped = true;
    const delay = Math.max(0, ((fadeOutAt ?? this.ctx.currentTime) - this.ctx.currentTime) * 1000) + 500;
    const el = this.el;
    const node = this.node;
    setTimeout(() => {
      el?.pause();
      node?.disconnect();
    }, delay);
  }
}

export class ZonePlayer {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private master: GainNode;
  private kit: SynthKit;
  private buses = {} as Record<Tempo, GainNode>;
  private sends = {} as Record<Tempo, GainNode>;
  private sources: Partial<Record<Tempo, TempoSource>> = {};
  private dead = new Set<Tempo>();
  private levelBuf: Float32Array<ArrayBuffer>;
  tempo: Tempo | null = null;
  volume = 0;

  /** Только из обработчика клика (политика автозапуска звука). */
  constructor(
    private manifest: Manifest,
    private onUpdate: () => void = () => {},
  ) {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.ctx.resume().catch(() => {});

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    comp.connect(this.master).connect(this.analyser).connect(this.ctx.destination);
    this.levelBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    this.kit = new SynthKit(this.ctx, comp);
    for (const tp of TEMPOS) {
      const bus = this.ctx.createGain();
      bus.gain.value = 0;
      bus.connect(comp);
      const send = this.ctx.createGain();
      send.gain.value = 0;
      send.connect(this.kit.reverbIn);
      this.buses[tp] = bus;
      this.sends[tp] = send;
    }
  }

  /** Плавное изменение громкости (линейно по усилению за rampSec секунд). */
  setVolume(v: number, rampSec = 3) {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(gainFromVolume(v), now + rampSec);
    this.volume = v;
    this.onUpdate();
  }

  /** Смена темпа кроссфейдом. */
  setTempo(tempo: Tempo, fadeSec = 4) {
    if (tempo === this.tempo) return;
    const now = this.ctx.currentTime;
    const prev = this.tempo;
    const fade = prev ? fadeSec : 1.5;

    this.sources[tempo]?.stop(now);
    const src = this.makeSource(tempo);
    this.sources[tempo] = src;
    src.start();
    for (const node of [this.buses[tempo], this.sends[tempo]]) {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(1, now + fade);
    }
    if (prev) {
      for (const node of [this.buses[prev], this.sends[prev]]) {
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(0, now + fade);
      }
      const old = this.sources[prev];
      delete this.sources[prev];
      old?.stop(now + fade + 0.2);
    }
    this.tempo = tempo;
    this.onUpdate();
  }

  private makeSource(tempo: Tempo): TempoSource {
    const files = this.manifest[tempo] ?? [];
    if (files.length && !this.dead.has(tempo)) {
      return new FilePlaylist(this.ctx, this.buses[tempo], files, () => {
        // Файлы не грузятся — переключаемся на синтез того же темпа
        this.dead.add(tempo);
        if (this.tempo === tempo) {
          const synth = this.makeSource(tempo);
          this.sources[tempo] = synth;
          synth.start();
          this.onUpdate();
        }
      });
    }
    return new AmbientSynth(this.ctx, this.buses[tempo], this.sends[tempo], this.kit, tempo);
  }

  usesFiles(tempo: Tempo | null = this.tempo) {
    return Boolean(tempo && this.manifest[tempo]?.length && !this.dead.has(tempo));
  }

  nowPlaying() {
    return this.tempo ? (this.sources[this.tempo]?.label() ?? '') : '';
  }

  /** Текущий уровень на выходе, dBFS. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let ms = 0;
    for (let i = 0; i < this.levelBuf.length; i++) ms += this.levelBuf[i] * this.levelBuf[i];
    ms /= this.levelBuf.length;
    return ms > 1e-10 ? 10 * Math.log10(ms) : -100;
  }

  currentGain() {
    return this.master.gain.value;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
  }

  async pause() {
    await this.ctx.suspend().catch(() => {});
  }

  close() {
    Object.values(this.sources).forEach((s) => s?.stop());
    this.sources = {};
    this.ctx.close().catch(() => {});
  }
}

export async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch('/music/manifest.json', { cache: 'no-store' });
    if (!res.ok) return EMPTY_MANIFEST;
    const m = (await res.json()) as Partial<Manifest>;
    return { slow: m.slow ?? [], mid: m.mid ?? [], fast: m.fast ?? [] };
  } catch {
    return EMPTY_MANIFEST;
  }
}
