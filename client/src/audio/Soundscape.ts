export interface AudioParamLike {
    value: number;
    setValueAtTime(value: number, time: number): unknown;
    setTargetAtTime(value: number, time: number, constant: number): unknown;
    linearRampToValueAtTime(value: number, time: number): unknown;
}

export interface AudioNodeLike {
    connect(destination: AudioNodeLike | AudioParamLike): unknown;
    disconnect(): void;
}

export interface GainLike extends AudioNodeLike { gain: AudioParamLike }
export interface FilterLike extends AudioNodeLike { type: BiquadFilterType; frequency: AudioParamLike; Q: AudioParamLike }
export interface BufferLike { getChannelData(channel: number): Float32Array }
export interface SourceLike extends AudioNodeLike {
    start(time?: number): void;
    stop(time?: number): void;
    onended: ((event: Event) => void) | null;
}
export interface NoiseLike extends SourceLike { buffer: BufferLike | null; loop: boolean }
export interface OscillatorLike extends SourceLike { type: OscillatorType; frequency: AudioParamLike; detune: AudioParamLike }
export interface PannerLike extends AudioNodeLike { pan: AudioParamLike }

export interface AudioContextLike {
    readonly state: string;
    readonly currentTime: number;
    readonly sampleRate: number;
    readonly destination: AudioNodeLike;
    createGain(): GainLike;
    createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
    createBufferSource(): NoiseLike;
    createBiquadFilter(): FilterLike;
    createOscillator(): OscillatorLike;
    createDynamicsCompressor?(): AudioNodeLike;
    createStereoPanner(): PannerLike;
    resume(): Promise<void>;
    close(): Promise<void>;
}

type Bed = { filter: FilterLike; gain: GainLike };
type BreathVoice = { gain: GainLike; lfo: OscillatorLike; exertion: number; distance: number };
type Transient = { source: SourceLike; nodes: AudioNodeLike[] };
export type FootstepMaterial = 'grass' | 'stone' | 'wood' | 'water';

const METAL = [1, 2.76, 5.4, 7.13];
const BELL = [1, 2.01, 2.76, 4.07, 5.4, 6.83];
const clamp = (value: number): number => Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));

export class Soundscape {
    private context: AudioContextLike | null = null;
    private initializing: Promise<void> | null = null;
    private disposed = false;
    private master: GainLike | null = null;
    private ambience: GainLike | null = null;
    private effects: GainLike | null = null;
    private breath: GainLike | null = null;
    private volume = 0.8;
    private muted = false;
    private white: BufferLike | null = null;
    private pink: BufferLike | null = null;
    private wind: Bed | null = null;
    private rain: Bed | null = null;
    private crickets: Bed | null = null;
    private playerVoice: BreathVoice | null = null;
    private rivalVoice: BreathVoice | null = null;
    private readonly nodes = new Set<AudioNodeLike>();
    private readonly sources = new Set<SourceLike>();
    private readonly transients = new Set<Transient>();
    private transientNodes = 0;
    private windStrength = -1;
    private rainIntensity = -1;
    private night = 0;
    private nextBird = 0;
    private bellUntil = 0;

    constructor(private readonly createAudioContext: () => AudioContextLike = () => new AudioContext()) {}

    public get state(): 'suspended' | 'running' | 'uninitialized' {
        if (!this.ready()) return 'uninitialized';
        return this.context!.state === 'running' ? 'running' : 'suspended';
    }

    private ready(): boolean {
        return !this.disposed && this.context !== null && this.context.state !== 'closed';
    }

    public init(): Promise<void> {
        if (this.disposed || this.context?.state === 'closed') return Promise.resolve();
        if (this.initializing) return this.initializing;
        try {
            if (!this.context) {
                this.context = this.createAudioContext();
                if (this.context.state === 'closed') return Promise.resolve();
                this.build();
            }
            if (this.context.state === 'running') return Promise.resolve();
            this.initializing = this.context.resume().catch(() => {}).finally(() => { this.initializing = null; });
            return this.initializing;
        } catch {
            this.dispose();
            return Promise.resolve();
        }
    }

    private track<T extends AudioNodeLike>(node: T): T {
        this.nodes.add(node);
        return node;
    }

    private target(param: AudioParamLike, value: number, constant = 0.04): void {
        param.setTargetAtTime(value, this.context!.currentTime, constant);
    }

    private gain(value: number, output?: AudioNodeLike): GainLike {
        const node = this.track(this.context!.createGain());
        node.gain.setValueAtTime(0, this.context!.currentTime);
        this.target(node.gain, value);
        if (output) node.connect(output);
        return node;
    }

    private start(source: SourceLike): void {
        this.sources.add(source);
        source.start(this.context!.currentTime);
    }

    private build(): void {
        const ctx = this.context!;
        this.master = this.gain(this.volume);
        const compressor = ctx.createDynamicsCompressor?.();
        if (compressor) {
            this.master.connect(this.track(compressor));
            compressor.connect(ctx.destination);
        } else this.master.connect(ctx.destination);
        this.ambience = this.gain(0.5, this.master);
        this.effects = this.gain(0.8, this.master);
        this.breath = this.gain(0.6, this.master);
        this.white = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
        this.pink = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
        const white = this.white.getChannelData(0);
        const pink = this.pink.getChannelData(0);
        let slow = 0, medium = 0, fast = 0;
        for (let i = 0; i < white.length; i++) {
            const value = Math.random() * 2 - 1;
            white[i] = value;
            slow = 0.99765 * slow + value * 0.099046;
            medium = 0.963 * medium + value * 0.2965164;
            fast = 0.57 * fast + value * 1.0526913;
            pink[i] = (slow + medium + fast + value * 0.1848) * 0.16;
        }
        const seam = Math.min(256, pink.length);
        for (let i = 0; i < seam; i++) {
            const blend = i / seam;
            pink[i] = pink[pink.length - 1] * (1 - blend) + pink[i] * blend;
        }
        this.wind = this.bed(this.pink, 'lowpass', 300, this.ambience);
        this.rain = this.bed(this.white, 'bandpass', 4200, this.ambience);
        this.playerVoice = this.voice(0, 1);
        this.rivalVoice = this.voice(0.35, 1.07);
        this.crickets = this.bed(this.white, 'bandpass', 4800, this.ambience);
        this.crickets.filter.Q.setValueAtTime(12, ctx.currentTime);
        this.modulate(this.crickets, 19, 0.45);
        this.nextBird = ctx.currentTime + 2;
    }

    private bed(buffer: BufferLike, type: BiquadFilterType, frequency: number, output: AudioNodeLike): Bed {
        const ctx = this.context!;
        const source = this.track(ctx.createBufferSource());
        source.buffer = buffer;
        source.loop = true;
        const filter = this.track(ctx.createBiquadFilter());
        filter.type = type;
        filter.frequency.setValueAtTime(frequency, ctx.currentTime);
        filter.Q.setValueAtTime(0.7, ctx.currentTime);
        const gain = this.gain(0, output);
        source.connect(filter);
        filter.connect(gain);
        this.start(source);
        return { filter, gain };
    }

    private modulate(bed: Bed, rate: number, depth: number): OscillatorLike {
        const ctx = this.context!;
        const envelope = this.gain(0.5);
        bed.filter.disconnect();
        bed.filter.connect(envelope);
        const lfo = this.track(ctx.createOscillator());
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(rate, ctx.currentTime);
        const modulation = this.gain(depth);
        lfo.connect(modulation);
        modulation.connect(envelope.gain);
        envelope.connect(bed.gain);
        this.start(lfo);
        return lfo;
    }

    private voice(pan: number, rate: number): BreathVoice {
        const ctx = this.context!;
        const panner = this.track(ctx.createStereoPanner());
        panner.pan.setValueAtTime(pan, ctx.currentTime);
        panner.connect(this.breath!);
        const gain = this.gain(0, panner);
        const envelope = this.gain(0.5, gain);
        const bed = this.bed(this.white!, 'bandpass', pan ? 1050 : 850, envelope);
        this.target(bed.gain.gain, 1);
        const lfo = this.track(ctx.createOscillator());
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(8 / 60 * rate, ctx.currentTime);
        const depth = this.gain(0.45);
        lfo.connect(depth);
        depth.connect(envelope.gain);
        this.start(lfo);
        return { gain, lfo, exertion: -1, distance: -1 };
    }

    public setMasterVolume(value: number): void {
        if (!this.ready()) return;
        this.volume = clamp(value);
        this.target(this.master!.gain, this.muted ? 0 : this.volume);
    }

    public setMuted(muted: boolean): void {
        if (!this.ready()) return;
        this.muted = muted;
        this.target(this.master!.gain, muted ? 0 : this.volume);
    }

    public setWindStrength(value: number): void {
        if (!this.ready()) return;
        const strength = clamp(value);
        if (strength === this.windStrength) return;
        this.windStrength = strength;
        this.target(this.wind!.filter.frequency, 250 + strength * 1550, 0.15);
        this.target(this.wind!.gain.gain, strength * 0.65, 0.15);
    }

    public setRainIntensity(value: number): void {
        if (!this.ready()) return;
        const intensity = clamp(value);
        if (intensity === this.rainIntensity) return;
        this.rainIntensity = intensity;
        this.target(this.rain!.gain.gain, intensity * 0.32, 0.2);
    }

    private available(count: number): boolean {
        return this.ready() && this.transientNodes + count <= 38;
    }

    private envelope(gain: GainLike, peak: number, time: number, duration: number): void {
        gain.gain.setTargetAtTime(peak, time, 0.01);
        gain.gain.setTargetAtTime(0, time + 0.04, Math.max(0.01, duration / 7));
        gain.gain.setValueAtTime(0, time + duration + 0.02);
    }

    private transient(source: SourceLike, nodes: AudioNodeLike[], time: number, duration: number): void {
        const transient = { source, nodes };
        this.transients.add(transient);
        this.transientNodes += nodes.length;
        this.sources.add(source);
        source.onended = () => {
            source.onended = null;
            this.sources.delete(source);
            if (!this.transients.delete(transient)) return;
            this.transientNodes -= nodes.length;
            for (const node of nodes) {
                node.disconnect();
                this.nodes.delete(node);
            }
        };
        source.start(time);
        source.stop(time + duration + 0.03);
    }

    private noise(frequency: number, end: number, duration: number, volume: number, type: BiquadFilterType = 'bandpass'): void {
        if (volume <= 0 || !this.available(3)) return;
        const ctx = this.context!;
        const source = this.track(ctx.createBufferSource());
        source.buffer = this.white;
        const filter = this.track(ctx.createBiquadFilter());
        filter.type = type;
        filter.Q.setValueAtTime(type === 'bandpass' ? 0.6 : 0.4, ctx.currentTime);
        filter.frequency.setValueAtTime(frequency, ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(end, ctx.currentTime + duration);
        const gain = this.gain(0, this.effects!);
        source.connect(filter);
        filter.connect(gain);
        this.envelope(gain, volume, ctx.currentTime, duration);
        this.transient(source, [source, filter, gain], ctx.currentTime, duration);
    }

    private tone(frequency: number, end: number, duration: number, volume: number, detune: number, type: OscillatorType = 'sine', delay = 0, ambience = false): void {
        if (volume <= 0 || !this.available(2)) return;
        const ctx = this.context!;
        const time = ctx.currentTime + delay;
        const source = this.track(ctx.createOscillator());
        source.type = type;
        source.frequency.setValueAtTime(Math.min(frequency, ctx.sampleRate * 0.45), time);
        source.frequency.linearRampToValueAtTime(Math.min(end, ctx.sampleRate * 0.45), time + Math.min(duration, 0.3));
        source.detune.setValueAtTime(detune, time);
        const gain = this.gain(0, ambience ? this.ambience! : this.effects!);
        source.connect(gain);
        this.envelope(gain, volume, time, duration);
        this.transient(source, [source, gain], time, duration);
    }

    public footstep(material: FootstepMaterial, intensity: number): void {
        if (!this.ready()) return;
        const volume = clamp(intensity);
        if (material === 'grass') this.noise(450, 300, 0.2, volume * 0.22, 'lowpass');
        else if (material === 'stone') this.noise(1300, 950, 0.1, volume * 0.3, 'highpass');
        else if (material === 'wood') {
            if (!this.available(5)) return;
            this.noise(350, 220, 0.16, volume * 0.25, 'lowpass');
            this.tone(290, 240, 0.18, volume * 0.08, -3, 'triangle');
        } else if (material === 'water') this.noise(2300, 650, 0.38, volume * 0.32);
    }

    public drawSword(): void {
        if (!this.available(7)) return;
        this.noise(650, 6500, 0.5, 0.18);
        this.tone(2100, 2900, 0.65, 0.04, -4);
        this.tone(3500, 4100, 0.55, 0.025, 5, 'triangle');
    }

    public sheathSword(): void {
        if (!this.available(5)) return;
        this.noise(3000, 450, 0.3, 0.12);
        this.tone(520, 320, 0.16, 0.07, 3, 'triangle');
    }

    public swingWhoosh(intensity: number): void {
        this.noise(600, 2400, 0.32, clamp(intensity) * 0.32);
    }

    private metal(intensity: number, frequency: number, duration: number): void {
        if (!this.available(11)) return;
        const volume = clamp(intensity);
        this.noise(6000, 1800, 0.12, volume * 0.24, 'highpass');
        for (let i = 0; i < METAL.length; i++) {
            const pitch = frequency * METAL[i];
            this.tone(pitch, pitch, duration * (1 - i * 0.08), volume * 0.15 / (i + 1), i % 2 ? 5 : -4, i % 2 ? 'triangle' : 'sine');
        }
    }

    public parryClash(intensity: number): void {
        this.metal(intensity, 1150, 2.1);
    }

    public hitFlesh(intensity: number): void {
        if (!this.available(5)) return;
        const volume = clamp(intensity);
        this.noise(650, 160, 0.22, volume * 0.4, 'lowpass');
        this.tone(135, 65, 0.18, volume * 0.18, 0, 'triangle');
    }

    public blockClank(intensity: number): void {
        this.metal(intensity, 510, 0.55);
    }

    public templeBell(): void {
        if (!this.available(12) || this.context!.currentTime < this.bellUntil) return;
        this.bellUntil = this.context!.currentTime + 8.03;
        for (let i = 0; i < BELL.length; i++) {
            const frequency = 210 * BELL[i];
            this.tone(frequency, frequency, 8 - i * 0.3, 0.23 / (i + 1), i % 2 ? 4 : -4);
        }
    }

    private breathe(voice: BreathVoice, exertion: number, distance: number, rate: number): void {
        if (voice.exertion === exertion && voice.distance === distance) return;
        voice.exertion = exertion;
        voice.distance = distance;
        this.target(voice.lfo.frequency, (8 + 32 * exertion) / 60 * rate, 0.25);
        this.target(voice.gain.gain, (0.012 + exertion * exertion * 0.38) * distance, 0.08);
    }

    public updateBreath(exertion: number, isPlayer = true): void {
        if (!this.ready()) return;
        if (isPlayer) this.breathe(this.playerVoice!, clamp(exertion), 1, 1);
        else this.breathe(this.rivalVoice!, clamp(exertion), Math.max(0, this.rivalVoice!.distance), 1.07);
    }

    public setRivalBreath(exertion: number, audibleDistance: number): void {
        if (!this.ready()) return;
        this.breathe(this.rivalVoice!, clamp(exertion), clamp(audibleDistance), 1.07);
    }

    public setBirdActivity(value: number): void {
        if (!this.ready()) return;
        const activity = clamp(value);
        const now = this.context!.currentTime;
        if (activity <= 0.3 || this.night >= 0.3) {
            this.nextBird = now + 2;
            return;
        }
        if (now < this.nextBird || !this.available(10)) return;
        this.nextBird = now + 5 + (1 - activity) * 15 + Math.random() * 5;
        const count = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const frequency = 2200 + Math.random() * 1400;
            this.tone(frequency, frequency + 1300, 0.14, activity * 0.045, 0, 'sine', i * 0.2, true);
        }
    }

    public setNightFactor(value: number): void {
        if (!this.ready()) return;
        const night = clamp(value);
        if (night === this.night) return;
        this.night = night;
        this.target(this.crickets!.gain.gain, Math.max(0, night - 0.4) * 0.055, 0.3);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const source of this.sources) {
            source.onended = null;
            try { source.stop(); } catch {}
        }
        for (const node of this.nodes) node.disconnect();
        this.sources.clear();
        this.nodes.clear();
        this.transients.clear();
        this.transientNodes = 0;
        const ctx = this.context;
        this.context = null;
        this.master = this.ambience = this.effects = this.breath = null;
        this.wind = this.rain = this.crickets = null;
        this.playerVoice = this.rivalVoice = null;
        this.white = this.pink = null;
        if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    }
}
