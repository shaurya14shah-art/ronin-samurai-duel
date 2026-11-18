import * as THREE from 'three';
import { buildHead } from './Face';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attackPose, type AttackKind, type Duelist, type Line } from '@ronin/combat';
import { createProceduralSwordMesh } from '../forge/mesh-generator';
import type { BladeGeometry } from '../forge/physics';
import type { BlendedMetallurgy } from '../forge/materials';
import { makeClothTexture } from '../world/textures';

// A dressed, animated swordsman driven by a duelist's sim state.
//
// Body and clips: Mesh2Motion (CC0) mannequin + clip library, built by
// tools/build-character-assets.mjs into public/models. Clips drive the legs, hips and
// reactions; the arms are solved with two-bone IK onto a katana whose pose comes from the sim,
// so every cut is two-handed and passes the opponent on the tick the sim resolves it.
//
// Clothes are shells generated from the body mesh itself (pushed out along the normals per
// region) and skinned to the same skeleton, so they deform exactly with it.
//
// Body frame: the figure faces +z; its right hand is on -x.

export interface SwordsmanLook {
    kimono: number;
    hakama: number;
    obi: number;
    skin?: number;
    hat?: boolean;
}

interface Assets { scene: THREE.Group; clips: THREE.AnimationClip[] }
let assets: Promise<Assets> | null = null;

export function loadSwordsmanAssets(): Promise<Assets> {
    if (!assets) {
        const loader = new GLTFLoader();
        assets = Promise.all([loader.loadAsync('/models/swordsman.glb'), loader.loadAsync('/models/swordsman-anims.glb')])
            .then(([body, anims]) => ({ scene: body.scene, clips: anims.animations }));
    }
    return assets;
}

type Pose = { p: [number, number, number]; r: [number, number, number] };

// Sword poses in body space; the sword's own +y is the blade (see `swordOffset`).
const GUARD: Record<Line, Pose> = {
    center: { p: [-0.06, 1.12, 0.42], r: [1.08, 0, 0.05] },
    high: { p: [-0.04, 1.75, 0.22], r: [-0.35, 0, 0.1] },
    low: { p: [-0.04, 0.9, 0.4], r: [1.95, 0, 0] },
    left: { p: [0.2, 1.2, 0.36], r: [0.55, 0, -0.5] },
    right: { p: [-0.3, 1.2, 0.36], r: [0.55, 0, 0.5] },
};
const EMPTY: Pose = { p: [-0.24, 0.95, 0.24], r: [2.5, 0, 0.25] };
const PARRY: Pose = { p: [-0.04, 1.3, 0.5], r: [0.45, 0, 0.1] };

const WINDUP: Record<AttackKind, Pose> = {
    overhead: { p: [-0.02, 1.95, 0.08], r: [-0.55, 0, 0] },
    diag_l: { p: [0.36, 1.72, 0.14], r: [-0.2, 0, -0.95] },
    diag_r: { p: [-0.4, 1.72, 0.14], r: [-0.2, 0, 0.95] },
    horiz_l: { p: [0.46, 1.32, 0.08], r: [1.2, 0, -1.35] },
    horiz_r: { p: [-0.5, 1.32, 0.08], r: [1.2, 0, 1.35] },
    thrust: { p: [-0.04, 1.16, 0.12], r: [1.57, 0, 0] },
    low: { p: [0.3, 0.82, 0.12], r: [2.4, 0, -0.55] },
    draw_cut: { p: [0.26, 1.0, 0.2], r: [1.6, 0, -1.4] },
    wind_step: { p: [-0.04, 1.14, 0.06], r: [1.57, 0, 0] },
    kesa_giri: { p: [0.42, 1.85, 0.08], r: [-0.35, 0, -0.9] },
};
const STRIKE_END: Record<AttackKind, Pose> = {
    overhead: { p: [-0.02, 1.0, 0.62], r: [1.9, 0, 0] },
    diag_l: { p: [-0.36, 0.92, 0.55], r: [1.65, 0, 0.75] },
    diag_r: { p: [0.32, 0.92, 0.55], r: [1.65, 0, -0.75] },
    horiz_l: { p: [-0.5, 1.24, 0.46], r: [1.5, 0, 1.1] },
    horiz_r: { p: [0.46, 1.24, 0.46], r: [1.5, 0, -1.1] },
    thrust: { p: [-0.04, 1.24, 0.82], r: [1.57, 0, 0] },
    low: { p: [-0.26, 1.3, 0.58], r: [0.95, 0, 0.55] },
    draw_cut: { p: [-0.5, 1.24, 0.46], r: [1.5, 0, 1.1] },
    wind_step: { p: [-0.04, 1.24, 0.84], r: [1.57, 0, 0] },
    kesa_giri: { p: [-0.42, 0.82, 0.55], r: [1.75, 0, 0.85] },
};
/** Scabbard on the left hip (figure's +x), hilt forward and up. */
const SAYA: Pose = { p: [0.19, 0.98, 0.16], r: [1.95, 0.05, -0.25] };

const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3(), tmpU = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

function poseTo(p: Pose, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    pos.set(p.p[0], p.p[1], p.p[2]);
    quat.setFromEuler(tmpE.set(p.r[0], p.r[1], p.r[2]));
}

const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function defaultLine(d: Duelist): Line {
    return d.stance === 'high' ? 'high' : d.stance === 'low' ? 'low' : 'center';
}

/** Rotate `bone` (about its own pivot) so the world point `from` moves to point at `to`. */
function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    const pivot = bone.getWorldPosition(new THREE.Vector3());
    const a = tmpV.subVectors(from, pivot).normalize();
    const b = tmpW.subVectors(to, pivot).normalize();
    if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
    const delta = tmpQ.setFromUnitVectors(a, b);
    const world = bone.getWorldQuaternion(tmpQ2).premultiply(delta);
    const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentWorld.invert().multiply(world));
    bone.updateMatrixWorld(true);
}

/** Basis rotation taking a local (primary, secondary) pair onto a world (primary, secondary) pair. */
function basisRotation(localA: THREE.Vector3, localB: THREE.Vector3, worldA: THREE.Vector3, worldB: THREE.Vector3): THREE.Quaternion {
    const frame = (a: THREE.Vector3, b: THREE.Vector3) => {
        const x = a.clone().normalize();
        const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
        const z = new THREE.Vector3().crossVectors(x, y);
        return new THREE.Matrix4().makeBasis(x, y, z);
    };
    const m = frame(worldA, worldB).multiply(frame(localA, localB).invert());
    return new THREE.Quaternion().setFromRotationMatrix(m);
}

const FINGERS = ['index', 'middle', 'pinky', 'ring', 'thumb'];

class Arm {
    upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone;
    fingerAxis = new THREE.Vector3();
    thumbAxis = new THREE.Vector3();
    grip: { bone: THREE.Bone; q: THREE.Quaternion }[] = [];
    constructor(root: THREE.Object3D, readonly side: 'l' | 'r') {
        this.upper = root.getObjectByName(`upperarm_${side}`) as THREE.Bone;
        this.lower = root.getObjectByName(`lowerarm_${side}`) as THREE.Bone;
        this.hand = root.getObjectByName(`hand_${side}`) as THREE.Bone;
        const local = (name: string) => this.hand.worldToLocal(root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())).normalize();
        this.fingerAxis.copy(local(`middle_01_${side}`));
        this.thumbAxis.copy(local(`thumb_01_${side}`));
    }

    /** Remember the finger curl of a gripping pose so the hands close around the tsuka. */
    captureGrip(): void {
        this.grip = [];
        this.hand.traverse(o => {
            if (o !== this.hand && FINGERS.some(f => o.name.startsWith(f))) this.grip.push({ bone: o as THREE.Bone, q: (o as THREE.Bone).quaternion.clone() });
        });
    }

    solve(target: THREE.Vector3, pole: THREE.Vector3, fingersTo: THREE.Vector3, thumbTo: THREE.Vector3): void {
        const s = this.upper.getWorldPosition(new THREE.Vector3());
        const e = this.lower.getWorldPosition(new THREE.Vector3());
        const h = this.hand.getWorldPosition(new THREE.Vector3());
        const la = s.distanceTo(e), lb = e.distanceTo(h);
        const toT = new THREE.Vector3().subVectors(target, s);
        const d = Math.min(toT.length(), la + lb - 1e-4);
        const dir = toT.normalize();
        const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
        const a = (la * la - lb * lb + d * d) / (2 * d);
        const hgt = Math.sqrt(Math.max(0, la * la - a * a));
        const elbow = s.clone().addScaledVector(dir, a).addScaledVector(p, hgt);
        aim(this.upper, e, elbow);
        aim(this.lower, this.hand.getWorldPosition(new THREE.Vector3()), target);
        // Wrist: fingers wrap toward the edge, thumb along the blade.
        const world = basisRotation(this.fingerAxis, this.thumbAxis, fingersTo, thumbTo);
        const parentWorld = this.lower.getWorldQuaternion(new THREE.Quaternion());
        this.hand.quaternion.copy(parentWorld.invert().multiply(world));
        for (const g of this.grip) g.bone.quaternion.copy(g.q);
        this.hand.updateMatrixWorld(true);
    }
}

/** Middle of the mannequin's head in its bind pose (model space, metres). */
const HEAD_CENTRE = new THREE.Vector3(0, 1.692, 0.006);
const tucked = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** A copy of the body with the head's own vertices pulled inward, out of sight inside the sculpted head. */
function tuckedHead(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const done = tucked.get(g);
    if (done) return done;
    const out = g.clone();
    const p = out.attributes.position, j = out.attributes.skinIndex, w = out.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) {
        let hw = 0;
        for (let k = 0; k < 4; k++) if (j.getComponent(i, k) === 6 || j.getComponent(i, k) === 7) hw += w.getComponent(i, k);
        if (hw < 0.5) continue;
        p.setXYZ(i, HEAD_CENTRE.x + (p.getX(i) - HEAD_CENTRE.x) * 0.7, HEAD_CENTRE.y + (p.getY(i) - HEAD_CENTRE.y) * 0.7, HEAD_CENTRE.z + (p.getZ(i) - HEAD_CENTRE.z) * 0.7);
    }
    out.computeVertexNormals();
    tucked.set(g, out);
    return out;
}

export class Swordsman extends THREE.Group {
    private model: THREE.Object3D;
    private mixer: THREE.AnimationMixer;
    private actions = new Map<string, THREE.AnimationAction>();
    private base = '';
    private arms: Arm[];
    private spine: THREE.Bone;
    private sword = new THREE.Group();
    private saya = new THREE.Group();
    private swordPos = new THREE.Vector3();
    private swordQuat = new THREE.Quaternion();
    private fromPos = new THREE.Vector3();
    private fromQuat = new THREE.Quaternion();
    private toPos = new THREE.Vector3();
    private toQuat = new THREE.Quaternion();
    private midPos = new THREE.Vector3();
    private midQuat = new THREE.Quaternion();
    private sayaPos = new THREE.Vector3();
    private sayaQuat = new THREE.Quaternion();
    private lastPhase = '';
    private time = 0;
    bladeLength = 0.74;
    private tsukaLength = 0.26;

    constructor(a: Assets, look: SwordsmanLook) {
        super();
        this.model = SkeletonUtils.clone(a.scene);
        this.add(this.model);
        const body = this.findBody();
        body.material = new THREE.MeshStandardMaterial({ color: look.skin ?? 0x9a7356, roughness: 0.62 });
        this.dress(body, look);
        this.addFace(body, look);
        if (look.hat !== false) this.addKasa();

        this.mixer = new THREE.AnimationMixer(this.model);
        for (const clip of a.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
        // Capture a sword grip's finger curl from the sword stance clip.
        const grip = this.actions.get('Idle_Sword');
        this.arms = [new Arm(this.model, 'r'), new Arm(this.model, 'l')];
        if (grip) {
            grip.play();
            this.mixer.update(0);
            this.model.updateMatrixWorld(true);
            this.arms[0].captureGrip();
            this.mirrorGrip(this.arms[0], this.arms[1]);
            grip.stop();
        }
        this.spine = this.model.getObjectByName('spine_03') as THREE.Bone;

        this.setBlade(createProceduralSwordMesh(DEFAULT_GEOMETRY, DEFAULT_METAL), 0.74, 0.26);
        const sayaMesh = makeSaya();
        sayaMesh.rotation.x = -Math.PI / 2;
        this.saya.add(sayaMesh);
        this.add(this.sword, this.saya);
        poseTo(SAYA, this.sayaPos, this.sayaQuat);
        this.saya.position.copy(this.sayaPos);
        this.saya.quaternion.copy(this.sayaQuat);
        this.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        this.play('Idle_A', 0);
    }

    private findBody(): THREE.SkinnedMesh {
        let body: THREE.SkinnedMesh | null = null;
        this.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !body) body = o as THREE.SkinnedMesh; });
        return body!;
    }

    /** Left hand closes the same way as the right. The rig mirrors across x, so mirror the rotation. */
    private mirrorGrip(from: Arm, to: Arm): void {
        to.grip = from.grip.map(g => {
            const bone = this.model.getObjectByName(g.bone.name.replace(/_r$/, '_l')) as THREE.Bone;
            const q = g.q.clone();
            return { bone, q: new THREE.Quaternion(q.x, -q.y, -q.z, q.w) };
        }).filter(g => g.bone);
    }

    setBlade(mesh: THREE.Object3D, bladeLength: number, tsukaLength: number): void {
        this.sword.clear();
        // The forged sword mesh runs along +z with the edge toward -y; poses expect blade +y.
        mesh.rotation.x = -Math.PI / 2;
        this.sword.add(mesh);
        this.bladeLength = bladeLength;
        this.tsukaLength = tsukaLength;
    }

    private dress(body: THREE.SkinnedMesh, look: SwordsmanLook): void {
        const g = body.geometry;
        const pos = g.attributes.position as THREE.BufferAttribute;
        const nrm = g.attributes.normal as THREE.BufferAttribute;
        const si = g.attributes.skinIndex as THREE.BufferAttribute;
        const sw = g.attributes.skinWeight as THREE.BufferAttribute;
        const bones = body.skeleton.bones;
        // Bind-pose heights of landmarks, from the inverse bind matrices.
        const bindY = (name: string) => {
            const i = bones.findIndex(b => b.name === name);
            return tmpV.setFromMatrixPosition(tmpM.copy(body.skeleton.boneInverses[i]).invert()).y;
        };
        const waist = bindY('spine_01');
        const kimono = new THREE.Color(look.kimono), hakama = new THREE.Color(look.hakama), obi = new THREE.Color(look.obi);
        const tabi = new THREE.Color(0xe8e2d6);
        const out = new Float32Array(pos.count * 3);
        const col = new Float32Array(pos.count * 3);
        const keep = new Uint8Array(pos.count);
        const offsets = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
            let best = 0, bw = -1;
            for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
            const name = bones[best].name;
            const y = pos.getY(i);
            let off = 0, c: THREE.Color | null = null;
            if (/^(spine|clavicle|upperarm|neck_01$)/.test(name) || (name === 'pelvis' && y > waist - 0.02)) {
                c = Math.abs(y - (waist + 0.03)) < 0.06 ? obi : kimono;
                off = c === obi ? 0.026 : 0.02;
                if (name === 'neck_01' && y > waist + 0.62) c = null;
            } else if (/^lowerarm/.test(name)) {
                c = kimono; off = 0.024;
            } else if (/^(pelvis|thigh|calf)/.test(name)) {
                // Hakama: wide pleated trousers flaring toward the ankle.
                c = hakama;
                const drop = THREE.MathUtils.clamp((waist - y) / (waist - 0.05), 0, 1);
                off = 0.024 + 0.1 * drop * drop;
            } else if (/^(foot|ball)/.test(name)) {
                c = tabi; off = 0.006;
            }
            if (!c) continue;
            keep[i] = 1;
            offsets[i] = off;
            out[i * 3] = pos.getX(i) + nrm.getX(i) * off;
            out[i * 3 + 1] = pos.getY(i) + nrm.getY(i) * off;
            out[i * 3 + 2] = pos.getZ(i) + nrm.getZ(i) * off;
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        const shell = g.clone();
        shell.setAttribute('position', new THREE.BufferAttribute(out, 3));
        shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const index = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
        const tris: number[] = [];
        for (let t = 0; t < index.length; t += 3) {
            if (keep[index[t]] && keep[index[t + 1]] && keep[index[t + 2]]) tris.push(index[t], index[t + 1], index[t + 2]);
        }
        shell.setIndex(tris);
        relax(shell, keep, 4, pos, nrm, offsets);
        shell.computeVertexNormals();
        const tex = makeClothTexture('#bdbdbd', '#8a8a8a');
        tex.repeat.set(6, 6);
        const mesh = new THREE.SkinnedMesh(shell, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.93 }));
        mesh.bind(body.skeleton, body.bindMatrix);
        body.parent!.add(mesh);
    }

    /**
     * The mannequin's head is a blank, low-poly egg. Tuck it inside and give the figure a
     * sculpted head (Face.ts) that rides the head bone.
     */
    private addFace(body: THREE.SkinnedMesh, look: SwordsmanLook): void {
        body.geometry = tuckedHead(body.geometry);
        const head = this.model.getObjectByName('head')!;
        this.model.updateMatrixWorld(true);
        const parts = buildHead(look.skin ?? 0x9a7356);
        const centre = body.localToWorld(HEAD_CENTRE.clone());
        head.worldToLocal(centre);
        parts.group.position.copy(centre);
        parts.group.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(body.getWorldQuaternion(new THREE.Quaternion())));
        head.add(parts.group);
    }

    private addKasa(): void {
        const head = this.model.getObjectByName('head')!;
        const straw = new THREE.MeshStandardMaterial({ color: 0x8b7048, roughness: 0.95, side: THREE.DoubleSide });
        const pts = [[0.0, 0.14], [0.06, 0.13], [0.15, 0.08], [0.25, 0.03], [0.3, 0.0], [0.29, -0.006], [0.0, 0.08]].map(([x, y]) => new THREE.Vector2(x, y));
        const kasa = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), straw);
        const knot = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.04, 6, 12), new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.7 }));
        kasa.position.set(0, 0.17, 0.0);
        knot.position.set(0, 0.17, -0.06);
        head.add(kasa);
    }

    private play(name: string, fade = 0.22, once = false): void {
        if (this.base === name) return;
        const next = this.actions.get(name);
        if (!next) return;
        const prev = this.actions.get(this.base);
        next.reset();
        next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = once;
        next.play();
        if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
        else if (prev) prev.stop();
        this.base = name;
    }

    /** Pose the whole figure from the duelist state. */
    sync(d: Duelist, groundY: number, dt: number): void {
        this.time += dt;
        this.position.set(d.pos.x, groundY, d.pos.z);
        this.rotation.y = d.facing;

        // Legs and body from clips.
        const speed = Math.hypot(d.vel.x, d.vel.z);
        const fwd = d.vel.x * Math.sin(d.facing) + d.vel.z * Math.cos(d.facing);
        const side = d.vel.x * -Math.cos(d.facing) + d.vel.z * Math.sin(d.facing);
        let clip = d.drawn ? 'Idle_Sword' : 'Idle_A';
        let rate = 1;
        if (d.phase === 'dead') clip = 'Death_A';
        else if (d.phase === 'stagger') clip = d.posture >= 99 ? 'Hit_Knockback' : 'Hit_Chest';
        else if (d.phase === 'step') {
            const lx = d.stepDir.x * -Math.cos(d.facing) + d.stepDir.z * Math.sin(d.facing);
            const lz = d.stepDir.x * Math.sin(d.facing) + d.stepDir.z * Math.cos(d.facing);
            clip = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 'Dodge_right' : 'Dodge_left') : lz < 0 ? 'Dodge_back' : 'Walk';
            rate = 2.2;
        } else if (speed > 0.15) {
            if (Math.abs(side) > Math.abs(fwd)) clip = side > 0 ? 'Strafe_right' : 'Strafe_left';
            else clip = fwd >= 0 ? 'Walk' : 'Walk_Backwards';
            rate = THREE.MathUtils.clamp(speed / 1.3, 0.5, 1.6);
        }
        const once = clip === 'Death_A' || clip.startsWith('Hit_') || clip.startsWith('Dodge_');
        this.play(clip, d.phase === 'stagger' ? 0.08 : 0.22, once);
        const action = this.actions.get(this.base);
        if (action) action.timeScale = rate;
        this.mixer.update(dt);
        this.model.updateMatrixWorld(true);

        this.poseSword(d, dt);
        this.solveArms(d);
    }

    private poseSword(d: Duelist, dt: number): void {
        if (d.phase !== this.lastPhase) {
            this.fromPos.copy(this.swordPos);
            this.fromQuat.copy(this.swordQuat);
            this.lastPhase = d.phase;
        }
        const t = d.phaseDur > 0 ? Math.min(1, d.phaseTime / d.phaseDur) : 1;
        const a = d.attack;
        const rest = !d.drawn ? SAYA : d.stance === 'empty' ? EMPTY : GUARD[d.guarding ? d.guardLine : defaultLine(d)];
        let lean = (d.posture / 100) * 0.1, twist = 0;
        switch (d.phase) {
            case 'windup':
                if (a) {
                    poseTo(WINDUP[a.kind], this.toPos, this.toQuat);
                    this.blend(smooth(t / 0.8));
                    lean -= (a.committed ? 0.1 : 0.05) * t;
                    twist = WINDUP[a.kind].p[0] * 0.5 * t;
                }
                break;
            case 'active':
                if (a) {
                    poseTo(WINDUP[a.kind], this.midPos, this.midQuat);
                    poseTo(STRIKE_END[a.kind], this.toPos, this.toQuat);
                    const s = a.extend ? attackPose(a, t).reach / a.reach : smooth(t);
                    this.swordPos.lerpVectors(this.midPos, this.toPos, s);
                    this.swordQuat.slerpQuaternions(this.midQuat, this.toQuat, s);
                    lean = 0.12;
                    twist = -STRIKE_END[a.kind].p[0] * 0.6;
                }
                break;
            case 'drawing':
            case 'sheathing':
                poseTo(d.phase === 'drawing' ? GUARD[defaultLine(d)] : SAYA, this.toPos, this.toQuat);
                this.blend(smooth(t));
                break;
            case 'parry':
                poseTo(PARRY, this.toPos, this.toQuat);
                this.blend(smooth(t / 0.25));
                break;
            case 'dead':
                break;
            default: {
                poseTo(rest, this.toPos, this.toQuat);
                const k = 1 - Math.exp(-(d.phase === 'recover' ? 7 : 12) * dt);
                this.swordPos.lerp(this.toPos, k);
                this.swordQuat.slerp(this.toQuat, k);
            }
        }
        // Breath and effort in the blade.
        const effort = 1 - d.stamina / 100;
        const breath = Math.sin(this.time * (1.6 + effort * 3)) * (0.004 + effort * 0.01);
        this.sword.position.copy(this.swordPos);
        this.sword.position.y += d.drawn ? breath : 0;
        this.sword.quaternion.copy(this.swordQuat);
        if (this.spine && d.phase !== 'dead') {
            this.spine.rotateX(lean);
            this.spine.rotateY(twist);
            this.spine.updateMatrixWorld(true);
        }
    }

    private blend(t: number): void {
        this.swordPos.lerpVectors(this.fromPos, this.toPos, t);
        this.swordQuat.slerpQuaternions(this.fromQuat, this.toQuat, t);
    }

    private solveArms(d: Duelist): void {
        if (d.phase === 'dead') {
            // The sword falls from the hand.
            this.sword.position.y = Math.max(0.03, this.sword.position.y - 0.05);
            return;
        }
        const holding = d.drawn || d.phase === 'drawing' || d.phase === 'sheathing' || (d.phase === 'windup' && d.attack?.kind === 'draw_cut');
        if (!holding) return;
        this.updateMatrixWorld(true);
        const grip = this.sword.getWorldPosition(new THREE.Vector3());
        const blade = new THREE.Vector3(0, 1, 0).applyQuaternion(this.sword.getWorldQuaternion(tmpQ));
        const edge = new THREE.Vector3(0, 0, 1).applyQuaternion(this.sword.getWorldQuaternion(tmpQ));
        const right = grip.clone().addScaledVector(blade, -0.045);
        const left = grip.clone().addScaledVector(blade, -(this.tsukaLength - 0.05));
        const down = tmpU.set(0, -1, 0);
        const outR = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.quaternion);
        const outL = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
        this.arms[0].solve(right, outR.multiplyScalar(0.6).add(down), edge, blade);
        // While drawing, the left hand stays on the scabbard mouth.
        if (d.phase === 'drawing' || d.phase === 'sheathing' || (d.phase === 'windup' && d.attack?.kind === 'draw_cut')) {
            const mouth = this.saya.localToWorld(new THREE.Vector3(0, 0.02, 0));
            const sayaAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.saya.getWorldQuaternion(tmpQ));
            this.arms[1].solve(mouth, outL.multiplyScalar(0.6).add(down), new THREE.Vector3(0, 1, 0), sayaAxis);
        } else {
            this.arms[1].solve(left, outL.multiplyScalar(0.6).add(down), edge, blade);
        }
    }
}

const DEFAULT_GEOMETRY: BladeGeometry = {
    bladeLength: 74, curvature: 1.8, baseWidth: 3.2, tipWidth: 2.2, baseThickness: 0.75, tipThickness: 0.45,
    tsukaLength: 26, balanceShift: 0, hamonPattern: 'gunome', tsubaStyle: 'iron_mokko', tsukaWrapColor: 'charcoal',
};
const DEFAULT_METAL: BlendedMetallurgy = {
    density: 7.85, carbonContent: 0.75, tensileStrength: 1250, toughness: 80, hardnessHRC: 62, resonanceDampening: 78,
    baseColor: '#dce4ed', luster: 0.85, grainTexture: 'folded', foldCount: 10, effectiveLayers: 1024,
};

/** Lacquered scabbard along +z from the mouth. */
function makeSaya(): THREE.Group {
    const g = new THREE.Group();
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0c0a0a, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.2 });
    const curve = new THREE.CatmullRomCurve3([0, 0.25, 0.5, 0.75, 1].map(t => new THREE.Vector3(0, Math.sin(t * Math.PI * 0.95) * 0.018, t * 0.78)));
    const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.017, 16), lacquer);
    body.scale.set(0.75, 1.15, 1);
    g.add(body);
    return g;
}

/**
 * Laplacian relaxation of a cloth shell: cloth drapes over the body instead of tracing
 * every muscle. Only kept vertices move; seams are welded by position first so split UV
 * vertices move together.
 */
function relax(geo: THREE.BufferGeometry, keep: Uint8Array, iterations: number, skin: THREE.BufferAttribute, normals: THREE.BufferAttribute, offsets: Float32Array): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const weld = new Map<string, number>();
    const canon = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
        const k = key(i);
        if (!weld.has(k)) weld.set(k, i);
        canon[i] = weld.get(k)!;
    }
    const nbrs = new Map<number, Set<number>>();
    const idx = geo.index!.array;
    for (let t = 0; t < idx.length; t += 3) {
        for (let e = 0; e < 3; e++) {
            const a = canon[idx[t + e]], b = canon[idx[t + (e + 1) % 3]];
            if (!nbrs.has(a)) nbrs.set(a, new Set());
            if (!nbrs.has(b)) nbrs.set(b, new Set());
            nbrs.get(a)!.add(b); nbrs.get(b)!.add(a);
        }
    }
    const p = new Float32Array(pos.array as Float32Array);
    for (let it = 0; it < iterations; it++) {
        const next = new Float32Array(p);
        for (const [v, set] of nbrs) {
            if (!keep[v] || set.size < 3) continue;
            let x = 0, y = 0, z = 0;
            for (const n of set) { x += p[n * 3]; y += p[n * 3 + 1]; z += p[n * 3 + 2]; }
            const k = 0.5 / set.size;
            next[v * 3] = p[v * 3] * 0.5 + x * k;
            next[v * 3 + 1] = p[v * 3 + 1] * 0.5 + y * k;
            next[v * 3 + 2] = p[v * 3 + 2] * 0.5 + z * k;
        }
        p.set(next);
    }
    for (let i = 0; i < pos.count; i++) {
        const c = canon[i];
        let x = p[c * 3], y = p[c * 3 + 1], z = p[c * 3 + 2];
        // Never let relaxed cloth sink into the body it covers.
        const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
        const depth = (x - skin.getX(i)) * nx + (y - skin.getY(i)) * ny + (z - skin.getZ(i)) * nz;
        const min = offsets[i] * 0.85;
        if (depth < min) { x += nx * (min - depth); y += ny * (min - depth); z += nz * (min - depth); }
        pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
}
