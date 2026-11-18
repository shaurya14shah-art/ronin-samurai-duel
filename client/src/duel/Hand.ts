import * as THREE from 'three';

// A right hand closed around a katana grip, built as ONE smooth, closed surface.
//
// The hand is described as a signed distance field: a tapered "bone" (round cone) for each
// phalanx, metacarpal and thumb segment, blended with smooth unions (wide where the back of
// the hand is one mass of flesh, tight at the finger joints so creases show). The field is
// meshed with surface nets and shaded with its own gradient, so there are no seams, holes or
// facets. Built once and shared by both hands (the left is a mirror).
//
// Frame (the sword's): the grip runs along z (toward the blade at +z), the spine side is +y,
// the flat is ±x; the grip's axis passes through the origin. The fingers wrap from the knuckles
// on the upper +x side, round under the grip, to tips on the -x side under the thumb; the back
// of the hand lies over the top of the grip and runs up to the wrist.

const GRIP_R = 0.0158;
export const WRIST = new THREE.Vector3(-0.04, 0.064, -0.012);

type V = [number, number, number];
interface Bone { a: V; b: V; ra: number; rb: number; group: number }

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Distance to a round cone from a (radius ra) to b (radius rb). (After Inigo Quilez.) */
function roundCone(p: V, bone: Bone): number {
    const ba = sub(bone.b, bone.a), pa = sub(p, bone.a);
    const l2 = dot(ba, ba), rr = bone.ra - bone.rb, a2 = l2 - rr * rr, il2 = 1 / l2;
    const y = dot(pa, ba), z = y - l2;
    const xv: V = [pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y];
    const x2 = dot(xv, xv), y2 = y * y * l2, z2 = z * z * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - bone.rb;
    if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - bone.ra;
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - bone.ra;
}

/** Polynomial smooth minimum: blends two surfaces over a width k. */
function smin(a: number, b: number, k: number): number {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

const BACK = 0, FINGER = 1, THUMB = 2;

/** The skeleton of the closed hand. */
export function skeleton(): Bone[] {
    const bones: Bone[] = [];
    // Fingers: index (+z, toward the tsuba) to little. Lengths of the three phalanges, base radius.
    const fingers = [
        { z: 0.026, len: [0.044, 0.026, 0.021], r: 0.0089, mcp: 1.02 },
        { z: 0.0085, len: [0.047, 0.029, 0.022], r: 0.0093, mcp: 1.0 },
        { z: -0.009, len: [0.044, 0.028, 0.021], r: 0.0088, mcp: 1.02 },
        { z: -0.0255, len: [0.036, 0.021, 0.018], r: 0.0077, mcp: 1.1 },
    ];
    const carpal: V = [-0.03, 0.058, -0.008];
    for (const f of fingers) {
        // Each phalanx is a chord of a polygon whose sides touch a circle just outside the grip,
        // so the finger hugs the grip without sinking into it. Joints sit at the polygon corners.
        const inner = GRIP_R + f.r * 0.92;
        let phi = f.mcp;
        const corner = (ph: number, half: number): V => {
            const r = inner / Math.cos(half);
            return [Math.cos(ph) * r, Math.sin(ph) * r, f.z];
        };
        const radii = [f.r * 1.05, f.r * 0.95, f.r * 0.86, f.r * 0.78];
        let prevHalf = Math.atan(f.len[0] / 2 / inner);
        let a = corner(phi, prevHalf);
        const mcp = a;
        for (let s = 0; s < 3; s++) {
            const half = Math.atan(f.len[s] / 2 / inner);
            phi -= 2 * half;
            const nextHalf = s < 2 ? Math.atan(f.len[s + 1] / 2 / inner) : half * 0.6;
            const b = corner(phi, Math.max(half, nextHalf));
            // The distal pad presses a little into the grip, as a real grip does.
            if (s === 2) { b[0] *= 0.97; b[1] *= 0.97; }
            bones.push({ a, b, ra: radii[s], rb: radii[s + 1], group: FINGER });
            a = b;
            prevHalf = half;
        }
        // Metacarpal: knuckle to the carpus, fanning in toward the wrist.
        const c: V = [carpal[0], carpal[1], carpal[2] + f.z * 0.45];
        const knuckle: V = [mcp[0] * 1.04, mcp[1] * 1.04, mcp[2]];
        bones.push({ a: knuckle, b: c, ra: f.r * 1.2, rb: 0.0105, group: BACK });
    }
    // The fleshy mass of the back and palm, and the wrist joining the forearm.
    // The palm: two broad flat bones across the hand fill it out under the metacarpals.
    for (const z of [0.016, 0, -0.016]) bones.push({ a: [0.013, 0.03, z * 1.2], b: [-0.028, 0.054, z * 0.6], ra: 0.0135, rb: 0.013, group: BACK });
    bones.push({ a: carpal, b: [WRIST.x, WRIST.y, WRIST.z], ra: 0.0165, rb: 0.0175, group: BACK });
    // Thumb: from the ball of the thumb behind the index side, round the far side of the grip,
    // its pad resting on the index and middle fingers.
    const t0: V = [-0.028, 0.046, 0.016], t1: V = [-0.037, 0.026, 0.03], t2: V = [-0.032, 0.006, 0.037], t3: V = [-0.02, -0.006, 0.039];
    bones.push({ a: t0, b: t1, ra: 0.0135, rb: 0.0108, group: THUMB });
    bones.push({ a: t1, b: t2, ra: 0.0108, rb: 0.0096, group: THUMB });
    bones.push({ a: t2, b: t3, ra: 0.0096, rb: 0.0084, group: THUMB });
    // The thenar pad (ball of the thumb) fills the palm side.
    bones.push({ a: [-0.024, 0.044, 0.004], b: t0, ra: 0.016, rb: 0.0135, group: THUMB });
    return bones;
}

export function field(bones: Bone[]): (p: V) => number {
    const back = bones.filter(b => b.group === BACK), fingers = bones.filter(b => b.group === FINGER), thumb = bones.filter(b => b.group === THUMB);
    return p => {
        let d = 1;
        for (const b of back) d = smin(d, roundCone(p, b), 0.02);          // one mass of flesh; tendons only hinted
        let f = 1;
        for (let i = 0; i < fingers.length; i += 3) {
            // Phalanges joined tightly (a crease at each joint), each finger kept separate.
            let one = roundCone(p, fingers[i]);
            one = smin(one, roundCone(p, fingers[i + 1]), 0.0025);
            one = smin(one, roundCone(p, fingers[i + 2]), 0.0025);
            f = Math.min(f, one);
        }
        d = smin(d, f, 0.006);                                               // knuckles flow into the back
        let t = roundCone(p, thumb[3]);
        for (let i = 0; i < 3; i++) t = smin(t, roundCone(p, thumb[i]), 0.003);
        return smin(d, t, 0.009);
    };
}

/** Surface nets over the field: one vertex per surface cell, quads across sign-changing edges. */
function mesh(f: (p: V) => number, min: V, max: V, h: number): THREE.BufferGeometry {
    const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
    const values = new Float32Array(nx * ny * nz);
    const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
    // Coarse pass every 4 cells; the exact field is only evaluated near the surface.
    const C = 4, cx = Math.ceil(nx / C) + 1, cy = Math.ceil(ny / C) + 1, cz = Math.ceil(nz / C) + 1;
    const coarse = new Float32Array(cx * cy * cz);
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
        coarse[i + cx * (j + cy * k)] = f([min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h]);
    }
    const far = C * h * 1.8;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = coarse[Math.round(i / C) + cx * (Math.round(j / C) + cy * Math.round(k / C))];
        // The field is 1-Lipschitz, so a coarse value this far from zero keeps its sign nearby.
        values[at(i, j, k)] = Math.abs(c) > far ? c : f([min[0] + i * h, min[1] + j * h, min[2] + k * h]);
    }
    const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cell = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
    const pos: number[] = [];
    const corners: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const v = corners.map(([a, b, c]) => values[at(i + a, j + b, k + c)]);
        let inside = 0;
        for (const x of v) if (x < 0) inside++;
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [e0, e1] of edges) {
            const a = v[e0], b = v[e1];
            if ((a < 0) === (b < 0)) continue;
            const t = a / (a - b);
            const c0 = corners[e0], c1 = corners[e1];
            sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; n++;
        }
        cellVert[cell(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
    }
    const idx: number[] = [];
    const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const v0 = values[at(i, j, k)] < 0;
        // Edge along +x from (i,j,k): shared by the four cells around it in y,z.
        if (i < nx - 1 && v0 !== (values[at(i + 1, j, k)] < 0)) quad(cellVert[cell(i, j - 1, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i, j - 1, k)], v0);
        if (j < ny - 1 && v0 !== (values[at(i, j + 1, k)] < 0)) quad(cellVert[cell(i - 1, j, k - 1)], cellVert[cell(i - 1, j, k)], cellVert[cell(i, j, k)], cellVert[cell(i, j, k - 1)], v0);
        if (k < nz - 1 && v0 !== (values[at(i, j, k + 1)] < 0)) quad(cellVert[cell(i - 1, j - 1, k)], cellVert[cell(i, j - 1, k)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)], v0);
    }
    // Normals from the field's gradient: smooth everywhere, true to the shape.
    const nrm = new Float32Array(pos.length);
    const e = h * 0.5;
    for (let q = 0; q < pos.length; q += 3) {
        const p: V = [pos[q], pos[q + 1], pos[q + 2]];
        const gx = f([p[0] + e, p[1], p[2]]) - f([p[0] - e, p[1], p[2]]);
        const gy = f([p[0], p[1] + e, p[2]]) - f([p[0], p[1] - e, p[2]]);
        const gz = f([p[0], p[1], p[2] + e]) - f([p[0], p[1], p[2] - e]);
        const l = Math.hypot(gx, gy, gz) || 1;
        nrm[q] = gx / l; nrm[q + 1] = gy / l; nrm[q + 2] = gz / l;
    }
    // Wind every triangle so it faces outward (along the gradient), whatever axis made it.
    for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const out = fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
        if (out < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
}

/** Skin colour: knuckles and fingertips a little redder, the creases a touch darker. */
function tone(g: THREE.BufferGeometry, bones: Bone[]): void {
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const joints: V[] = bones.filter(b => b.group === FINGER).map(b => b.a);
    const tips: V[] = bones.filter((b, i) => b.group === FINGER && i % 4 === 2).map(b => b.b);
    for (let i = 0; i < p.count; i++) {
        const v: V = [p.getX(i), p.getY(i), p.getZ(i)];
        let red = 0;
        for (const j of joints) { const d = Math.hypot(...sub(v, j)); red = Math.max(red, Math.exp(-(d * d) / 0.00012)); }
        for (const t of tips) { const d = Math.hypot(...sub(v, t)); red = Math.max(red, 0.8 * Math.exp(-(d * d) / 0.0001)); }
        col.set([1 + red * 0.06, 0.97 - red * 0.06, 0.95 - red * 0.07], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * 30; uv[i * 2 + 1] = (p.getY(i) + p.getZ(i) * 0.5) * 30; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

let cached: THREE.BufferGeometry | null = null;

/** The closed right hand's surface (shared). Resolution 1.3 mm. */
export function handGeometry(): THREE.BufferGeometry {
    if (cached) return cached;
    const bones = skeleton();
    const g = mesh(field(bones), [-0.066, -0.04, -0.05], [0.05, 0.09, 0.062], 0.0013);
    tone(g, bones);
    g.computeBoundingSphere();
    cached = g;
    return g;
}

/** A right fist around the grip; mirror with scale.x = -1 for the left. */
export function makeHand(skin: THREE.Material, _cover?: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(handGeometry(), skin));
    return g;
}

function skinTextures(): { normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
    const S = 256;
    const heights = new Float32Array(S * S);
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 2600; i++) {
        const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
        heights[y * S + x] -= 0.6 + rnd() * 0.4; // pores
    }
    for (let l = 0; l < 60; l++) {
        // Fine skin lines.
        let x = rnd() * S, y = rnd() * S;
        const a = rnd() * Math.PI;
        for (let k = 0; k < 40; k++) { x += Math.cos(a); y += Math.sin(a) * 0.4; heights[((Math.floor(y) % S + S) % S) * S + ((Math.floor(x) % S + S) % S)] -= 0.3; }
    }
    const n = document.createElement('canvas'), r = document.createElement('canvas');
    n.width = n.height = r.width = r.height = S;
    const ng = n.getContext('2d')!, rg = r.getContext('2d')!;
    const ni = ng.createImageData(S, S), ri = rg.createImageData(S, S);
    const at = (x: number, y: number) => heights[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 0.6, dy = (at(x, y + 1) - at(x, y - 1)) * 0.6;
        const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
        ni.data[i] = (-dx / l * 0.5 + 0.5) * 255; ni.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; ni.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; ni.data[i + 3] = 255;
        const rough = 0.5 + Math.max(-0.2, at(x, y)) * -0.3 + rnd() * 0.06;
        ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rough * 255; ri.data[i + 3] = 255;
    }
    ng.putImageData(ni, 0, 0); rg.putImageData(ri, 0, 0);
    const normalMap = new THREE.CanvasTexture(n), roughnessMap = new THREE.CanvasTexture(r);
    for (const t of [normalMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); }
    return { normalMap, roughnessMap };
}

let skinMaps: ReturnType<typeof skinTextures> | null = null;

/** Physical skin: sheen for the soft scattering at grazing angles, pores, slight oil. */
export function skinMaterial(tone: number, vertexColors = true): THREE.MeshPhysicalMaterial {
    if (!skinMaps && typeof document !== 'undefined') skinMaps = skinTextures();
    return new THREE.MeshPhysicalMaterial({
        color: tone, vertexColors, roughness: 1, roughnessMap: skinMaps?.roughnessMap ?? null,
        normalMap: skinMaps?.normalMap ?? null, normalScale: new THREE.Vector2(0.25, 0.25),
        sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xb05a40),
    });
}

/** Colour a forearm (lathe along y, elbow at 0): paler on the inside, weathered toward the back of the wrist. */
export function tintForearm(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(z, x);
        const inside = Math.max(0, Math.sin(a));              // the inner forearm sees less sun
        const vein = Math.exp(-((a - 1.2) ** 2) / 0.02) * Math.max(0, Math.sin(y * 9)) * 0.04;
        const k = 0.94 + inside * 0.08 - vein - (1 - y) * 0.03;
        col.set([k * 1.0, k * 0.97, k * 0.95], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 6);
    return g;
}

/**
 * Tekko: the cloth guards swordsmen bound over the forearm and the back of the hand. Indigo
 * cotton quilted with sashiko stitches, worn soft at the edges.
 */
export function tekkoMaterial(): THREE.MeshPhysicalMaterial {
    const S = 256;
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let map: THREE.CanvasTexture | null = null, bump: THREE.CanvasTexture | null = null;
    if (c) {
        c.width = c.height = S;
        const g = c.getContext('2d')!;
        g.fillStyle = '#1d2433'; g.fillRect(0, 0, S, S);
        let seed = 3;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        // Weave: fine cross-hatching of slightly different blues.
        for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${40 + rnd() * 30},${50 + rnd() * 30},${80 + rnd() * 40},0.25)`; g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1); }
        // Sashiko: a grid of short running stitches with small crosses (jūji-zashi).
        g.strokeStyle = 'rgba(220,214,196,0.85)'; g.lineWidth = 1.6; g.setLineDash([5, 4]);
        for (let k = 8; k < S; k += 32) {
            g.beginPath(); g.moveTo(0, k); g.lineTo(S, k); g.stroke();
            g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.stroke();
        }
        g.setLineDash([]);
        map = new THREE.CanvasTexture(c);
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(2, 3);
        const b = document.createElement('canvas'); b.width = b.height = S;
        const bg = b.getContext('2d')!;
        bg.fillStyle = '#808080'; bg.fillRect(0, 0, S, S);
        bg.strokeStyle = '#303030'; bg.lineWidth = 2; bg.setLineDash([5, 4]);
        for (let k = 8; k < S; k += 32) { bg.beginPath(); bg.moveTo(0, k); bg.lineTo(S, k); bg.stroke(); bg.beginPath(); bg.moveTo(k, 0); bg.lineTo(k, S); bg.stroke(); }
        bump = new THREE.CanvasTexture(b);
        bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
        bump.repeat.copy(map.repeat);
    }
    return new THREE.MeshPhysicalMaterial({ color: 0x9096a6, map, bumpMap: bump, bumpScale: 1.5, roughness: 0.92, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x4a5a80) });
}
