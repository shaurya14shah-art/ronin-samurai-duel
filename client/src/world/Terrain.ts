import * as THREE from 'three';

export class Terrain {
    private readonly perm: Uint8Array;
    public readonly chunkSize = 64;

    constructor(public readonly seed: number = 1337) {
        this.perm = new Uint8Array(512);
        const source = new Uint8Array(256);
        for (let i = 0; i < 256; i++) source[i] = i;
        let state = seed >>> 0 || 1;
        const next = () => {
            state ^= state << 13; state >>>= 0;
            state ^= state >> 17;
            state ^= state << 5; state >>>= 0;
            return state;
        };
        for (let i = 255; i > 0; i--) {
            const j = next() % (i + 1);
            const temp = source[i]; source[i] = source[j]; source[j] = temp;
        }
        for (let i = 0; i < 512; i++) this.perm[i] = source[i & 255];
    }

    private static fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private static lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    private valueNoise(x: number, z: number): number {
        const xi = Math.floor(x), zi = Math.floor(z);
        const xf = x - xi, zf = z - zi;
        const hash = (ix: number, iz: number) => this.perm[(this.perm[ix & 255] + iz) & 255] / 255;
        const u = Terrain.fade(xf), v = Terrain.fade(zf);
        const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
        return Terrain.lerp(Terrain.lerp(a, b, u), Terrain.lerp(c, d, u), v);
    }

    private fractal(x: number, z: number): number {
        let sum = 0, amplitude = 1, frequency = 1, norm = 0;
        for (let octave = 0; octave < 4; octave++) {
            sum += this.valueNoise(x * frequency, z * frequency) * amplitude;
            norm += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return sum / norm;
    }

    public readonly segments = 32;

    private vertexHeight(x: number, z: number): number {
        const radius = Math.hypot(x, z);
        if (radius <= 36) return 0;
        const t = Math.min(1, (radius - 36) / 12);
        const blend = t * t * (3 - 2 * t);
        const large = (this.fractal(x * 0.004 + 31.7, z * 0.004 + 11.3) - 0.5) * 2;
        const medium = (this.fractal(x * 0.016 + 7.9, z * 0.016 + 3.1) - 0.5) * 2;
        return Math.fround((large * 6 + medium * 0.8) * blend);
    }

    public sampleHeight(x: number, z: number): number {
        const step = this.chunkSize / this.segments;
        const gx = Math.floor(x / step) * step, gz = Math.floor(z / step) * step;
        const u = (x - gx) / step, v = (z - gz) / step;
        const a = this.vertexHeight(gx, gz), b = this.vertexHeight(gx + step, gz);
        const c = this.vertexHeight(gx, gz + step), d = this.vertexHeight(gx + step, gz + step);
        return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    }

    public buildGeometry(cx: number, cz: number): THREE.BufferGeometry {
        const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.segments, this.segments);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position as THREE.BufferAttribute;
        const normals = geometry.attributes.normal as THREE.BufferAttribute;
        const normal = new THREE.Vector3();
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i) + cx * this.chunkSize;
            const z = Math.round(positions.getZ(i)) + cz * this.chunkSize;
            positions.setZ(i, z - cz * this.chunkSize);
            positions.setY(i, this.vertexHeight(x, z));
            normal.set(this.vertexHeight(x - 2, z) - this.vertexHeight(x + 2, z), 4, this.vertexHeight(x, z - 2) - this.vertexHeight(x, z + 2)).normalize();
            normals.setXYZ(i, normal.x, normal.y, normal.z);
        }
        geometry.computeBoundingSphere();
        return geometry;
    }

    public wantedChunks(x: number, z: number, radius = 2): [number, number][] {
        const cx = Math.floor(x / this.chunkSize + 0.5), cz = Math.floor(z / this.chunkSize + 0.5);
        const chunks: [number, number][] = [];
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) chunks.push([cx + dx, cz + dz]);
        }
        return chunks.sort((a, b) => Math.hypot(a[0] * this.chunkSize - x, a[1] * this.chunkSize - z) - Math.hypot(b[0] * this.chunkSize - x, b[1] * this.chunkSize - z));
    }

    public vegetation(cx: number, cz: number): { x: number; z: number; height: number; radius: number }[] {
        let state = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ this.seed) >>> 0;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const props = [];
        const landmarks = [[-70, 6], [55, -51], [70, 10], [0, 78], [0, -76]];
        for (let i = 0; i < 70; i++) {
            const x = (cx + random() - 0.5) * this.chunkSize;
            const z = (cz + random() - 0.5) * this.chunkSize;
            const height = 5 + random() * 6, radius = 0.15 + random() * 0.2;
            if (Math.hypot(x, z) < 14 || landmarks.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 18)) continue;
            if (Math.abs(x) < 3 || Math.abs(z) < 3) continue;
            props.push({ x, z, height, radius });
        }
        return props;
    }
}
