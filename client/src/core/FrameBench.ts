// In-game frame benchmark for a real browser: open the game with `?bench` and it walks to five
// places, warms up, then records the real loop. Per frame: the interval between animation
// frames (what the player feels), the CPU time of the frame, and, where the browser exposes
// EXT_disjoint_timer_query_webgl2, the GPU time of the render. Results appear on screen and in
// `window.__RONIN_BENCH__`. See docs/PERFORMANCE.md.

export interface BenchSpot { name: string; x: number; z: number; yaw: number }

export const BENCH_SPOTS: BenchSpot[] = [
    { name: 'Courtyard', x: 4, z: 7, yaw: 0.4 },
    { name: 'Bamboo grove', x: 3, z: -52, yaw: 0 },
    { name: 'Shrine approach', x: -68, z: 32, yaw: 0 },
    { name: 'Hamlet', x: 50, z: -36, yaw: 2.6 },
    { name: 'Bridge', x: 66, z: 24, yaw: 0.3 },
];

export interface BenchRow {
    name: string;
    interval: { median: number; p95: number };
    cpu: { median: number; p95: number };
    gpu: { median: number; p95: number } | null;
    overBudget: number;
    width: number;
    height: number;
}

const WARMUP = 90, SAMPLES = 300, BUDGET = 1000 / 60;

const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

export class FrameBench {
    private spot = 0;
    private n = 0;
    private last = 0;
    private intervals: number[] = [];
    private cpu: number[] = [];
    private gpu: number[] = [];
    private pending: WebGLQuery[] = [];
    private query: WebGLQuery | null = null;
    private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    readonly rows: BenchRow[] = [];
    done = false;

    constructor(private gl: WebGL2RenderingContext, private place: (s: BenchSpot) => void, private onDone: (rows: BenchRow[]) => void) {
        this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        this.place(BENCH_SPOTS[0]);
    }

    /** Call at the start of each frame. */
    begin(now: number): void {
        if (this.done) return;
        if (this.n >= WARMUP && this.last) this.intervals.push(now - this.last);
        this.last = now;
        if (this.ext && this.n >= WARMUP) {
            this.query = this.gl.createQuery();
            if (this.query) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
        }
    }

    /** Call at the end of each frame with its CPU time. */
    end(cpuMs: number): void {
        if (this.done) return;
        const gl = this.gl;
        if (this.query && this.ext) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.query); this.query = null; }
        // Collect finished GPU timings (they arrive a few frames late).
        while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
            const qry = this.pending.shift()!;
            if (!gl.getParameter(this.ext!.GPU_DISJOINT_EXT)) this.gpu.push(gl.getQueryParameter(qry, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(qry);
        }
        if (this.n >= WARMUP) this.cpu.push(cpuMs);
        if (++this.n < WARMUP + SAMPLES) return;
        const s = BENCH_SPOTS[this.spot];
        this.rows.push({
            name: s.name,
            interval: { median: q(this.intervals, 0.5), p95: q(this.intervals, 0.95) },
            cpu: { median: q(this.cpu, 0.5), p95: q(this.cpu, 0.95) },
            gpu: this.gpu.length > 20 ? { median: q(this.gpu, 0.5), p95: q(this.gpu, 0.95) } : null,
            overBudget: this.intervals.filter(i => i > BUDGET * 1.5).length / Math.max(1, this.intervals.length),
            width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
        });
        this.intervals = []; this.cpu = []; this.gpu = []; this.n = 0; this.last = 0;
        for (const p of this.pending) gl.deleteQuery(p);
        this.pending = [];
        if (++this.spot >= BENCH_SPOTS.length) { this.done = true; this.onDone(this.rows); return; }
        this.place(BENCH_SPOTS[this.spot]);
    }
}

export function showBench(rows: BenchRow[], gpuAvailable: boolean): void {
    const el = document.createElement('pre');
    el.id = 'r-bench';
    el.style.cssText = 'position:fixed;left:16px;top:16px;z-index:999;margin:0;padding:14px 16px;background:rgba(8,8,6,.9);color:#e9e0cc;font:12px/1.5 ui-monospace,monospace;white-space:pre;border:1px solid rgba(255,255,255,.12)';
    const f = (v: number) => v.toFixed(2).padStart(6);
    const lines = rows.map(r => `${r.name.padEnd(16)} frame ${f(r.interval.median)} (p95 ${f(r.interval.p95)})  cpu ${f(r.cpu.median)} (p95 ${f(r.cpu.p95)})  gpu ${r.gpu ? `${f(r.gpu.median)} (p95 ${f(r.gpu.p95)})` : '   n/a'}  slow ${(r.overBudget * 100).toFixed(0).padStart(3)}%`);
    el.textContent = `Frame bench  ${rows[0]?.width}×${rows[0]?.height}  (ms; slow = frames over 25 ms)${gpuAvailable ? '' : '  · GPU timer unavailable'}\n${lines.join('\n')}`;
    document.body.appendChild(el);
}
