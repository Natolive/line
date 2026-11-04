// Synthesized engine, tyre screech and impacts. No audio files.
export class Sfx {
  private ctx?: AudioContext;
  private out?: GainNode;
  private noise?: AudioBuffer;
  private engine?: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; whistle: OscillatorNode; whistleGain: GainNode };
  private screech?: GainNode;
  private muted = false;

  /** Must be called from a user gesture (browsers block audio before one). */
  start() {
    this.init();
    void this.ctx!.resume();
  }
  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.out) this.out.gain.value = this.muted ? 0 : 0.8;
  }

  /**
   * Engine note at the real firing frequency (rpm/60 × cylinders/2): an inline-6 at 7,000 rpm hums at
   * 350 Hz, a V12 at 8,500 rpm screams at 850 Hz. Turbo engines add a whistle that rises with boost.
   */
  setEngine(rpm: number, throttle: number, redline: number, engine: { cylinders: number; turbo: boolean }) {
    const e = this.engine, t = this.ctx?.currentTime ?? 0;
    if (!e) return;
    const firing = (rpm / 60) * (engine.cylinders / 2), rev = rpm / redline;
    e.a.type = engine.cylinders >= 10 ? 'triangle' : 'sawtooth'; // many cylinders: smoother, purer note
    e.a.frequency.setTargetAtTime(firing, t, 0.03);
    e.b.frequency.setTargetAtTime(firing / 2, t, 0.03);
    e.filter.frequency.setTargetAtTime(300 + rev * 1800 + throttle * 700, t, 0.05);
    e.gain.gain.setTargetAtTime(0.05 + throttle * 0.07, t, 0.08);
    e.whistle.frequency.setTargetAtTime(1800 + rpm * 0.45, t, 0.1);
    e.whistleGain.gain.setTargetAtTime(engine.turbo ? throttle * rev * rev * 0.025 : 0, t, 0.2);
  }

  setScreech(amount: number) {
    this.screech?.gain.setTargetAtTime(amount * 0.15, this.ctx!.currentTime, 0.05);
  }

  silenceLoops() {
    this.setScreech(0);
    this.engine?.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.1);
    this.engine?.whistleGain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.1);
  }

  /** `k`: how hard (0..2, see crashSeverity). */
  crash(k = 1) {
    const g = Math.min(1, 0.3 + 0.5 * k);
    this.burst(0.5 + 0.4 * g, 'lowpass', 2500, 150, 0.5 * g);
    this.burst(0.25, 'highpass', 3000, 6000, 0.2 * g); // glass
  }
  thud() { this.burst(0.35, 'lowpass', 900, 80, 0.35); } // the wreck landing
  nearMiss() { this.burst(0.35, 'bandpass', 500, 2500, 0.18); }
  scrape() { this.burst(0.12, 'highpass', 2500, 4000, 0.1); }

  private init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.8;
    this.out.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const a = ctx.createOscillator(), b = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    a.type = 'sawtooth';
    b.type = 'square';
    filter.type = 'lowpass';
    filter.Q.value = 3;
    gain.gain.value = 0;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain).connect(this.out);
    const whistle = ctx.createOscillator(), whistleGain = ctx.createGain();
    whistle.type = 'sine';
    whistleGain.gain.value = 0;
    whistle.connect(whistleGain).connect(this.out);
    a.start();
    b.start();
    whistle.start();
    this.engine = { a, b, filter, gain, whistle, whistleGain };

    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter();
    src.buffer = this.noise;
    src.loop = true;
    band.type = 'bandpass';
    band.frequency.value = 1700;
    band.Q.value = 8;
    this.screech = ctx.createGain();
    this.screech.gain.value = 0;
    src.connect(band).connect(this.screech).connect(this.out);
    src.start();
  }

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.out) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + dur);
  }
}
