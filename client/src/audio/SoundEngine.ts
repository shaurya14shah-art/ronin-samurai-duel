// Procedural Web Audio Sound Engine for Vagabond-inspired First-Person Combat
export class SamuraiAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterGain: GainNode | null = null;

  public init() {
    if (typeof window === "undefined") return;
    if (this.ctx) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn("AudioContext init error:", e);
    }
  }

  private ensureContext() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  // Blade swing whoosh modulated by weapon inertia & speed
  public playSwing(inertia: number = 0.6, speedMs: number = 240) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const dur = Math.max(0.12, (speedMs / 1000) * 0.7);

    // Noise buffer for air tearing
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    // Bandpass filter for high-velocity steel slice through air
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    const baseFreq = 480 - inertia * 150;
    filter.frequency.setValueAtTime(baseFreq * 0.6, t);
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 2.8, t + dur * 0.5);
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + dur);
    filter.Q.setValueAtTime(2.5, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.exponentialRampToValueAtTime(0.35 + inertia * 0.15, t + dur * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    whiteNoise.start(t);
    whiteNoise.stop(t + dur);
  }

  // Resonant steel deflection / parry clash
  public playParryClash(pitch: number = 1.0, stability: number = 70) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    // Harmonic partials for authentic high-carbon folded steel ring
    const fundamental = 1250 * pitch;
    const frequencies = [fundamental, fundamental * 1.58, fundamental * 2.32, fundamental * 3.45];
    const ringDuration = 0.5 + (stability / 100) * 0.6;

    frequencies.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = idx === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.98, t + ringDuration);

      const amp = idx === 0 ? 0.35 : 0.15 / (idx + 1);
      gain.gain.setValueAtTime(amp, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ringDuration / (idx * 0.5 + 1));

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + ringDuration);
    });

    // Impact click
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = "sawtooth";
    clickOsc.frequency.setValueAtTime(2800, t);
    clickOsc.frequency.exponentialRampToValueAtTime(200, t + 0.04);
    clickGain.gain.setValueAtTime(0.4, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    clickOsc.connect(clickGain);
    clickGain.connect(this.masterGain);
    clickOsc.start(t);
    clickOsc.stop(t + 0.04);
  }

  // Heavy guard block impact
  public playBlock() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(650, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + 0.15);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.18);
  }

  // Visceral, sharp cutting impact
  public playSlashHit(isCritical: boolean = false) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const dur = isCritical ? 0.28 : 0.18;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(isCritical ? 520 : 380, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + dur);

    gain.gain.setValueAtTime(isCritical ? 0.5 : 0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // Sword draw (Scabbard friction + Habaki latch)
  public playDraw() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    // Wood slide
    const slideOsc = this.ctx.createOscillator();
    const slideGain = this.ctx.createGain();
    slideOsc.type = "triangle";
    slideOsc.frequency.setValueAtTime(320, t);
    slideOsc.frequency.linearRampToValueAtTime(780, t + 0.18);
    slideGain.gain.setValueAtTime(0.01, t);
    slideGain.gain.linearRampToValueAtTime(0.15, t + 0.12);
    slideGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    slideOsc.connect(slideGain);
    slideGain.connect(this.masterGain);
    slideOsc.start(t);
    slideOsc.stop(t + 0.22);

    // Habaki release click
    setTimeout(() => {
      if (!this.ctx || !this.masterGain) return;
      const clickT = this.ctx.currentTime;
      const click = this.ctx.createOscillator();
      const cGain = this.ctx.createGain();
      click.type = "sine";
      click.frequency.setValueAtTime(1800, clickT);
      click.frequency.exponentialRampToValueAtTime(900, clickT + 0.08);
      cGain.gain.setValueAtTime(0.2, clickT);
      cGain.gain.exponentialRampToValueAtTime(0.001, clickT + 0.08);
      click.connect(cGain);
      cGain.connect(this.masterGain);
      click.start(clickT);
      click.stop(clickT + 0.08);
    }, 120);
  }

  // Anvil hammer strike on red-hot billet
  public playAnvilStrike(tempKelvin: number = 1350) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    // Anvil bell ring
    const anvilRing = this.ctx.createOscillator();
    const anvilGain = this.ctx.createGain();
    anvilRing.type = "sine";
    const ringFreq = 1680 + (tempKelvin > 1300 ? -120 : 150);
    anvilRing.frequency.setValueAtTime(ringFreq, t);

    anvilGain.gain.setValueAtTime(0.4, t);
    anvilGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    anvilRing.connect(anvilGain);
    anvilGain.connect(this.masterGain);
    anvilRing.start(t);
    anvilRing.stop(t + 0.45);

    // Hot metal thud
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = "triangle";
    thud.frequency.setValueAtTime(180, t);
    thud.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    thudGain.gain.setValueAtTime(0.5, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    thud.connect(thudGain);
    thudGain.connect(this.masterGain);
    thud.start(t);
    thud.stop(t + 0.12);
  }

  // Quench steam hiss
  public playQuenchSteam() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const dur = 1.2;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(1100, t + dur);
    filter.Q.setValueAtTime(1.8, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(t);
    source.stop(t + dur);
  }

  // Footstep footwork on bamboo grove / tatami
  public playFootstep() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(110 + Math.random() * 20, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.08);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260, t);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  // Samurai deep breath
  public playBreath(isComposed: boolean = true) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const dur = isComposed ? 0.9 : 0.55;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(380, t);
    filter.frequency.linearRampToValueAtTime(620, t + dur * 0.4);
    filter.frequency.linearRampToValueAtTime(220, t + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(isComposed ? 0.12 : 0.22, t + dur * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(t);
    source.stop(t + dur);
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.7, this.ctx.currentTime);
    }
  }
}

export const soundEngine = new SamuraiAudioEngine();
