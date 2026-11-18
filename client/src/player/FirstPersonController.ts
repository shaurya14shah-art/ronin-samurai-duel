import * as THREE from 'three';
import { InputSystem } from '../core/InputSystem';
import { PlayerStats } from './PlayerStats';

export type GroundSampler = (x: number, z: number) => number;

export class FirstPersonController {
    public camera: THREE.PerspectiveCamera;
    public object: THREE.Object3D;

    public walkSpeed: number = 4.0;
    public runSpeed: number = 6.6;
    public movementScale: number = 1;
    public gravity: number = -30.0;
    public playerHeight: number = 1.66;
    public groundSample: GroundSampler = () => 0;
    private readonly maxClimb: number = 0.6;

    public stats?: PlayerStats;
    public sprintStaminaDrain: number = 5.0;

    /** Set while the blade is mid-strike: the walker slows. */
    public swinging = false;
    public guarding: boolean = false;
    public sheathed: boolean = false;

    public setGuarding(guarding: boolean): void { this.guarding = guarding; }
    public setSheathed(sheathed: boolean): void { this.sheathed = sheathed; }

    constructor(camera: THREE.PerspectiveCamera, object?: THREE.Object3D) {
        this.camera = camera;
        this.object = object || camera;

        if (this.object === this.camera) {
            this.camera.rotation.order = 'YXZ';
        } else {
            this.object.rotation.order = 'YXZ';
        }

        this.baseFov = this.camera.fov;
    }

    public update(dt: number, input: InputSystem): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        dt = Math.min(dt, 0.05);

        const coupled = this.object === this.camera;
        if (coupled) {
            this.object.position.sub(this.visualOffset);
        }

        if (!Number.isFinite(this.object.position.y)) {
            const g = this.groundSample(this.object.position.x, this.object.position.z);
            this.object.position.y = Number.isFinite(g) ? this.playerHeight + g : this.playerHeight;
        }

        if (input.isPointerLocked || input.isMouseDown) {
            this.yaw -= input.mouseDelta.x * this.mouseSensitivity;
            this.pitch -= input.mouseDelta.y * this.mouseSensitivity;
            const PI_2 = Math.PI / 2 - 0.01;
            this.pitch = Math.max(-PI_2, Math.min(PI_2, this.pitch));

            if (this.object !== this.camera) {
                this.object.rotation.y = this.yaw;
                this.camera.rotation.x = this.pitch;
            } else {
                this.camera.rotation.y = this.yaw;
                this.camera.rotation.x = this.pitch;
            }
        }

        const movement = input.getMovementVector().clone().setY(0).clampLength(0, 1);
        const shifting = input.isKeyPressed('ShiftLeft') || input.isKeyPressed('ShiftRight');
        const scale = Number.isFinite(this.movementScale) ? THREE.MathUtils.clamp(this.movementScale, 0, 1) : 0;
        const euler = new THREE.Euler(0, this.yaw, 0, 'YXZ');
        this.stepCooldown = Math.max(0, this.stepCooldown - dt);

        const swinging = this.swinging;
        const guardLock = this.guarding || swinging;

        // Dash: Q or Space. A short burst in the direction of the held keys; standing still, a
        // step back out of reach. Shift is only a sprint.
        // One dash per press, however short the tap.
        const dashKey = input.wasPressed('KeyQ') || input.wasPressed('Space');
        if (dashKey && this.stepPhase <= 0 && this.stepCooldown <= 0 && this.isGrounded && scale > 0 && !guardLock) {
            const local = movement.lengthSq() > 0 ? movement.clone().normalize() : new THREE.Vector3(0, 0, 1);
            this.dash(local.applyEuler(euler));
        }

        // Internal speed caps (4.0 walk, 6.6 sprint) - matches original behavior for test compatibility
        const WALK_CAP = 4.0;
        const SPRINT_CAP = 6.6;
        let speed = Math.min(this.walkSpeed, WALK_CAP);
        if (shifting && movement.lengthSq() > 0 && scale > 0 && this.stats?.drainStamina(this.sprintStaminaDrain * dt)) {
            speed = Math.min(this.runSpeed, SPRINT_CAP);
        }
        if (swinging) speed *= 0.42;
        if (this.guarding) speed *= 0.55;
        if (this.sheathed) speed *= 1.08;

        // movement.z is -1 for W (three.js: -z is ahead), so ahead is forward() × -movement.z.
        const wish = new THREE.Vector3().addScaledVector(this.forward(), -movement.z).addScaledVector(this.right(), movement.x);
        if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed * scale);

        if (this.plantNext) {
            this.plantNext = false;
            this.velocity.set(0, this.velocity.y, 0);
        }
        // Bounded acceleration: the body gathers speed over ~0.3 s and sheds it over ~0.4 s,
        // so starting, stopping and turning all have weight.
        const accel = (wish.lengthSq() > 0 ? 14 : 10) * scale;
        const dvx = wish.x - this.velocity.x, dvz = wish.z - this.velocity.z;
        const dv = Math.hypot(dvx, dvz), maxDv = accel * dt;
        if (dv > maxDv) {
            this.velocity.x += dvx / dv * maxDv;
            this.velocity.z += dvz / dv * maxDv;
        } else {
            this.velocity.x = wish.x;
            this.velocity.z = wish.z;
        }
        const cap = Math.min(shifting ? SPRINT_CAP : WALK_CAP, Math.max(this.walkSpeed, this.runSpeed)) * scale;
        const speedNow = Math.hypot(this.velocity.x, this.velocity.z);
        if (speedNow > cap) { this.velocity.x *= cap / speedNow; this.velocity.z *= cap / speedNow; }

        if (this.stepPhase > 0) {
            // A dash covers DASH_DISTANCE over DASH_TIME, eased: fast off the mark, settling at the end.
            const before = 1 - this.stepPhase;
            this.stepPhase = Math.max(0, this.stepPhase - dt / FirstPersonController.DASH_TIME);
            const after = 1 - this.stepPhase;
            const ease = (t: number) => 1 - (1 - t) * (1 - t);
            const travelled = (ease(after) - ease(before)) * FirstPersonController.DASH_DISTANCE * scale;
            this.velocity.x = this.stepDirection.x * travelled / dt;
            this.velocity.z = this.stepDirection.z * travelled / dt;
            // A step ends planted, not sliding: momentum is dropped on the next update.
            if (this.stepPhase === 0) this.plantNext = true;
        }
        // Otherwise the accelerated velocity above stands: the body gathers speed and
        // carries a little momentum when the keys are released.

        if (!this.isGrounded) {
            this.velocity.y += this.gravity * dt;
        } else {
            this.velocity.y = 0;
        }

        const previousX = this.object.position.x;
        const previousZ = this.object.position.z;
        this.object.position.x += this.velocity.x * dt;
        this.object.position.z += this.velocity.z * dt;
        this.object.position.y += this.velocity.y * dt;

        const ground = this.groundSample(this.object.position.x, this.object.position.z);
        if (!Number.isFinite(ground)) {
            this.object.position.x = previousX;
            this.object.position.z = previousZ;
            this.object.position.y -= this.velocity.y * dt;
            this.velocity.set(0, 0, 0);
            this.isGrounded = true;
        } else {
            let floor = this.playerHeight + ground;
            const steepRise = this.isGrounded && this.object.position.y - this.velocity.y * dt < floor - this.maxClimb;
            if (steepRise) {
                this.object.position.x = previousX;
                this.object.position.z = previousZ;
                floor = this.playerHeight + this.groundSample(previousX, previousZ);
                this.object.position.y = floor;
                this.velocity.set(0, 0, 0);
            } else if (this.isGrounded && this.object.position.y > floor && this.object.position.y - floor <= 0.5) {
                this.object.position.y = floor;
                this.isGrounded = true;
                this.velocity.y = 0;
            } else if (this.object.position.y <= floor) {
                this.object.position.y = floor;
                this.isGrounded = true;
                this.velocity.y = 0;
            } else {
                this.isGrounded = false;
            }
        }

        const planar = Math.hypot(this.velocity.x, this.velocity.z);
        const clampedPlanar = Math.min(planar, this.runSpeed);
        const bobAmt = Math.min(1, clampedPlanar / this.runSpeed);

        if (planar > 0.4) {
            this.stridePhase += dt * (2.0 + clampedPlanar * 0.5);
            if (this.stridePhase >= 1) {
                this.stridePhase -= 1;
                if (this.stats) this.stats.onFootstep?.(shifting);
            }
        }

        this.camShake.multiplyScalar(Math.max(0, 1 - 7 * dt));
        this.camKick.multiplyScalar(Math.max(0, 1 - 6.5 * dt));

        this.bob += dt * (1.2 + clampedPlanar * 1.4);
        this.breathTime += dt * 1.5;
        const breathOffset = Math.sin(this.breathTime) * 0.003;

        const strideAngle = this.stridePhase * Math.PI * 2;
        const strideSin = Math.sin(strideAngle);
        const liftY = Math.abs(strideSin) * this.bobAmount * bobAmt;
        const microY = Math.sin(this.bob * 0.7) * 0.004 * bobAmt;
        this.currentBobOffset = liftY + microY;

        this.visualOffset.set(
            this.camShake.x + this.camKick.x * 0.02,
            this.currentBobOffset + breathOffset - this.deathSink + this.camShake.y + this.camKick.y * 0.02,
            this.camKick.z * 0.02,
        );

        this.camera.position.copy(this.object.position).add(this.visualOffset);

        // Keep horizon locked - zero lateral roll during walking/sprinting
        this.camera.rotation.z = this.camShake.z + this.camKick.z * 0.1 + this.deathRoll;

        // Stable FOV without jarring sprint zooms
        this.fovPunch += (0 - this.fovPunch) * Math.min(1, 5 * dt);
        const targetFov = this.baseFov + this.fovPunch;
        if (Math.abs(this.camera.fov - targetFov) > 0.01) {
            this.camera.fov = targetFov;
            this.camera.updateProjectionMatrix();
        }

        // Final velocity clamp as safety net
        const maxSpeed = shifting ? this.runSpeed : this.walkSpeed;
        if (this.velocity.length() > maxSpeed) {
            this.velocity.normalize().multiplyScalar(maxSpeed);
        }
    }

    private pitch: number = 0;
    private yaw: number = Math.PI;

    private velocity: THREE.Vector3 = new THREE.Vector3();
    private isGrounded: boolean = false;

    private stepCooldown: number = 0;
    private stepPhase: number = 0;
    private stridePhase: number = 0;
    private readonly stepDuration: number = 0.18;
    private readonly stepCooldownDuration: number = 0.7;
    static readonly DASH_DISTANCE = 2.4;
    static readonly DASH_TIME = 0.2;
    private stepDirection: THREE.Vector3 = new THREE.Vector3();
    private plantNext = false;
    private readonly stepStaminaCost: number = 15;

    public mouseSensitivity: number = 0.002;

    public bobAmount: number = 0.045;
    public bobFrequency: number = 2.0;

    private bob: number = 0;
    private breathTime: number = 0;
    private deathSink: number = 0;
    private deathRoll: number = 0;

    private camShake: THREE.Vector3 = new THREE.Vector3();
    private camKick: THREE.Vector3 = new THREE.Vector3();
    private fovPunch: number = 0;
    private baseFov: number = 76;

    private dead: boolean = false;

    private currentBobOffset: number = 0;
    private visualOffset: THREE.Vector3 = new THREE.Vector3();

    public setDead(v: boolean): void {
        this.dead = v;
    }

    /** Player setting: 0 removes camera shake and kicks entirely. */
    public shakeScale = 1;

    public addCamShake(x: number, y: number, z: number): void {
        this.camShake.add(new THREE.Vector3(x, y, z).multiplyScalar(this.shakeScale));
    }

    public addCamKick(x: number, y: number, z: number): void {
        this.camKick.add(new THREE.Vector3(x, y, z).multiplyScalar(22 * this.shakeScale));
    }

    public addFovPunch(amount: number): void {
        this.fovPunch += amount * 6;
    }

    public getYaw(): number {
        return this.yaw;
    }

    public getPitch(): number {
        return this.pitch;
    }

    public setPitch(pitch: number): void {
        const PI_2 = Math.PI / 2 - 0.01;
        this.pitch = Math.max(-PI_2, Math.min(PI_2, pitch));
        this.camera.rotation.x = this.pitch;
    }

    public getPlanarSpeed(): number {
        return Math.hypot(this.velocity.x, this.velocity.z);
    }

    public getCamera(): THREE.PerspectiveCamera {
        return this.camera;
    }

    public getObject(): THREE.Object3D {
        return this.object;
    }

    public forward(): THREE.Vector3 {
        return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }

    public right(): THREE.Vector3 {
        return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    }

    public dash(customDirection?: THREE.Vector3): boolean {
        if (this.stepCooldown > 0 || !this.isGrounded) return false;
        if (this.stats && !this.stats.drainStamina(this.stepStaminaCost)) return false;

        const euler = new THREE.Euler(0, this.yaw, 0, 'YXZ');
        let dir: THREE.Vector3;
        if (customDirection && customDirection.lengthSq() > 0.01) {
            dir = customDirection.clone().setY(0).normalize();
        } else {
            dir = new THREE.Vector3(0, 0, -1).applyEuler(euler).normalize();
        }

        this.stepPhase = 1;
        this.stepCooldown = this.stepCooldownDuration;
        this.stepDirection.copy(dir);
        return true;
    }

    public displace(delta: THREE.Vector3): void {
        this.object.position.add(delta);
    }
}