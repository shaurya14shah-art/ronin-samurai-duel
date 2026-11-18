import * as THREE from 'three';
import { InputSystem } from '../core/InputSystem';

export class InteractableForge {
    private mesh: THREE.Group;
    private interactionDistance: number = 3.0;
    private onInteract: () => void;
    private isPlayerNear: boolean = false;
    private uiPromptMesh!: THREE.Mesh;
    private wasInteractKeyPressed: boolean = false;

    constructor(onInteract: () => void) {
        this.onInteract = onInteract;
        this.mesh = new THREE.Group();
        this.buildAnvil();
        this.buildUIPrompt();
        // Position it at the center of the Dojo environment
        this.mesh.position.set(0, 1.25, 0); // Ground level of Dojo
    }

    private buildAnvil(): void {
        const material = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.5,
            metalness: 0.8
        });

        // Base
        const baseGeo = new THREE.BoxGeometry(1.2, 0.4, 0.8);
        const base = new THREE.Mesh(baseGeo, material);
        base.position.y = 0.2; 
        base.castShadow = true;
        base.receiveShadow = true;
        this.mesh.add(base);

        // Body
        const bodyGeo = new THREE.BoxGeometry(0.8, 0.5, 0.6);
        const body = new THREE.Mesh(bodyGeo, material);
        body.position.y = 0.65; 
        body.castShadow = true;
        body.receiveShadow = true;
        this.mesh.add(body);

        // Top Face
        const topGeo = new THREE.BoxGeometry(1.4, 0.2, 0.7);
        const top = new THREE.Mesh(topGeo, material);
        top.position.y = 1.0; 
        top.castShadow = true;
        top.receiveShadow = true;
        this.mesh.add(top);
        
        // Horn
        const hornGeo = new THREE.CylinderGeometry(0.02, 0.35, 0.6, 16);
        const horn = new THREE.Mesh(hornGeo, material);
        horn.rotation.z = Math.PI / 2;
        horn.position.set(1.0, 1.0, 0);
        horn.castShadow = true;
        horn.receiveShadow = true;
        this.mesh.add(horn);
    }

    private buildUIPrompt(): void {
        const promptGeo = new THREE.OctahedronGeometry(0.15);
        const promptMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true });
        this.uiPromptMesh = new THREE.Mesh(promptGeo, promptMat);
        this.uiPromptMesh.position.set(0, 2.0, 0);
        this.uiPromptMesh.visible = false;
        this.mesh.add(this.uiPromptMesh);
    }

    public getMesh(): THREE.Group {
        return this.mesh;
    }

    public update(playerPos: THREE.Vector3, dt: number): void {
        const forgePos = new THREE.Vector3();
        this.mesh.getWorldPosition(forgePos);
        
        // Track distance on the XZ plane to avoid height differences breaking interactions
        const dist = Math.hypot(forgePos.x - playerPos.x, forgePos.z - playerPos.z);
        this.isPlayerNear = (dist <= this.interactionDistance);

        if (this.isPlayerNear) {
            this.uiPromptMesh.visible = true;
            this.uiPromptMesh.rotation.y += 2 * dt;
            this.uiPromptMesh.position.y = 2.0 + Math.sin(Date.now() * 0.005) * 0.1;
        } else {
            this.uiPromptMesh.visible = false;
        }
    }

    public handleInput(inputSystem: InputSystem): void {
        const isEPressed = inputSystem.isKeyPressed('KeyE');
        
        if (!this.isPlayerNear) {
            this.wasInteractKeyPressed = isEPressed;
            return;
        }

        if (isEPressed && !this.wasInteractKeyPressed) {
             this.onInteract();
        }
        this.wasInteractKeyPressed = isEPressed;
    }
}
