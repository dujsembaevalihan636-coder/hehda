'use client';

import type { Tempo } from '../types';
import { TEMPO_BPM } from '../zones';

// Генеративный эмбиент на Web Audio: демо работает даже без музыкальных файлов.
// Три характера под темп: slow — пэд и колокольчики, mid — лаунж с арпеджио,
// fast — хаус-грув с бочкой. Гармония общая: D – Bm – G – A.

const PROGRESSION = [
  [62, 66, 69, 73], // Dmaj7
  [59, 62, 66, 69], // Bm7
  [55, 59, 62, 66], // Gmaj7
  [57, 61, 64, 67], // A7
];
const BASS = [38, 35, 43, 45]; // D2 B1 G2 A2
const PENTA = [74, 76, 78, 81, 83, 86, 88]; // D-мажорная пентатоника

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface TempoSource {
  start(): void;
  stop(fadeOutAt?: number): void;
  label(): string;
}

/** Общие узлы контекста: шум, реверб. */
export class SynthKit {
  readonly noise: AudioBuffer;
  readonly reverb: ConvolverNode;
  readonly reverbIn: GainNode;

  constructor(
    readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    const len = ctx.sampleRate * 1;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Реверб: стерео-шум с экспоненциальным затуханием 2.8 с
    const irLen = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverbIn.connect(this.reverb).connect(wet).connect(out);
  }
}

export class AmbientSynth implements TempoSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private next = 0;
  private readonly sixteenth: number;
  private readonly out: GainNode;
  private stopped = false;

  constructor(
    private ctx: AudioContext,
    bus: AudioNode,
    private send: AudioNode,
    private kit: SynthKit,
    private tempo: Tempo,
  ) {
    this.sixteenth = 60 / TEMPO_BPM[tempo] / 4;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(bus);
  }

  label() {
    return `${this.tempo === 'slow' ? 'Эмбиент' : this.tempo === 'mid' ? 'Лаунж' : 'Хаус-грув'} · ${TEMPO_BPM[this.tempo]} BPM`;
  }

  start() {
    this.next = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 40);
    this.schedule();
  }

  stop(fadeOutAt?: number) {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const t = fadeOutAt ?? this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.3);
    setTimeout(() => this.out.disconnect(), Math.max(0, (t - this.ctx.currentTime) * 1000) + 3000);
  }

  private schedule() {
    if (this.stopped) return;
    // В фоне таймеры замедляются — планируем с запасом
    const ahead = typeof document !== 'undefined' && document.hidden ? 1.6 : 0.3;
    while (this.next < this.ctx.currentTime + ahead) {
      this.playStep(this.step, this.next);
      this.next += this.sixteenth;
      this.step++;
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ci = bar % 4;
    const chord = PROGRESSION[ci];
    const barLen = this.sixteenth * 16;
    const rnd = pseudo(step * 7.13 + bar);

    if (this.tempo === 'slow') {
      if (s === 0) {
        this.pad(chord, t, barLen * 1.05, 850, 0.05);
        this.bass(BASS[ci] + 12, t, barLen * 0.95, 0.12);
      }
      if ((s === 0 || s === 6 || s === 10 || s === 13) && rnd > 0.35) {
        this.bell(PENTA[Math.floor(pseudo(step * 3.7) * PENTA.length)], t, 0.07);
      }
      return;
    }

    if (this.tempo === 'mid') {
      if (s === 0) this.pad(chord, t, barLen, 1200, 0.032);
      if (s === 0 || s === 6 || s === 10) this.bass(BASS[ci] + (s === 10 ? 12 : 0), t, this.sixteenth * 3, 0.2);
      if (s % 2 === 0) {
        const order = [0, 1, 2, 3, 2, 1, 3, 2];
        this.pluck(chord[order[(s / 2) % order.length]] + 12, t, 0.06);
      }
      if (s % 4 === 2) this.hat(t, 0.035, 0.05);
      if (s === 4 || s === 12) this.rim(t, 0.06);
      if (s === 14 && rnd > 0.6) this.bell(PENTA[Math.floor(rnd * 5)], t, 0.035);
      return;
    }

    // fast
    if (s === 0) this.pad(chord, t, barLen, 1700, 0.022);
    if (s % 4 === 0) this.kick(t, 0.55);
    if (s % 4 === 2) this.hat(t, 0.06, 0.06);
    else if (s % 2 === 1) this.hat(t, 0.018, 0.03);
    if (s === 4 || s === 12) this.clap(t, 0.13);
    if (s % 2 === 0) this.bass(BASS[ci] + (s % 4 === 2 ? 12 : 0), t, this.sixteenth * 1.6, 0.17);
    const arp = [0, 2, 1, 3];
    if (s % 4 !== 3) this.pluck(chord[arp[s % 4]] + 12, t, 0.035, 0.16);
  }

  // ---------------- инструменты ----------------

  private env(t: number, peak: number, attack: number, release: number, hold = 0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  private pad(notes: number[], t: number, dur: number, cutoff: number, level: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 0.7, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    lp.Q.value = 0.6;
    const g = this.env(t, level, 0.9, 1.4, Math.max(0, dur - 0.9));
    lp.connect(g);
    g.connect(this.out);
    g.connect(this.send);
    for (const n of notes) {
      for (const det of [-7, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(midi(n), t);
        o.detune.setValueAtTime(det, t);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 2.5);
      }
    }
  }

  private bell(note: number, t: number, level: number) {
    const g = this.env(t, level, 0.005, 1.8);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(midi(note), t);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(midi(note) * 2.01, t);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.out);
    g.connect(this.send);
    o.start(t);
    o2.start(t);
    o.stop(t + 2);
    o2.stop(t + 2);
  }

  private pluck(note: number, t: number, level: number, decay = 0.28) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + decay);
    const g = this.env(t, level, 0.004, decay);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(midi(note), t);
    o.connect(lp).connect(g);
    g.connect(this.out);
    g.connect(this.send);
    o.start(t);
    o.stop(t + decay + 0.1);
  }

  private bass(note: number, t: number, dur: number, level: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.env(t, level, 0.01, 0.25, Math.max(0, dur - 0.2));
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(midi(note), t);
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(midi(note), t);
    o.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(this.out);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.4);
    sub.stop(t + dur + 0.4);
  }

  private kick(t: number, level: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseHit(t: number, level: number, decay: number, type: BiquadFilterType, freq: number, q = 0.7) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.kit.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(t, level, 0.002, decay);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
    return g;
  }

  private hat(t: number, level: number, decay: number) {
    this.noiseHit(t, level, decay, 'highpass', 7500);
  }

  private rim(t: number, level: number) {
    this.noiseHit(t, level, 0.04, 'bandpass', 2400, 4);
  }

  private clap(t: number, level: number) {
    const g = this.noiseHit(t, level, 0.18, 'bandpass', 1500, 1.2);
    g.connect(this.send);
  }
}

function pseudo(x: number) {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
