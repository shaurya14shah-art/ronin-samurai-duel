import * as THREE from 'three';

export class EnvironmentManager {
    private scene: THREE.Scene;
    private ambientLight!: THREE.AmbientLight;
    private directionalLight!: THREE.DirectionalLight;
    private pointLight!: THREE.PointLight;

    public targetState: 'ethereal' | 'combat' = 'ethereal';
    private transitionSpeed: number = 2.0;

    // Ethereal values (Cinematic, Moonlit)
    private ethFogColor = new THREE.Color(0x0f172a); // Deep blue-gray night
    private ethFogDensity = 0.018; // Softly blends horizon at 90-110m to hide chunk boundaries
    private ethAmbientColor = new THREE.Color(0x1e293b); // Moonlit blue ambient
    private ethAmbientIntensity = 1.0;
    private ethPointColor = new THREE.Color(0x93c5fd); // Soft blue light
    private ethPointIntensity = 2.0;

    // Combat values (Now identical to Ethereal to prevent the red shift)
    private comFogColor = new THREE.Color(0x0f172a);
    private comFogDensity = 0.018;
    private comAmbientColor = new THREE.Color(0x1e293b);
    private comAmbientIntensity = 1.0;
    private comPointColor = new THREE.Color(0x93c5fd);
    private comPointIntensity = 2.0;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public setLightingState(state: 'ethereal' | 'combat'): void {
        this.targetState = state;
    }

    public applyExternalLighting(color: THREE.Color, intensity: number, position: THREE.Vector3, night: number, player = new THREE.Vector3()): void {
        this.directionalLight.color.copy(color);
        this.directionalLight.intensity = intensity;
        this.directionalLight.position.copy(position).add(player);
        this.directionalLight.target.position.copy(player);
        this.directionalLight.target.updateMatrixWorld();
        this.ambientLight.color.setHex(0x8ea6cc).lerp(new THREE.Color(0xffe6c7), 1 - night);
        this.ambientLight.intensity = 0.3 + (1 - night) * 0.65;
        this.pointLight.intensity = 0;
    }

    public applyExternalFog(color: THREE.Color, density: number, background: THREE.Color): void {
        if (!(this.scene.fog instanceof THREE.FogExp2)) return;
        this.scene.fog.color.copy(color);
        this.scene.fog.density = density;
        (this.scene.background as THREE.Color).copy(background);
    }

    public update(dt: number): void {
        const t = dt * this.transitionSpeed;
        const isCombat = this.targetState === 'combat';
        
        const targetFogColor = isCombat ? this.comFogColor : this.ethFogColor;
        const targetFogDensity = isCombat ? this.comFogDensity : this.ethFogDensity;
        const targetAmbientColor = isCombat ? this.comAmbientColor : this.ethAmbientColor;
        const targetAmbientIntensity = isCombat ? this.comAmbientIntensity : this.ethAmbientIntensity;
        const targetPointColor = isCombat ? this.comPointColor : this.ethPointColor;
        const targetPointIntensity = isCombat ? this.comPointIntensity : this.ethPointIntensity;

        if (this.scene.fog instanceof THREE.FogExp2) {
            this.scene.fog.color.lerp(targetFogColor, t);
            this.scene.fog.density += (targetFogDensity - this.scene.fog.density) * t;
        }
        (this.scene.background as THREE.Color).lerp(targetFogColor, t);

        this.ambientLight.color.lerp(targetAmbientColor, t);
        this.ambientLight.intensity += (targetAmbientIntensity - this.ambientLight.intensity) * t;

        this.pointLight.color.lerp(targetPointColor, t);
        this.pointLight.intensity += (targetPointIntensity - this.pointLight.intensity) * t;
    }

    public async init(): Promise<void> {
        this.setupLighting();
        this.setupAtmosphere();
        this.createBambooForest();
        this.createDojo();
    }

    private setupLighting(): void {
        // Start with Ethereal aesthetic
        this.ambientLight = new THREE.AmbientLight(this.ethAmbientColor, this.ethAmbientIntensity);
        this.scene.add(this.ambientLight);

        // Main moonlight (optimized for performance: 1024 map, focused bounds)
        this.directionalLight = new THREE.DirectionalLight(0xe0eaff, 1.2);
        this.directionalLight.position.set(40, 80, 40);
        this.directionalLight.castShadow = true;
        // Bias against acne on the long low-sun shadows across rolling terrain.
        this.directionalLight.shadow.bias = -0.0006;
        this.directionalLight.shadow.normalBias = 0.06;
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.near = 1.0;
        this.directionalLight.shadow.camera.far = 160;
        
        const d = 45;
        this.directionalLight.shadow.camera.left = -d;
        this.directionalLight.shadow.camera.right = d;
        this.directionalLight.shadow.camera.top = d;
        this.directionalLight.shadow.camera.bottom = -d;
        this.directionalLight.shadow.bias = -0.0005;
        this.scene.add(this.directionalLight);

        // Add a point light inside the courtyard area
        this.pointLight = new THREE.PointLight(this.ethPointColor, this.ethPointIntensity, 40);
        this.pointLight.position.set(0, 5, 0);
        this.scene.add(this.pointLight);
    }

    private setupAtmosphere(): void {
        this.scene.fog = new THREE.FogExp2(this.ethFogColor, this.ethFogDensity);
        this.scene.background = this.ethFogColor.clone();
    }

    private createBambooForest(): void {
        // Obsolete: Bamboo grove aesthetics ported to WorldScene
    }

    private createDojo(): void {
        // Obsolete: Dojo base ported to WorldScene
    }
}
