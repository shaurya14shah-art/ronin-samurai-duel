import * as THREE from 'three';
import type { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { WorldScene } from '../world/WorldScene';
import type { Weather } from '../world/Atmosphere';
import { uiState } from './UIState';

// Photo mode: the duel holds still, the camera is free, and the light is yours to choose.
// Every control acts on the real renderer and atmosphere; leaving restores all of it.
//
//   W A S D move · Q / E down / up · Shift faster · drag to look · H hide panel · Esc / P leave

const CSS = `
#r-photo { z-index: 43; pointer-events: none; }
#r-photo.is-open { pointer-events: none; }
#r-photo .card { position: absolute; left: clamp(20px, 3vw, 48px); bottom: clamp(20px, 4vh, 44px); width: 320px; padding: 22px 24px; display: grid; gap: 12px; pointer-events: auto;
  background: linear-gradient(180deg, rgba(10,9,7,.6), rgba(10,9,7,.8)); border-top: 1px solid var(--line); backdrop-filter: blur(3px); transition: opacity var(--mid) var(--ease); }
#r-photo.hide-card .card { opacity: 0; pointer-events: none; }
#r-photo .title { font: 400 calc(26px * var(--ui-scale)) var(--font-brush); }
#r-photo label { display: grid; grid-template-columns: 112px 1fr 44px; white-space: nowrap; gap: 10px; align-items: center; font: 500 calc(10px * var(--ui-scale)) var(--font-sans); letter-spacing: .2em; text-transform: uppercase; color: var(--ivory-dim); }
#r-photo output { font: 500 calc(10px * var(--ui-scale)) var(--font-sans); color: var(--ivory-faint); text-align: right; }
#r-photo input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 16px; background: transparent; }
#r-photo input[type=range]::-webkit-slider-runnable-track { height: 1px; background: var(--ivory-faint); }
#r-photo input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 8px; height: 8px; margin-top: -4px; transform: rotate(45deg); background: var(--gold); }
#r-photo .row { display: flex; flex-wrap: wrap; gap: 6px 14px; }
#r-photo .pill { all: unset; cursor: pointer; font: 500 calc(10px * var(--ui-scale)) var(--font-sans); letter-spacing: .2em; text-transform: uppercase; color: var(--ivory-faint); padding: 3px 0; border-bottom: 1px solid transparent; }
#r-photo .pill[aria-pressed="true"] { color: var(--ivory); border-color: var(--gold); }
#r-photo .keys { font: 400 calc(10px * var(--ui-scale)) / 1.6 var(--font-sans); letter-spacing: .08em; color: var(--ivory-faint); }
#r-photo .actions { display: flex; justify-content: space-between; margin-top: 4px; }
#r-photo .actions .r-menu { display: flex; gap: 20px; }
#r-photo .flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
#r-photo .flash.go { animation: r-photo-flash .5s ease-out; }
@keyframes r-photo-flash { 0% { opacity: .5; } 100% { opacity: 0; } }
body[data-ui="photo"] #hud-portrait, body[data-ui="photo"] #r-hud { opacity: 0 !important; }
`;

export class PhotoMode {
    readonly root = document.createElement('section');
    private keys = new Set<string>();
    private yaw = 0;
    private pitch = 0;
    private dragging = false;
    private saved: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; exposure: number; time: number; weather: Weather; fog: number } | null = null;
    private weather: Weather = 'clear';
    private flash = document.createElement('div');
    onClose: () => void = () => {};

    constructor(
        private world: WorldScene,
        private camera: THREE.PerspectiveCamera,
        private renderer: THREE.WebGLRenderer,
        private bokeh: BokehPass,
    ) {
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
        this.root.id = 'r-photo';
        this.root.className = 'r-layer r-screen';
        this.flash.className = 'flash';
        this.root.appendChild(this.flash);
        document.body.appendChild(this.root);

        window.addEventListener('keydown', e => {
            if (!this.isOpen) return;
            if ((e.target as HTMLElement)?.tagName === 'INPUT' && e.code !== 'Escape') return;
            if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
            if (e.code === 'KeyH') { this.root.classList.toggle('hide-card'); return; }
            this.keys.add(e.code);
        }, true);
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        const canvas = renderer.domElement;
        canvas.addEventListener('pointerdown', e => { if (this.isOpen) { this.dragging = true; canvas.setPointerCapture(e.pointerId); } });
        canvas.addEventListener('pointerup', () => { this.dragging = false; });
        canvas.addEventListener('pointermove', e => {
            if (!this.isOpen || !this.dragging) return;
            this.yaw -= e.movementX * 0.003;
            this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.003, -1.45, 1.45);
        });
    }

    get isOpen(): boolean { return this.root.classList.contains('is-open'); }

    open(): void {
        const atmo = this.world.getAtmosphere();
        this.saved = {
            pos: this.camera.position.clone(), quat: this.camera.quaternion.clone(), fov: this.camera.fov,
            exposure: this.renderer.toneMappingExposure, time: atmo?.getTimeOfDay() ?? 0.4,
            weather: (atmo?.getWeather() as Weather) ?? 'clear', fog: atmo?.fogScale ?? 1,
        };
        this.weather = this.saved.weather;
        this.world.setPhotoMode(true);
        atmo?.pinWeather(this.weather);
        // Step back from the eyes so the photographer can see the swordsman.
        const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = e.y;
        this.pitch = Math.max(-0.4, e.x);
        const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        this.camera.position.addScaledVector(back, 2.6).add(new THREE.Vector3(0, 0.2, 0));
        this.build();
        this.root.classList.add('is-open');
        this.root.classList.remove('hide-card');
        uiState.open('photo');
    }

    close(): void {
        if (!this.isOpen) return;
        const atmo = this.world.getAtmosphere();
        if (this.saved) {
            this.camera.position.copy(this.saved.pos);
            this.camera.quaternion.copy(this.saved.quat);
            this.camera.fov = this.saved.fov;
            this.camera.updateProjectionMatrix();
            this.renderer.toneMappingExposure = this.saved.exposure;
            atmo?.setTimeOfDay(this.saved.time);
            atmo?.pinWeather(null);
            atmo?.setWeather(this.saved.weather, 0);
            if (atmo) atmo.fogScale = this.saved.fog;
        }
        this.bokeh.enabled = false;
        this.world.setPhotoMode(false);
        this.root.classList.remove('is-open');
        this.keys.clear();
        uiState.close('photo');
        this.onClose();
    }

    update(dt: number): void {
        if (!this.isOpen) return;
        const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 9 : 3) * dt;
        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        if (this.keys.has('KeyW')) this.camera.position.addScaledVector(fwd, speed);
        if (this.keys.has('KeyS')) this.camera.position.addScaledVector(fwd, -speed);
        if (this.keys.has('KeyD')) this.camera.position.addScaledVector(right, speed);
        if (this.keys.has('KeyA')) this.camera.position.addScaledVector(right, -speed);
        if (this.keys.has('KeyE')) this.camera.position.y += speed;
        if (this.keys.has('KeyQ')) this.camera.position.y -= speed;
        this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    }

    private build(): void {
        this.root.querySelector('.card')?.remove();
        const card = document.createElement('div');
        card.className = 'card';
        const atmo = this.world.getAtmosphere();
        const range = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, apply: (v: number) => void) => {
            const l = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
            const out = document.createElement('output');
            out.textContent = fmt(value);
            input.addEventListener('input', () => { const v = Number(input.value); apply(v); out.textContent = fmt(v); });
            l.append(document.createTextNode(label), input, out);
            return l;
        };
        const clock = (t: number) => { const h = (t * 24 + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
        const focus = range('Focus', 1, 40, 0.5, 6, v => `${v} m`, v => { (this.bokeh.uniforms as any).focus.value = v; });
        focus.style.display = 'none';
        const weatherRow = document.createElement('div');
        weatherRow.className = 'row';
        for (const w of ['clear', 'wind', 'fog', 'rain'] as Weather[]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pill';
            b.textContent = w;
            b.setAttribute('aria-pressed', String(w === this.weather));
            b.addEventListener('click', () => {
                this.weather = w;
                atmo?.pinWeather(w, 1.5);
                weatherRow.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            });
            weatherRow.appendChild(b);
        }
        const dof = document.createElement('button');
        dof.type = 'button';
        dof.className = 'pill';
        dof.textContent = 'Depth of field';
        dof.setAttribute('aria-pressed', 'false');
        dof.addEventListener('click', () => {
            this.bokeh.enabled = !this.bokeh.enabled;
            dof.setAttribute('aria-pressed', String(this.bokeh.enabled));
            focus.style.display = this.bokeh.enabled ? '' : 'none';
        });
        const actions = document.createElement('div');
        actions.className = 'actions';
        const menu = document.createElement('div');
        menu.className = 'r-menu';
        const capture = document.createElement('button');
        capture.type = 'button';
        capture.textContent = 'Capture';
        capture.setAttribute('aria-current', 'true');
        capture.addEventListener('click', () => this.capture());
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.textContent = 'Leave';
        leave.addEventListener('click', () => this.close());
        menu.append(capture, leave);
        actions.appendChild(menu);
        const keys = document.createElement('div');
        keys.className = 'keys';
        keys.textContent = 'W A S D move · Q / E down, up · Shift faster · drag to look · H hide this · Esc leave';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = 'Photograph';
        card.append(
            title,
            range('Field of view', 20, 100, 1, this.camera.fov, v => `${v}°`, v => { this.camera.fov = v; this.camera.updateProjectionMatrix(); }),
            range('Exposure', 0.25, 1.8, 0.01, this.renderer.toneMappingExposure, v => v.toFixed(2), v => { this.renderer.toneMappingExposure = v; }),
            range('Time of day', 0, 1, 0.002, atmo?.getTimeOfDay() ?? 0.4, clock, v => atmo?.setTimeOfDay(v)),
            range('Haze', 0, 2, 0.05, atmo?.fogScale ?? 1, v => `×${v.toFixed(2)}`, v => { if (atmo) atmo.fogScale = v; }),
            weatherRow, dof, focus, keys, actions,
        );
        this.root.appendChild(card);
    }

    /** Render one frame without the card and save it as a PNG. */
    private capture(): void {
        this.root.classList.add('hide-card');
        requestAnimationFrame(() => {
            const game = (window as any).__RONIN_DEBUG__?.game;
            game?.renderFrameNow?.();
            this.renderer.domElement.toBlob(blob => {
                if (blob) {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `ronin-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
                }
                this.flash.classList.remove('go');
                void this.flash.offsetWidth;
                this.flash.classList.add('go');
                this.root.classList.remove('hide-card');
            }, 'image/png');
        });
    }
}
