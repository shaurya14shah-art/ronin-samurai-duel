import * as THREE from 'three';
import { WRIST, makeHand, skinMaterial, tekkoMaterial, tintForearm } from './Hand';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { easeInOut, type AttackKind, type Duelist, type Line } from '@ronin/combat';
import { createProceduralSwordMesh } from '../forge/mesh-generator';
import type { BladeGeometry } from '../forge/physics';
import type { BlendedMetallurgy } from '../forge/materials';
import { makeClothTexture } from '../world/textures';

// First-person arms, katana and scabbard, posed every frame from the player's duelist.
//
// Camera space: -z is where you look, +x right, +y up. A sword pose is the grip point (just
// below the tsuba) plus the blade direction and the direction the cutting edge faces. The
// sword mesh's own frame is blade along +z, edge toward -y.
//
// Strikes follow the sim: windup pose → through the centre in front of you → follow-through,
// timed by the same eased progress the sim uses for its arc, so the blade crosses your centre
// line on the tick the cut can land.

type V3 = [number, number, number];
interface PoseDef { grip: V3; dir: V3; edge: V3 }
interface Pose { grip: THREE.Vector3; quat: THREE.Quaternion }

const n = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const P = (grip: V3, dir: V3, edge: V3): PoseDef => ({ grip, dir: n(dir), edge: n(edge) });
const mirror = (p: PoseDef): PoseDef => ({ grip: [-p.grip[0], p.grip[1], p.grip[2]], dir: [-p.dir[0], p.dir[1], p.dir[2]], edge: [-p.edge[0], p.edge[1], p.edge[2]] });

const GUARD: Record<Line, PoseDef> = {
    center: P([0.1, -0.16, -0.52], [-0.2, 0.42, -1], [-0.45, -1, -0.1]),
    high: P([0.05, 0.05, -0.33], [0.05, 0.85, 0.55], [0, 0.4, -1]),
    low: P([0.06, -0.34, -0.42], [-0.05, -0.42, -1], [0, -1, 0.3]),
    left: P([-0.13, -0.16, -0.42], [-0.22, 0.95, -0.35], [-1, 0, -0.35]),
    right: P([0.21, -0.16, -0.42], [0.22, 0.95, -0.35], [1, 0, -0.35]),
};
const FLUID = P([0.20, -0.32, -0.30], [0.45, -0.3, 0.85], [0, -1, 0]);
const EMPTY = P([0.17, -0.44, -0.36], [0.12, -0.92, -0.35], [0, 0.2, -1]);
const PARRY = P([0.05, -0.12, -0.53], [0.12, 0.88, -0.45], [0, 0.35, -1]);
const DRAW_MID = P([-0.04, -0.26, -0.62], [-0.62, 0.22, -0.78], [0.5, -0.8, 0]);

const WINDUP: Record<AttackKind, PoseDef> = {
    overhead: P([0.03, 0.3, -0.6], [0, 0.6, 0.8], [0, 0.6, -0.8]),
    diag_l: P([-0.32, 0.2, -0.62], [-0.5, 0.72, 0.48], [0.62, -0.4, -0.6]),
    diag_r: mirror(P([-0.32, 0.2, -0.62], [-0.5, 0.72, 0.48], [0.62, -0.4, -0.6])),
    horiz_l: P([-0.36, -0.12, -0.5], [-0.85, 0.12, 0.5], [0.4, 0, -0.9]),
    horiz_r: mirror(P([-0.36, -0.12, -0.5], [-0.85, 0.12, 0.5], [0.4, 0, -0.9])),
    thrust: P([0.07, -0.23, -0.30], [-0.05, 0.1, -1], [0, -1, 0]),
    low: P([-0.24, -0.42, -0.44], [-0.4, -0.6, 0.6], [0.4, 0.6, -0.6]),
    draw_cut: P([-0.17, -0.52, -0.48], [0.1, -0.22, 1], [0, 1, 0]),
    wind_step: P([0.07, -0.25, -0.26], [-0.05, 0.1, -1], [0, -1, 0]),
    // Kesa-giri: raised high over the left shoulder, the whole body loaded behind it.
    kesa_giri: P([-0.36, 0.3, -0.5], [-0.42, 0.85, 0.32], [0.65, -0.3, -0.6]),
};
const MID: Record<AttackKind, PoseDef> = {
    overhead: P([0.02, -0.10, -0.56], [0, 0.18, -1], [0, -1, -0.2]),
    diag_l: P([0.00, -0.19, -0.56], [-0.15, 0.3, -1], [0.7, -0.7, 0]),
    diag_r: mirror(P([0.00, -0.19, -0.56], [-0.15, 0.3, -1], [0.7, -0.7, 0])),
    horiz_l: P([0.00, -0.19, -0.58], [0, 0.05, -1], [1, 0, 0]),
    horiz_r: mirror(P([0.00, -0.19, -0.58], [0, 0.05, -1], [1, 0, 0])),
    thrust: P([0.05, -0.19, -0.48], [-0.04, 0.09, -1], [0, -1, 0]),
    low: P([0.00, -0.27, -0.56], [0, -0.05, -1], [0.3, 0.9, 0]),
    draw_cut: P([-0.02, -0.25, -0.56], [-0.2, 0.05, -1], [1, 0, 0]),
    wind_step: P([0.05, -0.19, -0.48], [-0.04, 0.09, -1], [0, -1, 0]),
    kesa_giri: P([0.0, -0.17, -0.6], [-0.12, 0.25, -1], [0.7, -0.7, 0]),
};
const END: Record<AttackKind, PoseDef> = {
    overhead: P([0.02, -0.27, -0.58], [0, -0.4, -1], [0, -1, 0.3]),
    diag_l: P([0.22, -0.28, -0.48], [0.75, -0.35, -0.55], [0.5, -0.8, 0.3]),
    diag_r: mirror(P([0.22, -0.28, -0.48], [0.75, -0.35, -0.55], [0.5, -0.8, 0.3])),
    horiz_l: P([0.30, -0.11, -0.42], [0.95, 0.02, 0.2], [0.3, 0, 0.95]),
    horiz_r: mirror(P([0.30, -0.11, -0.42], [0.95, 0.02, 0.2], [0.3, 0, 0.95])),
    thrust: P([0.04, -0.06, -0.76], [-0.03, 0.08, -1], [0, -1, 0]),
    low: P([0.20, 0.12, -0.50], [0.5, 0.75, -0.4], [0.5, 0.6, -0.3]),
    draw_cut: P([0.30, -0.11, -0.42], [0.95, 0.02, 0.2], [0.3, 0, 0.95]),
    wind_step: P([0.04, -0.06, -0.78], [-0.03, 0.08, -1], [0, -1, 0]),
    // Carried right through, low across the body.
    kesa_giri: P([0.3, -0.36, -0.44], [0.8, -0.5, -0.4], [0.5, -0.8, 0.3]),
};

/** Scabbard pose in yaw space (does not pitch with the head): left hip, hilt forward. */
const HIP: PoseDef = P([-0.17, -0.66, -0.26], [0.08, -0.24, 1], [0, 1, 0.24]);

const X = new THREE.Vector3(1, 0, 0);
const tmpM = new THREE.Matrix4();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

function toPose(def: PoseDef, out: Pose): Pose {
    out.grip.set(def.grip[0], def.grip[1], def.grip[2]);
    const z = tmpA.set(def.dir[0], def.dir[1], def.dir[2]).normalize();
    const y = tmpB.set(-def.edge[0], -def.edge[1], -def.edge[2]);
    y.addScaledVector(z, -y.dot(z)).normalize();
    const x = tmpC.crossVectors(y, z).normalize();
    tmpM.makeBasis(x, y, z);
    out.quat.setFromRotationMatrix(tmpM);
    return out;
}

const pose = (): Pose => ({ grip: new THREE.Vector3(), quat: new THREE.Quaternion() });

function copyPose(src: Pose, dst: Pose): Pose {
    dst.grip.copy(src.grip);
    dst.quat.copy(src.quat);
    return dst;
}

/** Quadratic Bézier through a mid pose: the blade passes in front of you, not through you. */
function arc(a: Pose, m: Pose, b: Pose, u: number, out: Pose): Pose {
    const p0 = tmpA.copy(a.grip).lerp(m.grip, u);
    const p1 = tmpB.copy(m.grip).lerp(b.grip, u);
    out.grip.copy(p0).lerp(p1, u);
    const q0 = new THREE.Quaternion().slerpQuaternions(a.quat, m.quat, u);
    const q1 = new THREE.Quaternion().slerpQuaternions(m.quat, b.quat, u);
    out.quat.slerpQuaternions(q0, q1, u);
    return out;
}

function blend(a: Pose, b: Pose, t: number, out: Pose): Pose {
    out.grip.lerpVectors(a.grip, b.grip, t);
    out.quat.slerpQuaternions(a.quat, b.quat, t);
    return out;
}

const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function defaultGuard(d: Duelist): PoseDef {
    switch (d.stance) {
        case 'high': return GUARD.high;
        case 'low': return GUARD.low;
        case 'fluid': return FLUID;
        case 'empty': return EMPTY;
        default: return GUARD.center;
    }
}

function lathe(points: [number, number][], segments = 28): THREE.LatheGeometry {
    return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Two-bone arm from shoulder to wrist with a bent elbow. */
class Arm {
    readonly root = new THREE.Group();
    private upper: THREE.Mesh;
    private fore: THREE.Mesh;
    private sleeve: THREE.Mesh;
    private readonly foreLen = 0.29;
    private elbow = new THREE.Vector3();
    private yAxis = new THREE.Vector3(0, 1, 0);

    constructor(private side: number, skin: THREE.Material, cloth: THREE.Material) {
        // Unit-height geometries along +y, scaled to bone length each frame.
        const upperGeo = new THREE.CapsuleGeometry(0.042, 1, 8, 20);
        upperGeo.translate(0, 0.5, 0);
        this.upper = new THREE.Mesh(upperGeo, cloth);
        // Elbow (y = 0) to wrist (y = 1): full at the muscle belly, narrowing to the wrist.
        const foreGeo = lathe([[0.0, 0], [0.03, 0.02], [0.036, 0.2], [0.034, 0.45], [0.028, 0.72], [0.021, 0.92], [0.0195, 1]], 40);
        foreGeo.scale(1, 1, 0.82);
        tintForearm(foreGeo);
        this.fore = new THREE.Mesh(foreGeo, skin);
        // The wide kimono sleeve hangs open around the forearm.
        const sleeveGeo = lathe([[0.045, 0], [0.058, 0.35], [0.068, 0.62], [0.066, 0.64], [0.05, 0.4], [0.04, 0.02]], 32);
        this.sleeve = new THREE.Mesh(sleeveGeo, cloth);
        // Upper arms pass beside the eyes and would fill the frame: like any viewmodel,
        // only forearms and sleeve cuffs are drawn.
        this.upper.visible = false;
        this.root.add(this.upper, this.fore, this.sleeve);
    }

    /**
     * Viewmodel forearm: hangs from the wrist back toward an off-screen elbow, below and to the
     * side, so a raised sword never puts an elbow beside the lens.
     */
    solve(wrist: THREE.Vector3, along: THREE.Vector3): void {
        const back = tmpA.copy(along).multiplyScalar(-0.35);
        back.add(tmpB.set(this.side * 0.45, -1, 0.55)).normalize();
        this.elbow.copy(wrist).addScaledVector(back, this.foreLen);
        this.place(this.fore, this.elbow, wrist);
        const sleeveEnd = tmpC.lerpVectors(this.elbow, wrist, 0.45);
        this.place(this.sleeve, this.elbow.clone().addScaledVector(back, 0.12), sleeveEnd);
    }

    private place(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
        const seg = new THREE.Vector3().subVectors(to, from);
        const len = seg.length();
        mesh.position.copy(from);
        mesh.quaternion.setFromUnitVectors(this.yAxis, seg.normalize());
        mesh.scale.set(1, len, 1);
    }
}

export class FirstPersonRig {
    /** Attached to the camera. Everything that pitches with the head. */
    readonly mesh = new THREE.Group();
    /** Parent of the scabbard and lower body; counter-rotated so it stays upright. */
    private hips = new THREE.Group();
    private swordHolder = new THREE.Group();
    private sword: THREE.Group;
    private saya: THREE.Group;
    private arms: Arm[];
    private fists: THREE.Group[];
    private camera: THREE.PerspectiveCamera;
    bladeLength = 0.95;
    private tsukaLength = 0.26;

    private current = pose();
    private from = pose();
    private target = pose();
    private midPose = pose();
    private endPose = pose();
    private hipPose = pose();
    private lastPhase = '';
    private time = 0;
    private bob = 0;
    private kick = new THREE.Vector3();

    constructor(camera: THREE.PerspectiveCamera) {
        this.camera = camera;
        const skin = skinMaterial(0xa87a5c);
        const clothTex = makeClothTexture('#2a3242', '#1a2030');
        clothTex.repeat.set(2, 2);
        const cloth = new THREE.MeshStandardMaterial({ map: clothTex, color: 0x8892a6, roughness: 0.92, side: THREE.DoubleSide });
        const tekko = tekkoMaterial();
        this.arms = [new Arm(1, tekko, cloth), new Arm(-1, tekko, cloth)];
        this.fists = [makeHand(skin, tekko), makeHand(skin, tekko)];
        this.fists[1].scale.set(-1, 1, 1);
        for (const a of this.arms) this.mesh.add(a.root);
        for (const f of this.fists) this.mesh.add(f);

        this.sword = this.defaultSword();
        this.swordHolder.add(this.sword);
        this.mesh.add(this.swordHolder);

        this.saya = this.makeSaya();
        this.hips.add(this.saya, this.makeLowerBody(cloth));
        this.mesh.add(this.hips);
        this.mesh.traverse(o => {
            if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }
        });
        // A soft key light so the arms read at night without flattening them.
        const fill = new THREE.PointLight(0xdfe6f2, 0.45, 2.5, 2);
        fill.position.set(0.15, 0.2, -0.3);
        this.mesh.add(fill);
        camera.add(this.mesh);
        toPose(HIP, this.current);
    }

    private defaultSword(): THREE.Group {
        const geometry: BladeGeometry = {
            bladeLength: 74, curvature: 1.8, baseWidth: 3.2, tipWidth: 2.2, baseThickness: 0.75, tipThickness: 0.45,
            tsukaLength: 26, balanceShift: 0, hamonPattern: 'gunome', tsubaStyle: 'iron_mokko', tsukaWrapColor: 'charcoal',
        };
        const metal: BlendedMetallurgy = {
            density: 7.85, carbonContent: 0.75, tensileStrength: 1250, toughness: 80, hardnessHRC: 62, resonanceDampening: 78,
            baseColor: '#dce4ed', luster: 0.85, grainTexture: 'folded', foldCount: 10, effectiveLayers: 1024,
        };
        this.bladeLength = 0.74;
        this.tsukaLength = 0.26;
        return createProceduralSwordMesh(geometry, metal);
    }

    replaceWeaponMesh(geometry: BladeGeometry, metallurgy: BlendedMetallurgy): void {
        this.swordHolder.remove(this.sword);
        this.sword = createProceduralSwordMesh(geometry, metallurgy);
        this.sword.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.frustumCulled = false; } });
        this.swordHolder.add(this.sword);
        this.bladeLength = Math.max(0.35, geometry.bladeLength / 100);
        this.tsukaLength = Math.max(0.15, geometry.tsukaLength / 100);
    }

    private makeSaya(): THREE.Group {
        const g = new THREE.Group();
        const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0c0a0a, roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 });
        const horn = new THREE.MeshStandardMaterial({ color: 0x1d1612, roughness: 0.5 });
        // Slightly curved, flattened oval tube from the mouth (z=0) to the tip.
        const curve = new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map(t => new THREE.Vector3(0, Math.sin(t * Math.PI * 0.95) * 0.018, t * 0.78)));
        const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.017, 16), lacquer);
        body.scale.set(0.75, 1.15, 1);
        const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 20), horn);
        mouth.rotation.x = Math.PI / 2;
        mouth.scale.set(0.8, 1, 1.2);
        const kojiri = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), horn);
        kojiri.position.set(0, 0.002, 0.79);
        kojiri.scale.set(0.8, 1.1, 1.2);
        g.add(body, mouth, kojiri);
        return g;
    }

    private makeLowerBody(cloth: THREE.Material): THREE.Group {
        const g = new THREE.Group();
        const obi = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.165, 0.11, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: 0.75, side: THREE.DoubleSide }));
        obi.position.set(0, -0.68, 0.05);
        obi.scale.set(1, 1, 0.75);
        const hakama = new THREE.Mesh(lathe([[0.17, 0], [0.2, -0.25], [0.26, -0.6], [0.3, -0.95]], 32), cloth);
        hakama.position.set(0, -0.73, 0.05);
        hakama.scale.set(1, 1, 0.8);
        g.add(obi, hakama);
        return g;
    }

    /** Pose everything from the player's sim state. `pitch` is the camera's look-up/down angle. */
    sync(d: Duelist, dt: number, moving: boolean, sway: THREE.Vector2): void {
        this.time += dt;
        const pitch = this.camera.rotation.x;

        // Hips stay upright under the head: undo the camera pitch.
        this.hips.quaternion.setFromAxisAngle(X, -pitch);
        this.hips.position.set(0, 0, 0);
        const hipGrip = new THREE.Vector3(...HIP.grip).applyAxisAngle(X, -pitch);
        toPose(HIP, this.hipPose);
        this.hipPose.grip.copy(hipGrip);
        this.hipPose.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(X, -pitch));
        // Scabbard: mouth at the hilt's position, following the hip.
        this.saya.position.set(...HIP.grip);
        this.saya.quaternion.copy(toPose(HIP, pose()).quat);

        if (d.phase !== this.lastPhase) {
            copyPose(this.current, this.from);
            this.lastPhase = d.phase;
        }
        const t = d.phaseDur > 0 ? Math.min(1, d.phaseTime / d.phaseDur) : 1;
        const a = d.attack;
        const rest = d.guarding ? GUARD[d.guardLine] : defaultGuard(d);
        let direct = false;

        switch (d.phase) {
            case 'sheathed':
                copyPose(this.hipPose, this.target);
                direct = true;
                break;
            case 'drawing':
            case 'sheathing': {
                const drawn = d.phase === 'drawing';
                const u = easeInOut(drawn ? t : 1 - t);
                toPose(DRAW_MID, this.midPose);
                toPose(defaultGuard(d), this.endPose);
                arc(this.hipPose, this.midPose, this.endPose, u, this.target);
                direct = true;
                break;
            }
            case 'windup':
                if (a) {
                    if (a.kind === 'draw_cut') copyPose(this.hipPose, this.target);
                    else toPose(WINDUP[a.kind], this.target);
                    blend(this.from, this.target, smooth(t / 0.8), this.target);
                    // Gathering tension at the end of a committed windup.
                    if (a.committed) this.target.grip.y += Math.sin(Math.min(1, t) * Math.PI) * 0.015;
                    direct = true;
                }
                break;
            case 'active':
                if (a) {
                    const start = a.kind === 'draw_cut' ? this.hipPose : toPose(WINDUP[a.kind], pose());
                    toPose(MID[a.kind], this.midPose);
                    toPose(END[a.kind], this.endPose);
                    arc(start, this.midPose, this.endPose, easeInOut(t), this.target);
                    direct = true;
                }
                break;
            case 'parry': {
                toPose(PARRY, this.target);
                const snap = smooth(t / 0.25);
                blend(this.from, this.target, snap, this.target);
                direct = true;
                break;
            }
            case 'recover':
                toPose(rest, this.target);
                blend(this.from, this.target, smooth(t), this.target);
                direct = true;
                break;
            case 'stagger': {
                toPose(rest, this.target);
                const jolt = Math.sin(t * Math.PI) * (1 - t);
                this.target.grip.add(tmpA.set(0.06, -0.12, 0.14).multiplyScalar(jolt));
                this.target.quat.multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.5 * jolt));
                blend(this.from, this.target, smooth(t * 3), this.target);
                direct = true;
                break;
            }
            case 'dead':
                copyPose(this.current, this.target);
                this.target.grip.y -= dt * 0.4;
                direct = true;
                break;
            default:
                toPose(rest, this.target);
        }

        if (direct) copyPose(this.target, this.current);
        else blend(this.current, this.target, 1 - Math.exp(-12 * dt), this.current);

        // Life: breathing, walking, mouse lag, impacts. Composure shows as an unsteady tip.
        const effort = 1 - d.stamina / 100;
        this.bob += dt * (moving ? 7.5 : 0);
        const breath = Math.sin(this.time * (1.7 + effort * 2.5)) * (0.003 + effort * 0.007);
        const walk = moving ? Math.sin(this.bob) * 0.008 : 0;
        const tremor = (1 - d.composure) * 0.012 + (d.stamina < 20 ? 0.008 : 0);
        this.kick.multiplyScalar(Math.exp(-10 * dt));
        const show = copyPose(this.current, pose());
        if (d.phase !== 'sheathed') {
            show.grip.x += -sway.x * 0.00025 + Math.sin(this.time * 9.1) * tremor * 0.5 + this.kick.x;
            show.grip.y += breath + walk + sway.y * 0.0002 + this.kick.y;
            show.grip.z += this.kick.z;
            show.quat.multiply(new THREE.Quaternion().setFromAxisAngle(X, Math.sin(this.time * 7.3) * tremor));
        }

        this.swordHolder.position.copy(show.grip);
        this.swordHolder.quaternion.copy(show.quat);

        // Hands: right just below the tsuba, left at the pommel end of the grip.
        const along = tmpC.set(0, 0, 1).applyQuaternion(show.quat);
        const holding = d.phase !== 'sheathed' && !(d.phase === 'sheathing' && t > 0.92);
        const reaching = d.phase === 'drawing' || d.phase === 'sheathing' || (d.phase === 'windup' && a?.kind === 'draw_cut');
        const hands = [
            show.grip.clone().addScaledVector(along, -0.045),
            show.grip.clone().addScaledVector(along, -(this.tsukaLength - 0.05)),
        ];
        // During the draw only the right hand travels with the hilt; the left steadies the scabbard.
        if (reaching) hands[1].copy(this.hipPose.grip).add(tmpA.set(0.0, -0.02, 0.12).applyAxisAngle(X, -pitch));
        for (let i = 0; i < 2; i++) {
            const fist = this.fists[i];
            fist.visible = holding || (i === 1 && reaching);
            this.arms[i].root.visible = fist.visible;
            if (!fist.visible) continue;
            fist.position.copy(hands[i]);
            fist.quaternion.copy(show.quat);
            // The forearm meets the hand at its own wrist.
            const wrist = WRIST.clone().multiply(fist.scale).applyQuaternion(fist.quaternion).add(fist.position);
            this.arms[i].solve(wrist, along);
        }
    }

    /** A small physical jolt, in camera space (e.g. a blocked or landed cut). */
    impulse(x: number, y: number, z: number): void {
        this.kick.add(tmpA.set(x, y, z));
    }

    set visible(v: boolean) {
        this.mesh.visible = v;
    }
}
