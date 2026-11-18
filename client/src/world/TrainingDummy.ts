import * as THREE from 'three';
import { architecturePalette } from './Architecture';

export class TrainingDummy extends THREE.Group {
    private head: THREE.Mesh;
    private body: THREE.Mesh;
    
    private maxHealth: number = 100;
    private currentHealth: number = 100;
    private isDead: boolean = false;
    
    // Visual feedback
    private originalHeadColor: THREE.Color;
    private originalBodyColor: THREE.Color;
    private headMaterial: THREE.MeshStandardMaterial;
    private bodyMaterial: THREE.MeshStandardMaterial;
    private flashTimer: number = 0;
    private isFlashing: boolean = false;
    
    // Knockback & spring recoil
    private velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    private drag: number = 10.0; // Knockback drag
    private basePosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    private wobbleAmp = 0;
    private wobbleTime = 0;

    constructor() {
        super();
        // A straw target on a post: a thick bundle of rice straw bound with rope, a shorter
        // bundle across it at shoulder height, standing on a squared foot.
        const p = architecturePalette();
        this.originalHeadColor = new THREE.Color(0xd8c392);
        this.originalBodyColor = new THREE.Color(0xc9b07c);
        this.headMaterial = (p.thatch as THREE.MeshStandardMaterial).clone();
        this.headMaterial.side = THREE.FrontSide;
        this.headMaterial.color.copy(this.originalHeadColor);
        this.bodyMaterial = this.headMaterial.clone();
        this.bodyMaterial.color.copy(this.originalBodyColor);

        const bundle = (radius: number, length: number) => {
            const pts: THREE.Vector2[] = [];
            for (let i = 0; i <= 12; i++) {
                const t = i / 12;
                // Bulging between bindings, frayed ends slightly flared.
                const r = radius * (0.9 + 0.1 * Math.sin(t * Math.PI * 4) ** 2 + (t < 0.05 || t > 0.95 ? 0.08 : 0));
                pts.push(new THREE.Vector2(r, (t - 0.5) * length));
            }
            const g = new THREE.LatheGeometry(pts, 18);
            const uv = g.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * length);
            return g;
        };
        this.body = new THREE.Mesh(bundle(0.17, 1.35), this.bodyMaterial);
        this.body.position.y = 0.95;
        this.head = new THREE.Mesh(bundle(0.11, 0.95), this.headMaterial);
        this.head.rotation.z = Math.PI / 2;
        this.head.position.y = 1.38;
        for (const m of [this.body, this.head]) { m.castShadow = true; m.receiveShadow = true; }
        this.add(this.body, this.head);
        const rope = new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 1 });
        for (const y of [0.4, 0.72, 1.05, 1.5]) {
            const band = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.018, 6, 20), rope);
            band.rotation.x = Math.PI / 2;
            band.position.y = y;
            this.add(band);
        }
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 10), p.darkWood);
        post.position.y = 0.3;
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), p.darkWood);
        foot.position.y = 0.06;
        for (const m of [post, foot]) { m.castShadow = true; m.receiveShadow = true; this.add(m); }
    }

    public setPosition(x: number, y: number, z: number): void {
        this.position.set(x, y, z);
        this.basePosition.copy(this.position);
    }

    public takeDamage(amount: number, hitDirection?: THREE.Vector3, knockbackForce: number = 5): void {
        if (this.isDead) return;
        
        this.currentHealth -= amount;
        this.wobbleAmp = 0.42;
        this.wobbleTime = 0;
        
        // A brief flare in the straw
        this.flashRed();
        
        // Apply knockback
        if (hitDirection && hitDirection.lengthSq() > 0) {
            const force = hitDirection.clone().normalize().multiplyScalar(knockbackForce);
            this.velocity.add(force);
        }
        
        if (this.currentHealth <= 0) {
            this.die();
        }
    }
    
    private flashRed(): void {
        // The straw takes the cut: a brief pale flare where it was struck, no colour change.
        this.headMaterial.emissive.setHex(0x3a3020);
        this.bodyMaterial.emissive.setHex(0x3a3020);
        this.isFlashing = true;
        this.flashTimer = 0.22;
    }
    
    private resetColor(): void {
        this.headMaterial.color.copy(this.originalHeadColor);
        this.bodyMaterial.color.copy(this.originalBodyColor);
        this.headMaterial.emissive.setHex(0x000000);
        this.bodyMaterial.emissive.setHex(0x000000);
        this.isFlashing = false;
    }
    
    private die(): void {
        this.isDead = true;
        this.currentHealth = 0;
        
        // Tip over backwards
        this.rotation.x = Math.PI / 2;
        this.position.y = 0.3; // Lower to ground
        
        // Cut through: the straw darkens where it lies.
        this.headMaterial.color.setHex(0x8a7a58);
        this.bodyMaterial.color.setHex(0x8a7a58);
        this.headMaterial.emissive.setHex(0x000000);
        this.bodyMaterial.emissive.setHex(0x000000);
    }
    
    public update(dt: number): void {
        if (this.isDead) return;
        
        // Handle flashing timer
        if (this.isFlashing) {
            this.flashTimer -= dt;
            if (this.flashTimer <= 0) {
                this.resetColor();
            }
        }
        
        // Handle knockback physics
        if (this.velocity.lengthSq() > 0.001) {
            const movement = this.velocity.clone().multiplyScalar(dt);
            this.position.add(movement);
            
            const dragForce = this.velocity.clone().multiplyScalar(this.drag * dt);
            this.velocity.sub(dragForce);
        } else {
            this.velocity.set(0, 0, 0);
            this.position.lerp(this.basePosition, dt * 5);
        }

        // Spring wobble recoil
        if (this.wobbleAmp > 0.005) {
            this.wobbleTime += dt;
            this.rotation.x = -Math.sin(this.wobbleTime * 16) * this.wobbleAmp;
            this.rotation.z = Math.cos(this.wobbleTime * 12) * (this.wobbleAmp * 0.35);
            this.wobbleAmp = Math.max(0, this.wobbleAmp - dt * 2.2);
        } else {
            this.rotation.x = THREE.MathUtils.lerp(this.rotation.x, 0, dt * 8);
            this.rotation.z = THREE.MathUtils.lerp(this.rotation.z, 0, dt * 8);
        }
    }
}
