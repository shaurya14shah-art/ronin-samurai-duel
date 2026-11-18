import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A sculpted head for the swordsmen, replacing the mannequin's blank one. It is built from a
// dense sphere pushed into a skull, jaw and face by smooth (Gaussian) features: brow ridge,
// eye sockets, cheekbones, a nose with wings, lips, chin. Eyes sit in the sockets under lids;
// brows, ears and tied-back hair with a topknot complete it. Skin colour varies a little
// (lips, cheeks, sockets, stubble along the jaw) through vertex colours.
//
// Space: metres, centred on the middle of the head; +z is the face, +y up.

const G = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s));
const RX = 0.077, RY = 0.115, RZ = 0.098;

/** The skull and jaw before features, for a unit-sphere direction. */
function skull(dx: number, dy: number, dz: number): THREE.Vector3 {
    let x = dx * RX, y = dy * RY, z = dz * RZ;
    // The cranium is fuller at the back and top; the jaw narrows toward the chin.
    if (dz < 0) z *= 1.1 - 0.12 * Math.max(0, -dy);
    if (dy < 0) x *= 1 - 0.3 * Math.pow(-dy, 1.6) * (dz > -0.3 ? 1 : 0.6);
    // A face is flatter than an egg: pull the front plane back a little at the sides.
    if (dz > 0) z *= 1 - 0.18 * Math.pow(Math.abs(dx), 2);
    // Chin forward, under-jaw flat.
    if (dy < -0.55 && dz > 0) z += 0.012 * (-dy - 0.55) * 2 * dz;
    if (dy < -0.75) y = Math.max(y, -RY * 0.98 + (1 - dz) * 0.01);
    return new THREE.Vector3(x, y, z);
}

/** Forward relief of the face at (x, y), in metres (positive = out of the face). */
function relief(x: number, y: number): number {
    const ax = Math.abs(x);
    let r = 0;
    r -= 0.0105 * G(ax - 0.031, 0.015) * G(y - 0.012, 0.011);           // eye sockets
    r += 0.0055 * G(ax - 0.029, 0.021) * G(y - 0.031, 0.0065);          // brow ridge
    r += 0.003 * G(x, 0.02) * G(y - 0.034, 0.01);                        // glabella
    // Nose: a ridge from between the brows growing to the tip, then the wings and nostrils.
    const t = THREE.MathUtils.clamp((0.024 - y) / 0.06, 0, 1);
    const ridge = (0.003 + 0.019 * Math.pow(t, 1.5)) * (y > -0.038 ? 1 : G(y + 0.038, 0.005));
    r += ridge * G(x, 0.0065 + t * 0.004);
    r += 0.0062 * G(ax - 0.0125, 0.0065) * G(y + 0.033, 0.0055);         // alae
    r += 0.0058 * G(ax - 0.046, 0.017) * G(y + 0.004, 0.012);           // cheekbones
    r -= 0.0025 * G(ax - 0.04, 0.012) * G(y + 0.03, 0.012);             // under the cheekbone
    r += 0.0016 * G(x, 0.004) * G(y + 0.047, 0.004);                    // philtrum
    r += 0.0058 * G(x, 0.017) * G(y + 0.055, 0.0042);                   // upper lip
    r += 0.0068 * G(x, 0.015) * G(y + 0.066, 0.0045);                   // lower lip
    r -= 0.003 * G(x, 0.019) * G(y + 0.0605, 0.0016);                   // the line of the mouth
    r -= 0.0025 * G(x, 0.014) * G(y + 0.077, 0.004);                    // under the lip
    r += 0.0075 * G(x, 0.017) * G(y + 0.094, 0.011);                    // chin
    return r;
}

/** Skin tint at a face point, as a multiplier on the base skin colour. */
function tint(p: THREE.Vector3, c: THREE.Color): THREE.Color {
    const ax = Math.abs(p.x);
    c.setRGB(1, 1, 1);
    if (p.z <= 0) return c;
    const lips = (G(p.y + 0.06, 0.007) * G(p.x, 0.016));
    c.r += lips * 0.12; c.g -= lips * 0.12; c.b -= lips * 0.08;
    const cheeks = G(ax - 0.044, 0.016) * G(p.y + 0.012, 0.014);
    c.r += cheeks * 0.06; c.g -= cheeks * 0.03;
    const sockets = G(ax - 0.031, 0.016) * G(p.y - 0.01, 0.012);
    c.multiplyScalar(1 - sockets * 0.22);
    // Stubble along the jaw and upper lip: a shadow of a beard on a man on the road.
    const jaw = p.y < -0.05 ? Math.min(1, (-p.y - 0.05) / 0.02) * (1 - G(p.x, 0.01) * G(p.y + 0.06, 0.006)) : 0;
    const lipShadow = G(p.x, 0.02) * G(p.y + 0.046, 0.004) * 0.6;
    const beard = Math.max(jaw * (ax < 0.07 ? 1 : 0.4), lipShadow) * (lips > 0.5 ? 0 : 1);
    c.multiplyScalar(1 - beard * 0.2);
    c.b += beard * 0.015;
    return c;
}

let cachedHead: THREE.BufferGeometry | null = null;
let cachedHair: THREE.BufferGeometry | null = null;

function headGeometry(): THREE.BufferGeometry {
    if (!cachedHead) cachedHead = sculpt();
    return cachedHead;
}

function sculpt(): THREE.BufferGeometry {
    const g = mergeVertices(new THREE.SphereGeometry(1, 96, 72), 1e-4);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const v = skull(p.getX(i), p.getY(i), p.getZ(i));
        if (v.z > 0) v.z += relief(v.x, v.y) * THREE.MathUtils.smoothstep(v.z, 0.02, 0.06);
        p.setXYZ(i, v.x, v.y, v.z);
        tint(v, c);
        colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
}

/** Where the face surface is at (x, y), searching along z. */
function faceZ(x: number, y: number): number {
    // Invert the skull mapping numerically: march directions until x, y match.
    let best = 0, err = Infinity;
    for (let a = -1; a <= 1; a += 0.02) {
        for (let b = -1; b <= 1; b += 0.02) {
            const dz2 = 1 - a * a - b * b;
            if (dz2 <= 0) continue;
            const v = skull(a, b, Math.sqrt(dz2));
            const e = Math.hypot(v.x - x, v.y - y);
            if (e < err) { err = e; best = v.z; }
        }
    }
    return best + relief(x, y);
}

function eyeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ddd5c8';
    g.fillRect(0, 0, 128, 128);
    // The iris sits at the front (+z) of the eyeball: u = 0.25 on a SphereGeometry.
    const cx = 32, cy = 64;
    // Dark brown iris (~23° across), a small pupil, a darker limbal ring.
    g.save();
    g.translate(cx, cy);
    g.scale(1, 2);
    const iris = g.createRadialGradient(0, 0, 1, 0, 0, 8.5);
    iris.addColorStop(0, '#070504');
    iris.addColorStop(0.3, '#070504');
    iris.addColorStop(0.38, '#4a2e18');
    iris.addColorStop(0.85, '#2c1a0e');
    iris.addColorStop(1, '#120b06');
    g.fillStyle = iris;
    g.beginPath(); g.arc(0, 0, 8.5, 0, Math.PI * 2); g.fill();
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function hairShell(): THREE.BufferGeometry {
    const hairGeo = sculpt().clone();
    const hp = hairGeo.attributes.position, idx = hairGeo.index!;
    // Hairness per vertex: signed height above a smooth hairline (brow, over the ears, nape).
    // Alpha-tested against vertex alpha, so the edge follows the line, not the triangles.
    const above = new Float32Array(hp.count);
    for (let i = 0; i < hp.count; i++) {
        const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
        const front = 0.058 - 0.04 * Math.pow(Math.abs(x) / RX, 2);
        const back = THREE.MathUtils.smoothstep(-z, -0.02, 0.06);
        const line = THREE.MathUtils.lerp(front, -0.065, back);
        // Over the ears the line lifts in a soft arc.
        const ear = G(Math.abs(x) - RX, 0.02) * G(z + 0.012, 0.03) * 0.045;
        above[i] = y - (line + ear);
    }
    const keep: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        if (Math.max(above[a], above[b], above[c]) > -0.004) keep.push(a, b, c);
    }
    const rgba = new Float32Array(hp.count * 4);
    for (let i = 0; i < hp.count; i++) {
        const v = new THREE.Vector3(hp.getX(i), hp.getY(i), hp.getZ(i));
        v.addScaledVector(v.clone().normalize(), 0.0035 + Math.max(0, v.y) * 0.03);
        hp.setXYZ(i, v.x, v.y, v.z);
        rgba.set([1, 1, 1, THREE.MathUtils.clamp(0.5 + above[i] / 0.006, 0, 1)], i * 4);
    }
    hairGeo.setIndex(keep);
    hairGeo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    hairGeo.computeVertexNormals();
    return hairGeo;
}

export interface HeadParts { group: THREE.Group; skin: THREE.MeshStandardMaterial }

/** Build a head with the given skin colour (hex) and hair colour. */
export function buildHead(skinHex: number, hairHex = 0x14110f): HeadParts {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: skinHex, vertexColors: true, roughness: 0.56 });
    const head = new THREE.Mesh(headGeometry(), skin);
    head.castShadow = true;
    group.add(head);

    // Eyes, set back into the sockets, looking forward.
    const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTexture(), roughness: 0.25 });
    // Lids, ears and other parts without vertex colours use plain skin.
    const plainSkin = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.56 });
    const lidMat = plainSkin;
    for (const side of [-1, 1]) {
        const x = side * 0.031, y = 0.012;
        const z = faceZ(x, y) - 0.0085;
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0118, 24, 16), eyeMat);
        eye.position.set(x, y, z);
        group.add(eye);
        // Upper lid covers the top third; lower lid just the rim. Calm, a little hooded.
        const upper = new THREE.Mesh(new THREE.SphereGeometry(0.0127, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), lidMat);
        upper.position.copy(eye.position);
        upper.rotation.x = 0.03;
        const lower = new THREE.Mesh(new THREE.SphereGeometry(0.0124, 24, 12, 0, Math.PI * 2, Math.PI * 0.655, Math.PI * 0.345), lidMat);
        lower.position.copy(eye.position);
        group.add(upper, lower);
        // Brow: a short, slightly arched stroke over the ridge.
        const pts = [-0.019, -0.006, 0.008, 0.02].map((dx, i) => {
            const bx = x + side * dx, by = 0.03 + [0.0, 0.003, 0.003, -0.001][i];
            return new THREE.Vector3(bx, by, faceZ(bx, by) + 0.0012);
        });
        const brow = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.0022, 6), new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.9 }));
        brow.scale.set(1, 1.15, 0.7);
        group.add(brow);
    }

    const earSkin = plainSkin.clone();
    earSkin.side = THREE.DoubleSide;
    // Ears: a rim around a bowl, set just behind the jaw hinge at eye-to-nose height.
    for (const side of [-1, 1]) {
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.004 + Math.sin(t * Math.PI) * 0.016, (t - 0.5) * 0.058)); }
        const ear = new THREE.Mesh(new THREE.LatheGeometry(pts, 14, 0, Math.PI), earSkin);
        ear.scale.set(1, 1, 0.45);
        ear.rotation.set(0, side > 0 ? -Math.PI / 2 - 0.25 : Math.PI / 2 + 0.25, 0);
        ear.position.set(side * (RX - 0.004), -0.008, -0.012);
        group.add(ear);
    }

    // Hair: drawn tight back to a topknot. A shell over the scalp, above a natural hairline.
    const hairMat = new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.6, metalness: 0.05, vertexColors: true, alphaTest: 0.5 });
    if (!cachedHair) cachedHair = hairShell();
    const hairGeo = cachedHair;
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.castShadow = true;
    group.add(hair);
    // The topknot: a short folded bun on the crown, tied with a white cord.
    const knot = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.045, 6, 12), new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.6 }));
    knot.rotation.x = Math.PI / 2 - 0.25;
    knot.position.set(0, RY + 0.012, -0.005);
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0025, 6, 16), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8 }));
    cord.position.set(0, RY + 0.01, -0.028);
    group.add(knot, cord);
    return { group, skin };
}
