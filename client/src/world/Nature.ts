import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Natural dressing for the world: textured ground, Japanese cedars, wind-moved grass, a far
// mountain range and photoscanned rocks. Textures: ambientCG (CC0). Rocks: Poly Haven (CC0).
// Everything here is presentation; nothing affects movement or combat.

// ── Shared deterministic noise (value noise, good enough for placement and colour) ────────
function hash(x: number, z: number): number {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
}
function noise(x: number, z: number): number {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, octaves = 5): number {
    let sum = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
    return sum;
}

/**
 * Open meadows break the forest: scattered clearings from low-frequency noise, plus the long
 * western meadow from the courtyard toward the Evening Bell Shrine and the setting sun.
 */
export function isMeadow(x: number, z: number): boolean {
    // The western meadow, with a ragged natural edge rather than a ruled one.
    const n = (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 14;
    if (x < -14 + n && x > -150 && z > -4 + n && z < 56 - n) return true;
    return fbm(x * 0.011 + 5, z * 0.011 - 3, 3) > 0.56;
}

// ── Textures ──────────────────────────────────────────────────────────────────────────────
const loader = new THREE.TextureLoader();
const textures = new Map<string, THREE.Texture>();
function tex(path: string, color = false): THREE.Texture {
    let t = textures.get(path);
    if (!t) {
        t = loader.load(path);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        textures.set(path, t);
    }
    return t;
}

/**
 * Ground: grass and bare earth blended by large-scale noise in world space, so the meadow
 * breaks into worn patches instead of repeating one tile.
 */
export function groundMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
        map: tex('/textures/grass/color.jpg', true),
        color: 0xb9b49a,
        roughness: 1,
    });
    // Matte: soil and turf do not mirror the low sun. Relief comes from the grass and soil normal
    // maps, applied in world space with the same world UVs as the colour (the built-in normal-map
    // path would use each chunk's own 0–1 UVs and screen derivatives, which is what failed before).
    const dirt = tex('/textures/dirt/color.jpg', true);
    const grassN = tex('/textures/grass/normal.jpg'), dirtN = tex('/textures/dirt/normal.jpg');
    m.onBeforeCompile = shader => {
        shader.uniforms.uDirt = { value: dirt };
        shader.uniforms.uGrassN = { value: grassN };
        shader.uniforms.uDirtN = { value: dirtN };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying vec3 vWorldN;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
uniform sampler2D uDirt;
uniform sampler2D uGrassN;
uniform sampler2D uDirtN;
varying vec3 vWorld;
varying vec3 vWorldN;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y); }`)
            .replace('#include <map_fragment>', `
vec2 wuv = vWorld.xz * 0.22;
vec4 g = texture2D(map, wuv);
vec4 g2 = texture2D(map, wuv * 0.37 + 0.31);
vec4 dirtCol = texture2D(uDirt, wuv * 0.8);
float n = gn(vWorld.xz * 0.045) * 0.65 + gn(vWorld.xz * 0.19) * 0.35;
float bare = smoothstep(0.58, 0.74, n);
vec3 grassCol = mix(g.rgb, g2.rgb, 0.45) * mix(vec3(0.92, 0.95, 0.82), vec3(1.08, 1.0, 0.86), gn(vWorld.xz * 0.02));
diffuseColor.rgb *= mix(grassCol, dirtCol.rgb * 0.9, bare);`)
            .replace('#include <normal_fragment_maps>', `
{
  vec3 tn = mix(texture2D(uGrassN, wuv).xyz, texture2D(uDirtN, wuv * 0.8).xyz, bare) * 2.0 - 1.0;
  tn.xy *= 0.7;
  vec3 Nw = normalize(vWorldN);
  vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
  vec3 Bw = cross(Tw, Nw);
  vec3 nW = normalize(Tw * tn.x + Bw * tn.y + Nw * tn.z);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`);
    };
    return m;
}

// ── Cedars ────────────────────────────────────────────────────────────────────────────────

/** A clump of needles on a twig, drawn once on a canvas: the card texture for every cedar. */
function needleTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.translate(128, 128);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let spray = 0; spray < 9; spray++) {
        const a = rnd() * Math.PI * 2, len = 60 + rnd() * 50;
        const bx = Math.cos(a) * len, by = Math.sin(a) * len;
        g.strokeStyle = 'rgba(52,40,26,0.8)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(bx, by); g.stroke();
        for (let i = 0; i < 46; i++) {
            const t = rnd();
            const px = bx * t, py = by * t;
            const na = a + (rnd() - 0.5) * 2.4;
            const nl = 10 + rnd() * 16 * (1.2 - t);
            const shade = 70 + rnd() * 60;
            g.strokeStyle = `rgba(${shade * 0.45 | 0},${shade | 0},${shade * 0.42 | 0},0.95)`;
            g.lineWidth = 1.6 + rnd() * 1.6;
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); g.stroke();
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

export interface TreeKit { trunk: THREE.BufferGeometry[]; foliage: THREE.BufferGeometry[]; bark: THREE.Material; needles: THREE.Material }

let kit: TreeKit | null = null;

/** Three cedar variants (height 1, scaled per instance). Card normals point away from the trunk
 * so the crown is lit like a soft volume, not a heap of flat quads. */
export function cedarKit(): TreeKit {
    if (kit) return kit;
    const bark = new THREE.MeshStandardMaterial({
        map: tex('/textures/wood/color.jpg', true), normalMap: tex('/textures/wood/normal.jpg'), color: 0x7a6a5a, roughness: 0.95,
    });
    const needles = new THREE.MeshStandardMaterial({
        map: needleTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: 0x9fb08a, roughness: 0.9,
    });
    const trunk: THREE.BufferGeometry[] = [];
    const foliage: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 3; v++) {
        let s = 17 + v * 101;
        const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        const lean = (rnd() - 0.5) * 0.04;
        const path = new THREE.CatmullRomCurve3([0, 0.3, 0.6, 1].map(t => new THREE.Vector3(lean * t * t, t, lean * 0.6 * t)));
        const tube = new THREE.TubeGeometry(path, 12, 0.012, 10);
        // Taper: flare at the root, thin at the crown.
        const p = tube.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const y = p.getY(i);
            const center = path.getPoint(Math.min(1, Math.max(0, y)));
            const k = 1.8 * (1 - y) + 0.25 + (y < 0.05 ? (0.05 - y) * 18 : 0);
            p.setX(i, center.x + (p.getX(i) - center.x) * k);
            p.setZ(i, center.z + (p.getZ(i) - center.z) * k);
        }
        tube.computeVertexNormals();
        trunk.push(tube);

        const cards: THREE.BufferGeometry[] = [];
        const tiers = 14 + v * 3;
        for (let i = 0; i < tiers; i++) {
            const h = 0.3 + 0.7 * (i / (tiers - 1)) + (rnd() - 0.5) * 0.03;
            const reach = (1 - h) * 0.32 + 0.035;
            const clumps = 3 + Math.round(reach * 14);
            for (let c = 0; c < clumps; c++) {
                const a = rnd() * Math.PI * 2;
                const r = reach * (0.45 + rnd() * 0.6);
                const cx = Math.cos(a) * r + lean * h * h, cz = Math.sin(a) * r;
                const size = 0.07 + reach * 0.55;
                for (let k = 0; k < 2; k++) {
                    const q = new THREE.PlaneGeometry(size, size * 0.8);
                    q.rotateY(a + Math.PI / 2 + k * Math.PI / 2 + (rnd() - 0.5) * 0.6);
                    q.rotateZ((rnd() - 0.5) * 0.5);
                    q.translate(cx, h - size * 0.12, cz);
                    // Normals: outward from the trunk axis, tilted up.
                    const n = q.attributes.normal;
                    const pos = q.attributes.position;
                    for (let j = 0; j < n.count; j++) {
                        const dx = pos.getX(j), dz = pos.getZ(j);
                        const l = Math.hypot(dx, dz) || 1;
                        n.setXYZ(j, dx / l * 0.8, 0.6, dz / l * 0.8);
                    }
                    cards.push(q);
                }
            }
        }
        foliage.push(mergeGeometries(cards)!);
    }
    kit = { trunk, foliage, bark, needles };
    return kit;
}

/** Instanced cedars for a set of placements (one InstancedMesh pair per variant). */
export function plantCedars(placements: { x: number; y: number; z: number; height: number }[]): THREE.Group {
    const k = cedarKit();
    const group = new THREE.Group();
    const byVariant: typeof placements[] = [[], [], []];
    for (const p of placements) byVariant[Math.floor(hash(p.x, p.z) * 3) % 3].push(p);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    byVariant.forEach((list, v) => {
        if (!list.length) return;
        const trunks = new THREE.InstancedMesh(k.trunk[v], k.bark, list.length);
        const crowns = new THREE.InstancedMesh(k.foliage[v], k.needles, list.length);
        const color = new THREE.Color();
        list.forEach((p, i) => {
            const h = p.height * 2.1;
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(p.z, p.x) * Math.PI * 2);
            m.compose(t.set(p.x, p.y - 0.1, p.z), q, s.set(h * 0.85, h, h * 0.85));
            trunks.setMatrixAt(i, m);
            crowns.setMatrixAt(i, m);
            crowns.setColorAt(i, color.setHSL(0.27 + hash(p.x, 3) * 0.05, 0.25 + hash(4, p.z) * 0.15, 0.5 + hash(p.x, p.z) * 0.18));
        });
        trunks.castShadow = crowns.castShadow = true;
        trunks.receiveShadow = crowns.receiveShadow = true;
        trunks.computeBoundingSphere();
        crowns.computeBoundingSphere();
        group.add(trunks, crowns);
    });
    return group;
}

// ── Grass ─────────────────────────────────────────────────────────────────────────────────

/**
 * A field of tapered, bending blades that travels with the player: clumps are laid on a grid
 * around the camera and re-seated on the terrain when the player moves on, so density stays
 * high where it is seen without paying for grass everywhere.
 */
export class GrassField {
    readonly mesh: THREE.InstancedMesh;
    readonly uniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };
    private center = new THREE.Vector2(1e9, 1e9);
    private readonly radius = 26;
    private readonly spacing = 0.5;

    constructor(private ground: (x: number, z: number) => number, private allow: (x: number, z: number) => boolean) {
        const blades: THREE.BufferGeometry[] = [];
        for (let b = 0; b < 9; b++) {
            const h = 0.35 + hash(b, 1) * 0.45, w = 0.022 + hash(2, b) * 0.012;
            const g = new THREE.PlaneGeometry(w, h, 1, 4);
            const p = g.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const t = (p.getY(i) + h / 2) / h;
                p.setX(i, p.getX(i) * (1 - t * 0.92));
                p.setZ(i, t * t * 0.12 * (0.5 + hash(b, 7)));
                p.setY(i, t * h);
            }
            g.rotateY(hash(b, 3) * Math.PI * 2);
            g.translate((hash(b, 5) - 0.5) * 0.28, 0, (hash(6, b) - 0.5) * 0.28);
            g.computeVertexNormals();
            blades.push(g);
        }
        const clump = mergeGeometries(blades)!;
        // Height along each blade, for root-to-tip shading and bending.
        const p = clump.attributes.position;
        const tip = new Float32Array(p.count);
        for (let i = 0; i < p.count; i++) tip[i] = Math.min(1, p.getY(i) / 0.6);
        clump.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
        mat.onBeforeCompile = shader => {
            shader.uniforms.uTime = this.uniforms.uTime;
            shader.uniforms.uWind = this.uniforms.uWind;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float tip;\nuniform float uTime;\nuniform float uWind;\nvarying float vTip;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
vTip = tip;
vec3 base = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
float gust = sin(uTime * 1.3 + base.x * 0.21 + base.z * 0.17) * 0.6 + sin(uTime * 2.7 + base.x * 0.9) * 0.25;
float bend = (gust + 0.6) * uWind * tip * tip * 0.28;
transformed.x += bend;
transformed.z += bend * 0.35;
transformed.y -= bend * bend * 0.5;`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vTip;')
                .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.38, 1.12, vTip);');
        };
        const count = Math.pow(Math.ceil((this.radius * 2) / this.spacing), 2);
        this.mesh = new THREE.InstancedMesh(clump, mat, count);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.receiveShadow = true;
        this.mesh.count = 0;
        this.mesh.setColorAt(0, new THREE.Color());
    }

    update(dt: number, at: THREE.Vector3, wind: number): void {
        this.uniforms.uTime.value += dt;
        this.uniforms.uWind.value = 0.35 + wind * 0.9;
        if (Math.hypot(at.x - this.center.x, at.z - this.center.y) < 6) return;
        this.center.set(Math.round(at.x / 4) * 4, Math.round(at.z / 4) * 4);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        const color = new THREE.Color();
        const dry = new THREE.Color(0xb5a46a), lush = new THREE.Color(0x6f8a45), deep = new THREE.Color(0x4e6a38);
        let n = 0;
        const steps = Math.ceil((this.radius * 2) / this.spacing);
        for (let i = 0; i < steps; i++) {
            for (let j = 0; j < steps; j++) {
                const gx = this.center.x - this.radius + i * this.spacing;
                const gz = this.center.y - this.radius + j * this.spacing;
                const x = gx + (hash(gx, gz) - 0.5) * this.spacing;
                const z = gz + (hash(gz, gx) - 0.5) * this.spacing;
                if (Math.hypot(x - this.center.x, z - this.center.y) > this.radius) continue;
                const dens = fbm(x * 0.06, z * 0.06, 3);
                if (dens < 0.38 || !this.allow(x, z)) continue;
                q.setFromAxisAngle(up, hash(x, z) * Math.PI * 2);
                const size = 0.55 + dens * 0.45 + hash(z, x) * 0.25;
                m.compose(t.set(x, this.ground(x, z) - 0.02, z), q, s.set(size, size * (0.65 + dens * 0.45), size));
                this.mesh.setMatrixAt(n, m);
                const tone = fbm(x * 0.03 + 9, z * 0.03, 3);
                color.copy(deep).lerp(lush, Math.min(1, tone * 1.4)).lerp(dry, Math.max(0, tone - 0.45) * 1.6);
                this.mesh.setColorAt(n, color);
                n++;
            }
        }
        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
}

// ── Mountains ─────────────────────────────────────────────────────────────────────────────

/**
 * A ring of ridged mountains beyond the playable land. Lit like terrain, then washed toward
 * the sky with distance (aerial perspective), independent of the near fog so they stay visible.
 */
export class MountainRange {
    readonly mesh: THREE.Mesh;
    private haze = { value: new THREE.Color(0x9aa6b2) };

    constructor() {
        const rings = 46, segs = 220, r0 = 240, r1 = 520;
        const pos: number[] = [], col: number[] = [], idx: number[] = [];
        const forest = new THREE.Color(0x2c3a2c), rock = new THREE.Color(0x6b665c), snow = new THREE.Color(0xe6e8ea);
        const c = new THREE.Color();
        for (let i = 0; i <= rings; i++) {
            const r = r0 + (r1 - r0) * (i / rings);
            for (let j = 0; j <= segs; j++) {
                const a = (j / segs) * Math.PI * 2;
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                // Ridged noise: sharp crests, soft valleys; taller further out.
                const ridge = 1 - Math.abs(fbm(x * 0.006 + 40, z * 0.006, 5) * 2 - 1);
                const rise = Math.min(1, (r - r0) / 70);
                const h = (ridge * ridge * 95 + fbm(x * 0.02, z * 0.02, 4) * 22) * rise * (0.55 + 0.6 * (i / rings)) - 6;
                pos.push(x, h, z);
                const k = h / 110;
                c.copy(forest).lerp(rock, THREE.MathUtils.smoothstep(k, 0.25, 0.55)).lerp(snow, THREE.MathUtils.smoothstep(k, 0.62, 0.8));
                col.push(c.r, c.g, c.b);
            }
        }
        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < segs; j++) {
                const a = i * (segs + 1) + j, b = a + segs + 1;
                // Wound so normals face up and outward toward the viewer at the centre.
                idx.push(a, a + 1, b, b, a + 1, b + 1);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, fog: false });
        m.onBeforeCompile = shader => {
            shader.uniforms.uHaze = this.haze;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying float vDist;')
                .replace('#include <project_vertex>', '#include <project_vertex>\nvDist = -mvPosition.z;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying float vDist;')
                .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nfloat air = 1.0 - exp(-vDist * 0.0042);\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(air, 0.0, 0.88));');
        };
        this.mesh = new THREE.Mesh(g, m);
        this.mesh.frustumCulled = false;
    }

    /** Follow the player horizontally (it is scenery at the horizon) and take the sky's haze. */
    update(at: THREE.Vector3, haze: THREE.Color): void {
        this.mesh.position.set(at.x, 0, at.z);
        this.haze.value.copy(haze);
    }
}

// ── Rocks ─────────────────────────────────────────────────────────────────────────────────

const ROCKS = ['boulder_a', 'boulder_b', 'boulder_c', 'rock_a', 'stones_a'];
let rockModels: Promise<THREE.Object3D[]> | null = null;

export function loadRocks(): Promise<THREE.Object3D[]> {
    if (!rockModels) {
        const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
        rockModels = Promise.all(ROCKS.map(n => gltf.loadAsync(`/models/nature/${n}.glb`).then(g => {
            g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
            const box = new THREE.Box3().setFromObject(g.scene);
            g.scene.userData.size = box.getSize(new THREE.Vector3()).length();
            g.scene.userData.bottom = box.min.y;
            return g.scene;
        })));
    }
    return rockModels;
}

/** A few rocks per chunk, half-sunk into the ground, never on paths or near landmarks. */
export function placeRocks(models: THREE.Object3D[], cx: number, cz: number, size: number, ground: (x: number, z: number) => number, allow: (x: number, z: number) => boolean): THREE.Group {
    const group = new THREE.Group();
    const count = 3 + Math.floor(hash(cx, cz) * 4);
    for (let i = 0; i < count; i++) {
        const x = (cx + hash(cx * 3 + i, cz) - 0.5) * size;
        const z = (cz + hash(cz * 5 + i, cx) - 0.5) * size;
        if (!allow(x, z)) continue;
        const src = models[Math.floor(hash(x, z) * models.length) % models.length];
        const rock = src.clone();
        const scale = (0.9 + hash(z, x) * 2.4) / Math.max(0.5, src.userData.size);
        rock.scale.setScalar(scale * 2.2);
        rock.rotation.set((hash(x, 1) - 0.5) * 0.3, hash(1, z) * Math.PI * 2, (hash(z, 2) - 0.5) * 0.3);
        rock.position.set(x, ground(x, z) - src.userData.bottom * rock.scale.y - 0.25 * rock.scale.y, z);
        group.add(rock);
    }
    return group;
}
