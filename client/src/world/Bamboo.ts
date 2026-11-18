import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Bamboo: segmented culms (internodes with raised node rings, a taper and a gentle bow) and
// leaf sprays of alpha-cut lanceolate leaves on thin side branches in the upper third. Three
// variants, unit height, instanced and scaled per stem. Presentation only.

function rng(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Hand-drawn bamboo leaves on a twig, on a transparent card. */
function leafTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const rnd = rng(31);
    // The twig runs down the middle of the card; leaves hang from it, tips down and out.
    g.strokeStyle = 'rgba(92,96,52,0.95)';
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(128, 6); g.quadraticCurveTo(122, 90, 130, 150); g.stroke();
    for (let i = 0; i < 11; i++) {
        const t = 0.08 + (i / 10) * 0.85;
        const x0 = 128 + (rnd() - 0.5) * 6, y0 = 10 + t * 140;
        const side = i % 2 ? 1 : -1;
        const angle = Math.PI / 2 + side * (0.35 + rnd() * 0.55);
        const len = 70 + rnd() * 55, wid = 9 + rnd() * 5;
        g.save();
        g.translate(x0, y0);
        g.rotate(angle - Math.PI / 2);
        const shade = 0.75 + rnd() * 0.35;
        const grad = g.createLinearGradient(-wid, 0, wid, 0);
        grad.addColorStop(0, `rgb(${58 * shade | 0},${92 * shade | 0},${38 * shade | 0})`);
        grad.addColorStop(0.5, `rgb(${92 * shade | 0},${130 * shade | 0},${56 * shade | 0})`);
        grad.addColorStop(1, `rgb(${50 * shade | 0},${84 * shade | 0},${34 * shade | 0})`);
        g.fillStyle = grad;
        // Lanceolate: widest a third of the way, a long fine tip.
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(wid, len * 0.2, wid * 0.8, len * 0.6, 0, len);
        g.bezierCurveTo(-wid * 0.8, len * 0.6, -wid, len * 0.2, 0, 0);
        g.fill();
        g.strokeStyle = `rgba(150,170,100,0.5)`;
        g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(0, 2); g.lineTo(0, len * 0.92); g.stroke();
        g.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** One culm, unit height: radius ~0.012 (scaled per instance), nodes every ~1/22 of height. */
function culmGeometry(rnd: () => number): THREE.BufferGeometry {
    const radial = 7;
    const nodes = 20 + Math.floor(rnd() * 6);
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], index: number[] = [];
    // Rings: each internode gets a few rings, with a raised band at every node.
    const rings: { y: number; r: number; tone: number }[] = [];
    for (let n = 0; n < nodes; n++) {
        const y0 = n / nodes, y1 = (n + 1) / nodes;
        const taper = (y: number) => 0.0125 * (1 - y * 0.55);
        rings.push({ y: y0, r: taper(y0) * 1.12, tone: 0.72 });
        rings.push({ y: y0 + (y1 - y0) * 0.04, r: taper(y0) * 1.0, tone: 0.82 });
        rings.push({ y: y1 - (y1 - y0) * 0.06, r: taper(y1) * 1.0, tone: 0.9 });
    }
    rings.push({ y: 1, r: 0.0125 * 0.45 * 0.6, tone: 0.8 });
    const center = (y: number) => new THREE.Vector3(0, y, 0);
    rings.forEach((ring, i) => {
        const c = center(ring.y);
        // Colour: deep green at the base, yellowing a little toward the top; nodes darker.
        const base = new THREE.Color().setHSL(0.23 - ring.y * 0.03, 0.58, 0.15 + ring.y * 0.06).multiplyScalar(ring.tone);
        for (let k = 0; k <= radial; k++) {
            const a = (k / radial) * Math.PI * 2;
            const nx = Math.cos(a), nz = Math.sin(a);
            positions.push(c.x + nx * ring.r, c.y, c.z + nz * ring.r);
            normals.push(nx, 0, nz);
            colors.push(base.r, base.g, base.b);
            if (i > 0 && k < radial) {
                const a0 = (i - 1) * (radial + 1) + k, b0 = i * (radial + 1) + k;
                index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
            }
        }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    return g;
}

/** Leaf sprays along the upper culm: crossed cards on short branches angled out and down. */
function foliageGeometry(rnd: () => number): THREE.BufferGeometry {
    const cards: THREE.BufferGeometry[] = [];
    const sprays = 16 + Math.floor(rnd() * 6);
    for (let i = 0; i < sprays; i++) {
        const h = 0.55 + rnd() * 0.45;
        const a = rnd() * Math.PI * 2;
        const reach = 0.03 + (1 - h) * 0.12 + rnd() * 0.04;
        const size = 0.09 + rnd() * 0.05;
        for (let k = 0; k < 2; k++) {
            const q = new THREE.PlaneGeometry(size, size);
            q.translate(0, -size * 0.35, 0);
            q.rotateX(0.5 + rnd() * 0.4);
            q.rotateY(a + k * Math.PI / 2 + (rnd() - 0.5) * 0.5);
            q.translate(Math.cos(a) * reach, h, Math.sin(a) * reach);
            const n = q.attributes.normal, p = q.attributes.position;
            for (let j = 0; j < n.count; j++) {
                const dx = p.getX(j), dz = p.getZ(j), l = Math.hypot(dx, dz) || 1;
                n.setXYZ(j, dx / l * 0.7, 0.7, dz / l * 0.7);
            }
            cards.push(q);
        }
    }
    return mergeGeometries(cards)!;
}

interface Kit { culms: THREE.BufferGeometry[]; leaves: THREE.BufferGeometry[]; stem: THREE.Material; foliage: THREE.Material }
let kit: Kit | null = null;

function bambooKit(): Kit {
    if (kit) return kit;
    const culms: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 3; v++) {
        const rnd = rng(101 + v * 977);
        culms.push(culmGeometry(rnd));
        leaves.push(foliageGeometry(rnd));
    }
    const stem = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.02 });
    const foliage = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, color: 0xc4d0a0 });
    kit = { culms, leaves, stem, foliage };
    return kit;
}

export interface BambooStem { x: number; y: number; z: number; height: number }

/**
 * Stems in clumps around each centre, `count` per clump, grounded by `ground`. `allow` filters
 * spots (paths, clearings, meadows).
 */
export function bambooClumps(centres: { x: number; z: number; radius: number; count: number }[], ground: (x: number, z: number) => number, allow: (x: number, z: number) => boolean, seed = 5): BambooStem[] {
    const rnd = rng(seed);
    const out: BambooStem[] = [];
    for (const c of centres) {
        for (let i = 0; i < c.count; i++) {
            const a = i * 2.399963 + rnd() * 0.6;
            const r = Math.sqrt((i + 0.5) / c.count) * c.radius * (0.85 + rnd() * 0.3);
            const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
            if (!allow(x, z)) continue;
            out.push({ x, z, y: ground(x, z), height: 8 + rnd() * 6 });
        }
    }
    return out;
}

/** Instanced bamboo for these stems. */
export function plantBamboo(stems: BambooStem[]): THREE.Group {
    const k = bambooKit();
    const group = new THREE.Group();
    const byVariant: BambooStem[][] = [[], [], []];
    stems.forEach((s, i) => byVariant[i % 3].push(s));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), t = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    byVariant.forEach((list, v) => {
        if (!list.length) return;
        const culms = new THREE.InstancedMesh(k.culms[v], k.stem, list.length);
        const leaves = new THREE.InstancedMesh(k.leaves[v], k.foliage, list.length);
        const color = new THREE.Color();
        list.forEach((s, i) => {
            // A little lean, each its own way; the leaves share the culm's transform.
            const yaw = (s.x * 12.9898 + s.z * 78.233) % (Math.PI * 2);
            q.setFromEuler(new THREE.Euler(0.02 + ((i * 0.618) % 1) * 0.05, yaw, 0, 'YXZ'));
            t.set(s.x, s.y - 0.05, s.z);
            // The unit culm is 0.0125 thick per metre of height; real culms are 4–8 cm across
            // whatever their height, so the girth is scaled separately.
            const radiusScale = (0.045 + (s.height - 8) * 0.005) / (0.0125 * s.height);
            m.compose(t, q, sc.set(s.height * radiusScale, s.height, s.height * radiusScale));
            culms.setMatrixAt(i, m);
            m.compose(t, q, sc.set(s.height, s.height, s.height));
            leaves.setMatrixAt(i, m);
            leaves.setColorAt(i, color.setHSL(0.22 + ((i * 0.37) % 1) * 0.04, 0.3, 0.55 + ((i * 0.71) % 1) * 0.15));
        });
        for (const mesh of [culms, leaves]) {
            mesh.receiveShadow = true;
            mesh.computeBoundingSphere();
        }
        // Culms cast shadows; the alpha-cut leaf cards don't. Measured in a real browser at
        // 1080p, their shadow pass held the grove just over the frame budget (docs/PERFORMANCE.md).
        culms.castShadow = true;
        group.add(culms, leaves);
    });
    return group;
}
