import * as THREE from 'three';
import '../index.css';
import '../ui/theme.css';
import { WorldScene } from '../world/WorldScene';
import { InputSystem } from './InputSystem';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { PhotoMode } from '../ui/PhotoMode';
import { MapScreen } from '../ui/MapScreen';
import { MultiplayerScreen } from '../ui/MultiplayerScreen';
import { MangaGradeShader } from '../world/manga-grade';
import { uiState } from '../ui/UIState';
import { settings } from '../ui/Settings';
import { TitleScreen, PauseScreen, DeathScreen } from '../ui/Screens';
import { CharacterScreen } from '../ui/CharacterScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import { FrameBench, showBench } from './FrameBench';
import { CharacterPortrait } from '../ui/CharacterPortrait';

class Game {
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 900);
    private world: WorldScene;
    private input = InputSystem.getInstance();
    private clock = new THREE.Clock();
    private composer!: EffectComposer;
    private grade!: ShaderPass;
    private flash = 0;
    private title: TitleScreen;
    private pause: PauseScreen;
    private death: DeathScreen;
    private character: CharacterScreen;
    private settingsScreen: SettingsScreen;
    private portrait: CharacterPortrait | null = null;
    /** Which screen to go back to when a sub-screen (character, settings) closes. */
    private returnTo: 'title' | 'pause' = 'title';
    private playing = false;
    private bokeh!: BokehPass;
    private photo!: PhotoMode;
    private map!: MapScreen;
    private multiplayer!: MultiplayerScreen;

    constructor() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.7;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.domElement.id = 'game-canvas';
        document.body.appendChild(this.renderer.domElement);
        this.scene.background = new THREE.Color(0x0b1017);
        this.input.init(this.renderer.domElement, this.camera, this.scene);
        this.world = new WorldScene(this.scene, this.camera, this.renderer);

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        // The sky's sun disc and specular glints exceed half-float range; bloom would smear
        // those infinities into NaN across the frame. Clamp HDR to a generous, finite ceiling.
        this.composer.addPass(new ShaderPass({
            uniforms: { tDiffuse: { value: null } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; c = clamp(c, 0.0, 24.0); if (c != c) c = vec3(0.0); gl_FragColor = vec4(c, 1.0); }',
        }));
        this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)), 0.22, 0.6, 2.2));
        this.grade = new ShaderPass(MangaGradeShader);
        this.composer.addPass(this.grade);
        this.bokeh = new BokehPass(this.scene, this.camera, { focus: 6, aperture: 0.004, maxblur: 0.012 });
        this.bokeh.enabled = false;
        this.composer.addPass(this.bokeh);
        this.composer.addPass(new OutputPass());

        // Graphics settings act on the renderer directly.
        settings.watch('renderScale', v => {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * v);
            this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * v);
        });
        settings.watch('shadows', v => {
            this.renderer.shadowMap.enabled = v;
            this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
        });

        window.addEventListener('combat-feedback', (e: Event) => {
            const kind = (e as CustomEvent).detail?.kind;
            if (kind === 'parry' || kind === 'clash') this.flash = 0.55;
            else if (kind === 'damage') this.flash = 0.3;
        });

        this.title = new TitleScreen([
            { label: 'Continue', action: () => this.begin(), hidden: () => !this.world.hasSavedJourney },
            { label: 'Begin the road', action: () => this.begin(), hidden: () => this.world.hasSavedJourney },
            { label: 'New journey', action: () => { this.world.newJourney(); this.begin(); }, hidden: () => !this.world.hasSavedJourney },
            { label: 'Multiplayer', action: () => this.openSub('multiplayer', 'title') },
            { label: 'Character', action: () => this.openSub('character', 'title') },
            { label: 'Settings', action: () => this.openSub('settings', 'title') },
        ]);
        this.pause = new PauseScreen([
            { label: 'Resume', action: () => this.resume() },
            { label: 'Map', action: () => this.openSub('map', 'pause') },
            { label: 'Multiplayer', action: () => this.openSub('multiplayer', 'pause'), hidden: () => this.world.online },
            { label: 'Leave the online duel', action: () => { this.world.leaveOnline(); this.resume(); }, hidden: () => !this.world.online },
            { label: 'Character', action: () => this.openSub('character', 'pause') },
            { label: 'Settings', action: () => this.openSub('settings', 'pause') },
            { label: 'Photo mode', action: () => { this.pause.close(); this.openPhoto(); } },
            { label: 'Return to title', action: () => this.toTitle() },
        ]);
        this.death = new DeathScreen([
            { label: 'Rise again', action: () => { this.death.close(); this.world.respawn(); this.resume(); } },
            { label: 'Return to title', action: () => { this.death.close(); this.world.respawn(); this.toTitle(); } },
        ]);
        this.world.onDeath = rival => { this.playing = false; this.death.show(rival); };

        const director = () => this.world.getDirector();
        this.character = new CharacterScreen({
            player: () => director().player,
            weapons: () => this.world.getInventory().getWeapons(),
            activeWeapon: () => this.world.getInventory().getActiveIndex(),
            equip: i => this.world.getInventory().equipWeapon(i),
            rivals: () => director().rivalRecords(),
            journal: () => this.world.journal.entries(),
            way: () => this.world.way,
            train: id => this.world.train(id),
        });
        this.character.onClose = () => this.closeSub();
        this.settingsScreen = new SettingsScreen();
        this.settingsScreen.onClose = () => this.closeSub();
        this.title.open();
        this.photo = new PhotoMode(this.world, this.camera, this.renderer, this.bokeh);
        this.photo.onClose = () => this.resume();
        this.map = new MapScreen(this.world.mapSource());
        this.map.onClose = () => this.closeSub();
        this.multiplayer = new MultiplayerScreen();
        this.multiplayer.onClose = () => this.closeSub();
        this.multiplayer.onTrain = () => {
            this.multiplayer.close();
            if (this.world.titleMode) this.begin(); else this.resume();
        };
        this.multiplayer.onEnter = net => {
            this.multiplayer.close();
            if (this.world.titleMode) { this.title.close(); this.world.beginPlay(); this.world.startAudio(); }
            this.pause.close();
            this.world.enterOnline(net);
            this.resume();
        };

        window.addEventListener('keydown', e => this.onKey(e));
        this.input.on('pointerlockchange', (locked: boolean) => {
            // Losing the pointer mid-play (Esc, alt-tab) is a pause.
            if (!locked && this.playing && !uiState.blocking) this.openPause();
        });
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });
        void this.load();
        (window as any).__RONIN_DEBUG__ = { scene: this.world, game: this };
    }

    private onKey(e: KeyboardEvent): void {
        if (uiState.has('forge')) {
            if (e.code === 'Escape') this.world.leaveForge();
            return;
        }
        if (e.code === 'Escape') {
            if (this.character.isOpen || this.settingsScreen.isOpen || this.map.isOpen || this.multiplayer.isOpen) { this.closeSub(); return; }
            if (this.pause.isOpen) { this.resume(); return; }
            if (this.playing) this.openPause();
            return;
        }
        if (this.photo.isOpen) return;
        if (this.playing && !uiState.blocking && e.code === 'KeyP') {
            e.preventDefault();
            this.openPhoto();
            return;
        }
        if (this.playing && !uiState.blocking && e.code === 'KeyM') {
            e.preventDefault();
            this.input.exitPointerLock();
            this.playing = false;
            this.openSub('map', 'pause', false);
            return;
        }
        if (this.map.isOpen && e.code === 'KeyM') { this.closeSub(); return; }
        if (this.playing && !uiState.blocking && (e.code === 'Tab' || e.code === 'KeyI')) {
            e.preventDefault();
            this.input.exitPointerLock();
            this.playing = false;
            this.openSub('character', 'pause', false);
        }
    }

    private openPhoto(): void {
        this.playing = false;
        this.input.exitPointerLock();
        this.photo.open();
    }

    /** Render immediately (photo capture reads the canvas in the same task). */
    renderFrameNow(): void {
        try { this.composer.render(); } catch { this.renderer.render(this.scene, this.camera); }
    }

    private begin(): void {
        this.title.close();
        this.world.beginPlay();
        this.world.startAudio();
        this.resume();
    }

    private resume(): void {
        this.pause.close();
        this.playing = true;
        this.input.requestPointerLock();
    }

    private openPause(): void {
        this.playing = false;
        this.input.exitPointerLock();
        this.pause.open();
    }

    private toTitle(): void {
        if (this.world.online) this.world.leaveOnline();
        this.pause.close();
        this.playing = false;
        this.input.exitPointerLock();
        this.world.enterTitle();
        this.title.open();
        this.title.ready();
    }

    private openSub(which: 'character' | 'settings' | 'map' | 'multiplayer', from: 'title' | 'pause', closeFrom = true): void {
        this.returnTo = from;
        if (closeFrom) (from === 'title' ? this.title : this.pause).close();
        ({ character: this.character, settings: this.settingsScreen, map: this.map, multiplayer: this.multiplayer })[which].open();
    }

    private closeSub(): void {
        if (this.character.isOpen) this.character.close();
        if (this.settingsScreen.isOpen) this.settingsScreen.close();
        if (this.map.isOpen) this.map.close();
        if (this.multiplayer.isOpen) this.multiplayer.close();
        if (this.returnTo === 'title') { this.title.open(); this.title.ready(); } else this.pause.open();
    }

    private async load(): Promise<void> {
        try {
            await this.world.init();
            this.portrait = new CharacterPortrait(document.getElementById('hud-portrait')!, { fps: 24 });
            this.title.ready();
            if (new URLSearchParams(location.search).has('bench')) this.startBench();
            this.renderer.setAnimationLoop(() => {
                const t0 = performance.now();
                this.bench?.begin(t0);
                this.frame();
                this.bench?.end(performance.now() - t0);
            });
        } catch (error) {
            console.error(error);
            this.title.failed('The world could not load. Reload the page and check that WebGL is enabled.');
        }
    }

    private bench: FrameBench | null = null;

    /** `?bench`: walk the five benchmark places and record the real loop (docs/PERFORMANCE.md). */
    private startBench(): void {
        this.begin();
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        const ctl = this.world.getController();
        this.bench = new FrameBench(gl, spot => {
            ctl.object.position.set(spot.x, ctl.object.position.y, spot.z);
            (ctl as unknown as { yaw: number }).yaw = spot.yaw;
            ctl.object.rotation.y = spot.yaw;
        }, rows => {
            const gpu = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
            (window as unknown as { __RONIN_BENCH__: unknown }).__RONIN_BENCH__ = { rows, gpu, dpr: window.devicePixelRatio, ua: navigator.userAgent };
            console.table(rows.map(r => ({ place: r.name, frame: r.interval.median, frame95: r.interval.p95, cpu: r.cpu.median, gpu: r.gpu?.median ?? null })));
            showBench(rows, gpu);
        });
    }

    private frame(): void {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.input.update(dt);
        this.world.handleInput(this.input);
        // Menus freeze the world; the title and the forge keep it alive behind them.
        const frozen = uiState.blocking && !uiState.has('title') && !uiState.has('forge') && !uiState.has('photo');
        this.photo.update(dt);
        this.world.update(frozen ? 0 : dt);
        this.character.update(dt);
        this.map.update();
        if (this.portrait && this.playing) this.portrait.update(this.world.getDirector().player, dt);
        this.input.postUpdate();

        this.flash = Math.max(0, this.flash - dt * 2.8);
        const u = this.grade.uniforms;
        u.uTime.value = this.clock.getElapsedTime();
        u.uFlash.value = this.flash;
        const hp = this.world.getPlayerHpRatio();
        u.uDamage.value = Math.max(0, (1 - hp) * 0.4);
        u.uSat.value = 0.97 - (1 - hp) * 0.25;
        try { this.composer.render(); } catch { this.renderer.render(this.scene, this.camera); }
    }
}

try {
    new Game();
} catch (error) {
    console.error(error);
    const message = document.createElement('div');
    message.style.cssText = 'padding:48px;color:#e3d5ba;font:20px Georgia;';
    message.textContent = 'RŌNIN needs WebGL 2. Enable hardware acceleration in your browser, then reload.';
    document.body.appendChild(message);
}
