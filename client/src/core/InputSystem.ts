import * as THREE from 'three';

type InputEventCallback = (data?: any) => void;

export class InputSystem {
    private static instance: InputSystem;
    
    public mousePosition: THREE.Vector2 = new THREE.Vector2();
    public normalizedMouse: THREE.Vector2 = new THREE.Vector2();
    public mouseDelta: THREE.Vector2 = new THREE.Vector2();
    
    public isMouseDown: boolean = false;
    public isRightMouseDown: boolean = false;
    public isMouseJustPressed: boolean = false;
    public isMouseJustReleased: boolean = false;
    public mouseHoldDuration: number = 0;
    
    public isPointerLocked: boolean = false;
    public forceLocked: boolean = false;
    
    private keys: Map<string, boolean> = new Map();
    public keyHoldDurations: Map<string, number> = new Map();
    private eventListeners: Map<string, InputEventCallback[]> = new Map();
    
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private camera!: THREE.Camera;
    private scene!: THREE.Scene;
    private domElement!: HTMLElement;

    private constructor() {}

    public static getInstance(): InputSystem {
        if (!InputSystem.instance) {
            InputSystem.instance = new InputSystem();
        }
        return InputSystem.instance;
    }

    public init(domElement: HTMLElement, camera: THREE.Camera, scene: THREE.Scene): void {
        this.domElement = domElement;
        this.camera = camera;
        this.scene = scene;

        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mouseup', this.onMouseUp.bind(this));
        window.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        window.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        window.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        window.addEventListener('touchend', this.onTouchEnd.bind(this));

        document.addEventListener('pointerlockchange', this.onPointerLockChange.bind(this));
        document.addEventListener('pointerlockerror', this.onPointerLockError.bind(this));
    }

    public onResize(): void {}

    public update(dt: number): void {
        if (this.isMouseDown) {
            this.mouseHoldDuration += dt;
        }
        
        for (const [code, isDown] of this.keys.entries()) {
            if (isDown) {
                const currentDuration = this.keyHoldDurations.get(code) || 0;
                this.keyHoldDurations.set(code, currentDuration + dt);
            }
        }
    }

    /** Keys pressed since the last frame: a tap that went down and up between frames still counts. */
    private pressed = new Set<string>();

    public wasPressed(code: string): boolean {
        return this.pressed.has(code);
    }

    public postUpdate(): void {
        this.pressed.clear();
        this.isMouseJustPressed = false;
        this.isMouseJustReleased = false;
        this.mouseDelta.set(0, 0);
    }

    public raycast(objects?: THREE.Object3D[]): THREE.Intersection[] {
        this.raycaster.setFromCamera(this.normalizedMouse, this.camera);
        if (objects) {
            return this.raycaster.intersectObjects(objects, true);
        }
        return this.raycaster.intersectObject(this.scene, true);
    }

    public isKeyPressed(code: string): boolean {
        return !!this.keys.get(code);
    }

    public getMovementVector(): THREE.Vector3 {
        const movement = new THREE.Vector3(0, 0, 0);
        if (this.isKeyPressed('KeyW') || this.isKeyPressed('ArrowUp')) movement.z -= 1;
        if (this.isKeyPressed('KeyS') || this.isKeyPressed('ArrowDown')) movement.z += 1;
        if (this.isKeyPressed('KeyA') || this.isKeyPressed('ArrowLeft')) movement.x -= 1;
        if (this.isKeyPressed('KeyD') || this.isKeyPressed('ArrowRight')) movement.x += 1;
        
        if (movement.lengthSq() > 0) {
            movement.normalize();
        }
        return movement;
    }

    public requestPointerLock(): void {
        if (!this.isPointerLocked) {
            try {
                const result = this.domElement.requestPointerLock();
                if (result) result.catch(() => this.emit('pointerlockerror'));
            } catch {
                this.emit('pointerlockerror');
            }
        }
    }

    public exitPointerLock(): void {
        if (this.isPointerLocked) {
            document.exitPointerLock();
        }
    }

    public on(eventName: string, callback: InputEventCallback): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    private emit(eventName: string, data?: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(cb => cb(data));
        }
    }

    private updateMousePosition(clientX: number, clientY: number): void {
        this.mousePosition.set(clientX, clientY);
        this.normalizedMouse.set(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1
        );
    }

    private onMouseMove(event: MouseEvent): void {
        this.updateMousePosition(event.clientX, event.clientY);
        
        this.mouseDelta.x += event.movementX || 0;
        this.mouseDelta.y += event.movementY || 0;

        this.emit('mousemove', {
            position: this.mousePosition,
            delta: this.mouseDelta,
            isLocked: this.isPointerLocked
        });
    }

    private onMouseDown(event: MouseEvent): void {
        if (event.button === 0) {
            this.isMouseDown = true;
            this.isMouseJustPressed = true;
            this.mouseHoldDuration = 0;
            this.emit('mousedown');
        } else if (event.button === 1) {
            this.emit('middlemousedown');
        } else if (event.button === 2) {
            this.isRightMouseDown = true;
            this.emit('rightmousedown');
        }
    }

    private onMouseUp(event: MouseEvent): void {
        if (event.button === 0) {
            this.isMouseDown = false;
            this.isMouseJustReleased = true;
            this.emit('mouseup', { duration: this.mouseHoldDuration });
            this.mouseHoldDuration = 0;
        } else if (event.button === 1) {
            this.emit('middlemouseup');
        } else if (event.button === 2) {
            this.isRightMouseDown = false;
            this.emit('rightmouseup');
        }
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (event.code === 'AltLeft' || event.code === 'AltRight') {
            event.preventDefault();
            if (this.isPointerLocked) {
                this.exitPointerLock();
            } else {
                this.requestPointerLock();
            }
        }
        if (event.repeat) return;
        this.keys.set(event.code, true);
        this.pressed.add(event.code);
        this.keyHoldDurations.set(event.code, 0);
        this.emit('keydown', event.code);
    }

    private onKeyUp(event: KeyboardEvent): void {
        this.keys.set(event.code, false);
        const holdDuration = this.keyHoldDurations.get(event.code) || 0;
        this.emit('keyup', { code: event.code, duration: holdDuration });
        this.keyHoldDurations.set(event.code, 0);
    }

    private onTouchStart(event: TouchEvent): void {
        if (event.touches.length > 0) {
            this.updateMousePosition(event.touches[0].clientX, event.touches[0].clientY);
            this.isMouseDown = true;
            this.isMouseJustPressed = true;
            this.mouseHoldDuration = 0;
            this.emit('mousedown');
        }
    }

    private onTouchMove(event: TouchEvent): void {
        if (event.touches.length > 0) {
            this.updateMousePosition(event.touches[0].clientX, event.touches[0].clientY);
            this.emit('mousemove', {
                position: this.mousePosition,
                delta: this.mouseDelta,
                isLocked: false
            });
        }
    }

    private onTouchEnd(event: TouchEvent): void {
        this.isMouseDown = false;
        this.isMouseJustReleased = true;
        this.emit('mouseup', { duration: this.mouseHoldDuration });
        this.mouseHoldDuration = 0;
    }

    private onPointerLockChange(): void {
        if (this.forceLocked) return;
        this.isPointerLocked = document.pointerLockElement === this.domElement;
        if (document.pointerLockElement === null) this.clearHeldInput();
        this.emit('pointerlockchange', this.isPointerLocked);
    }

    public setSimulatedLock(locked: boolean): void {
        this.forceLocked = locked;
        this.isPointerLocked = locked;
        if (!locked && document.pointerLockElement === null) this.clearHeldInput();
        this.emit('pointerlockchange', locked);
    }

    private clearHeldInput(): void {
        this.keys.clear();
        this.keyHoldDurations.clear();
        this.isMouseDown = false;
        this.isRightMouseDown = false;
        this.isMouseJustPressed = false;
        this.isMouseJustReleased = false;
        this.mouseHoldDuration = 0;
        this.mouseDelta.set(0, 0);
    }

    private onPointerLockError(): void {
        console.error('PointerLock API error');
        this.emit('pointerlockerror');
    }
}
