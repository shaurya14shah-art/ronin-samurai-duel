import * as THREE from 'three';
import { FirstPersonController } from '../player/FirstPersonController';
import { InputSystem } from '../core/InputSystem';
import { EnvironmentManager } from './EnvironmentManager';
import { InteractableForge } from './InteractableForge';
import { PlayerStats } from '../player/PlayerStats';
import { Hud, type Objective, type Prompt } from '../ui/Hud';
import { Swordsman } from '../characters/Swordsman';
import { PLAYER_LOOK } from '../ui/CharacterPortrait';
import { DuelDirector } from '../duel/DuelDirector';
import { LANDMARKS } from './Landmarks';
import { ROUTES } from './Structures';
import type { MapSource } from '../ui/MapScreen';
import { formatRecord, type NetDuel } from '../net/NetDuel';
import { Journal } from './Journal';
import { NODES, earnOnline, earnWin, learn as learnWay, recordUse, toTraining, type WayNode, type WayState } from '../progression/Way';
import { rememberRecord } from '../ui/MultiplayerScreen';
import { loadSwordsmanAssets } from '../characters/Swordsman';
import type { PersonalityName } from '@ronin/combat';
import { Terrain } from './Terrain';
import { Structures } from './Structures';
import { Atmosphere, type Weather } from './Atmosphere';
import { InventorySystem } from '../inventory/InventorySystem';
import { ForgeSession } from '../forge/ForgeSession';
import { Smithy } from './Smithy';
import { uiState } from '../ui/UIState';
import { settings } from '../ui/Settings';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

import { Soundscape } from '../audio/Soundscape';
import { soundEngine } from '../audio/SoundEngine';
import { freshJourney, loadJourney, storeJourney, restoreResources, JOURNEY_KEY, type JourneyState, type RivalId } from './JourneySave';
import { groundMaterial, plantCedars, isMeadow, GrassField, MountainRange, loadRocks, placeRocks } from './Nature';
import { bambooClumps, plantBamboo } from './Bamboo';
import { architecturePalette, batchStatic, building, stoneLantern, timber, torii, setArchitectureNight } from './Architecture';


type Chunk = { root: THREE.Group; colliders: { x: number; z: number; radius: number }[] };
type Outcome = 'death';
/** Late afternoon: long warm light for the title screen. */
const TITLE_HOUR = 0.742;
/** Exposure for the tone-mapped pipeline (OutputPass applies ACES). */
const EXPOSURE = 0.7;

export class WorldScene {
    private firstPersonController: FirstPersonController;
    private environmentManager: EnvironmentManager;
    private interactableForge: InteractableForge;
    private director: DuelDirector;
    private playerStats: PlayerStats;
    private hud!: Hud;
    /** Set by the UI layer: the player fell (name of the rival who stood, if any). */
    public onDeath?: (rival: string | null) => void;
    /** What happened on the road, written as it happens. */
    public readonly journal = new Journal();
    /** While on the title screen the world runs but nobody plays it. */
    public titleMode = true;
    private titleFigure?: Swordsman;
    private titleTime = 0;
    private heldTime: number | null = null;
    private photoMode = false;
    private groveTrees: { x: number; z: number }[] = [];
    private discovered = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('ronin.discovered.v1') ?? '[]'); } catch { return []; } })());
    private heldWeather: Weather | null = null;
    private titleAssets?: Awaited<ReturnType<typeof loadSwordsmanAssets>>;
    private lastPlace = '';
    private inventorySystem: InventorySystem;
    private journey = loadJourney() ?? freshJourney();
    private savedJourney = loadJourney() !== null;
    private totalWorldTime = 0;
    private saveTimer = 0;
    private restoring = false;
    private soundscape = new Soundscape();
    private audioVolume = 0.8;
    private stepDistance = 0;
    private previousPlayer = new THREE.Vector3();
    private peacefulPosition = new THREE.Vector3();

    private isPlaying(): boolean {
        return this.isInitialized && !this.forgeOpen && !this.outcome && this.playerStats.currentHp > 0;
    }
    private forgeOpen = false;
    private outcome: Outcome | null = null;
    private pointerTarget: HTMLElement | null = null;
    private isInitialized = false;
    private lastStatus = '';
    private grass?: GrassField;
    private mountains?: MountainRange;
    private ground?: THREE.MeshStandardMaterial;
    private sky?: Sky;
    private smithy = new Smithy();
    private forgeSession?: ForgeSession;
    private rocks?: THREE.Object3D[];
    private terrain = new Terrain(20260917);
    private terrainChunks = new Map<string, Chunk>();
    private chunkTimer = 0;
    private structures?: Structures;
    private atmosphere?: Atmosphere;

    constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private renderer?: THREE.WebGLRenderer) {
        this.environmentManager = new EnvironmentManager(scene);
        this.playerStats = new PlayerStats();
        this.firstPersonController = this.createPlayerController();
        window.addEventListener('keydown', this.onWorldKeyDown, true);

        const input = InputSystem.getInstance();
        this.director = new DuelDirector(scene, camera, () => this.firstPersonController, this.playerStats, (x, z) => this.groundAt(x, z), input);
        this.hud = new Hud({
            player: () => this.director.player,
            rival: () => this.director.nearestRival(),
            objective: () => this.objective(),
            prompts: () => this.prompts(),
        });
        settings.watch('mouseSensitivity', v => { this.firstPersonController.mouseSensitivity = 0.002 * v; });
        const shake = () => { this.firstPersonController.shakeScale = settings.get('reducedMotion') ? 0 : settings.get('screenShake'); };
        settings.watch('screenShake', shake);
        settings.watch('reducedMotion', shake);
        settings.watch('masterVolume', v => this.setAudioVolume(v));
        this.director.onRivalFalls = name => {
            // Aftermath: silence first, then a quiet line. No banner, no numbers.
            uiState.cinematic(4.5);
            window.setTimeout(() => this.hud.showReveal('Duel complete', `${name} does not rise.`, '', 3.2), 1500);
            this.journal.add('duel', `${name} did not rise. You walked on.`);
            // Insight: what the duel taught. A first victory over a rival teaches the most.
            const site = LANDMARKS.find(l => l.rivalName === name);
            if (site) {
                const r = earnWin(this.journey.way, site.id);
                this.journey.way = r.state;
                this.journal.add('duel', `Learned from the duel with ${name}: ${r.gained} insight to spend on training.`);
                this.saveJourney();
            }
        };
        this.director.trainingFor = () => toTraining(this.journey.way);
        this.director.onTechniqueLanded = t => { this.journey.way = recordUse(this.journey.way, t); this.director.applyTraining(); };
        this.director.onEngage = (name, title) => {
            uiState.cinematic(3.2);
            this.hud.showReveal(name, title, 'A swordsman waits', 3);
            const site = LANDMARKS.find(l => l.rivalName === name);
            this.journal.add('rival', `${name}, ${title.toLowerCase()}, stood in the road${site ? ` at ${site.name}` : ''}.`);
        };
        input.on('pointerlockchange', locked => {
            if (locked && (this.forgeOpen || this.outcome)) {
                input.exitPointerLock();
                return;
            }
            if (locked) {
                this.pointerTarget = document.pointerLockElement as HTMLElement;
                this.lastStatus = '';
                    }
        });

        this.inventorySystem = new InventorySystem();
        this.inventorySystem.setCallbacks(() => {}, weapon => { if (weapon) this.director.equipWeapon(weapon); });
        for (const weapon of this.journey.weapons) this.inventorySystem.addWeapon(weapon);
        this.inventorySystem.equipWeapon(this.journey.activeIndex);

        restoreResources(this.playerStats, this.journey);
        this.director.applyTraining();
        this.interactableForge = new InteractableForge(() => this.openForge());
        this.interactableForge.getMesh().position.set(0, 0, 0);
        (window as any).__worldScene = this;
        window.addEventListener('pagehide', () => { this.saveJourney(); this.soundscape.setMuted(true); });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { this.saveJourney(); this.soundscape.setMuted(true); }
        });
        document.addEventListener('pointerlockchange', () => this.soundscape.setMuted(!this.isPlaying()));
        window.addEventListener('bell-rung', () => { if (this.isPlaying()) this.soundscape.templeBell(); });
        window.addEventListener('combat-feedback', event => {
            if (!this.isPlaying()) return;
            const kind = (event as CustomEvent<{ kind: string }>).detail?.kind;
            if (kind === 'parry' || kind === 'clash') {
                this.soundscape.parryClash(0.85);
                soundEngine.playParryClash(1.0, 85);
            } else if (kind === 'block') {
                this.soundscape.blockClank(0.7);
                soundEngine.playBlock();
            } else if (kind === 'hit' || kind === 'damage') {
                this.soundscape.hitFlesh(kind === 'damage' ? 0.85 : 0.6);
                soundEngine.playSlashHit(kind === 'damage');
            }
        });
        window.addEventListener('sword-state', event => {
            if (!this.isPlaying()) return;
            const state = (event as CustomEvent<{ state: string }>).detail?.state;
            if (state === 'drawing') {
                this.soundscape.drawSword();
                soundEngine.playDraw();
            } else if (state === 'sheathing') {
                this.soundscape.sheathSword();
            }
        });
        window.addEventListener('combat-swing', event => {
            if (!this.isPlaying()) return;
            const heavy = (event as CustomEvent<{ heavy: boolean }>).detail?.heavy;
            this.soundscape.swingWhoosh(heavy ? 1 : 0.6);
            soundEngine.playSwing(heavy ? 0.85 : 0.6, heavy ? 320 : 220);
        });
    }

    private createPlayerController(): FirstPersonController {
        const controller = new FirstPersonController(this.camera);
        controller.stats = this.playerStats;
        controller.playerHeight = 1.7;
        controller.bobAmount = 0.035;
        controller.groundSample = (x, z) => this.groundAt(x, z);
        controller.object.position.set(0, controller.playerHeight, 8);
        controller.mouseSensitivity = 0.002 * settings.get('mouseSensitivity');
        controller.shakeScale = settings.get('reducedMotion') ? 0 : settings.get('screenShake');
        this.camera.rotation.set(0, 0, 0, 'YXZ');
        return controller;
    }

    private buildChunk(cx: number, cz: number): Chunk {
        const root = new THREE.Group();
        this.ground ??= groundMaterial();
        const mesh = new THREE.Mesh(this.terrain.buildGeometry(cx, cz), this.ground);
        mesh.position.set(cx * this.terrain.chunkSize, 0, cz * this.terrain.chunkSize);
        mesh.receiveShadow = true;
        mesh.userData.sharedMaterial = true;
        root.add(mesh);
        // Cedars are far larger than the old cones; every other site keeps the forest open.
        const props = this.terrain.vegetation(cx, cz).filter((p, i) => i % 2 === 0 && !isMeadow(p.x, p.z));
        if (props.length) {
            const cedars = plantCedars(props.map(p => ({ x: p.x, z: p.z, y: this.terrain.sampleHeight(p.x, p.z), height: p.height })));
            cedars.traverse(o => { o.userData.shared = true; });
            root.add(cedars);
        }
        if (this.rocks) root.add(placeRocks(this.rocks, cx, cz, this.terrain.chunkSize, (x, z) => this.terrain.sampleHeight(x, z), (x, z) => this.openGround(x, z)).translateY(0));
        root.traverse(o => { if (o !== mesh && !(o as THREE.InstancedMesh).isInstancedMesh) o.userData.shared = true; });
        return { root, colliders: props };
    }

    /** The courtyard's boundary stones, as photoscanned rocks once they have loaded. */
    private replaceRingStones(models: THREE.Object3D[]): void {
        const old = this.scene.getObjectByName('ring-stones');
        if (old) this.scene.remove(old);
        const small = models.filter(m => m.userData.size < 4);
        const pool = small.length ? small : models;
        for (let i = 0; i < 40; i++) {
            const angle = i * Math.PI * 2 / 40 + Math.sin(i * 7.3) * 0.04;
            const radius = 10.9 + Math.sin(i * 3.1) * 0.25;
            const src = pool[i % pool.length];
            const rock = src.clone();
            const size = (0.45 + ((i * 7) % 5) * 0.08) / Math.max(0.3, src.userData.size);
            rock.scale.setScalar(size);
            rock.rotation.set(0, i * 1.7, 0);
            const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
            rock.position.set(x, this.terrain.sampleHeight(x, z) - src.userData.bottom * size - 0.04, z);
            this.scene.add(rock);
        }
    }

    /** Ground free for rocks and grass: not the courtyard, not a landmark's footprint. */
    private openGround(x: number, z: number): boolean {
        if (Math.hypot(x, z) < 15) return false;
        return !LANDMARKS.some(l => Math.hypot(x - l.x, z - l.z) < 12);
    }

    private unloadChunk(chunk: Chunk): void {
        this.scene.remove(chunk.root);
        chunk.root.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            // Cedar templates, rock models and the ground material are shared between chunks.
            if (object instanceof THREE.InstancedMesh) { object.dispose(); return; }
            if (object.userData.shared) return;
            object.geometry.dispose();
            if (!object.userData.sharedMaterial) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        });
        chunk.colliders.length = 0;
        chunk.root.clear();
    }

    private updateTerrain(initial = false): void {
        const player = this.firstPersonController.object.position;
        // Optimized 3x3 chunk radius (9 chunks instead of 25) to eliminate lag and foliage draw calls
        const ordered = this.terrain.wantedChunks(player.x, player.z, 1);
        const wanted = new Set(ordered.map(([x, z]) => `${x},${z}`));
        for (const [key, chunk] of this.terrainChunks) {
            if (!wanted.has(key)) {
                this.unloadChunk(chunk);
                this.terrainChunks.delete(key);
            }
        }
        let budget = initial ? 9 : 2;
        const cx = Math.floor(player.x / this.terrain.chunkSize + 0.5), cz = Math.floor(player.z / this.terrain.chunkSize + 0.5);
        for (const [x, z] of ordered) {
            const key = `${x},${z}`;
            if (this.terrainChunks.has(key)) continue;
            const near = Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1;
            if (!near && budget <= 0) continue;
            const chunk = this.buildChunk(x, z);
            this.terrainChunks.set(key, chunk);
            this.scene.add(chunk.root);
            budget--;
        }
    }

    private resolveProps(): void {
        const player = this.firstPersonController.object.position;
        for (const prop of this.staticColliders) {
            const dx = player.x - prop.x, dz = player.z - prop.z;
            const distance = Math.hypot(dx, dz), radius = prop.radius + 0.3;
            if (distance >= radius) continue;
            player.x = prop.x + (distance > 0.0001 ? dx / distance : 1) * radius;
            player.z = prop.z + (distance > 0.0001 ? dz / distance : 0) * radius;
        }
        for (const chunk of this.terrainChunks.values()) {
            for (const prop of chunk.colliders) {
                const dx = player.x - prop.x, dz = player.z - prop.z;
                const distance = Math.hypot(dx, dz), radius = prop.radius * 1.25 + 0.3;
                if (distance >= radius) continue;
                player.x = prop.x + (distance > 0.0001 ? dx / distance : 1) * radius;
                player.z = prop.z + (distance > 0.0001 ? dz / distance : 0) * radius;
            }
        }
    }

    private isNearForge(): boolean {
        const player = this.firstPersonController.object.position;
        const forge = this.interactableForge.getMesh().position;
        return Math.hypot(player.x - forge.x, player.z - forge.z) <= 3;
    }

    private onWorldKeyDown = (event: KeyboardEvent): void => {
        if (this.outcome) return;
        if (!this.isInitialized || this.forgeOpen) return;
        const input = InputSystem.getInstance();
        if (event.code === 'KeyE' && this.isNearForge()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) this.openForge();
        } else if (event.key === 'Alt' && !event.repeat && input.isPointerLocked) {
            event.preventDefault();
            input.exitPointerLock();
        }
    };

    private openForge(): void {
        if (!this.isInitialized || this.forgeOpen || this.outcome || this.playerStats.currentHp <= 0) return;
        if (!this.isNearForge() || !this.forgeSession) return;
        this.forgeOpen = true;
        this.pointerTarget = document.pointerLockElement as HTMLElement | null;
        this.director.setIntentEnabled(false);
        this.director.sword.weapon.mesh.visible = false;
        this.forgeSession.open();
        InputSystem.getInstance().exitPointerLock();
    }

    /** Photo mode: freeze play and stand the player's own figure where they are. */
    public setPhotoMode(on: boolean): void {
        this.photoMode = on;
        this.director.sword.weapon.mesh.visible = !on;
        if (this.titleFigure) this.titleFigure.visible = on;
        if (on) this.syncPlayerFigure(0);
    }

    public get photoActive(): boolean { return this.photoMode; }

    private syncPlayerFigure(dt: number): void {
        if (!this.titleFigure && this.titleAssets) {
            this.titleFigure = new Swordsman(this.titleAssets, PLAYER_LOOK);
            this.scene.add(this.titleFigure);
        }
        if (!this.titleFigure) return;
        const d = this.director.player;
        this.titleFigure.visible = true;
        this.titleFigure.sync({ ...d, vel: { x: 0, z: 0 } }, this.terrain.sampleHeight(d.pos.x, d.pos.z), dt);
    }

    public getAtmosphere(): Atmosphere | undefined {
        return this.atmosphere;
    }

    /** Join a server-judged duel: the ring in the courtyard, the server's rules. */
    public enterOnline(net: NetDuel): void {
        if (!this.titleAssets) return;
        this.director.enterNet(net, this.titleAssets);
        this.director.setIntentEnabled(true);
        this.director.sword.weapon.mesh.visible = true;
        net.onResult = r => {
            rememberRecord(net.records[net.you]);
            const youWon = r.winner === net.you;
            const other = net.names[net.opponentId ?? ''] ?? 'your opponent';
            this.journal.add('online', `${youWon ? 'Won' : 'Lost'} round ${r.round} of an online duel against ${other}.`);
            if (youWon) { this.journey.way = earnOnline(this.journey.way); this.saveJourney(); }
            uiState.cinematic(4);
            window.setTimeout(() => this.hud.showReveal(youWon ? 'Duel complete' : 'You fall', youWon ? `${other} does not rise.` : `${other} stands. The next round begins.`, `Round ${r.round}`, 3), 1200);
        };
        net.onJoined = (_id, name) => this.hud.showReveal(name, 'enters the ring', 'An online duel', 3);
        net.onLeft = () => this.hud.showReveal('Alone', 'Your opponent has left the ring.', '', 3);
        net.onConnection = c => {
            if (c === 'lost') this.hud.showReveal('Connection lost', 'The server could not be reached again. Leave the duel from the pause menu.', '', 5);
        };
    }

    public leaveOnline(): void {
        this.director.leaveNet();
    }

    public get online(): boolean {
        return !!this.director.online;
    }

    public leaveForge(): void {
        this.forgeSession?.close();
    }

    private closeForge(): void {
        this.forgeOpen = false;
        this.director.setIntentEnabled(true);
        this.director.sword.weapon.mesh.visible = true;
        this.resumePointerLock();
    }


    private resumePointerLock(): void {
        try {
            const result = this.pointerTarget?.requestPointerLock();
            if (result) result.catch(() => this.notify('Paused · click Resume to return to the courtyard.'));
        } catch {
            this.notify('Paused · click Resume to return to the courtyard.');
        }
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;
        await this.environmentManager.init();
        this.buildVagabondAtmosphere();
        this.buildCourtyard();
        this.buildGrove();
        this.buildGrass();
        if (this.renderer) {
            // Image-based light so steel, lacquer and wet stone have something to reflect.
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            pmrem.dispose();
        }
        this.structures = new Structures(this.scene, this.terrain);
        this.structures.build();
        this.staticColliders.push(...this.structures.colliders);
        this.atmosphere = new Atmosphere(this.scene, this.renderer, this.camera, this.terrain);
        this.atmosphere.setTimeOfDay(this.journey.time);
        if (this.renderer) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            // The shadow pass is the costliest part of a frame (docs/PERFORMANCE.md); it is
            // refreshed every other frame (30 Hz), see update().
            this.renderer.shadowMap.autoUpdate = false;
            this.renderer.shadowMap.needsUpdate = true;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = EXPOSURE;
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
        for (const x of [-5, 5]) this.director.addDummy(x, -5);
        try { this.rocks = await loadRocks(); } catch (e) { console.warn('rocks unavailable', e); }
        await this.smithy.load();
        this.scene.add(this.smithy.root);
        this.interactableForge.getMesh().visible = false;
        this.forgeSession = new ForgeSession(this.scene, this.camera, this.smithy, forged => {
            const weapon = this.inventorySystem.addForgedWeapon(forged);
            this.journal.add('forge', `Forged a blade at the courtyard: ${weapon.name}.`);
            this.inventorySystem.equipWeapon(this.inventorySystem.getWeapons().indexOf(weapon));
            this.saveJourney();
        }, () => this.closeForge());
        if (this.rocks) this.replaceRingStones(this.rocks);
        this.updateTerrain(true);
        this.director.setWorldTime(this.totalWorldTime);
        const swordsmen = await loadSwordsmanAssets();
        this.titleAssets = swordsmen;
        for (const landmark of LANDMARKS) this.director.addRival(landmark, this.journey.rivals[landmark.id], swordsmen);
        this.scene.add(this.interactableForge.getMesh(), this.camera);
        this.applySavedLighting();
        this.isInitialized = true;
    }

    private applySavedLighting(): void {
        if (!this.atmosphere || !this.renderer) return;
        this.atmosphere.update(0, this.firstPersonController.object.position);
        const sun = this.atmosphere.getSunState(), moon = this.atmosphere.getMoonState();
        const light = moon.intensity > sun.intensity ? moon : sun;
        this.environmentManager.applyExternalLighting(light.color, light.intensity, light.position, this.atmosphere.getNightFactor(), this.firstPersonController.object.position);
        const fog = this.atmosphere.getFogState();
        this.environmentManager.applyExternalFog(fog.color, fog.density, fog.background);
        this.renderer.render(this.scene, this.camera);
    }

    public getPlayerHpRatio(): number {
        return Math.max(0, Math.min(1, this.playerStats.currentHp / this.playerStats.maxHp));
    }

    /** Physically based sky (Preetham) lit by the atmosphere's sun; scaled inside the far plane. */
    private buildVagabondAtmosphere(): void {
        this.sky = new Sky();
        this.sky.scale.setScalar(800);
        const u = this.sky.material.uniforms;
        u.turbidity.value = 10;
        u.rayleigh.value = 1.2;
        u.mieCoefficient.value = 0.007;
        u.mieDirectionalG.value = 0.88;
        this.sky.renderOrder = -40;
        this.scene.add(this.sky);
    }

    /** Where feet rest: the terrain, or a built surface above it (the bridge deck). */
    private groundAt(x: number, z: number): number {
        const t = this.terrain.sampleHeight(x, z);
        const built = this.structures?.walkHeight(x, z) ?? null;
        return built !== null ? Math.max(t, built) : t;
    }

    /** The player's training, for the Way screen. */
    public get way(): WayState { return this.journey.way; }

    /** Spend insight on training. Returns null on success or the reason it cannot be done. */
    public train(id: WayNode['id']): string | null {
        const r = learnWay(this.journey.way, id);
        if (typeof r === 'string') return r;
        this.journey.way = r;
        this.director.applyTraining();
        const node = NODES.find(n => n.id === id)!;
        this.journal.add('train', node.kind === 'technique' ? `Learned ${node.name}${node.jp ? ` (${node.jp})` : ''}.` : `Trained ${node.name.toLowerCase()} to rank ${r.ranks[id as keyof WayState['ranks']]}.`);
        this.saveJourney();
        return null;
    }

    /** Colliders that never unload (courtyard, shrine, hamlet), in world space. */
    private staticColliders: { x: number; z: number; radius: number }[] = [];

    private addColliders(list: { x: number; z: number; radius: number }[], frame: THREE.Object3D): void {
        frame.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        for (const c of list) {
            v.set(c.x, 0, c.z).applyMatrix4(frame.matrixWorld);
            this.staticColliders.push({ x: v.x, z: v.z, radius: c.radius });
        }
    }

    private buildCourtyard(): void {
        const sand = new THREE.MeshStandardMaterial({ color: 0xb79a70, roughness: 1 });
        const stone = new THREE.MeshStandardMaterial({ color: 0x847a64, roughness: 1 });
        const box = new THREE.BoxGeometry(1, 1, 1);
        const beam = (material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
            const mesh = new THREE.Mesh(box, material);
            mesh.position.set(x, y, z);
            mesh.scale.set(sx, sy, sz);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            return mesh;
        };
        const clearing = new THREE.Mesh(new THREE.CircleGeometry(11.8, 48), sand);
        clearing.rotation.x = -Math.PI / 2;
        clearing.position.y = 0.015;
        clearing.receiveShadow = true;
        this.scene.add(clearing);
        const arena = new THREE.Mesh(new THREE.CircleGeometry(7, 40), sand);
        arena.rotation.x = -Math.PI / 2;
        arena.position.set(0, 0.04, -20);
        arena.receiveShadow = true;
        this.scene.add(arena);

        // The gate onto the mountain road.
        // Built pieces of the courtyard, merged into a few draw calls once placed.
        const built = new THREE.Group();
        this.scene.add(built);
        const gate = torii(6, 5.4);
        gate.group.position.set(0, 0, -12);
        built.add(gate.group);
        this.addColliders(gate.colliders, gate.group);

        // The forge shelter: open on every side, a tiled roof whose ridge runs north–south.
        const shelter = building({
            width: 5, depth: 7, baysX: 2, baysZ: 2, floor: 0, wall: 3.4,
            front: 'open', back: 'open', left: 'open', right: 'open', roof: 'tile', veranda: 0, overhang: 0.9,
        });
        shelter.group.rotation.y = Math.PI / 2;
        built.add(shelter.group);
        this.addColliders(shelter.colliders, shelter.group);
        // The hearth's raised stone base; Smithy lays the coals, fire and tools.
        this.scene.add(timber(architecturePalette().stone, 1.2, 0.6, 1.2, 2.5, 0.3, -1.4));
        this.scene.add(new THREE.HemisphereLight(0xffd5a1, 0x725038, 2.2));

        for (const z of [-8, -3, 5]) {
            for (const x of [-3.9, 3.9]) {
                const lantern = stoneLantern(1.75);
                lantern.position.set(x, 0, z);
                lantern.rotation.y = x * 0.3 + z;
                built.add(lantern);
                this.staticColliders.push({ x, z, radius: 0.3 });
            }
        }
        batchStatic(built);

        const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stone, 64);
        stones.name = 'ring-stones';
        const transform = new THREE.Object3D();
        for (let i = 0; i < stones.count; i++) {
            const angle = i * Math.PI * 2 / stones.count;
            const radius = 10.8 + (i % 3) * 0.22;
            transform.position.set(Math.cos(angle) * radius, 0.12, Math.sin(angle) * radius);
            transform.rotation.set(i * 0.7, i * 1.3, 0);
            transform.scale.set(0.25 + (i % 3) * 0.08, 0.18, 0.32);
            transform.updateMatrix();
            stones.setMatrixAt(i, transform.matrix);
        }
        stones.castShadow = true;
        stones.receiveShadow = true;
        this.scene.add(stones);

        // Three old cedars frame the sanctuary.
        this.scene.add(plantCedars([[-8.5, 4.5, 3.4], [8.2, -5.2, 3.0], [-7.8, -8.0, 3.2]].map(([x, z, height]) => ({ x, z, y: this.terrain.sampleHeight(x, z), height }))));

        this.scene.traverse(object => {
            if (object instanceof THREE.DirectionalLight) {
                object.color.setHex(0xffdfb3);
                object.shadow.mapSize.set(2048, 2048);
                object.shadow.bias = -0.0006;
                object.shadow.normalBias = 0.06;
                object.shadow.camera.left = -60;
                object.shadow.camera.right = 60;
                object.shadow.camera.top = 60;
                object.shadow.camera.bottom = -60;
                object.shadow.camera.updateProjectionMatrix();
            }
        });
    }


    private buildGrove(): void {
        // The bamboo grove of the Whispering Bamboo, with a clearing where its rival waits and
        // the road kept open, plus a few clumps by water and edges elsewhere.
        const site = LANDMARKS.find(l => l.id === 'bamboo')!;
        const nearRoute = (x: number, z: number, w: number) => ROUTES.some(r => r.some((p, j) => {
            if (j === 0) return false;
            const [ax, az] = r[j - 1], [bx, bz] = p;
            const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
            return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < w;
        }));
        const clumps = [{ x: site.x, z: site.z - 6, radius: 15, count: 190 }];
        for (let i = 0; i < 14; i++) {
            const angle = i * 2.399963 + 0.7;
            const radius = 40 + (i * 23 % 60);
            clumps.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius: 2.5 + (i % 3), count: 9 + (i % 4) * 3 });
        }
        const allow = (x: number, z: number) => !isMeadow(x, z) && !nearRoute(x, z, 2.2) && Math.hypot(x - site.x, z - site.z) > 5.5 && Math.hypot(x, z) > 18
            && !LANDMARKS.some(l => l.id !== 'bamboo' && Math.hypot(x - l.x, z - l.z) < 14);
        // One instanced set per clump, so clumps out of view are culled whole.
        clumps.forEach((clump, i) => {
            const stems = bambooClumps([clump], (x, z) => this.terrain.sampleHeight(x, z), allow, 5 + i);
            if (stems.length) this.scene.add(plantBamboo(stems));
        });
        const grove: { x: number; y: number; z: number; height: number }[] = [];
        for (let i = 0; i < 40; i++) {
            const angle = i * 2.399963;
            const radius = 35 + (i * 13 % 55);
            const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
            if (!isMeadow(x, z)) grove.push({ x, z, y: this.terrain.sampleHeight(x, z), height: 7 + (i % 5) });
        }
        this.groveTrees = grove;
        this.scene.add(plantCedars(grove));

    }

    private buildGrass(): void {
        this.grass = new GrassField((x, z) => this.terrain.sampleHeight(x, z), (x, z) => Math.hypot(x, z) > 12.5 && !LANDMARKS.some(l => Math.hypot(x - l.x, z - l.z) < 7) && !this.structures?.occupied(x, z));
        this.scene.add(this.grass.mesh);
        this.mountains = new MountainRange();
        this.scene.add(this.mountains.mesh);
    }

    private showOutcome(outcome: Outcome): void {
        if (this.outcome) return;
        this.outcome = outcome;
        this.director.setIntentEnabled(false);
        this.director.sword.weapon.mesh.visible = false;
        InputSystem.getInstance().exitPointerLock();
        const rival = this.director.nearestRival();
        const by = rival && rival.engaged ? rival.name : null;
        const site = by ? LANDMARKS.find(l => l.rivalName === by) : undefined;
        this.journal.add('fall', by ? `You fell to ${by}${site ? ` at ${site.name}` : ''}, and woke at the forge.` : 'You fell, and woke at the forge.');
        this.onDeath?.(by);
    }

    /** Rise again at the forge: fresh body, rivals back at their ground. */
    public respawn(): void {
        this.firstPersonController = this.createPlayerController();
        this.playerStats.currentHp = this.playerStats.maxHp;
        this.playerStats.currentStamina = this.playerStats.maxStamina;
        this.playerStats.currentComposure = this.playerStats.maxComposure;
        this.director.revive();
        this.director.setIntentEnabled(true);
        this.director.sword.weapon.mesh.visible = true;
        this.outcome = null;
    }

    private notify(_text: string): void {
        // Status lines are now carried by the objective and reveals; kept for call sites.
    }

    /** What the player is doing on this road, derived from the journey's real state. */
    private objective(): Objective | null {
        if (!this.isInitialized || this.titleMode) return null;
        const net = this.director.online;
        if (net) {
            const foe = net.opponentId;
            const rec = (id: string | null) => (id && net.records[id] ? ` (${formatRecord(net.records[id])})` : '');
            const text = net.connection === 'reconnecting' ? 'Connection dropped · rejoining the ring…'
                : net.connection === 'lost' ? 'Connection lost · leave from the pause menu'
                : foe ? `Against ${net.names[foe]}${rec(foe)} · ${net.pingMs} ms` : 'Waiting in the ring for an opponent.';
            return { title: `Online duel · round ${net.latest?.round ?? 1}${rec(net.you)}`, text };
        }
        const remaining = LANDMARKS.filter(l => (this.journey.rivals[l.id]?.falls ?? 0) === 0);
        const rival = this.director.nearestRival();
        if (rival && !rival.engaged && rival.distance < 45) {
            const place = LANDMARKS.find(l => l.rivalName === rival.name);
            return { title: place?.name ?? 'A stranger', text: rival.drawn ? 'Steel is already drawn.' : 'Someone stands on the road ahead, waiting.' };
        }
        if (remaining.length === 0) return { title: 'The quiet roads', text: 'Every swordsman of the mountain has been met. Return to the forge.' };
        if (this.isNearForge()) return { title: 'The forge', text: 'A blade of your own making waits in the coals.' };
        const n = remaining.length;
        return { title: 'The mountain roads', text: `${n === 5 ? 'Five' : n === 4 ? 'Four' : n === 3 ? 'Three' : n === 2 ? 'Two' : 'One'} ${n === 1 ? 'swordsman waits' : 'swordsmen wait'} beyond the torii.` };
    }

    /** Controls are shown only where they help. */
    private prompts(): Prompt[] {
        if (!this.isInitialized || this.titleMode || this.forgeOpen) return [];
        const me = this.director.player;
        const pos = this.firstPersonController.object.position;
        if (this.isNearForge()) return [{ key: 'E', label: 'Forge a blade' }];
        const training = Math.hypot(pos.x, pos.z + 5) < 8;
        const rival = this.director.nearestRival();
        if (!me.drawn && (training || (rival && rival.distance < 14))) return [{ key: 'X', label: 'Draw the blade' }];
        // The first moments of a duel: the essentials, then silence.
        if (rival && rival.engaged && rival.distance < 9 && rival.since < 10 && (this.journey.rivals[LANDMARKS.find(l => l.rivalName === rival.name)?.id ?? 'shrine']?.encounters ?? 0) <= 2) {
            return me.drawn
                ? [{ key: 'Click', label: 'Cut' }, { key: 'Hold F', label: 'Guard' }, { key: 'T', label: 'Parry' }, { key: 'Q', label: 'Step' }]
                : [{ key: 'X', label: 'Draw the blade' }];
        }
        if (training && me.drawn) {
            return [
                { key: 'Click', label: 'Cut · move the mouse first' }, { key: 'R', label: 'Committed cut' },
                { key: 'Hold F', label: 'Guard · flick to shift it' }, { key: 'T', label: 'Parry' },
                { key: 'Q', label: 'Step' }, { key: 'V', label: 'Stance' }, { key: 'C', label: 'Wind Step' },
            ];
        }
        return [];
    }

    public getPlayerController(): { getStats: () => PlayerStats['baseStats'] } {
        return { getStats: () => this.playerStats.baseStats };
    }

    public handleInput(inputSystem: InputSystem): void {
        if (!this.isInitialized || this.forgeOpen || this.outcome || this.playerStats.currentHp <= 0) return;
        this.interactableForge.update(this.firstPersonController.object.position, 0);
        this.interactableForge.handleInput(inputSystem);
    }

    private shadowFrame = 0;

    public update(dt: number): void {
        if (this.renderer && (++this.shadowFrame & 1) === 0) this.renderer.shadowMap.needsUpdate = true;
        if (!this.isInitialized) return;
        if (this.titleMode) { this.updateTitle(Math.min(dt, 0.05)); return; }
        this.hud.update();
        if (this.playerStats.currentHp <= 0) {
            this.showOutcome('death');
            return;
        }
        const input = InputSystem.getInstance();
        if (this.photoMode && Number.isFinite(dt) && dt > 0) {
            // Photo mode: the moment is frozen (nobody moves, the clock is the photographer's),
            // but wind, grass and light stay alive.
            this.updateLighting(dt);
            this.updateNature(dt, this.camera.position);
            this.syncPlayerFigure(dt);
            return;
        }
        if (this.forgeOpen && Number.isFinite(dt) && dt > 0) {
            // At the anvil the world goes on (light, wind, fire); the player's body does not.
            this.forgeSession?.update(Math.min(dt, 0.05));
            if (this.atmosphere) this.atmosphere.update(dt, this.camera.position);
            this.updateLighting(dt);
            this.updateNature(dt, this.camera.position);
            return;
        }
        if (this.forgeOpen || this.outcome || !Number.isFinite(dt) || dt <= 0) {
            this.soundscape.setMuted(true);
            return;
        }
        this.soundscape.setMuted(false);
        dt = Math.min(dt, 0.05);
        this.totalWorldTime += dt;
        this.firstPersonController.update(dt, input);
        this.director.update(dt);
        if (this.structures) this.structures.update(this.firstPersonController.object.position, dt);
        if (this.atmosphere) this.atmosphere.update(dt, this.firstPersonController.object.position);
        this.resolveProps();
        if (this.playerStats.currentHp <= 0) {
                this.showOutcome('death');
            return;
        }
        this.playerStats.update(dt);
        this.interactableForge.update(this.firstPersonController.object.position, dt);
        this.updateLighting(dt);
        this.revealPlace();
        this.discover();
        this.updateNature(dt, this.camera.position);
        this.chunkTimer += dt;
        if (this.chunkTimer >= 0.2) {
            this.chunkTimer = 0;
            this.updateTerrain();
        }
        this.updateAudio(dt);
        this.saveTimer += dt;
        if (this.saveTimer >= 15) {
            this.saveTimer = 0;
            this.saveJourney();
        }
    }

    private updateLighting(dt: number): void {
        this.environmentManager.setLightingState('ethereal');
        if (this.atmosphere) {
            const sun = this.atmosphere.getSunState(), moon = this.atmosphere.getMoonState();
            const light = moon.intensity > sun.intensity ? moon : sun;
            this.environmentManager.applyExternalLighting(light.color, light.intensity, light.position, this.atmosphere.getNightFactor(), this.firstPersonController.object.position);
            const fog = this.atmosphere.getFogState();
            // Low sun: the air itself takes the warm light (aerial perspective toward the sun's colour).
            const low = Math.max(0, 1 - Math.abs(sun.position.y) / 70) * (1 - this.atmosphere.getNightFactor());
            fog.color.lerp(sun.color, low * 0.45);
            fog.background.lerp(sun.color, low * 0.35);
            this.environmentManager.applyExternalFog(fog.color, fog.density, fog.background);
            this.scene.environmentIntensity = 0.12 + 0.43 * (1 - this.atmosphere.getNightFactor());
            setArchitectureNight(this.atmosphere.getNightFactor());
            if (this.sky) {
                this.sky.position.copy(this.camera.position);
                this.sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();
                // At night the sky shader goes black; let the stars and moon carry it.
                this.sky.visible = this.atmosphere.getNightFactor() < 0.98;
            }
        } else {
            this.environmentManager.update(dt);
        }
    }

    private updateNature(dt: number, at: THREE.Vector3): void {
        const wind = this.atmosphere?.getWindStrength() ?? 0.3;
        this.grass?.update(dt, at, wind);
        const fog = this.atmosphere?.getFogState();
        if (fog && this.mountains) this.mountains.update(at, fog.background.clone().lerp(fog.color, 0.4));
    }

    /** Reaching a named place marks it on the map for good. */
    private discover(): void {
        const p = this.firstPersonController.object.position;
        for (const l of LANDMARKS) {
            if (!this.discovered.has(l.id) && Math.hypot(p.x - l.x, p.z - l.z) < 30) {
                this.discovered.add(l.id);
                this.journal.add('place', `Came to ${l.name}. ${l.description}`);
                try { localStorage.setItem('ronin.discovered.v1', JSON.stringify([...this.discovered])); } catch { /* private mode */ }
            }
        }
    }

    /** Everything the map draws, from the world's own data. */
    public mapSource(): MapSource {
        return {
            height: (x, z) => this.terrain.sampleHeight(x, z),
            meadow: (x, z) => isMeadow(x, z),
            routes: () => ROUTES,
            discovered: () => this.discovered,
            player: () => {
                const p = this.firstPersonController.object.position;
                return { x: p.x, z: p.z, yaw: this.firstPersonController.getYaw() };
            },
            rival: id => {
                const r = this.journey.rivals[id as RivalId];
                const rec = this.director.rivalRecords().find(x => x.name === LANDMARKS.find(l => l.id === id)?.rivalName);
                return r ? { encounters: rec?.encounters ?? r.encounters, wins: r.wins, falls: r.falls, dormant: rec?.dormant ?? false } : null;
            },
            trees: (minX, minZ, maxX, maxZ) => {
                const out: { x: number; z: number }[] = [];
                const size = this.terrain.chunkSize;
                for (let cx = Math.floor(minX / size + 0.5); cx <= Math.floor(maxX / size + 0.5); cx++) {
                    for (let cz = Math.floor(minZ / size + 0.5); cz <= Math.floor(maxZ / size + 0.5); cz++) {
                        this.terrain.vegetation(cx, cz).forEach((t, i) => { if (i % 2 === 0 && !isMeadow(t.x, t.z)) out.push(t); });
                    }
                }
                return [...out, ...this.groveTrees];
            },
        };
    }

    /** A new place is named once, in brush, as the player arrives. */
    private revealPlace(): void {
        const place = this.getLocationName();
        if (place === this.lastPlace) return;
        const first = this.lastPlace === '';
        this.lastPlace = place;
        if (!first && place !== 'The Wilds' && uiState.state !== 'duel') this.hud.showReveal(place, '', '', 2.6);
    }

    /**
     * Title screen: the world keeps living (wind, light, grass) under a slow camera, with the
     * player's swordsman standing at the edge of the courtyard looking out at the mountains.
     */
    private updateTitle(dt: number): void {
        this.titleTime += dt;
        // The title always stands in late golden light; the journey's own clock is kept aside.
        if (this.atmosphere && this.atmosphere.getTimeOfDay() !== TITLE_HOUR) {
            if (this.heldTime === null) {
                this.heldTime = this.atmosphere.getTimeOfDay();
                this.heldWeather = this.atmosphere.getWeather() as Weather;
            }
            this.atmosphere.setTimeOfDay(TITLE_HOUR);
            // Clear golden air with long views, whatever the road's weather.
            this.atmosphere.pinWeather('clear');
            this.atmosphere.fogScale = 0.45;
        }
        const spot = new THREE.Vector3(-18, 0, 24);
        spot.y = this.terrain.sampleHeight(spot.x, spot.z);
        const look = new THREE.Vector3(-200, 30, 30);
        if (!this.titleFigure && this.titleAssets) {
            this.titleFigure = new Swordsman(this.titleAssets, PLAYER_LOOK);
            this.scene.add(this.titleFigure);
        }
        if (this.titleFigure) {
            this.titleFigure.visible = true;
            const facing = Math.atan2(look.x - spot.x, look.z - spot.z);
            const d = this.director.player;
            const idle = { ...d, phase: 'sheathed' as const, drawn: false, attack: null, pos: { x: spot.x, z: spot.z }, vel: { x: 0, z: 0 }, facing, stamina: 100, composure: 1, posture: 0 };
            this.titleFigure.sync(idle, spot.y, dt);
        }
        const drift = Math.sin(this.titleTime * 0.05) * 0.6;
        // Over the shoulder, a little behind and to the right, the horizon in the upper third.
        const cx = spot.x + 4.6, cz = spot.z + 2.6 + drift;
        const cy = Math.max(this.terrain.sampleHeight(cx, cz), spot.y) + 1.9 + drift * 0.15;
        this.camera.position.set(cx, cy, cz);
        this.camera.lookAt(spot.x - 30, Math.max(cy - 0.8, this.terrain.sampleHeight(spot.x - 30, spot.z + 1.5) + 2), spot.z + 1.5);
        this.director.sword.weapon.mesh.visible = false;
        if (this.atmosphere) { this.atmosphere.update(dt, this.camera.position); this.atmosphere.setTimeOfDay(TITLE_HOUR); }
        this.updateLighting(dt);
        this.updateNature(dt, this.camera.position);
        this.chunkTimer += dt;
        if (this.chunkTimer >= 0.5) { this.chunkTimer = 0; this.updateTerrain(); }
        if (this.structures) this.structures.update(this.camera.position, dt);
    }

    /** Leave the title: hand the camera back to the walker. */
    public beginPlay(): void {
        this.titleMode = false;
        if (this.atmosphere && this.heldTime !== null) {
            this.atmosphere.setTimeOfDay(this.heldTime);
            this.atmosphere.pinWeather(null);
            if (this.heldWeather) this.atmosphere.setWeather(this.heldWeather, 0);
            this.atmosphere.fogScale = 1;
        }
        this.heldTime = null;
        if (this.titleFigure) this.titleFigure.visible = false;
        this.firstPersonController = this.createPlayerController();
        this.director.sword.weapon.mesh.visible = true;
        this.director.setIntentEnabled(true);
        this.lastPlace = '';
    }

    public enterTitle(): void {
        this.saveJourney();
        this.titleMode = true;
        this.director.setIntentEnabled(false);
    }

    private updateAudio(dt: number): void {
        const player = this.firstPersonController.object.position;
        const moved = Math.hypot(player.x - this.previousPlayer.x, player.z - this.previousPlayer.z);
        this.previousPlayer.copy(player);
        this.stepDistance += moved;
        if (this.stepDistance >= 1.7) {
            this.stepDistance %= 1.7;
            const material = Math.hypot(player.x, player.z) < 14 ? 'stone' : 'grass';
            this.soundscape.footstep(material, Math.min(1, moved * 2));
        }
        if (this.atmosphere) {
            this.soundscape.setWindStrength(this.atmosphere.getWindStrength());
            this.soundscape.setRainIntensity(this.atmosphere.getWeather() === 'rain' ? 0.8 : 0);
            this.soundscape.setNightFactor(this.atmosphere.getNightFactor());
            this.soundscape.setBirdActivity(1 - this.atmosphere.getNightFactor());
        }
        const stats = this.playerStats;
        const exertion = Math.max(0, 1 - stats.currentStamina / Math.max(1, stats.maxStamina));
        this.soundscape.updateBreath(exertion, true);
        const rival = this.director.nearestRival();
        this.soundscape.setRivalBreath(rival?.exertion ?? 0, rival ? Math.max(0, 1 - rival.distance / 14) : 0);
    }

    public get hasSavedJourney(): boolean {
        return this.savedJourney;
    }

    public newJourney(): void {
        this.journey = freshJourney();
        this.savedJourney = false;
        this.totalWorldTime = 0;
        this.saveTimer = 0;
        this.restoring = true;
        this.playerStats.currentHp = this.playerStats.maxHp;
        this.playerStats.currentStamina = this.playerStats.maxStamina;
        this.playerStats.currentComposure = this.playerStats.maxComposure;
        try { localStorage.removeItem(JOURNEY_KEY); } catch {}
        // A new road: nothing yet discovered or written.
        this.discovered.clear();
        try { localStorage.removeItem('ronin.discovered.v1'); } catch {}
        this.journal.clear();
        this.director.applyTraining();
        this.restoring = false;
        storeJourney(this.journey);
    }

    public saveJourney(): boolean {
        if (this.restoring || !this.isInitialized) return false;
        const player = this.firstPersonController.object.position;
        this.journey.position = { x: player.x, y: player.y, z: player.z };
        this.journey.time = this.atmosphere?.getTimeOfDay() ?? 0.32;
        this.journey.totalWorldTime = this.totalWorldTime;
        this.journey.stats = { hp: this.playerStats.currentHp, stamina: this.playerStats.currentStamina, composure: this.playerStats.currentComposure };
        this.journey.weapons = this.inventorySystem.getWeapons().map(weapon => structuredClone(weapon));
        this.journey.activeIndex = this.inventorySystem.getActiveIndex();
        const ok = storeJourney(this.journey);
        if (ok) this.savedJourney = true;
        return ok;
    }

    public startAudio(): void {
        this.soundscape.setMasterVolume(this.audioVolume);
        void this.soundscape.init();
    }

    public setAudioVolume(value: number): void {
        if (!Number.isFinite(value)) return;
        this.audioVolume = THREE.MathUtils.clamp(value, 0, 1);
        this.soundscape.setMasterVolume(this.audioVolume);
    }

    public getLocationName(): string {
        const player = this.firstPersonController.object.position;
        if (Math.hypot(player.x, player.z) < 14) return 'Forge Courtyard';
        let best = 'The Wilds';
        let bestDistance = 22;
        for (const landmark of LANDMARKS) {
            const distance = Math.hypot(player.x - landmark.x, player.z - landmark.z);
            if (distance < bestDistance) { best = landmark.name; bestDistance = distance; }
        }
        return best;
    }

    public getController(): FirstPersonController {
        return this.firstPersonController;
    }

    public getInventory(): InventorySystem {
        return this.inventorySystem;
    }

    public getDirector(): DuelDirector {
        return this.director;
    }

    public getHudState(): { drawn: boolean; phase: string; guarding: boolean } {
        return this.director.hudState();
    }
}
