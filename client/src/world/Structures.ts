import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { archBridge, architecturePalette, batchStatic, building, paperLantern, post, stoneLantern, timber, torii, type Collider } from './Architecture';

type Batch = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; matrices: THREE.Matrix4[]; shadow: boolean };

export class Structures {
    private readonly root = new THREE.Group();
    private readonly geometries = new Set<THREE.BufferGeometry>();
    private readonly materials = new Set<THREE.Material>();
    private readonly batches = new Map<THREE.Group, Map<string, Batch>>();
    private readonly casters: { mesh: THREE.Mesh; center: THREE.Vector3 }[] = [];
    private readonly transform = new THREE.Object3D();
    private readonly bellPivot = new THREE.Group();
    private readonly box = this.geometry(new THREE.BoxGeometry(1, 1, 1));
    private readonly stoneShape = this.geometry(new THREE.DodecahedronGeometry(1, 0));
    private water?: THREE.MeshStandardMaterial;
    private elapsed = 0;
    private bellTime = 4;
    private built = false;
    private pendingColliders: { frame: THREE.Object3D; list: Collider[] }[] = [];
    /** World-space colliders for posts, walls and lanterns (filled by build()). */
    readonly colliders: Collider[] = [];
    /** Walkable surfaces above the terrain (the bridge deck): world (x, z) → height, or null. */
    private decks: ((x: number, z: number) => number | null)[] = [];
    /** Ground that is water or built on, where grass must not grow. */
    private covered: ((x: number, z: number) => boolean)[] = [];
    private disposed = false;

    constructor(private scene: THREE.Scene, private terrain: Terrain) {}

    private rand(x: number, z: number, salt = 0): number {
        let h = Math.imul(Math.round(x * 100), 374761393) ^ Math.imul(Math.round(z * 100), 668265263) ^ Math.imul(salt, 2246822519);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
        this.geometries.add(geometry);
        return geometry;
    }

    private material(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 1, ...extra });
        this.materials.add(material);
        return material;
    }

    private anchor(x: number, z: number, imperfect = true): THREE.Group {
        const group = new THREE.Group();
        group.position.set(x, this.terrain.sampleHeight(x, z), z);
        if (imperfect) {
            group.rotation.set((this.rand(x, z, 1) - 0.5) * 0.04, (this.rand(x, z, 2) - 0.5) * 0.08, (this.rand(x, z, 3) - 0.5) * 0.04);
            group.scale.setScalar(0.98 + this.rand(x, z, 4) * 0.04);
        }
        this.root.add(group);
        this.batches.set(group, new Map());
        return group;
    }

    private part(group: THREE.Group, material: THREE.MeshStandardMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0, geometry: THREE.BufferGeometry = this.box, shadow = true): void {
        const batches = this.batches.get(group)!;
        const key = `${material.id}:${geometry.id}:${shadow}`;
        let batch = batches.get(key);
        if (!batch) {
            batch = { geometry, material, matrices: [], shadow };
            batches.set(key, batch);
        }
        this.transform.position.set(x, y, z);
        this.transform.rotation.set(rx, ry, rz);
        this.transform.scale.set(sx, sy, sz);
        this.transform.updateMatrix();
        batch.matrices.push(this.transform.matrix.clone());
    }

    /** Add kit pieces to an anchor; their colliders become world-space after build. */
    private place(group: THREE.Group, object: THREE.Object3D, colliders: Collider[] = [], x = 0, y = 0, z = 0, yaw = 0): void {
        object.position.set(x, y, z);
        object.rotation.y = yaw;
        group.add(object);
        if (colliders.length) this.pendingColliders.push({ frame: object, list: colliders });
    }

    private ground(group: THREE.Group, x: number, z: number): number {
        return this.terrain.sampleHeight(group.position.x + x, group.position.z + z) - group.position.y;
    }

    public build(): void {
        if (this.built || this.disposed) return;
        this.built = true;
        const wood = this.material(0x513623, { roughness: 0.9 });
        const roof = this.material(0x34352d, { roughness: 0.95 });
        const stone = this.material(0x847a64);
        const moss = this.material(0x4d5b3a);
        const warm = this.material(0xd8c9a0, { emissive: 0xffb95e, emissiveIntensity: 0.3, roughness: 0.8 });
        this.buildShrine(wood, roof, stone, moss, warm);
        this.buildHamlet(wood, roof, warm);
        this.buildBattlefield(wood, stone, moss);
        this.buildBridge(stone, moss);
        this.buildPaths();
        this.root.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        for (const { frame, list } of this.pendingColliders) {
            for (const c of list) {
                v.set(c.x, 0, c.z).applyMatrix4(frame.matrixWorld);
                this.colliders.push({ x: v.x, z: v.z, radius: c.radius });
            }
        }
        this.pendingColliders = [];
        for (const [group, batches] of this.batches) {
            for (const batch of batches.values()) {
                const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
                batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
                mesh.instanceMatrix.needsUpdate = true;
                mesh.computeBoundingSphere();
                mesh.receiveShadow = true;
                group.add(mesh);
                if (batch.shadow) this.casters.push({ mesh, center: group.position.clone() });
            }
        }
        this.batches.clear();
        // Every timber, roof and lantern merged per material: a few draw calls per place.
        for (const group of [...this.root.children]) batchStatic(group, [this.bellPivot]);
        this.scene.add(this.root);
    }

    private buildShrine(_wood: THREE.MeshStandardMaterial, _roof: THREE.MeshStandardMaterial, _stone: THREE.MeshStandardMaterial, moss: THREE.MeshStandardMaterial, _warm: THREE.MeshStandardMaterial): void {
        const p = architecturePalette();
        const hall = this.anchor(-70, 6);
        // Three cut-stone tiers, then the bell hall on top: walled on three sides, open to the steps.
        for (let i = 0; i < 3; i++) hall.add(timber(p.stone, 10 - i, 0.46, 8 - i, 0, 0.23 + i * 0.45, 0));
        const floor = 1.36;
        const hallBody = building({
            width: 5, depth: 4, baysX: 2, baysZ: 2, floor: 0, wall: 3.2,
            front: 'open', back: 'plaster', left: 'boards', right: 'boards', roof: 'tile', veranda: 0, overhang: 1.1, shrine: true,
        });
        this.place(hall, hallBody.group, hallBody.colliders, 0, floor, 0);
        // The beam the bell hangs from.
        hall.add(timber(p.darkWood, 5.2, 0.2, 0.22, 0, floor + 3.05, 1.2));
        const grounds = this.anchor(-70, 6, false);
        for (let i = 0; i < 5; i++) {
            const z = 4 + i * 0.8;
            const bottom = this.ground(grounds, 0, z) - 0.15;
            const top = Math.max(bottom + 0.2, 1.3 - i * 0.24);
            grounds.add(timber(p.stone, 3.6, top - bottom, 0.86, 0, (bottom + top) / 2, z));
            if (i % 3 === 0) this.part(grounds, moss, -1, top + 0.015, z, 0.65, 0.025, 0.4, 0, 0.1, 0, this.box, false);
        }
        // The approach: road, torii, lanterns, the rival's ground, the steps, the hall.
        const gate = this.anchor(-70, 21);
        const t = torii(4.8, 5.2);
        this.place(gate, t.group, t.colliders, 0, this.ground(gate, 0, 0), 0);
        for (const [x, z] of [[-3.8, 8], [3.8, 8], [-3.2, 13.6], [3.2, 13.6]]) {
            const lantern = stoneLantern(1.8);
            this.place(grounds, lantern, [{ x: 0, z: 0, radius: 0.3 }], x, this.ground(grounds, x, z), z, this.rand(x, z, 9) * 3);
        }
        this.bellPivot.position.set(0, floor + 2.95, 1.2);
        const bronze = this.material(0x6f5a30, { roughness: 0.5, metalness: 0.6 });
        const bell = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(0.4, 0.55, 0.8, 24, 1, true)), bronze);
        bell.position.y = -0.55;
        const rim = new THREE.Mesh(this.geometry(new THREE.TorusGeometry(0.55, 0.055, 8, 24)), bronze);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.95;
        const crown = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(0.4, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)), bronze);
        crown.position.y = -0.15;
        this.bellPivot.add(bell, rim, crown);
        hall.add(this.bellPivot);
        for (const mesh of [bell, rim, crown]) this.casters.push({ mesh, center: hall.position.clone() });
    }

    private buildHamlet(_wood: THREE.MeshStandardMaterial, _roof: THREE.MeshStandardMaterial, _warm: THREE.MeshStandardMaterial): void {
        const p = architecturePalette();
        // Two farmhouses (minka) with steep thatch, raised floors, shoji onto the road side.
        for (const [cx, cz, small] of [[55, -55, 0], [63, -49, 1]]) {
            const house = this.anchor(cx, cz);
            const b = building(small
                ? { width: 4, depth: 3, baysX: 2, baysZ: 2, floor: 0.4, wall: 2.3, front: ['boards', 'shoji'], back: 'boards', left: 'plaster', right: 'boards', roof: 'thatch', veranda: 0, overhang: 0.6 }
                : { width: 7, depth: 5, baysX: 4, baysZ: 2, floor: 0.5, wall: 2.5, front: ['shoji', 'shoji', 'shoji', 'boards'], back: ['plaster', 'boards', 'boards', 'plaster'], left: 'boards', right: 'plaster', roof: 'thatch', veranda: 0.9, overhang: 0.7 });
            this.place(house, b.group, b.colliders, 0, 0, 0);
            if (!small) {
                // A string of paper lanterns along the eave, sagging between two poles.
                const z = 2.5 + 0.9 + 0.55;
                for (const x of [-3.7, 3.7]) house.add(timber(p.darkWood, 0.08, 3.1, 0.08, x, 1.55, z));
                for (let i = 0; i < 12; i++) {
                    const x = -3.4 + i * 0.62;
                    const sag = Math.sin(i / 11 * Math.PI) * 0.35;
                    house.add(timber(p.black, 0.015, 0.25, 0.015, x, 2.95 - sag, z));
                    const l = paperLantern(0.13);
                    l.position.set(x, 2.68 - sag, z);
                    house.add(l);
                }
            }
        }
        // Terraced paddies: earthen bunds, still water, young rice in rows.
        const fields = this.anchor(48, -48, false);
        const rice = riceClump();
        const shoots: THREE.Matrix4[] = [];
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), t = new THREE.Vector3();
        for (let i = 0; i < 4; i++) {
            const x = -i * 4.5, z = i * 4;
            const bottom = this.ground(fields, x, z) - 0.1;
            const top = bottom + 0.5 + i * 0.25;
            const yaw = (this.rand(x, z, 7) - 0.5) * 0.04;
            const terrace = timber(p.earth, 8.2, top - bottom, 3.8, x, (bottom + top) / 2, z);
            terrace.rotation.y = yaw;
            fields.add(terrace);
            const pool = new THREE.Mesh(this.geometry(new THREE.PlaneGeometry(7.7, 3.25)), p.water);
            pool.rotation.set(-Math.PI / 2, 0, yaw);
            pool.position.set(x, top + 0.02, z);
            fields.add(pool);
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 24; c++) {
                    const px = x - 3.6 + c * 0.31 + (this.rand(c, r, i) - 0.5) * 0.06, pz = z - 1.45 + r * 0.36 + (this.rand(r, c, i) - 0.5) * 0.06;
                    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand(px, pz, 3) * 6.28);
                    const h = 0.32 + this.rand(px, pz, 4) * 0.12;
                    shoots.push(m.compose(t.set(px, top, pz), q, sc.set(h, h, h)).clone());
                }
            }
        }
        this.covered.push((x, z) => {
            for (let i = 0; i < 4; i++) {
                if (Math.abs(x - (fields.position.x - i * 4.5)) < 4.3 && Math.abs(z - (fields.position.z + i * 4)) < 2.1) return true;
            }
            return false;
        });
        const field = new THREE.InstancedMesh(rice.geometry, rice.material, shoots.length);
        shoots.forEach((mat, i) => field.setMatrixAt(i, mat));
        field.receiveShadow = true;
        field.computeBoundingSphere();
        fields.add(field);
    }

    private buildBattlefield(wood: THREE.MeshStandardMaterial, stone: THREE.MeshStandardMaterial, moss: THREE.MeshStandardMaterial): void {
        const field = this.anchor(0, 78, false);
        const rust = this.material(0x5d5348, { roughness: 1 });
        const cloth = this.material(0x8a6a4a, { side: THREE.DoubleSide, alphaTest: 0.5, roughness: 1 });
        cloth.alphaMap = frayMask();
        const p = architecturePalette();
        const blade = abandonedBlade(rust);
        const banner = bannerCloth(cloth);
        for (let i = 0; i < 12; i++) {
            const x = (this.rand(0, 78, i + 1) - 0.5) * 24;
            const z = (this.rand(0, 78, i + 20) - 0.5) * 24;
            const h = this.ground(field, x, z);
            const o = new THREE.Group();
            for (const part of blade) o.add(new THREE.Mesh(part.geometry, part.material));
            // Driven into the earth at an angle, a hand-span of steel buried.
            o.rotation.set((this.rand(x, z, 1) - 0.5) * 0.5, this.rand(x, z, 5) * 6.28, (this.rand(x, z, 6) - 0.5) * 0.5);
            o.position.set(x, h - 0.15, z);
            o.traverse(c => { (c as THREE.Mesh).castShadow = true; });
            field.add(o);
        }
        for (let i = 0; i < 6; i++) {
            const x = (this.rand(0, 78, i + 40) - 0.5) * 26;
            const z = (this.rand(0, 78, i + 50) - 0.5) * 26;
            const h = this.ground(field, x, z);
            const height = 3.2 + this.rand(x, z, 3) * 1.2;
            const tilt = (this.rand(x, z, 4) - 0.5) * 0.16;
            // A nobori: pole, crossbar at the top, cloth hanging from both.
            const n = new THREE.Group();
            n.add(post(p.darkWood, 0.035, height, 0, 0, 0.9));
            n.add(timber(p.darkWood, 0.6, 0.03, 0.03, 0.3, height - 0.08, 0));
            const c = new THREE.Mesh(banner, cloth);
            c.position.set(0.3, height - 0.1, 0.01);
            c.castShadow = true;
            n.add(c);
            n.position.set(x, h - 0.2, z);
            n.rotation.set(tilt, this.rand(x, z, 8) * 6.28, tilt * 0.6);
            field.add(n);
            // The broken pole of another, fallen beside it.
            const fallen = post(p.darkWood, 0.035, 1.6, 0, 0, 1);
            fallen.rotation.set(Math.PI / 2 - 0.08, 0, i);
            fallen.position.set(x + 0.7, h + 0.04, z + 0.5);
            field.add(fallen);
        }
        for (let i = 0; i < 9; i++) {
            const x = (this.rand(0, 78, i + 60) - 0.5) * 26;
            const z = (this.rand(0, 78, i + 70) - 0.5) * 26;
            const h = this.ground(field, x, z);
            for (let j = 0; j < 3; j++) {
                const size = 0.5 - j * 0.1;
                const dx = (this.rand(x, z, j) - 0.5) * 0.16;
                this.part(field, stone, x + dx, h + 0.25 + j * 0.34, z, size, size * 0.65, size, 0.04 * Math.sin(i), i + j, 0.04 * Math.cos(i), this.stoneShape);
                if ((i * 3 + j) % 3 === 0) this.part(field, moss, x + dx, h + 0.25 + j * 0.34 + size * 0.55, z, size * 0.8, 0.035, size * 0.7, 0, i, 0, this.box, false);
            }
        }
    }

    private buildBridge(_stone: THREE.MeshStandardMaterial, _moss: THREE.MeshStandardMaterial): void {
        const p = architecturePalette();
        const at = this.anchor(70, 10, false);
        // The stream: a ribbon of still water along z, banks lined with stones.
        const pos: number[] = [], idx: number[] = [];
        const n = 40, half = 1.7;
        for (let i = 0; i <= n; i++) {
            const z = -18 + (36 * i) / n;
            const wiggle = Math.sin(z * 0.23) * 0.9;
            const w = half + Math.sin(z * 0.61) * 0.25;
            for (const side of [-1, 1]) {
                const x = wiggle + side * w;
                pos.push(x, this.ground(at, x, z) + 0.03, z);
            }
            if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
            for (const side of [-1, 1]) {
                if ((i + (side > 0 ? 1 : 0)) % 2) continue;
                const x = wiggle + side * (w + 0.15);
                const size = 0.25 + this.rand(x, z, 11) * 0.3;
                this.part(at, p.stone, x, this.ground(at, x, z) + size * 0.25, z, size, size * 0.55, size * 1.2, this.rand(x, z, 12), this.rand(x, z, 13) * 6, 0, this.stoneShape);
            }
        }
        this.covered.push((x, z) => {
            const lz = z - at.position.z, lx = x - at.position.x;
            return Math.abs(lz) < 18 && Math.abs(lx - Math.sin(lz * 0.23) * 0.9) < half + 0.6;
        });
        const water = this.geometry(new THREE.BufferGeometry());
        water.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        water.setIndex(idx);
        water.computeVertexNormals();
        const surface = new THREE.Mesh(water, p.water);
        surface.receiveShadow = true;
        at.add(surface);
        // The arch, crossing the stream along x.
        const bridge = archBridge(11, 3, 1.3);
        const base = this.ground(at, 0, 0);
        this.place(at, bridge.group, bridge.colliders, 0, base, 0);
        this.decks.push((x, z) => {
            const lx = x - at.position.x, lz = z - at.position.z;
            if (Math.abs(lz) > 1.35) return null;
            const h = bridge.deckHeight(lx);
            return h === null ? null : at.position.y + base + h;
        });
    }

    /** True where the ground is water or built over (no grass there). */
    public occupied(x: number, z: number): boolean {
        return this.covered.some(f => f(x, z));
    }

    /** Height of a walkable built surface at (x, z), if one is there. */
    public walkHeight(x: number, z: number): number | null {
        for (const d of this.decks) { const h = d(x, z); if (h !== null) return h; }
        return null;
    }

    private buildPaths(): void {
        // Each route is a ribbon of worn earth laid on the terrain, its edges ragged where grass
        // creeps in. The earth texture tiles in world space (uv1); the edge mask follows the strip (uv).
        const dirt = new THREE.TextureLoader().load('/textures/dirt/color.jpg');
        dirt.colorSpace = THREE.SRGBColorSpace;
        dirt.wrapS = dirt.wrapT = THREE.RepeatWrapping;
        dirt.channel = 1;
        dirt.anisotropy = 8;
        const mask = pathMask();
        const material = this.material(0xb59b78, { map: dirt, alphaMap: mask, alphaTest: 0.5, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
        for (const route of ROUTES) {
            const pts: THREE.Vector2[] = [];
            for (let j = 1; j < route.length; j++) {
                const [ax, az] = route[j - 1], [bx, bz] = route[j];
                const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.7));
                for (let i = j === 1 ? 0 : 1; i <= n; i++) pts.push(new THREE.Vector2(ax + (bx - ax) * i / n, az + (bz - az) * i / n));
            }
            // Round the corners a little.
            for (let pass = 0; pass < 3; pass++) for (let i = 1; i < pts.length - 1; i++) pts[i].lerpVectors(pts[i], pts[i - 1].clone().add(pts[i + 1]).multiplyScalar(0.5), 0.5);
            const pos: number[] = [], uv: number[] = [], uv1: number[] = [], idx: number[] = [];
            let along = 0;
            pts.forEach((p, i) => {
                const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
                const t = next.clone().sub(prev).normalize();
                if (i > 0) along += p.distanceTo(pts[i - 1]);
                const half = 1.25 + Math.sin(along * 0.37) * 0.2;
                for (const side of [-1, 1]) {
                    const x = p.x - t.y * side * half, z = p.y + t.x * side * half;
                    pos.push(x, this.terrain.sampleHeight(x, z) + 0.04, z);
                    uv.push(side < 0 ? 0 : 1, along / 6);
                    uv1.push(x / 3, z / 3);
                }
                if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
            });
            const g = this.geometry(new THREE.BufferGeometry());
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
            g.setIndex(idx);
            g.computeVertexNormals();
            const mesh = new THREE.Mesh(g, material);
            mesh.receiveShadow = true;
            this.root.add(mesh);
        }
    }

    public getBellPosition(): THREE.Vector3 {
        this.root.updateMatrixWorld(true);
        return this.bellPivot.getWorldPosition(new THREE.Vector3());
    }

    public ringBell(): void {
        if (!this.built || this.disposed) return;
        this.bellTime = 0;
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bell-rung'));
    }

    public get isRinging(): boolean {
        return this.bellTime < 4;
    }

    public update(playerPos: THREE.Vector3, dt: number): void {
        if (!this.built || this.disposed || !Number.isFinite(dt) || dt < 0) return;
        this.elapsed += dt;
        this.bellTime = Math.min(4, this.bellTime + dt);
        this.bellPivot.rotation.z = this.isRinging ? Math.sin(this.bellTime * 7.5) * 0.35 * Math.exp(-this.bellTime) * (1 - this.bellTime / 4) : 0;
        if (this.water) this.water.emissiveIntensity = 0.12 + (Math.sin(this.elapsed * 1.2) + 1) * 0.06;
        for (const { mesh, center } of this.casters) mesh.castShadow = Math.hypot(playerPos.x - center.x, playerPos.z - center.z) < 80;
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.bellTime = 4;
        this.scene.remove(this.root);
        this.root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.geometries.clear();
        this.materials.clear();
        this.batches.clear();
        this.casters.length = 0;
        this.root.clear();
    }
}

/** A curved blade with its guard and grip (unit-ish, ~1 m), pointing down -y from the grip. */
function abandonedBlade(rust: THREE.Material): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
    const shape = new THREE.Shape();
    // Edge and back follow a gentle curve; the tip is a short kissaki.
    const L = 0.72, w = 0.03, curve = (t: number) => 0.035 * t * t;
    shape.moveTo(0, 0);
    for (let i = 0; i <= 16; i++) { const t = i / 16; shape.lineTo(curve(t) + w * (1 - t * 0.25), -t * L); }
    shape.lineTo(curve(1) - 0.005, -L - 0.05);
    for (let i = 16; i >= 0; i--) { const t = i / 16; shape.lineTo(curve(t) - 0.004, -t * L); }
    const steel = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
    steel.translate(-0.015, 0, -0.003);
    const tsuba = new THREE.CylinderGeometry(0.045, 0.045, 0.008, 18);
    tsuba.rotateX(0); tsuba.translate(0, 0.005, 0);
    const grip = new THREE.CylinderGeometry(0.016, 0.018, 0.25, 10);
    grip.translate(0, 0.135, 0);
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.7, metalness: 0.5 });
    const wrap = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1 });
    return [{ geometry: steel, material: rust }, { geometry: tsuba, material: iron }, { geometry: grip, material: wrap }];
}

/** A tall banner hanging from its crossbar, stirred into folds (top edge at y = 0, x from -0.3). */
function bannerCloth(_m: THREE.Material): THREE.BufferGeometry {
    const g = new THREE.PlaneGeometry(0.55, 1.9, 6, 18);
    g.translate(0, -0.95, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, Math.sin(y * 3.1 + x * 4) * 0.05 * (-y / 1.9) + Math.sin(x * 9) * 0.015);
    }
    g.computeVertexNormals();
    return g;
}

/** Alpha for old cloth: a frayed, torn lower edge and a few holes. */
function frayMask(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#000';
    for (let x = 0; x < 64; x += 2) {
        const tear = 18 + Math.abs(Math.sin(x * 0.7) * 30 + Math.sin(x * 0.23) * 40);
        g.fillRect(x, 256 - tear, 2, tear);
    }
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(10 + k * 9 % 50, 90 + k * 23, 2 + k % 3, 0, Math.PI * 2); g.fill(); }
    return new THREE.CanvasTexture(c);
}

/** One clump of young rice: a few blades leaning out from a point (unit height). */
function riceClump(): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
    const pos: number[] = [], nrm: number[] = [];
    for (let b = 0; b < 7; b++) {
        const a = (b / 7) * Math.PI * 2, lean = 0.12 + (b % 3) * 0.08;
        const dx = Math.cos(a), dz = Math.sin(a), w = 0.012;
        const tipX = dx * lean, tipZ = dz * lean;
        // A blade: two triangles from a narrow base to a bent tip.
        pos.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, tipX * 0.5 - dz * w * 0.6, 0.55, tipZ * 0.5 + dx * w * 0.6);
        pos.push(dz * w, 0, -dx * w, tipX * 0.5 + dz * w * 0.6, 0.55, tipZ * 0.5 - dx * w * 0.6, tipX * 0.5 - dz * w * 0.6, 0.55, tipZ * 0.5 + dx * w * 0.6);
        pos.push(tipX * 0.5 - dz * w * 0.6, 0.55, tipZ * 0.5 + dx * w * 0.6, tipX * 0.5 + dz * w * 0.6, 0.55, tipZ * 0.5 - dx * w * 0.6, tipX, 1, tipZ);
        for (let k = 0; k < 9; k++) nrm.push(dx * 0.4, 0.9, dz * 0.4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return { geometry, material: new THREE.MeshStandardMaterial({ color: 0x7f9a4a, roughness: 0.8, side: THREE.DoubleSide }) };
}

/** Alpha mask across a path (u) and along it (v): a worn middle with ragged, grass-bitten edges. */
function pathMask(): THREE.CanvasTexture {
    const w = 64, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    const n = (y: number, k: number) => Math.sin(y * 0.11 + k) * 0.5 + Math.sin(y * 0.37 + k * 2.3) * 0.3 + Math.sin(y * 1.3 + k * 5.1) * 0.2;
    for (let y = 0; y < h; y++) {
        const left = 0.12 + n(y, 1) * 0.09, right = 0.88 + n(y, 7) * 0.09;
        for (let x = 0; x < w; x++) {
            const u = x / (w - 1);
            const grain = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1;
            const inside = u > left && u < right ? 1 : 0;
            const edge = Math.min(u - left, right - u);
            // Near the edge, tufts break the line.
            const a = inside && (edge > 0.06 || Math.abs(grain) > 0.45) ? 255 : 0;
            const i = (y * w + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = a; img.data[i + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapT = THREE.RepeatWrapping;
    return t;
}

/** Worn footpaths from the courtyard (x, z waypoints). Also drawn on the map. */
export const ROUTES: number[][][] = [[[0, -10], [-4, -26], [-38, -24], [-52, 6], [-60, 23], [-70, 24]], [[10, 0], [28, -3], [44, -24], [55, -51]],
    [[0, -12], [1, -34], [-2, -52], [0, -64]],
    [[11, 3], [34, 8], [52, 6], [68, 10]],
    [[0, 11], [3, 34], [-2, 52], [0, 70]]];
