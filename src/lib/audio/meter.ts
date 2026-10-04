'use client';

// Измеритель уровня для телефона-датчика.
// Приватность: сэмплы живут только в буфере AnalyserNode и сразу сворачиваются в одно число
// (средний квадрат). Ничего не записывается, не сохраняется и не отправляется.

type AudioContextCtor = typeof AudioContext;

export class LevelMeter {
  private ctx: AudioContext;
  private stream: MediaStream;
  private analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;

  private constructor(ctx: AudioContext, stream: MediaStream) {
    this.ctx = ctx;
    this.stream = stream;
    const source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    // Беззвучный «сток», чтобы граф обрабатывался во всех браузерах (в динамик ничего не идёт)
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.analyser.connect(sink);
    sink.connect(ctx.destination);
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  /** Вызывать из обработчика клика: iOS Safari требует жест пользователя. */
  static async start(): Promise<LevelMeter> {
    const Ctor: AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
    const ctx = new Ctor();
    const resumed = ctx.resume(); // запускаем синхронно внутри жеста
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
    } catch (e) {
      ctx.close().catch(() => {});
      throw e;
    }
    await resumed.catch(() => {});
    return new LevelMeter(ctx, stream);
  }

  /** Средний квадрат текущего окна (~46 мс) без постоянной составляющей. */
  sampleMeanSquare(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let mean = 0;
    for (let i = 0; i < this.buf.length; i++) mean += this.buf[i];
    mean /= this.buf.length;
    let ms = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = this.buf[i] - mean;
      ms += v * v;
    }
    return ms / this.buf.length;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
  }

  stop() {
    this.stream.getTracks().forEach((tr) => tr.stop());
    this.ctx.close().catch(() => {});
  }
}

/** dBFS из среднего квадрата. */
export function dbfsFromMeanSquare(ms: number): number {
  return ms > 1e-12 ? 10 * Math.log10(ms) : -120;
}

/** Энергетическое усреднение окна. */
export class EnergyWindow {
  private sum = 0;
  private n = 0;
  add(ms: number) {
    this.sum += ms;
    this.n++;
  }
  get count() {
    return this.n;
  }
  dbfs(): number | null {
    return this.n ? dbfsFromMeanSquare(this.sum / this.n) : null;
  }
  reset() {
    this.sum = 0;
    this.n = 0;
  }
}
