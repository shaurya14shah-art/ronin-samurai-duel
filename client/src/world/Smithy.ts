import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The forge shelter in the courtyard, dressed with real props (Quaternius Fantasy Props
// MegaKit, CC0) and a living hearth. Also the stage the forge session plays on: anchors for the
// anvil face, the quench tub and the blade stand, and the camera's working view.

const PROPS: { name: string; at: [number, number, number]; yaw: number; height?: number }[] = [
    { name: 'Anvil_Log', at: [0, 0, 0], yaw: 0, height: 0.82 },
    { name: 'Workbench', at: [-2.75, 0, -0.1], yaw: Math.PI / 2, height: 0.95 },
    { name: 'WeaponStand', at: [0.9, 0, -2.15], yaw: 0, height: 1.25 },
    { name: 'Bucket_Metal', at: [1.15, 0, 0.75], yaw: 0.4, height: 0.5 },
    { name: 'Barrel', at: [-2.85, 0, -2.0], yaw: 0.8, height: 1.0 },
    { name: 'Crate_Wooden', at: [-2.9, 0, 1.95], yaw: 0.2, height: 0.6 },
    { name: 'Chain_Coil', at: [-2.55, 0.97, 0.5], yaw: 1.1, height: 0.12 },
    { name: 'Peg_Rack', at: [-1.2, 1.4, -2.4], yaw: 0, height: 0.45 },
];

export class Smithy {
    readonly root = new THREE.Group();
    /** Where a blade or billet lies on the anvil face (world space). */
    readonly anvilFace = new THREE.Vector3(0, 0.84, 0);
    readonly quench = new THREE.Vector3(1.15, 0.55, 0.75);
    readonly stand = new THREE.Vector3(0.9, 1.0, -2.05);
    readonly hearth = new THREE.Vector3(2.5, 0.68, -1.4);
    /** Camera standing at the anvil, looking down at the work with the hearth to the right. */
    readonly view = { pos: new THREE.Vector3(0.2, 1.75, 2.6), look: new THREE.Vector3(1.6, 0.6, -0.9) };
    private fire: THREE.PointLight;
    private coals: THREE.Mesh;
    private time = 0;
    private loaded = false;

    constructor() {
        // The hearth: a ring of stone around a bed of coals that breathes.
        const coalTex = coalTexture();
        this.coals = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshStandardMaterial({
            map: coalTex, emissiveMap: coalTex, emissive: 0xff6a1f, emissiveIntensity: 2.2, color: 0x2a1a12, roughness: 1,
        }));
        this.coals.rotation.x = -Math.PI / 2;
        this.coals.position.set(this.hearth.x, this.hearth.y - 0.04, this.hearth.z);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.11, 12, 32), new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 1 }));
        rim.rotation.x = Math.PI / 2;
        rim.position.set(this.hearth.x, this.hearth.y - 0.05, this.hearth.z);
        rim.scale.set(1, 1, 0.8);
        this.fire = new THREE.PointLight(0xff9a50, 6, 8, 2);
        this.fire.position.set(this.hearth.x, this.hearth.y + 0.5, this.hearth.z);
        this.fire.castShadow = false;
        this.root.add(this.coals, rim, this.fire);
    }

    async load(): Promise<void> {
        if (this.loaded) return;
        this.loaded = true;
        const loader = new GLTFLoader();
        await Promise.all(PROPS.map(async p => {
            try {
                const g = await loader.loadAsync(`/models/forge/${p.name}.gltf`);
                const obj = g.scene;
                if (p.height) {
                    const box = new THREE.Box3().setFromObject(obj);
                    obj.scale.setScalar(p.height / Math.max(0.01, box.max.y - box.min.y));
                }
                obj.position.set(...p.at);
                obj.rotation.y = p.yaw;
                obj.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
                this.root.add(obj);
                if (p.name === 'Anvil_Log') {
                    const box = new THREE.Box3().setFromObject(obj);
                    this.anvilFace.y = box.max.y + 0.01;
                }
            } catch (e) {
                console.warn(`forge prop ${p.name} unavailable`, e);
            }
        }));
    }

    update(dt: number): void {
        this.time += dt;
        // Fire breathes: slow swell plus small flicker.
        const breathe = 0.8 + Math.sin(this.time * 0.9) * 0.12 + Math.sin(this.time * 7.3) * 0.05 + Math.sin(this.time * 13.1) * 0.03;
        this.fire.intensity = 6 * breathe;
        (this.coals.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 * breathe;
    }

    /** The bellows: briefly brighten the fire (a heating blade). */
    stoke(amount: number): void {
        this.fire.intensity += amount * 6;
    }
}

function coalTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#120804';
    g.fillRect(0, 0, 256, 256);
    let s = 3;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 260; i++) {
        const x = r() * 256, y = r() * 256, rad = 4 + r() * 14;
        const grad = g.createRadialGradient(x, y, 0, x, y, rad);
        const heat = r();
        grad.addColorStop(0, heat > 0.5 ? 'rgba(255,170,80,1)' : 'rgba(200,70,20,1)');
        grad.addColorStop(0.6, 'rgba(90,25,8,0.9)');
        grad.addColorStop(1, 'rgba(20,8,4,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
