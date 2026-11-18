import { uiState } from './UIState';
import { LANDMARKS, COURTYARD, type Landmark } from '../world/Landmarks';

// The map: aged paper, drawn from the world itself. Terrain is hill-shaded with ink contours,
// cedars are inked where they actually grow, meadows are left pale, the worn paths are dashed.
// Places you have not reached are marked but unnamed. Everything shown is live game state.
//
//   drag to pan · wheel to zoom · click a place to read it · double-click to set your mark

export interface MapSource {
    height(x: number, z: number): number;
    trees(minX: number, minZ: number, maxX: number, maxZ: number): { x: number; z: number }[];
    meadow(x: number, z: number): boolean;
    routes(): number[][][];
    player(): { x: number; z: number; yaw: number };
    discovered(): Set<string>;
    rival(id: string): { encounters: number; wins: number; falls: number; dormant: boolean } | null;
}

const EXTENT = 135; // metres from the centre to the paper's edge
const BASE = 900; // base map resolution (px)
const MARK_KEY = 'ronin.mapMark.v1';

const CSS = `
#r-map { z-index: 45; pointer-events: none; background: radial-gradient(ellipse at center, rgba(14,12,9,.9), rgba(5,4,3,.97)); }
#r-map.is-open { pointer-events: auto; }
#r-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; }
#r-map canvas.is-dragging { cursor: grabbing; }
#r-map .head { position: absolute; left: clamp(24px, 4vw, 64px); top: clamp(22px, 5vh, 52px); pointer-events: none; padding: 12px 18px; background: rgba(10,9,7,.7); }
#r-map .head .t { font: 400 calc(42px * var(--ui-scale)) var(--font-brush); }
#r-map .place { position: absolute; right: clamp(24px, 4vw, 64px); top: 14vh; width: min(340px, 30vw); padding: 26px 28px; display: grid; gap: 12px;
  background: linear-gradient(180deg, rgba(10,9,7,.7), rgba(10,9,7,.86)); border-top: 1px solid var(--line); transition: opacity var(--mid) var(--ease), transform var(--mid) var(--ease); }
#r-map .place.is-empty { opacity: 0; transform: translateY(6px); pointer-events: none; }
#r-map .place .n { font: 400 calc(30px * var(--ui-scale)) var(--font-brush); }
#r-map .place ul { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 8px; }
#r-map .place li { display: flex; gap: 10px; align-items: baseline; font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .18em; text-transform: uppercase; color: var(--ivory-dim); }
#r-map .place li i { width: 6px; height: 6px; transform: rotate(45deg); background: var(--gold); flex: none; }
#r-map .place li span.sub { letter-spacing: .06em; text-transform: none; font: italic calc(14px * var(--ui-scale)) var(--font-serif); color: var(--ivory-faint); }
#r-map .legend { position: absolute; left: clamp(24px, 4vw, 64px); bottom: clamp(22px, 5vh, 52px); display: grid; gap: 6px; pointer-events: none; padding: 12px 16px; background: rgba(10,9,7,.78); }
#r-map .keys { position: absolute; right: clamp(24px, 4vw, 64px); bottom: clamp(22px, 5vh, 52px); text-align: right; padding: 12px 18px; background: rgba(10,9,7,.78); }
#r-map .keys .r-menu { display: flex; gap: 26px; justify-content: flex-end; margin-top: 10px; pointer-events: auto; }
`;

type Hit = { kind: 'landmark'; lm: Landmark } | { kind: 'courtyard' } | { kind: 'player' } | { kind: 'mark' };

export class MapScreen {
    readonly root = document.createElement('section');
    private canvas = document.createElement('canvas');
    private ctx: CanvasRenderingContext2D;
    private base: HTMLCanvasElement | null = null;
    private zoom = 1;
    private center = { x: 0, z: 0 };
    private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
    private mark: { x: number; z: number } | null = null;
    private selected: Hit | null = null;
    private place = document.createElement('div');
    onClose: () => void = () => {};

    constructor(private source: MapSource) {
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
        this.root.id = 'r-map';
        this.root.className = 'r-layer r-screen r-grain';
        this.ctx = this.canvas.getContext('2d')!;
        this.place.className = 'place is-empty';
        const head = document.createElement('div');
        head.className = 'head';
        head.innerHTML = '<div class="r-eyebrow">The mountain roads</div><div class="t">Map</div>';
        const legend = document.createElement('div');
        legend.className = 'legend r-micro';
        legend.innerHTML = '◆ you &nbsp; ⛩ a place &nbsp; ⚔ a swordsman waits &nbsp; ✕ your mark &nbsp; ? not yet reached';
        const keys = document.createElement('div');
        keys.className = 'keys r-micro';
        keys.innerHTML = 'Drag to move · wheel to zoom · click a place · double-click to set your mark<div class="r-menu"></div>';
        const menu = keys.querySelector('.r-menu')!;
        const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); menu.appendChild(b); };
        btn('Centre on me', () => { const p = this.source.player(); this.center = { x: p.x, z: p.z }; });
        btn('Clear mark', () => { this.mark = null; this.saveMark(); });
        btn('Return', () => this.onClose());
        this.root.append(this.canvas, head, this.place, legend, keys);
        document.body.appendChild(this.root);
        try { const m = JSON.parse(localStorage.getItem(MARK_KEY) ?? 'null'); if (m && Number.isFinite(m.x)) this.mark = m; } catch { /* none */ }
        this.bind();
    }

    get isOpen(): boolean { return this.root.classList.contains('is-open'); }

    open(): void {
        if (!this.base) this.base = this.paint();
        const p = this.source.player();
        this.center = { x: p.x, z: p.z };
        this.zoom = 1.4;
        this.selected = null;
        this.renderPlace();
        this.root.classList.add('is-open');
        uiState.open('map');
    }

    close(): void {
        this.root.classList.remove('is-open');
        uiState.close('map');
    }

    /** Called each frame while open: markers move with the world. */
    update(): void {
        if (this.isOpen) this.draw();
    }

    // ── View math ───────────────────────────────────────────────────────────────────────────
    private scale(): number {
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        return (Math.min(w, h) / (EXTENT * 2)) * this.zoom;
    }
    private toScreen(x: number, z: number): [number, number] {
        const s = this.scale();
        return [this.canvas.clientWidth / 2 + (x - this.center.x) * s, this.canvas.clientHeight / 2 + (z - this.center.z) * s];
    }
    private toWorld(px: number, py: number): { x: number; z: number } {
        const s = this.scale();
        return { x: this.center.x + (px - this.canvas.clientWidth / 2) / s, z: this.center.z + (py - this.canvas.clientHeight / 2) / s };
    }

    private bind(): void {
        const c = this.canvas;
        c.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, cx: this.center.x, cz: this.center.z, moved: false }; try { c.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } c.classList.add('is-dragging'); });
        c.addEventListener('pointermove', e => {
            if (!this.drag) return;
            const s = this.scale();
            const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
            if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
            this.center = { x: this.drag.cx - dx / s, z: this.drag.cz - dy / s };
        });
        c.addEventListener('pointerup', e => {
            const d = this.drag;
            this.drag = null;
            c.classList.remove('is-dragging');
            if (d && !d.moved) { this.selected = this.hit(e.offsetX, e.offsetY); this.renderPlace(); }
        });
        c.addEventListener('dblclick', e => { this.mark = this.toWorld(e.offsetX, e.offsetY); this.saveMark(); this.selected = { kind: 'mark' }; this.renderPlace(); });
        c.addEventListener('wheel', e => {
            e.preventDefault();
            const before = this.toWorld(e.offsetX, e.offsetY);
            this.zoom = Math.min(5, Math.max(0.8, this.zoom * Math.exp(-e.deltaY * 0.0015)));
            const after = this.toWorld(e.offsetX, e.offsetY);
            this.center.x += before.x - after.x;
            this.center.z += before.z - after.z;
        }, { passive: false });
        this.root.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') { e.stopPropagation(); this.onClose(); } });
    }

    private saveMark(): void {
        try { localStorage.setItem(MARK_KEY, JSON.stringify(this.mark)); } catch { /* private mode */ }
    }

    private hit(px: number, py: number): Hit | null {
        const near = (x: number, z: number) => { const [sx, sy] = this.toScreen(x, z); return Math.hypot(sx - px, sy - py) < 20; };
        const p = this.source.player();
        if (near(p.x, p.z)) return { kind: 'player' };
        if (this.mark && near(this.mark.x, this.mark.z)) return { kind: 'mark' };
        for (const lm of LANDMARKS) if (near(lm.x, lm.z)) return { kind: 'landmark', lm };
        if (near(COURTYARD.x, COURTYARD.z)) return { kind: 'courtyard' };
        return null;
    }

    private renderPlace(): void {
        const h = this.selected;
        this.place.classList.toggle('is-empty', !h);
        if (!h) return;
        const item = (label: string, sub = '') => `<li><i></i>${label}${sub ? ` <span class="sub">${sub}</span>` : ''}</li>`;
        const p = this.source.player();
        const dist = (x: number, z: number) => `${Math.round(Math.hypot(x - p.x, z - p.z))} m from you`;
        if (h.kind === 'player') {
            this.place.innerHTML = `<div class="r-eyebrow">You</div><div class="n">Here</div><p class="r-body">Wherever you stand is the middle of the road.</p>`;
        } else if (h.kind === 'mark') {
            this.place.innerHTML = `<div class="r-eyebrow">Your mark</div><div class="n">Marked</div><ul>${item(dist(this.mark!.x, this.mark!.z))}</ul>`;
        } else if (h.kind === 'courtyard') {
            this.place.innerHTML = `<div class="r-eyebrow">Sanctuary</div><div class="n">${COURTYARD.name}</div><p class="r-body">${COURTYARD.description}</p><ul>${item('Forge', 'make a blade of your own')}${item('Training', 'two straw partners who never tire')}${item(dist(0, 0))}</ul>`;
        } else {
            const lm = h.lm;
            const known = this.source.discovered().has(lm.id);
            const r = this.source.rival(lm.id);
            const record = r && r.encounters
                ? `crossed blades ${r.encounters}× · you prevailed ${r.falls} · they prevailed ${r.wins}${r.dormant ? ' · recovering' : ''}`
                : 'not yet met';
            this.place.innerHTML = known
                ? `<div class="r-eyebrow">${lm.title}</div><div class="n">${lm.name}</div><p class="r-body">${lm.description}</p><ul>${item(`Duel · ${lm.rivalName}`, record)}${item(dist(lm.x, lm.z))}</ul>`
                : `<div class="r-eyebrow">Not yet reached</div><div class="n">Unknown</div><p class="r-body">Smoke rises there some evenings. Someone keeps that ground.</p><ul>${item(dist(lm.x, lm.z))}</ul>`;
        }
    }

    // ── Painting ────────────────────────────────────────────────────────────────────────────

    /** The paper itself: terrain, contours, meadows, forests and paths, painted once. */
    private paint(): HTMLCanvasElement {
        const c = document.createElement('canvas');
        c.width = c.height = BASE;
        const g = c.getContext('2d')!;
        const img = g.createImageData(BASE, BASE);
        const m = BASE / (EXTENT * 2);
        const H = new Float32Array(BASE * BASE);
        for (let j = 0; j < BASE; j++) for (let i = 0; i < BASE; i++) H[j * BASE + i] = this.source.height(i / m - EXTENT, j / m - EXTENT);
        for (let j = 0; j < BASE; j++) {
            for (let i = 0; i < BASE; i++) {
                const k = j * BASE + i;
                const h = H[k];
                const hx = H[k + (i < BASE - 1 ? 1 : 0)] - H[k - (i > 0 ? 1 : 0)];
                const hz = H[k + (j < BASE - 1 ? BASE : 0)] - H[k - (j > 0 ? BASE : 0)];
                // Light from the north-west, like an engraver's.
                const shade = Math.max(-1, Math.min(1, (-hx - hz) * 3.2));
                const x = i / m - EXTENT, z = j / m - EXTENT;
                const meadow = this.source.meadow(x, z);
                const grain = (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
                let r = 222, gg = 206, b = 168;
                if (!meadow) { r -= 10; gg -= 8; b -= 14; }
                r += shade * 26 - h * 1.2 + grain * 6; gg += shade * 24 - h * 1.1 + grain * 6; b += shade * 20 - h * 0.9 + grain * 5;
                // Ink contour every 1.5 m of height.
                const band = Math.floor(h / 1.5);
                const edge = i > 0 && j > 0 && (Math.floor(H[k - 1] / 1.5) !== band || Math.floor(H[k - BASE] / 1.5) !== band);
                if (edge) { r *= 0.62; gg *= 0.6; b *= 0.58; }
                // Burnt, worn edges of the sheet.
                // Distance to the sheet's edge as a soft rectangle (superellipse), roughened.
                const ux = Math.abs(i - BASE / 2) / (BASE / 2), uy = Math.abs(j - BASE / 2) / (BASE / 2);
                const e = Math.pow(Math.pow(ux, 8) + Math.pow(uy, 8), 1 / 8) + (grain - 0.5) * 0.015;
                const burn = Math.max(0, (e - 0.9) * 7);
                img.data[k * 4] = Math.max(0, r * (1 - burn * 0.6));
                img.data[k * 4 + 1] = Math.max(0, gg * (1 - burn * 0.65));
                img.data[k * 4 + 2] = Math.max(0, b * (1 - burn * 0.7));
                img.data[k * 4 + 3] = e > 1.0 ? 0 : 255;
            }
        }
        g.putImageData(img, 0, 0);
        // Forest: one small inked tree per cedar that actually stands there.
        g.strokeStyle = 'rgba(48,40,28,0.75)';
        g.fillStyle = 'rgba(70,82,58,0.32)';
        g.lineWidth = 1.1;
        for (const t of this.source.trees(-EXTENT, -EXTENT, EXTENT, EXTENT)) {
            const px = (t.x + EXTENT) * m, py = (t.z + EXTENT) * m;
            g.beginPath();
            g.moveTo(px, py - 5); g.lineTo(px - 3.4, py + 2.5); g.lineTo(px + 3.4, py + 2.5); g.closePath();
            g.fill(); g.stroke();
            g.beginPath(); g.moveTo(px, py + 2.5); g.lineTo(px, py + 4.5); g.stroke();
        }
        // Paths: dashed brush lines.
        g.strokeStyle = 'rgba(92,52,30,0.85)';
        g.lineWidth = 2.2;
        g.setLineDash([7, 5]);
        for (const route of this.source.routes()) {
            g.beginPath();
            route.forEach(([x, z], i) => { const px = (x + EXTENT) * m, py = (z + EXTENT) * m; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
            g.stroke();
        }
        g.setLineDash([]);
        // Courtyard
        g.strokeStyle = 'rgba(60,40,26,0.9)';
        g.lineWidth = 1.6;
        g.beginPath(); g.arc(EXTENT * m, EXTENT * m, 11 * m, 0, Math.PI * 2); g.stroke();
        // Compass rose
        g.save();
        g.translate(BASE - 70, BASE - 92);
        g.strokeStyle = 'rgba(60,40,26,0.8)';
        g.fillStyle = 'rgba(60,40,26,0.8)';
        g.beginPath(); g.moveTo(0, -26); g.lineTo(6, 0); g.lineTo(0, 26); g.lineTo(-6, 0); g.closePath(); g.stroke();
        g.beginPath(); g.moveTo(0, -26); g.lineTo(6, 0); g.lineTo(-6, 0); g.closePath(); g.fill();
        g.font = '18px "Yuji Syuku", serif';
        g.textAlign = 'center';
        g.fillText('北', 0, -32);
        g.restore();
        return c;
    }

    private draw(): void {
        const c = this.canvas, g = this.ctx;
        const dpr = Math.min(window.devicePixelRatio, 2);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        if (!this.base) return;
        const [x0, y0] = this.toScreen(-EXTENT, -EXTENT);
        const size = EXTENT * 2 * this.scale();
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = 40;
        g.drawImage(this.base, x0, y0, size, size);
        g.shadowBlur = 0;
        const ink = 'rgba(40,26,16,0.95)';
        const label = (text: string, x: number, y: number, size = 16, font = '"Cormorant Garamond", serif') => {
            g.font = `600 ${size}px ${font}`;
            g.textAlign = 'center';
            g.fillStyle = 'rgba(236,224,196,0.85)';
            g.fillText(text, x + 0.8, y + 0.8);
            g.fillStyle = ink;
            g.fillText(text, x, y);
        };
        // Courtyard
        const [cx, cy] = this.toScreen(0, 0);
        g.fillStyle = 'rgba(158,59,47,0.9)';
        g.fillRect(cx - 4, cy - 4, 8, 8);
        label('Forge Courtyard', cx, cy + 22, 15);
        // Places
        const known = this.source.discovered();
        for (const lm of LANDMARKS) {
            const [px, py] = this.toScreen(lm.x, lm.z);
            const r = this.source.rival(lm.id);
            const seen = known.has(lm.id);
            g.font = '20px "Noto Serif JP", serif';
            g.textAlign = 'center';
            g.fillStyle = seen ? 'rgba(158,59,47,0.95)' : 'rgba(60,40,26,0.55)';
            g.fillText(seen ? '⛩' : '?', px, py + 7);
            if (seen) {
                label(lm.name, px, py + 26, 15);
                if (r && !r.dormant) { g.font = '13px serif'; g.fillStyle = 'rgba(199,167,106,1)'; g.fillText('⚔', px + 18, py - 8); }
            }
            if (this.selected?.kind === 'landmark' && this.selected.lm === lm) {
                g.strokeStyle = 'rgba(199,167,106,1)'; g.lineWidth = 1.5;
                g.beginPath(); g.arc(px, py, 18, 0, Math.PI * 2); g.stroke();
            }
        }
        // Your mark
        if (this.mark) {
            const [mx, my] = this.toScreen(this.mark.x, this.mark.z);
            g.strokeStyle = 'rgba(158,59,47,1)'; g.lineWidth = 2.4;
            g.beginPath(); g.moveTo(mx - 7, my - 7); g.lineTo(mx + 7, my + 7); g.moveTo(mx + 7, my - 7); g.lineTo(mx - 7, my + 7); g.stroke();
        }
        // You, with your heading.
        const p = this.source.player();
        const [px, py] = this.toScreen(p.x, p.z);
        g.save();
        g.translate(px, py);
        g.rotate(-p.yaw);
        g.fillStyle = 'rgba(199,167,106,1)';
        g.strokeStyle = 'rgba(30,20,12,0.9)';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, -11); g.lineTo(6, 4); g.lineTo(0, 1); g.lineTo(-6, 4); g.closePath();
        g.fill(); g.stroke();
        g.restore();
    }
}
