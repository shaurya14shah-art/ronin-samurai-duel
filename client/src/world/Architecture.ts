import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A small kit of Japanese timber architecture, built procedurally so it reads as the real
// thing up close: round tapered posts, beams with eased edges, torii with an upswept kasagi,
// roofs that sag between ridge and eave and lift at the corners (tiled or thatched), shoji
// with kumiko lattice that glows from inside, and stone lanterns turned on a lathe.
// Everything returns plain meshes in a Group; callers place them. Presentation only, except
// `colliders`, which callers may hand to the walker so bodies don't pass through posts and walls.

export interface Collider { x: number; z: number; radius: number }

// ── Textures (procedural, generated once) ──────────────────────────────────────────────────

const loader = new THREE.TextureLoader();
function file(path: string, color: boolean, repeat = 1): THREE.Texture {
    const t = loader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')!];
}

/** Normal map from a height function sampled on a square grid (tileable if `h` is). */
function normalFromHeight(size: number, h: (x: number, y: number) => number, strength: number): THREE.CanvasTexture {
    const [c, g] = canvas(size);
    const img = g.createImageData(size, size);
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = h(x, y);
    const at = (x: number, y: number) => H[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
            const l = Math.hypot(dx, dy, 1);
            const i = (y * size + x) * 4;
            img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
            img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
            img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
            img.data[i + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

function hash(x: number, y: number): number {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/** Kawara: rows of round clay tiles. One texture = two tile columns × two courses. */
function tileHeight(x: number, y: number, size: number): number {
    const col = (x / size) * 2, course = (y / size) * 2;
    const round = Math.cos((col % 1) * Math.PI * 2) * 0.5 + 0.5;
    const lap = course % 1; // each course slopes down to its overlap with the next
    return round * 0.7 + (1 - lap) * 0.45 + (lap > 0.94 ? -0.4 : 0);
}

function tileTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
    const size = 256;
    const [c, g] = canvas(size);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const h = tileHeight(x, y, size);
            const tile = Math.floor(x / size * 2) + Math.floor(y / size * 2) * 2;
            const v = (0.32 + h * 0.18 + (hash(tile, 3) - 0.5) * 0.06 + (hash(x, y) - 0.5) * 0.03) * 255;
            const i = (y * size + x) * 4;
            img.data[i] = v * 0.94; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 1.04; img.data[i + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const normalMap = normalFromHeight(size, (x, y) => tileHeight(x, y, size), 6);
    normalMap.anisotropy = 8;
    return { map, normalMap };
}

/** Thatch: dense straw laid in courses, the cut ends pointing down the slope. */
function thatchTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
    const size = 256;
    const H = new Float32Array(size * size);
    let s = 9;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 2600; k++) {
        const x0 = rnd() * size, y0 = rnd() * size, len = 18 + rnd() * 30, lean = (rnd() - 0.5) * 0.25, depth = 0.4 + rnd() * 0.6;
        for (let t = 0; t < len; t++) {
            const x = Math.floor(x0 + lean * t + size) % size, y = Math.floor(y0 + t) % size;
            H[y * size + x] = Math.max(H[y * size + x], depth * (0.6 + 0.4 * t / len));
        }
    }
    const [c, g] = canvas(size);
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
        const h = H[i];
        const v = 0.28 + h * 0.42;
        img.data[i * 4] = v * 190; img.data[i * 4 + 1] = v * 158; img.data[i * 4 + 2] = v * 104; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const normalMap = normalFromHeight(size, (x, y) => H[y * size + x], 3);
    return { map, normalMap };
}

/** Shoji: washi paper in a wooden kumiko lattice. The emissive map lights only the paper. */
function shojiTextures(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
    const size = 256;
    const draw = (paper: string, wood: string) => {
        const [c, g] = canvas(size);
        g.fillStyle = paper;
        g.fillRect(0, 0, size, size);
        if (paper !== '#000') {
            // Fibres in the paper.
            for (let i = 0; i < 400; i++) {
                g.fillStyle = `rgba(150,130,100,${0.03 + hash(i, 1) * 0.05})`;
                g.fillRect(hash(i, 2) * size, hash(i, 3) * size, 1 + hash(i, 4) * 6, 1);
            }
        }
        g.fillStyle = wood;
        const bar = 5;
        for (let i = 0; i <= 3; i++) g.fillRect(Math.round(i * (size - bar) / 3), 0, bar, size);
        for (let j = 0; j <= 4; j++) g.fillRect(0, Math.round(j * (size - bar) / 4), size, bar);
        g.fillRect(0, 0, size, 12); g.fillRect(0, size - 12, size, 12);
        g.fillRect(0, 0, 10, size); g.fillRect(size - 10, 0, 10, size);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    };
    return { map: draw('#e9e0cc', '#5a4230'), emissiveMap: draw('#ffffff', '#000000') };
}

// ── Materials ──────────────────────────────────────────────────────────────────────────────

export interface Palette {
    wood: THREE.MeshStandardMaterial;
    darkWood: THREE.MeshStandardMaterial;
    lacquer: THREE.MeshStandardMaterial;
    black: THREE.MeshStandardMaterial;
    tile: THREE.MeshStandardMaterial;
    thatch: THREE.MeshStandardMaterial;
    plaster: THREE.MeshStandardMaterial;
    shoji: THREE.MeshStandardMaterial;
    stone: THREE.MeshStandardMaterial;
    lanternLight: THREE.MeshStandardMaterial;
    water: THREE.MeshStandardMaterial;
    earth: THREE.MeshStandardMaterial;
}

let palette: Palette | null = null;

export function architecturePalette(): Palette {
    if (palette) return palette;
    const woodMap = file('/textures/wood/color.jpg', true, 1), woodNormal = file('/textures/wood/normal.jpg', false, 1);
    const stoneMap = file('/textures/rock/color.jpg', true, 1), stoneNormal = file('/textures/rock/normal.jpg', false, 1);
    const tile = tileTextures(), thatch = thatchTextures(), shoji = shojiTextures();
    palette = {
        wood: new THREE.MeshStandardMaterial({ map: woodMap, normalMap: woodNormal, color: 0x9a7556, roughness: 0.85 }),
        darkWood: new THREE.MeshStandardMaterial({ map: woodMap, normalMap: woodNormal, color: 0x4e3a2c, roughness: 0.9 }),
        lacquer: new THREE.MeshStandardMaterial({ color: 0xa8381f, roughness: 0.48, normalMap: woodNormal, normalScale: new THREE.Vector2(0.25, 0.25) }),
        black: new THREE.MeshStandardMaterial({ color: 0x1c1916, roughness: 0.55 }),
        tile: new THREE.MeshStandardMaterial({ map: tile.map, normalMap: tile.normalMap, color: 0x8e949c, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
        thatch: new THREE.MeshStandardMaterial({ map: thatch.map, normalMap: thatch.normalMap, color: 0xb7a07a, roughness: 1, side: THREE.DoubleSide }),
        plaster: new THREE.MeshStandardMaterial({ color: 0xd4cbb6, roughness: 0.95 }),
        shoji: new THREE.MeshStandardMaterial({ map: shoji.map, emissiveMap: shoji.emissiveMap, emissive: 0xffb262, emissiveIntensity: 0.35, roughness: 0.9 }),
        stone: new THREE.MeshStandardMaterial({ map: stoneMap, normalMap: stoneNormal, color: 0xa79d8a, roughness: 0.95 }),
        lanternLight: new THREE.MeshStandardMaterial({ color: 0xf2dcb0, emissive: 0xffa94d, emissiveIntensity: 1.6, roughness: 0.9 }),
        // Still, shallow water: dark, reflecting the sky through the environment map.
        water: new THREE.MeshStandardMaterial({ color: 0x2f4140, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -1 }),
        earth: new THREE.MeshStandardMaterial({ map: file('/textures/dirt/color.jpg', true, 1), normalMap: file('/textures/dirt/normal.jpg', false, 1), color: 0x9b8468, roughness: 1 }),
    };
    return palette;
}

/** Night glow for lit paper (0 by day, 1 deep at night). */
export function setArchitectureNight(night: number): void {
    if (!palette) return;
    palette.shoji.emissiveIntensity = 0.08 + night * 0.9;
    palette.lanternLight.emissiveIntensity = 0.4 + night * 2.2;
}

// ── Geometry helpers ───────────────────────────────────────────────────────────────────────

/** World-scale UVs for box-like geometry: textures keep their size whatever the part's size. */
function worldUV(g: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
    const p = g.attributes.position, n = g.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        const [u, v] = ax > 0.6 ? [p.getZ(i), p.getY(i)] : ay > 0.6 ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
        uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true): THREE.Mesh {
    const o = new THREE.Mesh(g, m);
    o.castShadow = shadow;
    o.receiveShadow = true;
    return o;
}

/** A squared timber with eased edges, centred at (x, y, z). */
export function timber(m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
    const g = worldUV(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.025, w / 4, h / 4, d / 4)), 0.8);
    const o = mesh(g, m);
    o.position.set(x, y, z);
    return o;
}

/** A round post standing on y = 0, tapering slightly to the top. */
export function post(m: THREE.Material, radius: number, height: number, x = 0, z = 0, taper = 0.9): THREE.Mesh {
    const g = new THREE.CylinderGeometry(radius * taper, radius, height, 16, 1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * radius * 6, uv.getY(i) * height * 0.8);
    const o = mesh(g, m);
    o.position.set(x, height / 2, z);
    return o;
}

/**
 * A beam swept along x from -half to +half whose centreline height is y(x), with a rectangular
 * section (h tall, d deep) kept perpendicular to the curve. For kasagi and curved lintels.
 */
function sweptBeam(half: number, y: (x: number) => number, h: number, d: number, steps = 40, endCut = 0): THREE.BufferGeometry {
    const strips: THREE.BufferGeometry[] = [];
    const frames: { c: THREE.Vector2; n: THREE.Vector2 }[] = [];
    for (let i = 0; i <= steps; i++) {
        const x = -half + (2 * half * i) / steps;
        const e = 1e-3;
        const t = new THREE.Vector2(2 * e, y(x + e) - y(x - e)).normalize();
        frames.push({ c: new THREE.Vector2(x, y(x)), n: new THREE.Vector2(-t.y, t.x) });
    }
    // Four faces: top, bottom, front, back. Corner (s, k): s = ±1 across the height, k = ±1 in depth.
    const face = (a: [number, number], b: [number, number]) => {
        const pos: number[] = [], uv: number[] = [], idx: number[] = [];
        frames.forEach((f, i) => {
            for (const [s, k] of [a, b]) {
                pos.push(f.c.x + f.n.x * s * h / 2, f.c.y + f.n.y * s * h / 2, k * d / 2);
                uv.push(f.c.x, (s + k) * 0.25);
            }
            if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
    };
    strips.push(face([1, 1], [1, -1]), face([-1, -1], [-1, 1]), face([-1, 1], [1, 1]), face([1, -1], [-1, -1]));
    // End caps, cut at an angle (`endCut`) like the ends of a kasagi.
    for (const end of [0, frames.length - 1]) {
        const f = frames[end], dir = end === 0 ? -1 : 1;
        const pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, k]) => new THREE.Vector3(f.c.x + f.n.x * s * h / 2 + dir * (s > 0 ? endCut : 0), f.c.y + f.n.y * s * h / 2, k * d / 2));
        const g = new THREE.BufferGeometry().setFromPoints(dir > 0 ? [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]] : [pts[0], pts[2], pts[1], pts[0], pts[3], pts[2]]);
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
        g.computeVertexNormals();
        strips.push(g.toNonIndexed());
    }
    return mergeGeometries(strips.map(s => s.index ? s.toNonIndexed() : s))!;
}

// ── Torii ──────────────────────────────────────────────────────────────────────────────────

/**
 * A myōjin torii: two round pillars leaning slightly inward on stone bases, a nuki tie beam
 * passing through them, a centre strut (gakuzuka), and the kasagi (black-capped) sweeping up
 * at both ends over a shimaki. `span` is between pillar centres; `height` to the kasagi top.
 */
export function torii(span: number, height: number): { group: THREE.Group; colliders: Collider[] } {
    const p = architecturePalette();
    const g = new THREE.Group();
    const r = span * 0.055;
    const lean = 0.02;
    for (const side of [-1, 1]) {
        const pillar = post(p.lacquer, r, height - 0.55, side * span / 2, 0, 0.92);
        pillar.rotation.z = side * lean;
        pillar.position.x -= side * lean * (height - 0.55) / 2;
        g.add(pillar);
        // Kamebara base and the black ring (nemaki) where the pillar meets it.
        const base = mesh(new THREE.CylinderGeometry(r * 1.55, r * 1.8, 0.4, 20), p.stone);
        base.position.set(side * span / 2, 0.2, 0);
        const nemaki = mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.08, 0.35, 20), p.black);
        nemaki.position.set(side * span / 2, 0.55, 0);
        g.add(base, nemaki);
    }
    const nukiY = height * 0.72;
    g.add(timber(p.lacquer, span + r * 6, r * 0.9, r * 0.75, 0, nukiY, 0));
    // Wedges (kusabi) where the nuki passes through each pillar.
    for (const side of [-1, 1]) g.add(timber(p.lacquer, r * 0.3, r * 0.9, r * 0.5, side * (span / 2 - lean * nukiY + r * 1.15), nukiY, r * 0.55));
    const kasagiY = height - 0.12;
    const half = span / 2 + r * 6.5;
    const sweep = (x: number) => 0.26 * Math.pow(Math.abs(x) / half, 2.6);
    const shimaki = mesh(sweptBeam(half - r * 1.2, x => kasagiY - 0.32 + sweep(x) * 0.8, 0.26, r * 1.5, 40), p.lacquer);
    const kasagi = mesh(sweptBeam(half, x => kasagiY - 0.04 + sweep(x), 0.18, r * 1.9, 48, 0.08), p.black);
    g.add(shimaki, kasagi);
    // Gakuzuka: the short centre strut, and a plain plaque on it.
    g.add(timber(p.lacquer, r * 0.9, kasagiY - 0.45 - nukiY - r * 0.45, r * 0.7, 0, (kasagiY - 0.45 + nukiY + r * 0.45) / 2, 0));
    g.add(timber(p.black, r * 1.5, r * 2.2, r * 0.3, 0, (kasagiY - 0.45 + nukiY) / 2 + 0.05, r * 0.45));
    return { group: g, colliders: [-1, 1].map(s => ({ x: s * span / 2, z: 0, radius: r * 1.6 })) };
}

// ── Roofs ──────────────────────────────────────────────────────────────────────────────────

export interface RoofSpec {
    /** Length along the ridge (x), eaves included. */
    length: number;
    /** Horizontal distance from ridge to eave on each side (z). */
    run: number;
    /** Height of the ridge above the eave line. */
    rise: number;
    /** Concavity of the slope (0 straight, 0.2 a temple sag). */
    sag: number;
    /** How far the four corners lift (m). */
    upturn: number;
    thickness: number;
    material: THREE.Material;
    /** Metres per texture repeat. */
    texScale: number;
}

/** Height of the roof's upper surface above the eave line at fraction v of the run (0 ridge, 1 eave). */
export function roofProfile(spec: Pick<RoofSpec, 'rise' | 'sag'>, v: number): number {
    return spec.rise * (1 - v) - spec.sag * spec.rise * Math.sin(Math.PI * v) * 0.5;
}

/** A gable roof (kirizuma) with curved slopes, lifted corners and a solid edge, ridge along x. */
export function gableRoof(spec: RoofSpec): THREE.Group {
    const g = new THREE.Group();
    const nu = 24, nv = 12;
    const L = spec.length / 2;
    const surface = (side: number, offset: number) => {
        const pos: number[] = [], uv: number[] = [], idx: number[] = [];
        for (let j = 0; j <= nv; j++) {
            const v = j / nv;
            for (let i = 0; i <= nu; i++) {
                const u = -L + (2 * L * i) / nu;
                const corner = Math.pow(Math.abs(u) / L, 4) * v * v;
                const y = roofProfile(spec, v) + spec.upturn * corner - offset;
                const z = side * v * spec.run;
                pos.push(u, y, z);
                const slope = v * Math.hypot(spec.run, spec.rise);
                uv.push(u / spec.texScale, slope / spec.texScale);
                if (i > 0 && j > 0) {
                    const a = (j - 1) * (nu + 1) + i - 1, b = a + 1, c = a + nu + 1, d = c + 1;
                    // Wind so the outer face points up and away from the ridge.
                    if ((side > 0) === (offset === 0)) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
                }
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return geo;
    };
    for (const side of [-1, 1]) {
        g.add(mesh(surface(side, 0), spec.material));
        g.add(mesh(surface(side, spec.thickness), spec.material, false));
        // The eave and verge edges: thin strips joining the two surfaces.
        const top = surface(side, 0).attributes.position, bottom = surface(side, spec.thickness).attributes.position;
        const edge = (indices: number[]) => {
            const pos: number[] = [];
            for (let k = 1; k < indices.length; k++) {
                const a = indices[k - 1], b = indices[k];
                const A = [top.getX(a), top.getY(a), top.getZ(a)], B = [top.getX(b), top.getY(b), top.getZ(b)];
                const C = [bottom.getX(a), bottom.getY(a), bottom.getZ(a)], D = [bottom.getX(b), bottom.getY(b), bottom.getZ(b)];
                pos.push(...A, ...C, ...B, ...B, ...C, ...D);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
            geo.computeVertexNormals();
            return mesh(geo, spec.material === architecturePalette().thatch ? spec.material : architecturePalette().darkWood, false);
        };
        const row = (j: number) => Array.from({ length: nu + 1 }, (_, i) => j * (nu + 1) + i);
        const col = (i: number) => Array.from({ length: nv + 1 }, (_, j) => j * (nu + 1) + i);
        g.add(edge(row(nv)), edge(col(0)), edge(col(nu)));
    }
    return g;
}

/** Ridge cap along x, with raised end tiles (onigawara) for tiled roofs. */
export function ridge(length: number, y: number, m: THREE.Material, radius: number, ends: THREE.Material | null): THREE.Group {
    const g = new THREE.Group();
    const cap = mesh(new THREE.CylinderGeometry(radius, radius, length, 14), m);
    cap.rotation.z = Math.PI / 2;
    cap.position.y = y;
    g.add(cap);
    if (ends) for (const side of [-1, 1]) g.add(timber(ends, 0.18, radius * 3.2, radius * 2.6, side * length / 2, y + radius * 0.8, 0));
    return g;
}

/** Gable infill below a roof, following its underside (`outline`: [z, height] from -D to +D). Faces ±x at `x`. */
export function gableEnd(x: number, outline: [number, number][], baseY: number, m: THREE.Material): THREE.Mesh {
    const shape = new THREE.Shape([new THREE.Vector2(outline[0][0], 0), ...outline.map(([z, h]) => new THREE.Vector2(z, h)), new THREE.Vector2(outline[outline.length - 1][0], 0)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    const o = mesh(geo, m);
    o.position.set(x - 0.04, baseY, 0);
    return o;
}

// ── Walls ──────────────────────────────────────────────────────────────────────────────────

export type WallKind = 'shoji' | 'plaster' | 'boards' | 'open';

/** One bay of wall between two posts, from a to b (x, z) at floor height y, `h` tall. */
export function wallBay(kind: WallKind, a: [number, number], b: [number, number], y: number, h: number): THREE.Group {
    const p = architecturePalette();
    const g = new THREE.Group();
    if (kind === 'open') return g;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.position.set(mid[0], y, mid[1]);
    g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    // Sill (shikii) and head (kamoi) rails frame every bay.
    g.add(timber(p.darkWood, len, 0.1, 0.14, 0, 0.05, 0));
    g.add(timber(p.darkWood, len, 0.12, 0.14, 0, h * 0.78, 0));
    if (kind === 'shoji') {
        const panels = Math.max(2, Math.round(len / 0.9));
        const pw = len / panels;
        for (let i = 0; i < panels; i++) {
            const geo = new THREE.PlaneGeometry(pw - 0.02, h * 0.78 - 0.1);
            const o = mesh(geo, p.shoji, false);
            o.position.set(-len / 2 + pw * (i + 0.5), 0.1 + (h * 0.78 - 0.1) / 2, (i % 2) * 0.03 - 0.015);
            const back = o.clone();
            back.rotation.y = Math.PI;
            g.add(o, back);
        }
        // Plaster transom above the head rail.
        g.add(timber(p.plaster, len, h * 0.22 - 0.06, 0.08, 0, h * 0.89, 0));
    } else {
        const m = kind === 'plaster' ? p.plaster : p.wood;
        g.add(timber(m, len, h - 0.1, 0.08, 0, h / 2 + 0.05, 0));
        if (kind === 'boards') for (let i = 1; i < Math.round(len / 0.25); i++) g.add(timber(p.darkWood, 0.03, h - 0.12, 0.1, -len / 2 + i * 0.25, h / 2 + 0.05, 0));
    }
    return g;
}

/** Circles along a wall so a walker cannot pass through it. */
export function wallColliders(a: [number, number], b: [number, number], spacing = 0.45, radius = 0.22): Collider[] {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / spacing));
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a[0] + (b[0] - a[0]) * i / n, z: a[1] + (b[1] - a[1]) * i / n, radius }));
}

// ── Buildings ──────────────────────────────────────────────────────────────────────────────

export interface BuildingSpec {
    /** Footprint between post centres: width along x (ridge), depth along z. */
    width: number;
    depth: number;
    /** Bays along x and z (posts = bays + 1). */
    baysX: number;
    baysZ: number;
    /** Raised floor height (0 for an earth floor). */
    floor: number;
    /** Post height above the floor to the wall plate. */
    wall: number;
    /** Wall kinds: front (+z), back (-z), left (-x), right (+x); one per bay or one for all. */
    front: WallKind | WallKind[];
    back: WallKind | WallKind[];
    left: WallKind | WallKind[];
    right: WallKind | WallKind[];
    roof: 'tile' | 'thatch';
    /** Veranda depth on the front (0 for none). */
    veranda: number;
    overhang: number;
    /** Shinto ridge ornaments: crossed chigi at the gables and katsuogi billets on the ridge. */
    shrine?: boolean;
}

/** A timber building: posts, sills and plates, walls, a floor and veranda, and its roof. */
export function building(s: BuildingSpec): { group: THREE.Group; colliders: Collider[] } {
    const p = architecturePalette();
    const g = new THREE.Group();
    const colliders: Collider[] = [];
    const W = s.width / 2, D = s.depth / 2;
    const xs = Array.from({ length: s.baysX + 1 }, (_, i) => -W + (s.width * i) / s.baysX);
    const zs = Array.from({ length: s.baysZ + 1 }, (_, i) => -D + (s.depth * i) / s.baysZ);
    const postR = 0.11;
    const top = s.floor + s.wall;
    // Posts on the perimeter, standing on stones; the floor and veranda on short legs.
    for (const x of xs) for (const z of zs) {
        if (x !== xs[0] && x !== xs[xs.length - 1] && z !== zs[0] && z !== zs[zs.length - 1]) continue;
        g.add(post(p.wood, postR, top, x, z, 0.95));
        const stone = mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.16, 9), p.stone);
        stone.position.set(x, 0.05, z);
        g.add(stone);
    }
    if (s.floor > 0) {
        g.add(timber(p.darkWood, s.width + 0.2, 0.08, s.depth + 0.2, 0, s.floor - 0.04, 0));
        if (s.veranda > 0) {
            const vz = D + s.veranda / 2 + 0.1;
            g.add(timber(p.wood, s.width + 0.2, 0.06, s.veranda, 0, s.floor - 0.06, vz));
            for (const x of xs) g.add(post(p.darkWood, 0.06, s.floor - 0.09, x, D + s.veranda + 0.05, 1));
            // Steps up to the veranda in the middle bay.
            for (let k = 0; k < Math.ceil(s.floor / 0.2); k++) {
                g.add(timber(p.wood, 1.2, 0.06, 0.3, 0, s.floor - 0.12 - k * 0.2, D + s.veranda + 0.25 + k * 0.28));
            }
        }
    }
    // Wall plates (keta) and tie beams (hari) at the top of the posts.
    for (const z of [-D, D]) g.add(timber(p.darkWood, s.width + 0.6, 0.18, 0.16, 0, top + 0.09, z));
    for (const x of [-W, W]) g.add(timber(p.darkWood, 0.16, 0.18, s.depth + 0.3, x, top + 0.09, 0));
    // Walls, bay by bay.
    const sideWalls = (kinds: WallKind | WallKind[], pts: [number, number][]) => {
        for (let i = 1; i < pts.length; i++) {
            const kind = Array.isArray(kinds) ? kinds[i - 1] ?? 'open' : kinds;
            g.add(wallBay(kind, pts[i - 1], pts[i], s.floor, s.wall));
            if (kind !== 'open') colliders.push(...wallColliders(pts[i - 1], pts[i]));
        }
    };
    sideWalls(s.front, xs.map(x => [x, D] as [number, number]));
    sideWalls(s.back, xs.map(x => [x, -D] as [number, number]));
    sideWalls(s.left, zs.map(z => [-W, z] as [number, number]));
    sideWalls(s.right, zs.map(z => [W, z] as [number, number]));
    for (const x of xs) for (const z of [-D, D]) colliders.push({ x, z, radius: postR + 0.05 });
    // Roof: ridge along x.
    const run = D + s.overhang + (s.veranda > 0 ? s.veranda * 0.6 : 0);
    const thatched = s.roof === 'thatch';
    const rise = thatched ? run * 1.05 : run * 0.62;
    const spec: RoofSpec = {
        length: s.width + s.overhang * 2 + (thatched ? 0.4 : 0), run, rise,
        sag: thatched ? 0.04 : 0.16, upturn: thatched ? 0.05 : 0.28, thickness: thatched ? 0.45 : 0.12,
        material: thatched ? p.thatch : p.tile, texScale: thatched ? 1.6 : 0.6,
    };
    const roof = gableRoof(spec);
    // The roof's underside rests on the wall plates (top + 0.18) where it crosses them.
    const plate = top + 0.18;
    const eaveY = plate + spec.thickness - roofProfile(spec, D / run);
    roof.position.y = eaveY;
    g.add(roof);
    // Gable ends closed between the plates and the underside of the roof.
    const outline: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
        const z = -D + (2 * D * i) / 12;
        outline.push([z, Math.max(0.02, eaveY + roofProfile(spec, Math.abs(z) / run) - spec.thickness - plate)]);
    }
    // Gable infill only where the end wall is closed; an open shelter shows its roof timbers.
    const closed = (k: WallKind | WallKind[]) => (Array.isArray(k) ? k.some(x => x !== 'open') : k !== 'open');
    for (const side of [-1, 1]) if (closed(side < 0 ? s.left : s.right)) g.add(gableEnd(side * (W + 0.02), outline, plate, thatched ? p.darkWood : p.plaster));
    g.add(ridge(spec.length + 0.1, eaveY + rise + (thatched ? 0.12 : 0.04), thatched ? p.darkWood : p.tile, thatched ? 0.26 : 0.13, thatched ? null : p.tile));
    if (s.shrine) {
        // Katsuogi billets across the ridge and chigi boards crossing at each gable.
        for (let i = 0; i < 5; i++) {
            const k = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 12), p.darkWood);
            k.rotation.x = Math.PI / 2;
            k.position.set(-s.width * 0.35 + (i * s.width * 0.7) / 4, eaveY + rise + 0.2, 0);
            g.add(k);
        }
        for (const side of [-1, 1]) for (const lean of [-1, 1]) {
            const c = timber(p.darkWood, 0.08, 1.5, 0.2, side * (s.width / 2 + s.overhang - 0.05), eaveY + rise + 0.35, lean * 0.3);
            c.rotation.x = lean * 0.55;
            g.add(c);
        }
    }
    return { group: g, colliders };
}

// ── Stone lantern (tōrō) and paper lanterns ────────────────────────────────────────────────

/** A kasuga-style stone lantern, about `height` tall, with a lit chamber. */
export function stoneLantern(height = 1.9): THREE.Group {
    const p = architecturePalette();
    const k = height / 1.9;
    const g = new THREE.Group();
    const lathe = (pts: [number, number][], segs: number) => {
        const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * k, y * k)), segs);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
        return mesh(geo, p.stone);
    };
    g.add(lathe([[0, 0], [0.34, 0], [0.34, 0.1], [0.28, 0.16], [0.16, 0.22], [0, 0.22]], 6));
    g.add(lathe([[0, 0.2], [0.11, 0.2], [0.1, 0.62], [0.12, 0.66], [0.11, 0.7], [0, 0.7]], 16));
    g.add(lathe([[0, 0.68], [0.2, 0.7], [0.3, 0.8], [0.3, 0.86], [0, 0.86]], 6));
    // The light chamber: open windows on a hexagonal box, glowing paper inside.
    const glow = mesh(new THREE.CylinderGeometry(0.15 * k, 0.15 * k, 0.28 * k, 6), p.lanternLight, false);
    glow.position.y = 1.0 * k;
    g.add(glow);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const pillar = timber(p.stone, 0.05 * k, 0.3 * k, 0.05 * k, Math.cos(a) * 0.21 * k, 1.0 * k, Math.sin(a) * 0.21 * k);
        g.add(pillar);
    }
    // Kasa: a broad hexagonal roof with curled corners, then the hōju finial.
    g.add(lathe([[0, 1.14], [0.46, 1.14], [0.48, 1.19], [0.3, 1.3], [0.12, 1.42], [0, 1.44]], 6));
    g.add(lathe([[0, 1.42], [0.07, 1.45], [0.1, 1.53], [0.06, 1.63], [0, 1.68]], 12));
    return g;
}

/** A hanging paper lantern (chōchin). */
export function paperLantern(radius = 0.16): THREE.Group {
    const p = architecturePalette();
    const g = new THREE.Group();
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new THREE.Vector2(radius * (0.55 + 0.45 * Math.sin(Math.PI * t)), (t - 0.5) * radius * 2.6));
    }
    g.add(mesh(new THREE.LatheGeometry(pts, 14), p.lanternLight, false));
    for (const y of [-1, 1]) {
        const cap = mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, radius * 0.25, 14), p.black, false);
        cap.position.y = y * radius * 1.35;
        g.add(cap);
    }
    return g;
}

// ── Bridge ─────────────────────────────────────────────────────────────────────────────────

/**
 * A stone arch bridge spanning x from -span/2 to +span/2, `width` across (z). The deck rises
 * `rise` at the crown; `deckHeight(x)` gives its walking surface (local) for the walker.
 */
export function archBridge(span: number, width: number, rise: number): { group: THREE.Group; deckHeight: (x: number) => number | null; colliders: Collider[] } {
    const p = architecturePalette();
    const g = new THREE.Group();
    const half = span / 2;
    const top = (x: number) => 0.15 + rise * Math.max(0, 1 - (x / half) ** 2);
    // The body: deck curve on top, a semicircular-ish arch opening below, extruded across.
    const shape = new THREE.Shape();
    const opening = half * 0.45, archTop = rise * 0.75;
    shape.moveTo(-half, -0.4);
    for (let i = 0; i <= 32; i++) { const x = -half + (span * i) / 32; shape.lineTo(x, top(x)); }
    shape.lineTo(half, -0.4);
    shape.lineTo(opening, -0.4);
    for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI;
        shape.lineTo(Math.cos(a) * opening, -0.4 + Math.sin(a) * (archTop + 0.4));
    }
    shape.lineTo(-half, -0.4);
    const body = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 24 });
    body.translate(0, 0, -width / 2);
    const uv = body.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.4, uv.getY(i) * 0.4);
    g.add(mesh(body, p.stone));
    // Voussoirs: a ring of dressed stones around the arch on each face.
    for (const z of [-width / 2 - 0.03, width / 2 + 0.03]) {
        for (let i = 0; i < 11; i++) {
            const a = ((i + 0.5) / 11) * Math.PI;
            const r = opening + 0.18;
            const stone = timber(p.stone, 0.22, 0.42, 0.08, Math.cos(a) * r, -0.4 + Math.sin(a) * (archTop + 0.4 + 0.18), z);
            stone.rotation.z = a - Math.PI / 2;
            g.add(stone);
        }
    }
    // Parapets following the deck, with capped posts at the ends and the crown.
    for (const side of [-1, 1]) {
        const rail = mesh(sweptBeam(half - 0.15, x => top(x) + 0.32, 0.5, 0.22, 32), p.stone);
        rail.position.z = side * (width / 2 - 0.11);
        g.add(rail);
        for (const x of [-half + 0.15, 0, half - 0.15]) {
            const postMesh = post(p.stone, 0.15, 0.9, x, side * (width / 2 - 0.11), 0.95);
            postMesh.position.y += top(x) - 0.05;
            const cap = mesh(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), p.stone);
            cap.scale.y = 1.4;
            cap.position.set(x, top(x) + 0.85, side * (width / 2 - 0.11));
            g.add(postMesh, cap);
        }
    }
    const colliders: Collider[] = [];
    for (const side of [-1, 1]) for (let i = 0; i <= Math.round(span / 0.5); i++) colliders.push({ x: -half + i * 0.5, z: side * (width / 2 + 0.05), radius: 0.18 });
    return { group: g, colliders, deckHeight: x => (Math.abs(x) <= half ? top(x) : null) };
}

// ── Static batching ────────────────────────────────────────────────────────────────────────

/**
 * Merge every plain (non-instanced, non-skinned) mesh under `root` into one mesh per material
 * and vertex layout, baked into `root`'s space. Hundreds of timbers become a handful of draw
 * calls. Objects under any node in `keep` (moving parts, like the bell) are left alone.
 */
export function batchStatic(root: THREE.Object3D, keep: THREE.Object3D[] = []): void {
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const kept = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (keep.includes(p)) return true; return false; };
    const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean; meshes: THREE.Mesh[] }>();
    root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material) || kept(m)) return;
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1', 'color'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
        const layout = Object.keys(g.attributes).sort().map(k => `${k}${g.attributes[k].itemSize}`).join(',');
        const key = `${(m.material as THREE.Material).uuid}|${layout}|${m.castShadow}`;
        let entry = groups.get(key);
        if (!entry) groups.set(key, entry = { material: m.material as THREE.Material, geos: [], shadow: m.castShadow, meshes: [] });
        entry.geos.push(g);
        entry.meshes.push(m);
    });
    for (const { material, geos, shadow, meshes } of groups.values()) {
        if (meshes.length < 2) continue;
        const merged = mergeGeometries(geos);
        if (!merged) continue;
        for (const m of meshes) m.removeFromParent();
        const batch = new THREE.Mesh(merged, material);
        batch.castShadow = shadow;
        batch.receiveShadow = true;
        root.add(batch);
    }
}
