import * as THREE from 'three';
import { createProceduralSwordMesh } from './mesh-generator';
import { createForgedWeapon, type BladeGeometry, type ForgedWeapon } from './physics';
import { FORGE_MATERIALS, computeBlendedMetallurgy, type BlendedMetallurgy } from './materials';
import type { Smithy } from '../world/Smithy';
import { uiState } from '../ui/UIState';

// Forging, in the world: the camera stands at the anvil and the blade takes shape on it.
// Five short steps: steel, form, fire (one honest timing test), fittings, finish. Every choice
// changes the real blade geometry and metallurgy the forge's physics turns into a weapon, and
// the finished blade goes straight into the inventory and the hand.

type Step = 'steel' | 'form' | 'fire' | 'fittings' | 'finish';
const STEPS: { id: Step; label: string; kanji: string }[] = [
    { id: 'steel', label: 'Steel', kanji: '鋼' },
    { id: 'form', label: 'Form', kanji: '形' },
    { id: 'fire', label: 'Fire', kanji: '火' },
    { id: 'fittings', label: 'Fittings', kanji: '拵' },
    { id: 'finish', label: 'Finish', kanji: '成' },
];

const STEELS = ['tamahagane', 'folded_river_steel', 'white_paper_steel', 'meteoric_iron'];
/**
 * Sword types: real Japanese forms, each a length, a handle and a mass (the forge's physics
 * weighs the result). Long and short blade training (The Way) applies to them in a duel.
 */
const SWORD_TYPES = [
    { id: 'wakizashi', label: 'Wakizashi', cm: 52, tsuka: 18, width: 0.92, sori: 1.1, note: 'The short companion sword. Quick to parry, and a short-blade fighter parries quicker still; you must step inside to reach.' },
    { id: 'uchigatana', label: 'Uchigatana', cm: 72, tsuka: 26, width: 1, sori: 1.8, note: 'The katana worn edge-up through the belt. The measured length: nothing to prove.' },
    { id: 'tachi', label: 'Tachi', cm: 78, tsuka: 27, width: 1.02, sori: 2.6, note: 'The older slung sword: longer, deeply curved near the hilt. Draws through a cut.' },
    { id: 'nodachi', label: 'Nodachi', cm: 98, tsuka: 38, width: 1.12, sori: 2.6, note: 'The great field sword. Reaches first and lands heavy, but its weight slows every swing unless trained for it.' },
] as const;
const CURVES = [
    { sori: 1.1, label: 'Shallow', note: 'Straighter: thrusts run true.' },
    { sori: 1.8, label: 'Torii', note: 'The balanced curve of a working blade.' },
    { sori: 2.6, label: 'Deep', note: 'Draws through a cut; slower to thrust.' },
];
const HAMON: BladeGeometry['hamonPattern'][] = ['suguha', 'notare', 'gunome', 'choji', 'midare'];
const HAMON_WORD: Record<string, string> = { suguha: 'Straight', notare: 'Waves', gunome: 'Clustered', choji: 'Clove', midare: 'Wild' };
const TSUBA: BladeGeometry['tsubaStyle'][] = ['minimal_plain', 'iron_mokko', 'octagonal', 'sukashi_crane', 'dragon_maru'];
const TSUBA_WORD: Record<string, string> = { minimal_plain: 'Plain round', iron_mokko: 'Iron mokkō', octagonal: 'Octagonal', sukashi_crane: 'Openwork crane', dragon_maru: 'Dragon circle' };
const WRAPS = [
    { id: 'charcoal', label: 'Charcoal', hex: '#232326' },
    { id: 'indigo', label: 'Indigo', hex: '#24264f' },
    { id: 'crimson', label: 'Crimson', hex: '#7f1d1d' },
    { id: 'leather', label: 'Leather', hex: '#5a2c0a' },
    { id: 'unbleached', label: 'Unbleached', hex: '#d6d3d1' },
];

/** Target heat for the quench: the colour of a low sun (0..1 on the heat ramp). */
const TARGET = 0.62;
const TOLERANCE = 0.07;

const CSS = `
#r-forge { z-index: 44; pointer-events: none; }
#r-forge.is-open { pointer-events: auto; }
#r-forge .wash { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(6,5,4,.62), rgba(6,5,4,0) 30%, rgba(6,5,4,0) 58%, rgba(6,5,4,.78)); }
#r-forge .steps { position: absolute; left: clamp(28px, 4vw, 70px); top: 50%; transform: translateY(-50%); display: grid; gap: 22px; padding: 22px 26px 22px 0; text-shadow: 0 1px 12px rgba(0,0,0,.6); }
#r-forge .steps div { display: flex; gap: 16px; align-items: baseline; color: var(--ivory-faint); transition: color var(--mid); }
#r-forge .steps .k { font: 400 calc(22px * var(--ui-scale)) var(--font-kanji); width: 28px; }
#r-forge .steps .l { font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .32em; text-transform: uppercase; }
#r-forge .steps .is-now { color: var(--ivory); }
#r-forge .steps .is-now .k { color: var(--gold); }
#r-forge .steps .is-done { color: var(--ivory-dim); }
#r-forge .fg-panel { position: absolute; right: clamp(20px, 3vw, 54px); top: 8vh; bottom: 9vh; width: min(460px, 36vw); display: flex; flex-direction: column; gap: 18px; padding: 30px 32px; background: linear-gradient(180deg, rgba(10,9,7,.66), rgba(10,9,7,.82)); border-top: 1px solid var(--line); box-shadow: 0 30px 80px rgba(0,0,0,.35); backdrop-filter: blur(3px); }
#r-forge .fg-panel h2 { margin: 0; font: 400 calc(40px * var(--ui-scale)) var(--font-brush); }
#r-forge .fg-panel .lead { margin: -6px 0 6px; }
#r-forge .choices { display: grid; gap: 4px; overflow-y: auto; }
#r-forge .choice { all: unset; cursor: pointer; display: grid; gap: 4px; padding: 12px 0 12px 22px; border-left: 1px solid var(--line); transition: border-color var(--fast), background var(--fast); }
#r-forge .choice:hover, #r-forge .choice:focus-visible { border-color: var(--ivory-faint); background: rgba(255,255,255,.02); }
#r-forge .choice[aria-pressed="true"] { border-color: var(--gold); }
#r-forge .choice .n { font: 500 calc(19px * var(--ui-scale)) var(--font-serif); letter-spacing: .04em; }
#r-forge .choice .n small { margin-left: 10px; font: 400 calc(15px * var(--ui-scale)) var(--font-kanji); color: var(--gold); }
#r-forge .choice .d { font: italic calc(15px * var(--ui-scale)) / 1.4 var(--font-serif); color: var(--ivory-dim); }
#r-forge .group { display: grid; gap: 8px; }
#r-forge .row { display: flex; flex-wrap: wrap; gap: 8px 18px; }
#r-forge .pill { all: unset; cursor: pointer; font: 500 calc(11px * var(--ui-scale)) var(--font-sans); letter-spacing: .2em; text-transform: uppercase; color: var(--ivory-faint); padding: 6px 0; border-bottom: 1px solid transparent; }
#r-forge .pill[aria-pressed="true"] { color: var(--ivory); border-color: var(--gold); }
#r-forge .swatch { width: 10px; height: 10px; display: inline-block; margin-right: 8px; border: 1px solid var(--ivory-faint); vertical-align: middle; }
#r-forge .heat { position: relative; height: 4px; background: linear-gradient(90deg, #2a0d06, #6a1405 25%, #c2300c 45%, #ff6a10 62%, #ffc040 80%, #fff4d0); }
#r-forge .heat .band { position: absolute; top: -6px; bottom: -6px; border-left: 1px solid var(--ivory); border-right: 1px solid var(--ivory); }
#r-forge .heat .mark { position: absolute; top: -9px; width: 2px; height: 22px; background: var(--ivory); transform: translateX(-1px); }
#r-forge .hold { all: unset; cursor: pointer; text-align: center; padding: 16px; border: 1px solid var(--gold-dim); font: 500 calc(12px * var(--ui-scale)) var(--font-sans); letter-spacing: .3em; text-transform: uppercase; color: var(--ivory); user-select: none; }
#r-forge .hold.is-held { background: rgba(199,120,60,.15); border-color: var(--gold); }
#r-forge .verdict { font: italic calc(18px * var(--ui-scale)) / 1.45 var(--font-serif); color: var(--ivory); min-height: 2.9em; }
#r-forge input.name { all: unset; font: 400 calc(26px * var(--ui-scale)) var(--font-brush); border-bottom: 1px solid var(--line); padding: 4px 0; }
#r-forge input.name:focus { border-color: var(--gold-dim); }
#r-forge .facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; }
#r-forge .facts span:nth-child(odd) { font: 500 calc(10px * var(--ui-scale)) var(--font-sans); letter-spacing: .25em; text-transform: uppercase; color: var(--ivory-faint); align-self: center; }
#r-forge .facts span:nth-child(even) { font: italic calc(16px * var(--ui-scale)) var(--font-serif); color: var(--ivory-dim); }
#r-forge .nav { margin-top: auto; display: flex; justify-content: space-between; align-items: center; }
#r-forge .nav .r-menu { display: flex; gap: 28px; }
#r-forge .page > * { animation: r-ink .6s var(--ease) both; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
}

function heatColor(h: number, out: THREE.Color): THREE.Color {
    const stops: [number, number][] = [[0, 0x000000], [0.25, 0x6a1405], [0.45, 0xc2300c], [0.62, 0xff6a10], [0.8, 0xffc040], [1, 0xfff4d0]];
    for (let i = 1; i < stops.length; i++) {
        if (h <= stops[i][0]) {
            const t = (h - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
            return out.setHex(stops[i - 1][1]).lerp(new THREE.Color(stops[i][1]), t);
        }
    }
    return out.setHex(0xfff4d0);
}

export class ForgeSession {
    readonly root = el('section', 'r-layer r-screen r-grain');
    private stepsEl = el('div', 'steps');
    private panel = el('div', 'fg-panel page');
    private step: Step = 'steel';
    private steel = 'tamahagane';
    private lengthCm = 72;
    private swordType: (typeof SWORD_TYPES)[number] = SWORD_TYPES[1];
    private sori = 1.8;
    private hamon: BladeGeometry['hamonPattern'] = 'notare';
    private tsuba: BladeGeometry['tsubaStyle'] = 'iron_mokko';
    private wrap = 'charcoal';
    private name = '';
    private heat = 0;
    private holding = false;
    private temper: { quality: 'true' | 'soft' | 'brittle'; delta: number } | null = null;
    private blade: THREE.Group | null = null;
    private bladeMat: THREE.MeshStandardMaterial | null = null;
    private billet: THREE.Mesh;
    private holder = new THREE.Group();
    private savedPos = new THREE.Vector3();
    private savedQuat = new THREE.Quaternion();
    private camPos = new THREE.Vector3();
    private camLook = new THREE.Vector3();
    private anim: { kind: 'none' | 'toFire' | 'quench' | 'present'; t: number } = { kind: 'none', t: 0 };
    private steam: THREE.Mesh[] = [];
    private verdict = el('div', 'verdict');
    private heatMark = el('div', 'mark');
    private time = 0;
    open_ = false;

    constructor(
        private scene: THREE.Scene,
        private camera: THREE.PerspectiveCamera,
        private smithy: Smithy,
        private onFinish: (weapon: ForgedWeapon) => void,
        private onLeave: () => void,
    ) {
        const s = el('style');
        s.textContent = CSS;
        document.head.appendChild(s);
        this.root.id = 'r-forge';
        this.root.append(el('div', 'wash'), this.stepsEl, this.panel);
        document.body.appendChild(this.root);
        this.billet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6, metalness: 0.7 }));
        this.holder.add(this.billet);
        this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
        window.addEventListener('keydown', e => { if (this.open_ && this.step === 'fire' && e.code === 'Space' && !e.repeat) { e.preventDefault(); this.startHeat(); } });
        window.addEventListener('keyup', e => { if (this.open_ && this.step === 'fire' && e.code === 'Space') this.release(); });
    }

    get isOpen(): boolean { return this.open_; }

    open(): void {
        this.open_ = true;
        this.savedPos.copy(this.camera.position);
        this.savedQuat.copy(this.camera.quaternion);
        this.camPos.copy(this.camera.position);
        this.camLook.copy(this.camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
        this.step = 'steel';
        this.temper = null;
        this.heat = 0;
        this.name = '';
        this.scene.add(this.holder);
        this.layOnAnvil();
        this.billet.visible = true;
        this.blade?.removeFromParent();
        this.blade = null;
        this.render();
        this.root.classList.add('is-open');
        uiState.open('forge');
    }

    close(): void {
        if (!this.open_) return;
        this.open_ = false;
        this.root.classList.remove('is-open');
        this.holder.removeFromParent();
        for (const p of this.steam) p.removeFromParent();
        this.steam = [];
        this.camera.position.copy(this.savedPos);
        this.camera.quaternion.copy(this.savedQuat);
        uiState.close('forge');
        this.onLeave();
    }

    // ── 3D ──────────────────────────────────────────────────────────────────────────────────

    private geometry(): BladeGeometry {
        const k = this.lengthCm / 72;
        return {
            bladeLength: this.lengthCm, curvature: this.sori,
            baseWidth: +(3.1 * Math.pow(k, 0.35) * this.swordType.width).toFixed(2), tipWidth: +(2.15 * Math.pow(k, 0.3) * this.swordType.width).toFixed(2),
            baseThickness: +(0.75 * this.swordType.width).toFixed(2), tipThickness: 0.45,
            tsukaLength: this.swordType.tsuka,
            balanceShift: 0, hamonPattern: this.hamon, tsubaStyle: this.tsuba, tsukaWrapColor: this.wrap,
        };
    }

    private metallurgy(): BlendedMetallurgy {
        const m = computeBlendedMetallurgy([{ materialId: this.steel, ratio: 1 }], 12);
        if (this.temper) {
            // Too cool: softer, tougher. Too hot: harder, brittle. True: a little of both.
            const d = this.temper.delta;
            m.hardnessHRC = Math.round(Math.max(48, Math.min(66, m.hardnessHRC + d * 40 + (this.temper.quality === 'true' ? 1 : 0))));
            m.toughness = Math.round(Math.max(30, Math.min(98, m.toughness - d * 70 + (this.temper.quality === 'true' ? 4 : 0))));
        }
        return m;
    }

    private rebuildBlade(): void {
        this.blade?.removeFromParent();
        const sword = createProceduralSwordMesh(this.geometry(), this.metallurgy());
        // Lay it flat on the anvil: blade along +x, edge toward the smith.
        sword.rotation.set(0, Math.PI / 2, Math.PI / 2);
        sword.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
        const bladeMesh = sword.children[0] as THREE.Mesh;
        this.bladeMat = (bladeMesh.material as THREE.MeshStandardMaterial).clone();
        bladeMesh.material = this.bladeMat;
        // Centre the blade on the anvil face.
        sword.position.set(-this.lengthCm / 200, 0, 0);
        this.blade = new THREE.Group();
        this.blade.add(sword);
        this.holder.add(this.blade);
        this.billet.visible = false;
        this.applyHeat();
    }

    private layOnAnvil(): void {
        this.holder.position.copy(this.smithy.anvilFace).add(new THREE.Vector3(0.05, 0.04, 0));
        this.holder.rotation.set(0, 0.15, 0);
    }

    private applyHeat(): void {
        const c = heatColor(this.heat, new THREE.Color());
        const target = this.bladeMat ?? (this.billet.material as THREE.MeshStandardMaterial);
        target.emissive.copy(c);
        target.emissiveIntensity = 0.4 + this.heat * 2.4;
    }

    update(dt: number): void {
        if (!this.open_) return;
        this.time += dt;
        this.smithy.update(dt);
        // Camera settles into the smith's stance.
        const view = this.smithy.view;
        const k = 1 - Math.exp(-3 * dt);
        this.camPos.lerp(view.pos, k);
        this.camLook.lerp(this.anim.kind === 'present' ? this.smithy.stand : view.look, k * 0.8);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);

        if (this.holding) {
            this.heat = Math.min(1, this.heat + dt * 0.36);
            this.smithy.stoke(this.heat * 0.4);
            this.applyHeat();
            this.heatMark.style.left = `${this.heat * 100}%`;
            if (this.heat >= 1) this.release();
        } else if (this.step !== 'fire' && this.anim.kind !== 'quench') {
            // Steel cools when it is out of the fire.
            if (this.heat > 0) { this.heat = Math.max(0, this.heat - dt * 0.25); this.applyHeat(); }
        }

        const a = this.anim;
        a.t += dt;
        const ease = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
        if (a.kind === 'toFire') {
            const t = ease(a.t / 0.6);
            const from = this.smithy.anvilFace.clone().add(new THREE.Vector3(0.05, 0.02, 0));
            const over = this.smithy.hearth.clone().add(new THREE.Vector3(-0.15, 0.12, 0.05));
            this.holder.position.lerpVectors(from, over, t);
            this.holder.rotation.y = 0.15 + t * 0.6;
        } else if (a.kind === 'quench') {
            const t = a.t;
            const over = this.smithy.quench.clone().add(new THREE.Vector3(0, 0.45, 0));
            const into = this.smithy.quench.clone().add(new THREE.Vector3(0, 0.05, 0));
            if (t < 0.5) this.holder.position.lerp(over, 1 - Math.exp(-10 * dt));
            else if (t < 1.1) this.holder.position.lerp(into, 1 - Math.exp(-14 * dt));
            else if (t < 2.0) this.holder.position.lerp(over, 1 - Math.exp(-6 * dt));
            else { a.kind = 'none'; this.layOnAnvil(); }
            this.holder.rotation.set(t > 0.4 && t < 1.8 ? -1.2 : 0, 0.15, 0);
            if (t > 0.6 && t < 1.6) {
                if (this.heat > 0) { this.heat = Math.max(0, this.heat - dt * 2); this.applyHeat(); }
                if (Math.random() < dt * 30) this.puff();
            }
        } else if (a.kind === 'present') {
            const t = ease(a.t / 1.2);
            const stand = this.smithy.stand.clone();
            this.holder.position.lerp(stand, Math.min(1, t * 0.9 + 0.02));
            this.holder.rotation.set(0, 0.15 + this.time * 0.25, Math.PI * 0.42 * t);
        }
        for (const p of this.steam) {
            p.position.y += dt * 0.35;
            p.scale.multiplyScalar(1 + dt * 0.8);
            const m = p.material as THREE.MeshBasicMaterial;
            m.opacity = Math.max(0, m.opacity - dt * 0.35);
        }
        this.steam = this.steam.filter(p => {
            if ((p.material as THREE.MeshBasicMaterial).opacity > 0) return true;
            p.removeFromParent();
            return false;
        });
    }

    private puff(): void {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.32, depthWrite: false }));
        m.position.copy(this.smithy.quench).add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.2, (Math.random() - 0.5) * 0.2));
        this.scene.add(m);
        this.steam.push(m);
    }

    // ── Fire ────────────────────────────────────────────────────────────────────────────────

    private startHeat(): void {
        if (this.anim.kind === 'quench' || !this.blade) return;
        this.holding = true;
        this.temper = null;
        this.heat = Math.max(this.heat, 0.05);
        this.anim = { kind: 'toFire', t: 0 };
        this.verdict.textContent = 'Watch the colour, not the bar.';
        this.root.querySelector('.hold')?.classList.add('is-held');
    }

    private release(): void {
        if (!this.holding) return;
        this.holding = false;
        this.root.querySelector('.hold')?.classList.remove('is-held');
        if (this.heat < 0.3) {
            this.verdict.textContent = 'Barely warm. The steel will not take a temper like that.';
            this.anim = { kind: 'none', t: 0 };
            this.layOnAnvil();
            return;
        }
        const delta = this.heat - TARGET;
        const quality = Math.abs(delta) <= TOLERANCE ? 'true' : delta < 0 ? 'soft' : 'brittle';
        this.temper = { quality, delta };
        this.anim = { kind: 'quench', t: 0 };
        this.verdict.textContent = quality === 'true'
            ? 'The colour of a low sun. The temper line will hold: hard at the edge, alive in the spine.'
            : quality === 'soft'
                ? 'Quenched cool. The edge will be forgiving and soft; it will bend before it breaks.'
                : 'Quenched too hot. A hard, bright edge — and a blade that may chip on bone or steel.';
        this.rebuildBladeKeepingPlace();
        this.renderNav();
    }

    private rebuildBladeKeepingPlace(): void {
        const pos = this.holder.position.clone();
        this.rebuildBlade();
        this.holder.position.copy(pos);
    }

    // ── UI ──────────────────────────────────────────────────────────────────────────────────

    private render(): void {
        this.stepsEl.replaceChildren(...STEPS.map((s, i) => {
            const idx = STEPS.findIndex(x => x.id === this.step);
            const d = el('div', i === idx ? 'is-now' : i < idx ? 'is-done' : '');
            d.append(el('span', 'k', s.kanji), el('span', 'l', s.label));
            return d;
        }));
        this.panel.replaceChildren();
        const page = { steel: () => this.pageSteel(), form: () => this.pageForm(), fire: () => this.pageFire(), fittings: () => this.pageFittings(), finish: () => this.pageFinish() }[this.step];
        page();
        this.renderNav();
        (this.panel.querySelector('button, input') as HTMLElement | null)?.focus({ preventScroll: true });
    }

    private head(title: string, lead: string): void {
        this.panel.append(el('h2', '', title), el('p', 'r-body lead', lead));
    }

    private pageSteel(): void {
        this.head('Choose the steel', 'Everything after this is shaped by what the steel is willing to become.');
        const list = el('div', 'choices');
        for (const id of STEELS) {
            const m = FORGE_MATERIALS[id];
            if (!m) continue;
            const b = el('button', 'choice');
            b.type = 'button';
            b.setAttribute('aria-pressed', String(id === this.steel));
            const n = el('span', 'n', m.name);
            n.appendChild(el('small', '', m.kanji));
            b.append(n, el('span', 'd', m.description));
            b.addEventListener('click', () => {
                this.steel = id;
                (this.billet.material as THREE.MeshStandardMaterial).color.set(m.baseColor);
                this.render();
            });
            list.appendChild(b);
        }
        this.panel.appendChild(list);
    }

    private pageForm(): void {
        if (!this.blade) this.rebuildBlade();
        this.head('Draw out the form', 'The kind of sword decides its length and weight; the curve decides how a cut travels.');
        const group = (label: string, items: { label: string; on: boolean; note?: string; click: () => void }[]) => {
            const g = el('div', 'group');
            g.appendChild(el('div', 'r-eyebrow', label));
            const row = el('div', 'row');
            for (const it of items) {
                const p = el('button', 'pill', it.label);
                p.type = 'button';
                p.setAttribute('aria-pressed', String(it.on));
                p.addEventListener('click', () => { it.click(); this.rebuildBlade(); this.render(); });
                row.appendChild(p);
            }
            g.appendChild(row);
            const note = items.find(i => i.on)?.note;
            if (note) g.appendChild(el('div', 'r-micro', note));
            return g;
        };
        this.panel.append(
            group('Sword', SWORD_TYPES.map(t => ({ label: `${t.label} · ${t.cm} cm`, on: t.id === this.swordType.id, note: t.note, click: () => { this.swordType = t; this.lengthCm = t.cm; this.sori = t.sori; } }))),
            group('Curve', CURVES.map(c => ({ label: c.label, on: c.sori === this.sori, note: c.note, click: () => { this.sori = c.sori; } }))),
            group('Temper line', HAMON.map(h => ({ label: HAMON_WORD[h], on: h === this.hamon, click: () => { this.hamon = h; } }))),
        );
    }

    private pageFire(): void {
        if (!this.blade) this.rebuildBlade();
        this.head('The fire', 'Draw the blade through the coals and quench it when the steel glows like a low sun — orange, not yellow.');
        const heat = el('div', 'heat');
        const band = el('div', 'band');
        band.style.left = `${(TARGET - TOLERANCE) * 100}%`;
        band.style.width = `${TOLERANCE * 200}%`;
        this.heatMark.style.left = `${this.heat * 100}%`;
        heat.append(band, this.heatMark);
        const hold = el('button', 'hold', 'Hold to heat · release to quench');
        hold.type = 'button';
        hold.addEventListener('pointerdown', e => { e.preventDefault(); this.startHeat(); });
        hold.addEventListener('pointerup', () => this.release());
        hold.addEventListener('pointerleave', () => this.release());
        const key = el('div', 'r-micro');
        key.innerHTML = 'Or hold <kbd class="r-key">Space</kbd>. You may heat again as often as you like.';
        if (!this.temper) this.verdict.textContent = '';
        this.panel.append(heat, hold, key, this.verdict);
    }

    private pageFittings(): void {
        this.head('Fittings', 'The guard and the grip are what your hands will know.');
        const g1 = el('div', 'group');
        g1.appendChild(el('div', 'r-eyebrow', 'Tsuba'));
        const r1 = el('div', 'row');
        for (const t of TSUBA) {
            const p = el('button', 'pill', TSUBA_WORD[t]);
            p.type = 'button';
            p.setAttribute('aria-pressed', String(t === this.tsuba));
            p.addEventListener('click', () => { this.tsuba = t; this.rebuildBlade(); this.render(); });
            r1.appendChild(p);
        }
        g1.appendChild(r1);
        const g2 = el('div', 'group');
        g2.appendChild(el('div', 'r-eyebrow', 'Grip wrap'));
        const r2 = el('div', 'row');
        for (const w of WRAPS) {
            const p = el('button', 'pill');
            p.type = 'button';
            const sw = el('span', 'swatch');
            sw.style.background = w.hex;
            p.append(sw, document.createTextNode(w.label));
            p.setAttribute('aria-pressed', String(w.id === this.wrap));
            p.addEventListener('click', () => { this.wrap = w.id; this.rebuildBlade(); this.render(); });
            r2.appendChild(p);
        }
        g2.appendChild(r2);
        const g3 = el('div', 'group');
        g3.appendChild(el('div', 'r-eyebrow', 'Name'));
        const input = el('input', 'name');
        input.value = this.name || this.suggestName();
        input.maxLength = 32;
        input.addEventListener('input', () => { this.name = input.value; });
        g3.appendChild(input);
        this.panel.append(g1, g2, g3);
    }

    private pageFinish(): void {
        this.anim = { kind: 'present', t: 0 };
        const weapon = createForgedWeapon(this.name || this.suggestName(), this.geometry(), this.metallurgy());
        const st = weapon.stats as unknown as Record<string, number>;
        this.head(weapon.name, 'It rests on the stand. It is yours, and it is honest about what it is.');
        const facts = el('div', 'facts');
        const fact = (k: string, v: string) => facts.append(el('span', '', k), el('span', '', v));
        fact('Steel', FORGE_MATERIALS[this.steel]?.name ?? this.steel);
        fact('Form', `${this.swordType.label}, ${this.lengthCm} cm — ${this.lengthCm >= 80 ? 'you will reach first' : this.lengthCm <= 62 ? 'you must close the distance' : 'measured'}`);
        if (Number.isFinite(st.weightKg)) fact('Weight', `${st.weightKg.toFixed(2)} kg — ${st.weightKg > 1.4 ? 'heavy in the hand' : st.weightKg > 1.05 ? 'balanced' : 'light and quick'}`);
        fact('Temper', this.temper ? { true: 'true: hard edge, living spine', soft: 'soft and forgiving', brittle: 'hard and brittle' }[this.temper.quality] : 'untempered');
        fact('Curve', CURVES.find(c => c.sori === this.sori)?.label ?? '');
        fact('Fittings', `${TSUBA_WORD[this.tsuba]} guard, ${WRAPS.find(w => w.id === this.wrap)?.label.toLowerCase()} wrap`);
        this.panel.appendChild(facts);
        this.pendingWeapon = weapon;
    }

    private pendingWeapon: ForgedWeapon | null = null;

    private suggestName(): string {
        const steel = { tamahagane: 'Izumo', folded_river_steel: 'River', white_paper_steel: 'White Paper', meteoric_iron: 'Hida' }[this.steel] ?? 'Mountain';
        const form = this.swordType.label;
        return `${steel} ${form}`;
    }

    private renderNav(): void {
        this.panel.querySelector('.nav')?.remove();
        const nav = el('div', 'nav');
        const left = el('div', 'r-menu');
        const right = el('div', 'r-menu');
        const btn = (label: string, fn: () => void, current = false) => {
            const b = el('button', '', label);
            b.type = 'button';
            if (current) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', fn);
            return b;
        };
        const idx = STEPS.findIndex(s => s.id === this.step);
        left.appendChild(btn(idx === 0 ? 'Leave the forge' : 'Back', () => {
            if (idx === 0) this.close();
            else { this.anim = { kind: 'none', t: 0 }; this.layOnAnvil(); this.step = STEPS[idx - 1].id; this.render(); }
        }));
        if (this.step === 'finish') {
            right.appendChild(btn('Carry this blade', () => {
                if (this.pendingWeapon) this.onFinish(this.pendingWeapon);
                this.close();
            }, true));
        } else {
            const blocked = this.step === 'fire' && !this.temper;
            const next = btn(blocked ? 'Quench first' : 'Continue', () => {
                if (blocked) return;
                this.anim = { kind: 'none', t: 0 };
                this.layOnAnvil();
                this.step = STEPS[idx + 1].id;
                this.render();
            }, !blocked);
            if (blocked) next.style.opacity = '0.35';
            right.appendChild(next);
        }
        nav.append(left, right);
        this.panel.appendChild(nav);
    }
}
