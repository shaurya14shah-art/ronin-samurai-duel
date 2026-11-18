import * as THREE from 'three';
import {
    DT, Duel, DuelAI, PERSONALITIES, Predictor, cleanTraining, untrained, freshMemory, idleInput, seededRandom, yawTo,
    type Duelist, type DuelEvent, type DuelistInput, type NetSnapshot, type PersonalityName, type TechniqueId, type Training, type RivalMemory as Mind,
} from '@ronin/combat';
import type { InputSystem } from '../core/InputSystem';
import type { FirstPersonController } from '../player/FirstPersonController';
import type { PlayerStats } from '../player/PlayerStats';
import { TrainingDummy } from '../world/TrainingDummy';
import { PlayerIntent } from './PlayerIntent';
import type { NetDuel } from '../net/NetDuel';
import { PlayerSword } from './PlayerSword';
import { Swordsman, type SwordsmanLook } from '../characters/Swordsman';
import type { loadSwordsmanAssets } from '../characters/Swordsman';

// Runs every sword fight in the world through the shared deterministic sim.
// The player, rivals and training dummies are all fighters in one Duel. Rivals are driven by
// DuelAI while engaged and walk home otherwise. Presentation (figures, first-person blade,
// camera, audio cues) is derived from sim state and events.

export const PLAYER_ID = 'you';
const MINDS_KEY = 'ronin.rivalMinds.v1';
const ENGAGE_AT = 14;
const RELEASE_AT = 24;
/** Within this distance of another living fighter the sim, not the walker, moves the player. */
const DUEL_SPACE = 6;
const DORMANT_FOR = 2400;

export interface RivalView {
    name: string;
    title: string;
    distance: number;
    exertion: number;
    engaged: boolean;
    vitality: number;
    posture: number;
    drawn: boolean;
    /** Seconds since the duel began. */
    since: number;
}

export interface RivalSiteConfig {
    id: string;
    name: string;
    rivalName: string;
    x: number;
    z: number;
    personality: PersonalityName;
    robe?: number;
    hakama?: number;
    /** Short epithet shown when the duel begins. */
    title?: string;
}

/** What the journey save keeps per rival (unchanged legacy shape). */
export interface RivalRecord { encounters: number; wins: number; falls: number; defeatedUntil: number }

interface Site extends RivalSiteConfig {
    figure: Swordsman;
    mind: Mind;
    ai: DuelAI | null;
    record: RivalRecord;
    engagedAt: number;
}

/**
 * The rivals are trained swordsmen: each has the conditioning and techniques of their way of
 * fighting (and uses them; see ai.ts). Beating them is how the player earns the same.
 */
const RIVAL_TRAINING: Record<PersonalityName, Partial<Training>> = {
    patient: { defence: 2, endurance: 1, known: ['wind_step', 'maki_otoshi'] },
    aggressive: { strength: 2, footwork: 1, known: ['wind_step', 'kesa_giri'] },
    counter: { footwork: 2, defence: 1, known: ['wind_step', 'void_step'] },
    survivor: { endurance: 2, strength: 1, known: ['wind_step', 'iai', 'kesa_giri'] },
    teacher: { strength: 1, endurance: 1, defence: 1, footwork: 1, known: ['wind_step', 'iai', 'kesa_giri', 'void_step', 'maki_otoshi'] },
};

function hashId(id: string): number {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
    return h;
}

function loadMinds(): Record<string, Mind> {
    try {
        const raw = localStorage.getItem(MINDS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export class DuelDirector {
    duel = new Duel();
    readonly sword: PlayerSword;
    private intent: PlayerIntent;
    private sites: Site[] = [];
    private dummies: { id: string; mesh: TrainingDummy }[] = [];
    private minds = loadMinds();
    private acc = 0;
    private worldTime = 0;
    private sinceThreat = 99;
    private feedbackDir = new THREE.Vector3();
    public ownsPlayer = false;
    private net: NetDuel | null = null;
    private localDuel: Duel | null = null;
    private meId = PLAYER_ID;
    private foe?: Swordsman;
    private foePos = { x: 0, z: 0 };
    private pred: Predictor | null = null;
    /** The player's training (set by the world from the saved Way). */
    public trainingFor: () => Training = untrained;
    /** A known technique of the player's landed (for mastery). */
    public onTechniqueLanded?: (t: TechniqueId) => void;
    private voidAt = -99;
    /** Visual offset left by a prediction correction; it decays so the camera never jumps. */
    private corr = { x: 0, z: 0 };
    private netSince = 0;
    /** A rival has noticed the player and the duel begins (name, epithet). */
    public onEngage?: (name: string, title: string) => void;
    /** The player prevailed: the duel's aftermath. */
    public onRivalFalls?: (name: string, title: string) => void;
    private firstSync = new Set<string>();

    constructor(
        private scene: THREE.Scene,
        camera: THREE.PerspectiveCamera,
        private controller: () => FirstPersonController,
        private stats: PlayerStats,
        private ground: (x: number, z: number) => number,
        private input: InputSystem,
    ) {
        this.sword = new PlayerSword(camera);
        this.intent = new PlayerIntent(input);
        const p = controller().object.position;
        this.duel.add(PLAYER_ID, { x: p.x, z: p.z }, controller().getYaw() + Math.PI, { drawn: false, training: this.trainingFor() });
        this.sword.reset(true);
    }

    get player(): Duelist {
        // Online, before the first state arrives, keep showing the local body.
        return this.duel.get(this.meId) ?? this.localDuel?.get(PLAYER_ID) ?? this.duel.fighters[0];
    }

    public addDummy(x: number, z: number): void {
        const id = `dummy-${this.dummies.length}`;
        const mesh = new TrainingDummy();
        mesh.setPosition(x, this.ground(x, z), z);
        this.scene.add(mesh);
        this.duel.add(id, { x, z }, 0, { drawn: false });
        this.dummies.push({ id, mesh });
    }

    public addRival(cfg: RivalSiteConfig, record: RivalRecord, assets: Awaited<ReturnType<typeof loadSwordsmanAssets>>): void {
        const look: SwordsmanLook = { kimono: cfg.robe ?? 0x2a3346, hakama: cfg.hakama ?? 0x2e2e33, obi: 0x16110d };
        const figure = new Swordsman(assets, look);
        this.scene.add(figure);
        const mind = this.minds[cfg.id] ?? freshMemory();
        this.sites.push({ ...cfg, figure, mind, ai: null, record, engagedAt: 0 });
        this.spawnRival(this.sites[this.sites.length - 1]);
    }

    /** Bring the player's body up to date with their training (offline only: online is skill alone). */
    public applyTraining(): void {
        if (this.net) return;
        const me = this.localDuel?.get(PLAYER_ID) ?? this.duel.get(PLAYER_ID);
        if (me) me.training = cleanTraining(this.trainingFor());
    }

    private spawnRival(site: Site): void {
        this.duel.remove(site.id);
        const d = this.duel.add(site.id, { x: site.x, z: site.z }, 0, { drawn: false, training: RIVAL_TRAINING[site.personality] });
        site.figure.visible = this.worldTime >= site.record.defeatedUntil;
        site.ai = null;
        site.figure.sync(d, this.ground(site.x, site.z), 0);
    }

    public equipWeapon(weapon: any): void {
        if (weapon?.geometry && weapon?.metallurgy) this.sword.weapon.replaceWeaponMesh(weapon.geometry, weapon.metallurgy);
        this.player.bladeLength = THREE.MathUtils.clamp(this.sword.bladeLength, 0.5, 1.3);
        // The forged blade's real mass changes how it swings (shared/combat massFactor).
        const kg = Number(weapon?.stats?.weight);
        this.bladeMass = Number.isFinite(kg) && kg > 0.3 ? THREE.MathUtils.clamp(kg, 0.6, 2.2) : 1.1;
        this.player.bladeMass = this.bladeMass;
    }

    private bladeMass = 1.1;

    public setWorldTime(t: number): void {
        this.worldTime = t;
    }

    /** Advance the world's fights by real time. Call after the walker has updated. */
    public update(dt: number): void {
        this.worldTime += dt;
        if (this.net) { this.updateNet(dt); return; }
        this.intent.frame();
        const ctl = this.controller();
        const me = this.player;
        this.updateEngagement();

        const contested = me.phase !== 'dead' && this.duel.fighters.some(f => f.id !== PLAYER_ID && f.phase !== 'dead' &&
            (this.isEngagedRival(f.id) || f.id.startsWith('dummy')) && Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z) < DUEL_SPACE);
        const busy = me.phase !== 'ready' && me.phase !== 'sheathed';
        this.ownsPlayer = contested || busy;
        ctl.movementScale = this.ownsPlayer ? 0 : 1;
        if (!this.ownsPlayer) {
            me.pos.x = ctl.object.position.x;
            me.pos.z = ctl.object.position.z;
            me.vel.x = me.vel.z = 0;
            me.stamina = 100 * this.stats.currentStamina / Math.max(1, this.stats.maxStamina);
        }

        this.acc = Math.min(this.acc + dt, 0.25);
        while (this.acc >= DT) {
            this.acc -= DT;
            this.tick();
        }

        if (this.ownsPlayer) {
            ctl.object.position.x = me.pos.x;
            ctl.object.position.z = me.pos.z;
        }
        this.syncStats(dt);
        this.present(dt);
    }

    private isEngagedRival(id: string): boolean {
        return this.sites.some(s => s.id === id && s.ai !== null);
    }

    private tick(): void {
        const ctl = this.controller();
        const me = this.player;
        const inputs: Record<string, DuelistInput> = {
            [PLAYER_ID]: this.intent.build(ctl.getYaw() + Math.PI, me.stance),
        };
        if (inputs[PLAYER_ID].technique === 'void_step') this.voidAt = this.worldTime;
        if (!this.ownsPlayer) {
            // Walking freely: the walker owns position; keep only blade intents.
            const p = inputs[PLAYER_ID];
            p.move = { x: 0, z: 0 };
            p.step = undefined;
        }
        for (const site of this.sites) {
            const d = this.duel.get(site.id);
            if (!d) continue;
            inputs[site.id] = site.ai ? site.ai.think(this.duel) : this.homeward(d, site);
        }
        for (const dummy of this.dummies) inputs[dummy.id] = idleInput(0);

        const events = this.duel.step(inputs);
        for (const site of this.sites) site.ai?.learn(events, this.duel);
        for (const e of events) this.react(e);

        // Straw does not bleed or tire.
        for (const dummy of this.dummies) {
            const d = this.duel.get(dummy.id)!;
            d.vitality = 100; d.posture = 0; d.stamina = 100; d.composure = 1;
            if (d.phase === 'stagger' || d.phase === 'dead') { d.phase = 'sheathed'; d.phaseTime = 0; }
            d.pos.x = dummy.mesh.position.x; d.pos.z = dummy.mesh.position.z;
        }
    }

    /** A disengaged rival sheathes and walks back to its ground. */
    private homeward(d: Duelist, site: Site): DuelistInput {
        const input = idleInput(d.facing);
        if (d.phase === 'dead') return input;
        if (d.drawn && d.phase === 'ready') { input.draw = true; return input; }
        const dx = site.x - d.pos.x, dz = site.z - d.pos.z;
        const far = Math.hypot(dx, dz);
        if (far > 0.4) {
            input.facing = yawTo(d.pos, { x: site.x, z: site.z });
            input.move = { x: 0, z: Math.min(1, far) };
        }
        return input;
    }

    private updateEngagement(): void {
        const me = this.player;
        for (const site of this.sites) {
            const d = this.duel.get(site.id)!;
            if (d.phase === 'dead') {
                if (this.worldTime >= site.record.defeatedUntil && Math.hypot(me.pos.x - site.x, me.pos.z - site.z) > 40) this.spawnRival(site);
                continue;
            }
            if (!site.figure.visible) {
                if (this.worldTime >= site.record.defeatedUntil) site.figure.visible = true;
                else continue;
            }
            const distance = Math.hypot(me.pos.x - d.pos.x, me.pos.z - d.pos.z);
            // The courtyard around the forge is neutral ground.
            const sanctuary = Math.hypot(me.pos.x, me.pos.z) < 14;
            if (!site.ai && distance < ENGAGE_AT && !sanctuary && me.phase !== 'dead') {
                this.onEngage?.(site.rivalName, site.title ?? '');
                site.engagedAt = this.worldTime;
                site.ai = new DuelAI(site.id, PLAYER_ID, PERSONALITIES[site.personality], site.mind, seededRandom(hashId(site.id) + site.mind.encounters));
                site.record.encounters = site.mind.encounters + 1;
            } else if (site.ai && (distance > RELEASE_AT || sanctuary)) {
                site.ai = null;
            }
        }
    }

    private react(e: DuelEvent): void {
        const mine = e.a === this.meId, atMe = e.b === this.meId;
        const ctl = this.controller();
        const feedback = (kind: string) => window.dispatchEvent(new CustomEvent('combat-feedback', { detail: { text: '', kind } }));
        switch (e.type) {
            case 'attack_active':
                if (!mine) window.dispatchEvent(new CustomEvent('combat-swing', { detail: { heavy: this.duel.get(e.a)?.attack?.committed ?? false } }));
                break;
            case 'hit': {
                const dummy = this.dummies.find(x => x.id === e.b);
                if (dummy) {
                    const att = this.duel.get(e.a)!;
                    this.feedbackDir.set(dummy.mesh.position.x - att.pos.x, 0, dummy.mesh.position.z - att.pos.z).normalize();
                    dummy.mesh.takeDamage(0, this.feedbackDir, e.contact === 'clean' ? 3 : 1.5);
                }
                if (atMe) {
                    feedback('damage');
                    ctl.addCamShake(0.02, 0.02, 0.03);
                    ctl.addCamKick(0, 0, -0.04);
                    this.sinceThreat = 0;
                    this.sword.impact(0.6);
                } else if (mine) {
                    // Mastery: a known technique that lands counts as practice.
                    const me = this.duel.get(this.meId);
                    const t: TechniqueId | null = e.kind === 'wind_step' || e.kind === 'kesa_giri' ? e.kind
                        : e.kind === 'draw_cut' && me?.training.known.includes('iai') ? 'iai'
                        : e.kind === 'thrust' && this.worldTime - this.voidAt < 0.9 ? 'void_step' : null;
                    if (t && !this.net) this.onTechniqueLanded?.(t);
                    this.sword.impact(e.contact === 'jammed' ? 1.4 : 0.8);
                    feedback('hit');
                    ctl.addCamKick(0, 0, e.contact === 'jammed' ? -0.03 : 0.02);
                }
                break;
            }
            case 'block':
                if (mine || atMe) { feedback('block'); this.sword.impact(1.2); }
                if (atMe) ctl.addCamShake(0.012, 0.01, 0.01);
                break;
            case 'guard_break':
                if (mine || atMe) feedback('block');
                if (atMe) ctl.addCamShake(0.03, 0.03, 0.02);
                break;
            case 'parry':
                // In a parry event `a` is the one who parried.
                if (mine && e.kind === 'maki_otoshi' && !this.net) this.onTechniqueLanded?.('maki_otoshi');
                if (mine || atMe) feedback('parry');
                if (atMe) ctl.addCamShake(0.02, 0.02, 0.02);
                break;
            case 'clash':
                if (mine || atMe) { feedback('clash'); ctl.addCamShake(0.018, 0.018, 0.012); this.sword.impact(1.5); }
                break;
            case 'death': {
                const site = this.sites.find(s => s.id === e.a);
                if (site) {
                    this.onRivalFalls?.(site.rivalName, site.title ?? '');
                    site.record.falls += 1;
                    site.record.defeatedUntil = this.worldTime + DORMANT_FOR;
                    this.concludeEncounter(site, false);
                } else if (e.a === this.meId && !this.net) {
                    for (const s of this.sites) if (s.ai) { s.record.wins += 1; this.concludeEncounter(s, true); }
                }
                break;
            }
        }
    }

    private concludeEncounter(site: Site, rivalWon: boolean): void {
        if (!site.ai) return;
        site.mind = site.ai.conclude(rivalWon);
        site.ai = null;
        this.minds[site.id] = site.mind;
        try { localStorage.setItem(MINDS_KEY, JSON.stringify(this.minds)); } catch { /* private mode: memory lasts the session */ }
    }

    private syncStats(dt: number): void {
        const me = this.player;
        const s = this.stats;
        this.sinceThreat += dt;
        // Out of danger for a while, the body slowly mends.
        if (this.sinceThreat > 12 && me.phase !== 'dead') me.vitality = Math.min(100, me.vitality + dt * 1.5);
        s.currentHp = me.vitality / 100 * s.maxHp;
        if (this.ownsPlayer) s.currentStamina = me.stamina / 100 * s.maxStamina;
        s.currentComposure = me.composure * s.maxComposure;
        if (this.ownsPlayer && this.duel.fighters.some(f => this.isEngagedRival(f.id))) this.sinceThreat = Math.min(this.sinceThreat, 0);
    }

    private present(dt: number): void {
        const me = this.player;
        const moving = Math.hypot(me.vel.x, me.vel.z) > 0.2 || (!this.ownsPlayer && this.controller().getPlanarSpeed() > 0.2);
        this.sword.sync(me, dt, this.input.mouseDelta, moving);
        for (const site of this.sites) {
            const d = this.duel.get(site.id);
            if (!d) continue;
            // Far rivals are not animated: nobody can see them, and IK is not free.
            const far = Math.hypot(d.pos.x - me.pos.x, d.pos.z - me.pos.z) > 70;
            if (!far || this.firstSync.has(site.id) === false) { site.figure.sync(d, this.ground(d.pos.x, d.pos.z), dt); this.firstSync.add(site.id); }
        }
        for (const dummy of this.dummies) dummy.mesh.update(dt);
    }

    // ── Online duel ─────────────────────────────────────────────────────────────────────────

    /**
     * Hand the duel to the server. Local rivals and dummies hold still. Our own fighter is
     * predicted (shared `Predictor`): inputs apply at once and are replayed over each server
     * snapshot. The opponent is shown from the server's state; outcomes come only from the
     * server's events.
     */
    public enterNet(net: NetDuel, assets: Awaited<ReturnType<typeof loadSwordsmanAssets>>): void {
        this.net = net;
        this.localDuel = this.duel;
        this.pred = new Predictor(net.you);
        this.duel = this.pred.duel;
        this.meId = net.you;
        this.netSince = this.worldTime;
        this.corr = { x: 0, z: 0 };
        this.intent.clear();
        this.foe = new Swordsman(assets, { kimono: 0x3b2e2a, hakama: 0x26262b, obi: 0x1c2a40 });
        this.foe.visible = false;
        this.scene.add(this.foe);
        const take = (snap: NetSnapshot) => {
            const before = this.duel.get(this.meId);
            const bx = before?.pos.x ?? 0, bz = before?.pos.z ?? 0;
            const moved = this.pred!.reconcile(snap);
            const after = this.duel.get(this.meId);
            // Small corrections are eased out; a large one (new round, respawn) is a cut.
            if (before && after && moved > 0 && moved < 2) { this.corr.x += bx - after.pos.x; this.corr.z += bz - after.pos.z; }
            else if (moved >= 2) this.corr = { x: 0, z: 0 };
        };
        net.onSnap = snap => {
            take(snap);
            for (const e of snap.events) this.react(e);
        };
        if (net.latest) take(net.latest);
    }

    /** The opponent as the server last stated it (never predicted). */
    private serverFighter(id: string | null): Duelist | undefined {
        return id ? this.net?.latest?.state.fighters.find(f => f.id === id) : undefined;
    }

    public leaveNet(): void {
        if (!this.net) return;
        this.net.leave();
        this.net = null;
        this.pred = null;
        if (this.localDuel) this.duel = this.localDuel;
        this.localDuel = null;
        this.meId = PLAYER_ID;
        this.foe?.removeFromParent();
        this.foe = undefined;
        const me = this.player;
        const ctl = this.controller();
        me.pos.x = ctl.object.position.x;
        me.pos.z = ctl.object.position.z;
    }

    get online(): NetDuel | null { return this.net; }

    private updateNet(dt: number): void {
        const net = this.net!;
        this.intent.frame();
        const ctl = this.controller();
        this.ownsPlayer = true;
        ctl.movementScale = 0;
        this.acc = Math.min(this.acc + dt, 0.25);
        while (this.acc >= DT) {
            this.acc -= DT;
            const stance = this.duel.get(this.meId)?.stance ?? 'middle';
            net.send(this.pred!.input(this.intent.build(ctl.getYaw() + Math.PI, stance)));
        }
        const meNow = this.duel.get(this.meId);
        if (!meNow) return;
        const fade = Math.exp(-12 * dt);
        this.corr.x *= fade; this.corr.z *= fade;
        ctl.object.position.x = meNow.pos.x + this.corr.x;
        ctl.object.position.z = meNow.pos.z + this.corr.z;
        const s = this.stats;
        // The server decides who falls; the local body never "dies" from a snapshot.
        s.currentHp = Math.max(1, meNow.vitality / 100 * s.maxHp);
        s.currentStamina = meNow.stamina / 100 * s.maxStamina;
        s.currentComposure = meNow.composure * s.maxComposure;
        this.sword.sync(meNow, dt, this.input.mouseDelta, Math.hypot(meNow.vel.x, meNow.vel.z) > 0.2);
        const foe = this.serverFighter(net.opponentId);
        if (this.foe) {
            this.foe.visible = !!foe;
            if (foe) {
                // Snapshots arrive ~30 Hz; ease the figure between them so it never jumps.
                const k = 1 - Math.exp(-18 * dt);
                this.foePos.x += (foe.pos.x - this.foePos.x) * k;
                this.foePos.z += (foe.pos.z - this.foePos.z) * k;
                if (Math.hypot(foe.pos.x - this.foePos.x, foe.pos.z - this.foePos.z) > 3) { this.foePos.x = foe.pos.x; this.foePos.z = foe.pos.z; }
                this.foe.sync({ ...foe, pos: { ...this.foePos } }, this.ground(this.foePos.x, this.foePos.z), dt);
            }
        }
    }

    /** After the player falls and rises again: fresh body, rivals return to their ground. */
    public revive(): void {
        const ctl = this.controller();
        this.duel.remove(PLAYER_ID);
        const p = ctl.object.position;
        const me = this.duel.add(PLAYER_ID, { x: p.x, z: p.z }, ctl.getYaw() + Math.PI, { drawn: false, training: this.trainingFor() });
        me.bladeLength = THREE.MathUtils.clamp(this.sword.bladeLength, 0.5, 1.3);
        me.bladeMass = this.bladeMass;
        this.sword.reset(true);
        this.intent.clear();
        for (const site of this.sites) {
            site.ai = null;
            if (this.duel.get(site.id)?.phase !== 'dead') this.spawnRival(site);
        }
    }

    public setIntentEnabled(enabled: boolean): void {
        this.intent.enabled = enabled;
        if (!enabled) this.intent.clear();
    }

    public hudState(): { drawn: boolean; phase: string; guarding: boolean } {
        const me = this.player;
        return { drawn: me.drawn, phase: me.phase, guarding: me.guarding };
    }

    /** Nearest visible rival: for breathing audio, status lines and the duel HUD. */
    public nearestRival(): RivalView | null {
        const me = this.player;
        if (this.net) {
            const id = this.net.opponentId;
            const f = this.serverFighter(id);
            if (!f || !me) return null;
            return {
                name: this.net.names[id!] ?? 'Opponent', title: 'An online duel', distance: Math.hypot(me.pos.x - f.pos.x, me.pos.z - f.pos.z),
                exertion: 1 - f.stamina / 100, engaged: true, vitality: f.vitality / 100, posture: f.posture / 100, drawn: f.drawn,
                since: this.worldTime - this.netSince,
            };
        }
        let best: RivalView | null = null;
        for (const site of this.sites) {
            const d = this.duel.get(site.id);
            if (!d || !site.figure.visible || d.phase === 'dead') continue;
            const distance = Math.hypot(me.pos.x - d.pos.x, me.pos.z - d.pos.z);
            if (!best || distance < best.distance) {
                best = {
                    name: site.rivalName, title: site.title ?? '', distance, exertion: 1 - d.stamina / 100, engaged: site.ai !== null,
                    vitality: d.vitality / 100, posture: d.posture / 100, drawn: d.drawn, since: this.worldTime - site.engagedAt,
                };
            }
        }
        return best;
    }

    /** Every rival's standing with the player, for the journal. */
    public rivalRecords(): { name: string; title: string; place: string; record: RivalRecord; encounters: number; dormant: boolean }[] {
        return this.sites.map(s => ({ name: s.rivalName, title: s.title ?? '', place: s.name, record: s.record, encounters: s.mind.encounters, dormant: this.worldTime < s.record.defeatedUntil }));
    }
}
