import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Soundscape, type AudioContextLike, type AudioNodeLike, type AudioParamLike, type BufferLike, type FootstepMaterial, type GainLike } from './Soundscape';

class MockParam implements AudioParamLike {
    public value: number;
    public readonly events: Array<{ type: string; value: number; time: number; constant?: number }> = [];
    constructor(value = 0) { this.value = value; }
    public setValueAtTime(value: number, time: number): void {
        this.events.push({ type: 'set', value, time });
        this.value = value;
    }
    public setTargetAtTime(value: number, time: number, constant: number): void {
        this.events.push({ type: 'target', value, time, constant });
        this.value = value;
    }
    public linearRampToValueAtTime(value: number, time: number): void {
        this.events.push({ type: 'ramp', value, time });
        this.value = value;
    }
}

class MockNode implements AudioNodeLike {
    public connections = 0;
    public disconnections = 0;
    public readonly destinations: Array<AudioNodeLike | AudioParamLike> = [];
    public connect(destination: AudioNodeLike | AudioParamLike): void {
        this.connections++;
        this.destinations.push(destination);
    }
    public disconnect(): void {
        this.disconnections++;
        this.destinations.length = 0;
    }
}

class MockGain extends MockNode implements GainLike { public readonly gain = new MockParam(1); }

class MockSource extends MockNode {
    public readonly starts: number[] = [];
    public readonly stops: number[] = [];
    public ended = false;
    public onended: ((event: Event) => void) | null = null;
    public buffer: BufferLike | null = null;
    public loop = false;
    public type: OscillatorType = 'sine';
    public readonly frequency = new MockParam(440);
    public readonly detune = new MockParam(0);
    public start(time = 0): void { this.starts.push(time); }
    public stop(time = 0): void { this.stops.push(time); }
}

class MockFilter extends MockNode {
    public type: BiquadFilterType = 'lowpass';
    public readonly frequency = new MockParam(350);
    public readonly Q = new MockParam(1);
}

class MockPanner extends MockNode { public readonly pan = new MockParam(0); }

class MockAudioContext implements AudioContextLike {
    public state = 'suspended';
    public currentTime = 0;
    public readonly sampleRate = 48000;
    public readonly destination = new MockNode();
    public readonly nodes: MockNode[] = [];
    public readonly sources: MockSource[] = [];
    public readonly gains: MockGain[] = [];
    public readonly filters: MockFilter[] = [];
    public readonly oscillators: MockSource[] = [];
    public readonly buffers: BufferLike[] = [];
    public readonly panners: MockPanner[] = [];
    public closed = 0;
    public resumed = 0;
    public get liveNodes(): number { return this.nodes.filter(node => node.destinations.length > 0).length; }
    private track<T extends MockNode>(node: T): T { this.nodes.push(node); return node; }
    public createGain(): MockGain {
        const node = this.track(new MockGain());
        this.gains.push(node);
        return node;
    }
    public createBuffer(channels: number, length: number, sampleRate: number): BufferLike {
        assert.equal(sampleRate, this.sampleRate);
        assert.equal(length, sampleRate * 2);
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        const buffer = { getChannelData: (channel: number) => data[channel] };
        this.buffers.push(buffer);
        return buffer;
    }
    public createBufferSource(): MockSource {
        const source = this.track(new MockSource());
        this.sources.push(source);
        return source;
    }
    public createBiquadFilter(): MockFilter {
        const node = this.track(new MockFilter());
        this.filters.push(node);
        return node;
    }
    public createOscillator(): MockSource {
        const source = this.track(new MockSource());
        this.oscillators.push(source);
        this.sources.push(source);
        return source;
    }
    public createDynamicsCompressor(): MockNode { return this.track(new MockNode()); }
    public createStereoPanner(): MockPanner {
        const node = this.track(new MockPanner());
        this.panners.push(node);
        return node;
    }
    public async resume(): Promise<void> { this.state = 'running'; this.resumed++; }
    public async close(): Promise<void> { this.closed++; this.state = 'closed'; }
    public advance(seconds: number): void {
        this.currentTime += seconds;
        for (const source of this.sources) {
            const stop = source.stops.at(-1);
            if (!source.ended && stop !== undefined && stop <= this.currentTime) {
                source.ended = true;
                source.onended?.(new Event('ended'));
            }
        }
    }
}

function make(): { scape: Soundscape; ctx: MockAudioContext } {
    const ctx = new MockAudioContext();
    return { scape: new Soundscape(() => ctx), ctx };
}

function exercise(scape: Soundscape): void {
    scape.setMasterVolume(0.5);
    scape.setMuted(true);
    scape.setWindStrength(0.5);
    scape.setRainIntensity(0.5);
    scape.footstep('wood', 1);
    scape.drawSword();
    scape.sheathSword();
    scape.swingWhoosh(1);
    scape.parryClash(1);
    scape.hitFlesh(1);
    scape.blockClank(1);
    scape.templeBell();
    scape.updateBreath(0.5, true);
    scape.updateBreath(0.5, false);
    scape.setRivalBreath(0.5, 1);
    scape.setBirdActivity(1);
    scape.setNightFactor(1);
}

function breathGain(ctx: MockAudioContext, rival: boolean): MockGain {
    const panner = ctx.panners[rival ? 1 : 0];
    const gain = ctx.gains.find(node => node.destinations.includes(panner));
    assert.ok(gain);
    return gain;
}

test('constructor is lazy and concurrent init creates and resumes exactly once', async () => {
    const ctx = new MockAudioContext();
    let factories = 0;
    const scape = new Soundscape(() => { factories++; return ctx; });
    assert.equal(factories, 0);
    assert.equal(scape.state, 'uninitialized');
    await Promise.all([scape.init(), scape.init(), scape.init()]);
    assert.equal(factories, 1);
    assert.equal(ctx.resumed, 1);
    assert.equal(scape.state, 'running');
    assert.equal(ctx.buffers.length, 2);
    ctx.state = 'suspended';
    assert.equal(scape.state, 'suspended');
    await scape.init();
    assert.equal(ctx.resumed, 2);
    assert.equal(factories, 1);
});

test('master defaults, clamping and mute restore are scheduled on the master gain', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const master = ctx.gains[0].gain;
    assert.equal(master.value, 0.8);
    assert.deepEqual(ctx.gains.slice(1, 4).map(node => node.gain.value), [0.5, 0.8, 0.6]);
    scape.setMasterVolume(4);
    assert.equal(master.value, 1);
    scape.setMasterVolume(-1);
    assert.equal(master.value, 0);
    scape.setMuted(true);
    scape.setMasterVolume(0.5);
    assert.equal(master.value, 0);
    scape.setMuted(false);
    assert.equal(master.value, 0.5);
    scape.setMasterVolume(NaN);
    assert.equal(master.value, 0);
    assert.equal(master.events.at(-1)?.type, 'target');
    assert.ok(master.events.filter(event => event.type === 'target').every(event => event.constant! >= 0.01));
});

test('100 overlapping footsteps keep all concurrent nodes below 80 and reclaim ended voices', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const baseline = ctx.liveNodes;
    const materials: FootstepMaterial[] = ['grass', 'stone', 'wood', 'water'];
    for (let i = 0; i < 100; i++) {
        scape.footstep(materials[i % 4], 1);
        assert.ok(ctx.liveNodes < 80);
    }
    assert.ok(ctx.liveNodes > baseline);
    assert.ok(ctx.nodes.length < 80);
    ctx.advance(1);
    assert.equal(ctx.liveNodes, baseline);
    const before = ctx.sources.length;
    scape.footstep('grass', 1);
    assert.equal(ctx.sources.length, before + 1);
    assert.equal(ctx.buffers.length, 2);
});

test('parry has four inharmonic partials, detuning and a sustained ring', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const before = ctx.oscillators.length;
    scape.parryClash(1);
    const partials = ctx.oscillators.slice(before);
    assert.equal(partials.length, 4);
    assert.deepEqual(partials.map(node => node.frequency.value), [1150, 1150 * 2.76, 1150 * 5.4, 1150 * 7.13]);
    assert.ok(partials.every(node => node.detune.value !== 0));
    assert.ok(partials.every(node => node.stops[0] >= 1.2 && node.stops[0] <= 2.5));
});

test('templeBell is single-instance and can ring again after its decay', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const before = ctx.oscillators.length;
    scape.templeBell();
    assert.equal(ctx.oscillators.length - before, 6);
    assert.equal(ctx.oscillators[before].frequency.value, 210);
    scape.templeBell();
    assert.equal(ctx.oscillators.length, before + 6);
    ctx.advance(9);
    scape.templeBell();
    assert.equal(ctx.oscillators.length, before + 12);
});

test('breath exertion scales rate and gain without creating nodes or buffers', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const gain = breathGain(ctx, false).gain;
    const nodes = ctx.nodes.length;
    scape.updateBreath(0);
    const quiet = gain.value;
    assert.equal(ctx.oscillators[0].frequency.value, 8 / 60);
    scape.updateBreath(1);
    assert.ok(gain.value > quiet * 10);
    assert.equal(ctx.oscillators[0].frequency.value, 40 / 60);
    assert.equal(gain.events.at(-1)?.type, 'target');
    for (let i = 0; i < 100; i++) scape.updateBreath(i / 100);
    assert.equal(ctx.nodes.length, nodes);
    assert.equal(ctx.buffers.length, 2);
});

test('rival breath is silent at zero proximity and has distinct pan and rate', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const gain = breathGain(ctx, true).gain;
    assert.equal(gain.value, 0);
    scape.updateBreath(1, false);
    assert.equal(gain.value, 0);
    scape.setRivalBreath(1, 1);
    const near = gain.value;
    scape.setRivalBreath(1, 0.5);
    assert.equal(gain.value, near * 0.5);
    assert.equal(ctx.oscillators[1].frequency.value, 40 / 60 * 1.07);
    assert.equal(ctx.panners[1].pan.value, 0.35);
    scape.setRivalBreath(1, 0);
    assert.equal(gain.value, 0);
});

test('every public sound call before init is a no-op', () => {
    const { scape, ctx } = make();
    assert.doesNotThrow(() => exercise(scape));
    assert.equal(scape.state, 'uninitialized');
    assert.equal(ctx.nodes.length, 0);
    assert.equal(ctx.resumed, 0);
});

test('dispose stops all sources, disconnects all nodes, and clears ended listeners', async () => {
    const { scape, ctx } = make();
    await scape.init();
    scape.templeBell();
    scape.footstep('water', 1);
    scape.dispose();
    assert.equal(ctx.closed, 1);
    assert.equal(ctx.liveNodes, 0);
    assert.ok(ctx.sources.every(source => source.stops.length > 0 && source.onended === null));
    assert.ok(ctx.nodes.every(node => node.disconnections > 0));
    assert.equal(scape.state, 'uninitialized');
    ctx.advance(10);
    assert.equal(ctx.liveNodes, 0);
});

test('calls including init and repeated dispose are safe after disposal or external close', async () => {
    for (const external of [false, true]) {
        const { scape, ctx } = make();
        await scape.init();
        if (external) await ctx.close();
        else scape.dispose();
        const count = ctx.nodes.length;
        assert.doesNotThrow(() => exercise(scape));
        await scape.init();
        scape.dispose();
        assert.equal(ctx.nodes.length, count);
        assert.equal(ctx.closed, 1);
        assert.equal(scape.state, 'uninitialized');
    }
    const { scape, ctx } = make();
    scape.dispose();
    await scape.init();
    assert.equal(ctx.nodes.length, 0);
});

test('weather setters follow input and unchanged frame updates allocate no nodes', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const wind = ctx.filters[0];
    const rain = ctx.filters[1];
    const windGain = wind.destinations[0];
    const rainGain = rain.destinations[0];
    assert.ok(windGain instanceof MockGain);
    assert.ok(rainGain instanceof MockGain);
    scape.setWindStrength(1);
    assert.equal(wind.frequency.value, 1800);
    assert.equal(windGain.gain.value, 0.65);
    scape.setRainIntensity(1);
    assert.equal(rainGain.gain.value, 0.32);
    assert.equal(rain.type, 'bandpass');
    const count = ctx.nodes.length;
    const events = windGain.gain.events.length;
    for (let i = 0; i < 100; i++) {
        scape.setWindStrength(1);
        scape.setRainIntensity(1);
    }
    assert.equal(ctx.nodes.length, count);
    assert.equal(windGain.gain.events.length, events);
    scape.setWindStrength(0);
    scape.setRainIntensity(0);
    assert.equal(windGain.gain.value, 0);
    assert.equal(rainGain.gain.value, 0);
});

test('birds require activity and daytime; crickets have an audio-connected LFO envelope', async () => {
    const { scape, ctx } = make();
    await scape.init();
    ctx.advance(3);
    const before = ctx.oscillators.length;
    scape.setBirdActivity(0.3);
    assert.equal(ctx.oscillators.length, before);
    scape.setNightFactor(1);
    ctx.advance(3);
    scape.setBirdActivity(1);
    assert.equal(ctx.oscillators.length, before);
    const cricketEnvelope = ctx.filters[4].destinations[0];
    assert.ok(cricketEnvelope instanceof MockGain);
    const cricketVolume = cricketEnvelope.destinations[0];
    assert.ok(cricketVolume instanceof MockGain);
    assert.ok(cricketVolume.gain.value > 0);
    const depth = ctx.oscillators[2].destinations[0];
    assert.ok(depth instanceof MockGain);
    assert.equal(depth.destinations[0], cricketEnvelope.gain);
    scape.setNightFactor(0);
    assert.equal(cricketVolume.gain.value, 0);
    ctx.advance(3);
    scape.setBirdActivity(1);
    const count = ctx.oscillators.length - before;
    assert.ok(count >= 2 && count <= 5);
    scape.setBirdActivity(1);
    assert.equal(ctx.oscillators.length, before + count);
});

test('all effects together stay under the global node cap across repeated bursts', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const baseline = ctx.liveNodes;
    for (let i = 0; i < 10; i++) {
        exercise(scape);
        assert.ok(ctx.liveNodes < 80);
        ctx.advance(10);
        assert.equal(ctx.liveNodes, baseline);
    }
    assert.ok(ctx.sources.every(source => source.starts.length === 1));
});

test('zero-intensity effects allocate no nodes and transient envelopes use smooth targets', async () => {
    const { scape, ctx } = make();
    await scape.init();
    const count = ctx.nodes.length;
    scape.footstep('wood', 0);
    scape.swingWhoosh(0);
    scape.parryClash(0);
    scape.hitFlesh(0);
    scape.blockClank(0);
    assert.equal(ctx.nodes.length, count);
    const before = ctx.gains.length;
    scape.parryClash(1);
    for (const node of ctx.gains.slice(before)) {
        const targets = node.gain.events.filter(event => event.type === 'target');
        assert.ok(targets.every(event => event.constant! >= 0.01));
        assert.ok(targets.some(event => event.value > 0));
        assert.equal(targets.at(-1)?.value, 0);
    }
});
