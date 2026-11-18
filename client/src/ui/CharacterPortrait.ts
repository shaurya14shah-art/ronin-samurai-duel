import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Duelist } from '@ronin/combat';
import { Swordsman, loadSwordsmanAssets, type SwordsmanLook } from '../characters/Swordsman';

// A small separate render of the player's own swordsman, mirroring their live sim state
// (stance, blade drawn or at the hip, breathing, wounds of posture). Used as the top-right
// figure in play and, larger and rotatable, on the character screen.

export const PLAYER_LOOK: SwordsmanLook = { kimono: 0x2f2a24, hakama: 0x24252a, obi: 0x5a2a20, hat: true };

export class CharacterPortrait {
    readonly canvas: HTMLCanvasElement;
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera: THREE.PerspectiveCamera;
    private figure: Swordsman | null = null;
    private yaw = 0.5;
    private targetYaw = 0.5;
    private accum = 0;
    private dragging = false;
    active = true;

    constructor(host: HTMLElement, private opts: { fps: number; interactive?: boolean; framing?: 'bust' | 'full' }) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.setClearColor(0x000000, 0);
        this.canvas = this.renderer.domElement;
        host.appendChild(this.canvas);
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environmentIntensity = 0.45;
        pmrem.dispose();
        const key = new THREE.DirectionalLight(0xffe2bd, 2.4);
        key.position.set(2, 3, 2.5);
        const rim = new THREE.DirectionalLight(0x9fb3d6, 1.6);
        rim.position.set(-2.5, 2, -2);
        this.scene.add(key, rim);
        this.camera = new THREE.PerspectiveCamera(opts.framing === 'full' ? 28 : 24, 1, 0.1, 20);
        this.frame();
        if (opts.interactive) this.bindDrag();
        new ResizeObserver(() => this.resize()).observe(host);
        this.resize();
        void loadSwordsmanAssets().then(a => {
            this.figure = new Swordsman(a, PLAYER_LOOK);
            this.scene.add(this.figure);
        });
    }

    private frame(): void {
        if (this.opts.framing === 'full') {
            this.camera.position.set(0, 1.05, 5.4);
            this.camera.lookAt(0, 0.92, 0);
        } else {
            this.camera.position.set(0, 1.25, 4.6);
            this.camera.lookAt(0, 0.95, 0);
        }
    }

    private resize(): void {
        const w = this.canvas.parentElement!.clientWidth || 150;
        const h = this.canvas.parentElement!.clientHeight || 190;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    private bindDrag(): void {
        this.canvas.style.cursor = 'grab';
        this.canvas.style.pointerEvents = 'auto';
        this.canvas.addEventListener('pointerdown', e => { this.dragging = true; this.canvas.setPointerCapture(e.pointerId); this.canvas.style.cursor = 'grabbing'; });
        this.canvas.addEventListener('pointerup', () => { this.dragging = false; this.canvas.style.cursor = 'grab'; });
        this.canvas.addEventListener('pointermove', e => { if (this.dragging) this.targetYaw += e.movementX * 0.012; });
    }

    setBlade(mesh: THREE.Object3D, bladeLength: number, tsukaLength: number): void {
        this.figure?.setBlade(mesh, bladeLength, tsukaLength);
    }

    /** Mirror the player's state. The figure stands at the origin facing the camera, turned a little. */
    update(d: Duelist, dt: number): void {
        if (!this.active || !this.figure) return;
        this.accum += dt;
        if (this.accum < 1 / this.opts.fps) return;
        const step = this.accum;
        this.accum = 0;
        if (!this.opts.interactive && !this.dragging) this.targetYaw = 0.45;
        this.yaw += (this.targetYaw - this.yaw) * Math.min(1, step * 8);
        // Show the stance and state, not the travel: the figure stays in place.
        const local: Duelist = { ...d, pos: { x: 0, z: 0 }, facing: this.yaw, vel: { x: 0, z: 0 } };
        this.figure.sync(local, 0, step);
        this.renderer.render(this.scene, this.camera);
    }

    dispose(): void {
        this.active = false;
        this.renderer.dispose();
        this.canvas.remove();
    }
}
