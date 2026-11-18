import * as THREE from 'three';
import type { Terrain } from './Terrain';

export type Weather = 'clear' | 'fog' | 'rain' | 'wind';
type WeatherWeights = Record<Weather, number>;
type LightState = { color: THREE.Color; intensity: number; position: THREE.Vector3 };

export class Atmosphere {
    public static readonly DAY_LENGTH = 2400;
    private readonly root = new THREE.Group();
    private readonly sky = new THREE.Group();
    private readonly geometries = new Set<THREE.BufferGeometry>();
    private readonly materials = new Set<THREE.Material>();
    private readonly transform = new THREE.Object3D();
    private readonly cameraPosition = new THREE.Vector3();
    private readonly cameraQuaternion = new THREE.Quaternion();
    private readonly starMaterial = this.material(new THREE.PointsMaterial({ color: 0xdfe8ff, size: 0.45, map: softDot(), alphaTest: 0.02, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    private readonly rainMaterial = this.material(new THREE.PointsMaterial({ color: 0xa8c0d8, size: 0.06, transparent: true, opacity: 0, depthWrite: false }));
    private readonly moonMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0x181a20, emissive: 0xf3ead2, emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
    private readonly stars: THREE.Points;
    private readonly rain: THREE.Points;
    private readonly moon: THREE.Mesh;
    private readonly rainSpeeds = new Float32Array(1400);
    private readonly birdLines: THREE.LineSegments;
    private readonly smoke: THREE.InstancedMesh;
    private readonly fires: THREE.InstancedMesh;
    private readonly smokeSites = [new THREE.Vector3(6, 0, 66), new THREE.Vector3(-8, 0, 74), new THREE.Vector3(58, 0, -52)];
    private readonly sunState: LightState = { color: new THREE.Color(), intensity: 0, position: new THREE.Vector3() };
    private readonly moonState: LightState = { color: new THREE.Color(0x8ea6cc), intensity: 0, position: new THREE.Vector3() };
    private readonly fogState = { color: new THREE.Color(), density: 0, background: new THREE.Color() };
    private readonly weights: WeatherWeights = { clear: 1, fog: 0, rain: 0, wind: 0 };
    private weatherFrom: WeatherWeights = { ...this.weights };
    private weather: Weather = 'clear';
    private transitionTime = 0;
    private transitionDuration = 0;
    private timeOfDay = 0.32;
    private elapsed = 0;
    private weatherTimer = 0;
    private weatherIndex = 0;
    /** Pinned weather (title screen, photo mode): no cycling while set. */
    private pinned: Weather | null = null;
    /** Multiplier on fog density, for presentation moments that want long views. */
    public fogScale = 1;

    public pinWeather(w: Weather | null, transitionSec = 0): void {
        this.pinned = w;
        if (w) this.setWeather(w, transitionSec);
    }
    private starOpacity = 0;
    private disposed = false;

    constructor(private scene: THREE.Scene, _renderer: THREE.WebGLRenderer | undefined, private camera: THREE.Camera, private terrain: Terrain) {
        // Stars sit on the far sky sphere and are depth-tested, so terrain, trees and the
        // player's own body hide them (they used to draw over everything as white specks).
        const starPositions = new Float32Array(420 * 3);
        for (let i = 0; i < 420; i++) {
            const y = 0.08 + 0.92 * (i + 0.5) / 420;
            const r = Math.sqrt(1 - y * y);
            starPositions[i * 3] = Math.cos(i * 2.399963) * r;
            starPositions[i * 3 + 1] = y;
            starPositions[i * 3 + 2] = Math.sin(i * 2.399963) * r;
        }
        this.stars = new THREE.Points(this.positions(starPositions), this.starMaterial);
        this.stars.frustumCulled = false;
        this.stars.renderOrder = -20;
        this.moon = new THREE.Mesh(this.geometry(new THREE.CircleGeometry(0.024, 24)), this.moonMaterial);
        this.moon.frustumCulled = false;
        this.moon.renderOrder = -19;
        this.sky.add(this.stars, this.moon);
        this.root.add(this.sky);
        const rainPositions = new Float32Array(1400 * 3);
        for (let i = 0; i < 1400; i++) {
            this.recycleRain(rainPositions, i, false);
            this.rainSpeeds[i] = 22 + this.random(i, 4) * 10;
        }
        this.rain = new THREE.Points(this.positions(rainPositions), this.rainMaterial);
        this.rain.frustumCulled = false;
        this.root.add(this.rain);
        const birdMaterial = this.material(new THREE.LineBasicMaterial({ color: 0x28251f }));
        this.birdLines = new THREE.LineSegments(this.positions(new Float32Array(6 * 4 * 3)), birdMaterial);
        this.birdLines.frustumCulled = false;
        this.root.add(this.birdLines);
        const smokeMaterial = this.material(new THREE.MeshBasicMaterial({ color: 0x8b857a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
        this.smoke = this.instances(new THREE.PlaneGeometry(1, 1), smokeMaterial, 15);
        this.smoke.receiveShadow = false;
        const fireMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0x793c22, emissive: 0xe85c20, emissiveIntensity: 1.2, roughness: 1 }));
        this.fires = this.instances(new THREE.DodecahedronGeometry(1, 0), fireMaterial, 3);
        this.smokeSites.forEach((site, i) => {
            site.y = terrain.sampleHeight(site.x, site.z);
            this.transform.position.set(site.x, site.y + 0.12, site.z);
            this.transform.rotation.set(0, i, 0);
            this.transform.scale.set(0.4, 0.16, 0.35);
            this.setMatrix(this.fires, i);
        });
        this.scene.add(this.root);
        this.refreshStates();
        this.update(0, new THREE.Vector3());
    }

    private random(i: number, salt: number): number {
        let h = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
        this.geometries.add(geometry);
        return geometry;
    }

    private material<T extends THREE.Material>(material: T): T {
        this.materials.add(material);
        return material;
    }

    private positions(array: Float32Array): THREE.BufferGeometry {
        const geometry = this.geometry(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage));
        return geometry;
    }

    private instances(geometry: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
        const mesh = new THREE.InstancedMesh(this.geometry(geometry), material, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.root.add(mesh);
        return mesh;
    }

    private setMatrix(mesh: THREE.InstancedMesh, index: number): void {
        this.transform.updateMatrix();
        mesh.setMatrixAt(index, this.transform.matrix);
        mesh.instanceMatrix.needsUpdate = true;
    }

    public setTimeOfDay(t01: number): void {
        if (!Number.isFinite(t01) || this.disposed) return;
        this.timeOfDay = ((t01 % 1) + 1) % 1;
        this.refreshStates();
    }

    public getTimeOfDay(): number {
        return this.timeOfDay;
    }

    public getWeather(): string {
        return this.weather;
    }

    public setWeather(next: Weather, transitionSec = 8): void {
        if (this.disposed || !Object.prototype.hasOwnProperty.call(this.weights, next)) return;
        this.weatherFrom = { ...this.weights };
        this.weather = next;
        this.transitionTime = 0;
        this.transitionDuration = Number.isFinite(transitionSec) ? Math.max(0, transitionSec) : 8;
        this.updateWeather(0);
        this.refreshStates();
    }

    private updateWeather(dt: number): void {
        this.transitionTime = Math.min(this.transitionDuration, this.transitionTime + dt);
        const t = this.transitionDuration === 0 ? 1 : this.transitionTime / this.transitionDuration;
        const blend = t * t * (3 - 2 * t);
        for (const key of Object.keys(this.weights) as Weather[]) this.weights[key] = THREE.MathUtils.lerp(this.weatherFrom[key], key === this.weather ? 1 : 0, blend);
    }

    public getWindStrength(): number {
        const gust = Math.pow(Math.max(0, Math.sin(this.elapsed * 0.45)), 4) * (0.75 + 0.25 * Math.sin(this.elapsed * 1.7));
        return THREE.MathUtils.clamp(0.08 + this.weights.rain * 0.15 + this.weights.wind * (0.2 + gust * 0.72), 0, 1);
    }

    public getSunState(): LightState {
        return { color: this.sunState.color.clone(), intensity: this.sunState.intensity, position: this.sunState.position.clone() };
    }

    public getMoonState(): LightState {
        return { color: this.moonState.color.clone(), intensity: this.moonState.intensity, position: this.moonState.position.clone() };
    }

    public getFogState(): { color: THREE.Color; density: number; background: THREE.Color } {
        return { color: this.fogState.color.clone(), density: this.fogState.density, background: this.fogState.background.clone() };
    }

    public getStarOpacity(): number {
        return this.starOpacity;
    }

    public getNightFactor(): number {
        const angle = (this.timeOfDay - 0.25) * Math.PI * 2;
        const height = Math.sin(angle);
        return 1 - THREE.MathUtils.smoothstep(height, -0.25, 0.12);
    }

    private refreshStates(): void {
        const angle = (this.timeOfDay - 0.25) * Math.PI * 2;
        const height = Math.sin(angle);
        const day = THREE.MathUtils.smoothstep(height, -0.15, 0.3);
        const night = 1 - THREE.MathUtils.smoothstep(height, -0.25, 0.12);
        const horizon = 1 - THREE.MathUtils.smoothstep(Math.abs(height), 0, 0.45);
        const warm = new THREE.Color(this.timeOfDay < 0.5 ? 0xffc9a0 : 0xff9a66);
        const cloud = this.weights.fog * 0.25 + this.weights.rain * 0.6;
        this.sunState.color.setHex(0x8ea6cc).lerp(warm, day).lerp(new THREE.Color(0xfff4e0), THREE.MathUtils.smoothstep(height, 0.1, 0.7));
        this.sunState.intensity = (0.06 + day * (0.3 + Math.max(0, height) * 2)) * (1 - cloud);
        this.sunState.position.set(Math.cos(angle) * 120, height * 120, 40);
        this.moonState.position.copy(this.sunState.position).negate();
        this.moonState.intensity = night * Math.max(0, -height) * 0.22 * (1 - cloud);
        this.fogState.color.setHex(0x1b2436).lerp(new THREE.Color(0x9db4c4), day).lerp(warm, horizon * 0.32);
        this.fogState.color.lerp(new THREE.Color(0x8d999f), (this.weights.fog * 0.35 + this.weights.rain * 0.25) * (0.2 + day * 0.8));
        this.fogState.density = (0.006 + night * 0.004 + horizon * 0.004) * (1 + this.weights.fog * 1.8 + this.weights.rain * 1.2) * this.fogScale;
        this.fogState.background.copy(this.fogState.color);
        this.starOpacity = night * (1 - 0.85 * this.weights.fog - 0.9 * this.weights.rain);
        this.starMaterial.opacity = this.starOpacity;
        this.rainMaterial.opacity = this.weights.rain * 0.55;
        this.moonMaterial.opacity = night * (1 - cloud);
    }

    private recycleRain(positions: Float32Array, i: number, top: boolean): void {
        const salt = Math.floor(this.elapsed * 13);
        const angle = this.random(i, salt + 1) * Math.PI * 2;
        const radius = Math.sqrt(this.random(i, salt + 2)) * 40;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = top ? 26 + this.random(i, salt + 3) * 6 : this.random(i, 3) * 32;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
    }

    public update(dt: number, playerPos: THREE.Vector3): void {
        if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
        this.elapsed += dt;
        if (this.pinned === null) this.weatherTimer += dt;
        if (this.weatherTimer >= 180) {
            this.weatherTimer %= 180;
            this.weatherIndex++;
            this.setWeather((['clear', 'wind', 'fog', 'rain', 'clear'] as Weather[])[this.weatherIndex % 5], 18);
        }
        this.timeOfDay = (this.timeOfDay + dt / Atmosphere.DAY_LENGTH) % 1;
        this.updateWeather(dt);
        this.refreshStates();
        this.camera.getWorldPosition(this.cameraPosition);
        this.camera.getWorldQuaternion(this.cameraQuaternion);
        const far = (this.camera as THREE.PerspectiveCamera).far;
        const radius = Number.isFinite(far) ? Math.max(1, Math.min(380, far * 0.8)) : 380;
        this.sky.position.copy(this.cameraPosition);
        this.sky.scale.setScalar(radius);
        this.stars.rotation.z = this.timeOfDay * Math.PI * 2;
        this.stars.visible = this.starOpacity > 0.001;
        this.moon.position.copy(this.moonState.position).normalize();
        this.moon.quaternion.copy(this.cameraQuaternion);
        this.moon.visible = this.moon.position.y > -0.05 && this.moonMaterial.opacity > 0.001;
        this.rain.visible = this.weights.rain > 0.001;
        if (this.rain.visible) {
            this.rain.position.copy(playerPos);
            const positions = this.rain.geometry.attributes.position.array as Float32Array;
            for (let i = 0; i < 1400; i++) {
                const index = i * 3;
                positions[index] += dt * (1 + this.getWindStrength() * 5);
                positions[index + 1] -= dt * this.rainSpeeds[i];
                const ground = this.terrain.sampleHeight(playerPos.x + positions[index], playerPos.z + positions[index + 2]);
                if (positions[index + 1] + playerPos.y < ground || Math.hypot(positions[index], positions[index + 2]) > 40) this.recycleRain(positions, i, true);
            }
            this.rain.geometry.attributes.position.needsUpdate = true;
        }
        const birdPositions = this.birdLines.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < 6; i++) {
            const flock = Math.floor(i / 3);
            const angle = this.elapsed * 0.23 + i * 0.2;
            const radius = 16 + i % 3 * 2;
            const x = (flock ? 48 : -50) + Math.cos(angle) * radius;
            const z = (flock ? -48 : -60) + Math.sin(angle) * radius;
            const y = this.terrain.sampleHeight(x, z) + 18 + Math.sin(this.elapsed * 0.7 + i);
            const flap = Math.sin(this.elapsed * 7 + i) * 0.16;
            birdPositions.setXYZ(i * 4, x - Math.cos(angle) * 0.5, y + flap, z - Math.sin(angle) * 0.5);
            birdPositions.setXYZ(i * 4 + 1, x, y, z);
            birdPositions.setXYZ(i * 4 + 2, x, y, z);
            birdPositions.setXYZ(i * 4 + 3, x + Math.cos(angle) * 0.5, y + flap, z + Math.sin(angle) * 0.5);
        }
        birdPositions.needsUpdate = true;
        this.transform.quaternion.copy(this.cameraQuaternion);
        for (let i = 0; i < 15; i++) {
            const site = this.smokeSites[Math.floor(i / 5)];
            const phase = (this.elapsed * 0.035 + i * 0.2) % 1;
            const fade = Math.sin(phase * Math.PI);
            this.transform.position.set(site.x + phase * phase * (2 + this.getWindStrength() * 6), site.y + 0.5 + phase * 10, site.z + Math.sin(phase * 4 + i) * 0.3);
            this.transform.scale.set((0.6 + phase * 3) * fade, (1.2 + phase * 2.4) * fade, 1);
            this.setMatrix(this.smoke, i);
        }
        (this.fires.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(this.elapsed * 8) * 0.2;
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.scene.remove(this.root);
        this.root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.geometries.clear();
        this.materials.clear();
        this.root.clear();
    }
}

/** Soft round sprite so points read as distant lights, not square pixels. */
function softDot(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
}
