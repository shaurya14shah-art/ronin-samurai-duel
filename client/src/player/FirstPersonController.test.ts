import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FirstPersonController, type GroundSampler } from './FirstPersonController';
import { InputSystem } from '../core/InputSystem';
import { PlayerStats } from './PlayerStats';

const epsilon = 1e-8;
const WALK_CAP = 4.0;
const SPRINT_CAP = 6.6;
const DASH_DISTANCE = FirstPersonController.DASH_DISTANCE;
const STEP_COST = 15;
const STEP_COOLDOWN = 0.7;

function setup(hz: number, sampler: GroundSampler = () => 0, cameraBody = false) {
    const keys = new Set<string>();
    const pressed = new Set<string>();
    const input = {
        wasPressed: (code: string) => pressed.has(code),
        mouseDelta: new THREE.Vector2(),
        isPointerLocked: true,
        isMouseDown: false,
        isKeyPressed: (code: string) => keys.has(code),
        getMovementVector: () => new THREE.Vector3(
            Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
            0,
            Number(keys.has('KeyS')) - Number(keys.has('KeyW'))
        ).normalize()
    } as unknown as InputSystem;
    const camera = new THREE.PerspectiveCamera();
    const body = cameraBody ? camera : new THREE.Object3D();
    const controller = new FirstPersonController(camera, body);
    controller.groundSample = sampler;
    body.position.y = controller.playerHeight + sampler(0, 0);
    const state = controller as unknown as {
        velocity: THREE.Vector3;
        currentBobOffset: number;
        stepPhase: number;
    };
    const tick = (frames = 1) => {
        for (let i = 0; i < frames; i++) { controller.update(1 / hz, input); pressed.clear(); }
    };
    /** A key goes down (and counts as pressed for the next frame). */
    const press = (code: string) => { keys.add(code); pressed.add(code); };
    tick();
    return { controller, body, camera, keys, input, state, tick, press };
}

for (const hz of [30, 60, 120]) {
    test(`walking stays capped, including diagonals, at ${hz} Hz`, () => {
        const e = setup(hz);
        e.controller.walkSpeed = 50;
        e.keys.add('KeyW');
        e.keys.add('KeyD');
        for (let i = 0; i < hz; i++) {
            e.tick();
            assert.ok(e.state.velocity.length() <= WALK_CAP + epsilon);
        }
        // Bounded acceleration: a second of walking covers most, never all, of the capped distance.
        const travelled = Math.hypot(e.body.position.x, e.body.position.z);
        assert.ok(travelled <= WALK_CAP + epsilon && travelled > WALK_CAP * 0.8, `travelled ${travelled}`);
    });

    test(`sprinting requires stamina and caps speed at ${hz} Hz`, () => {
        const e = setup(hz);
        e.keys.add('KeyW');
        e.keys.add('ShiftLeft');
        e.tick(hz);
        assert.ok(e.state.velocity.length() > 0);
        e.controller.stats = new PlayerStats();
        e.controller.stats.currentStamina = 0;
        e.tick(hz);
        assert.ok(e.state.velocity.length() <= WALK_CAP + epsilon);
        e.controller.stats.currentStamina = 10;
        e.controller.runSpeed = 80;
        e.tick();
        assert.ok(e.state.velocity.length() > WALK_CAP);
        assert.ok(e.state.velocity.length() <= SPRINT_CAP + 0.1);
        assert.ok(Math.abs(e.controller.stats.currentStamina - (10 - 5 / hz)) < 0.05);
        e.keys.delete('ShiftLeft');
        e.tick(hz);
        assert.ok(Math.abs(e.state.velocity.length() - WALK_CAP) < 0.1);
    });

    test(`Space dashes but never jumps, and bobbing remains at ${hz} Hz`, () => {
        const e = setup(hz, () => 0, true);
        e.controller.stats = new PlayerStats();
        e.press('Space');
        e.keys.add('KeyW');
        let bobbed = false;
        for (let i = 0; i < hz; i++) {
            e.tick();
            assert.equal(e.state.velocity.y, 0);
            assert.ok(Math.abs(e.body.position.y - e.state.currentBobOffset - e.controller.playerHeight) < 0.06);
            bobbed ||= Math.abs(e.state.currentBobOffset) > 0.01;
        }
        assert.ok(e.controller.stats.currentStamina < e.controller.stats.maxStamina, 'Space is the dash');
        assert.ok(bobbed);
    });

    test(`W walks where the camera looks, S away, D to the right at ${hz} Hz`, () => {
        for (const yaw of [0, 0.9, -2.3]) {
            for (const [key, sign, axis] of [['KeyW', 1, 'ahead'], ['KeyS', -1, 'ahead'], ['KeyD', 1, 'right'], ['KeyA', -1, 'right']] as const) {
                const e = setup(hz);
                (e.controller as unknown as { yaw: number }).yaw = yaw;
                e.keys.add(key);
                e.tick(hz / 2);
                const view = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
                const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));
                const moved = e.body.position.clone().setY(0);
                const along = moved.dot(axis === 'ahead' ? view : right);
                assert.ok(along * sign > 0.5, `${key} at yaw ${yaw}: ${along.toFixed(2)} m along ${axis}`);
            }
        }
    });

    test(`walking and sprinting never dash at ${hz} Hz`, () => {
        const e = setup(hz);
        e.controller.stats = new PlayerStats();
        e.keys.add('KeyW');
        e.keys.add('ShiftLeft');
        for (let i = 0; i < hz; i++) {
            e.tick();
            assert.equal(e.state.stepPhase, 0);
            assert.ok(e.state.velocity.length() <= SPRINT_CAP + epsilon);
        }
    });

    test(`a dash covers its distance, costs its stamina, then plants at ${hz} Hz`, () => {
        for (const [keys, sign] of [[['KeyQ', 'KeyW'], 1], [['Space'], -1]] as const) {
            const e = setup(hz);
            e.controller.stats = new PlayerStats();
            e.controller.stats.currentStamina = STEP_COST;
            for (const k of keys) e.press(k);
            const start = e.body.position.clone();
            e.tick();
            assert.ok(e.state.stepPhase > 0, 'dash started');
            e.keys.clear();
            while (e.state.stepPhase > 0) e.tick();
            assert.equal(e.controller.stats.currentStamina, 0);
            const view = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, e.controller.getYaw(), 0));
            const along = e.body.position.clone().sub(start).dot(view);
            assert.ok(Math.abs(along - sign * DASH_DISTANCE) < 0.05, `dashed ${along.toFixed(2)} m (Space alone steps back)`);
            const end = e.body.position.clone();
            e.tick(hz);
            assert.ok(e.body.position.distanceTo(end) < epsilon, 'planted, no slide');
        }
    });

    test(`one dash per press; a press inside the cooldown is refused at ${hz} Hz`, () => {
        const e = setup(hz);
        const costs: number[] = [];
        let time = 0;
        e.controller.stats = { drainStamina: (cost: number) => { if (cost === STEP_COST) costs.push(time); return true; } } as PlayerStats;
        e.keys.add('KeyW');
        e.press('KeyQ');
        for (let i = 0; i < hz * 2; i++) { time = i / hz; e.tick(); }
        assert.equal(costs.length, 1, 'holding Q dashes once');
        e.press('KeyQ'); time = 2; e.tick();
        assert.equal(costs.length, 2, 'a new press dashes again');
        e.press('KeyQ'); time += 1 / hz; e.tick();
        assert.equal(costs.length, 2, 'not inside the cooldown');
        assert.ok(STEP_COOLDOWN > 0);
    });

    test(`grounding follows a walkable slope at ${hz} Hz`, () => {
        const sampler: GroundSampler = (x, z) => x * 0.25 - z * 0.25;
        const e = setup(hz, sampler);
        e.keys.add('KeyW');
        e.keys.add('KeyD');
        for (let i = 0; i < hz * 2; i++) {
            e.tick();
            assert.ok(Math.abs(e.body.position.y - e.controller.playerHeight - sampler(e.body.position.x, e.body.position.z)) < epsilon);
            assert.equal(e.state.velocity.y, 0);
        }
    });

    test(`movementScale slows walking, sprinting and steps at ${hz} Hz`, () => {
        for (const mode of ['walk', 'sprint']) {
            const normal = setup(hz);
            const slowed = setup(hz);
            slowed.controller.movementScale = 0.25;
            for (const e of [normal, slowed]) {
                e.keys.add('KeyW');
                if (mode !== 'walk') {
                    e.keys.add('ShiftLeft');
                    e.controller.stats = new PlayerStats();
                    e.controller.stats.currentStamina = 10;
                }
                e.tick();
            }
            assert.ok(Math.abs(slowed.state.velocity.length() - normal.state.velocity.length() * 0.25) < epsilon);
            assert.ok(Math.abs(slowed.body.position.z - normal.body.position.z * 0.25) < epsilon);
            slowed.controller.movementScale = 0;
            const start = slowed.body.position.clone();
            slowed.tick();
            assert.equal(slowed.state.velocity.length(), 0);
            assert.ok(slowed.body.position.distanceTo(start) < epsilon);
        }
    });

    test(`wall refusal and invalid-sampler recovery at ${hz} Hz`, () => {
        const e = setup(hz, x => Math.max(0, x - 2) * 1000);
        e.body.position.x = 2;
        e.keys.add('KeyA');
        e.tick(hz);
        assert.equal(e.body.position.x, 2);
        assert.equal(e.body.position.y, e.controller.playerHeight);
        assert.equal(e.state.velocity.length(), 0);
        for (const invalid of [NaN, Infinity, -Infinity]) {
            e.controller.groundSample = () => invalid;
            e.tick();
            assert.equal(e.body.position.x, 2);
            assert.equal(e.body.position.y, e.controller.playerHeight);
            assert.equal(e.state.velocity.length(), 0);
        }
        e.controller.groundSample = () => 0;
        e.body.position.y = NaN;
        e.tick();
        assert.ok(Number.isFinite(e.body.position.x));
        assert.equal(e.body.position.y, e.controller.playerHeight);
        e.tick();
        assert.ok(e.body.position.x > 2);
        assert.equal(e.state.velocity.y, 0);
    });
}

test('camera roll reflects shake and decays without accumulating', () => {
    const e = setup(60, () => 0, true);
    e.controller.addCamShake(0, 0, 0.2);
    e.tick();
    assert.ok(e.camera.rotation.z > 0.15 && e.camera.rotation.z <= 0.2, `roll ${e.camera.rotation.z}`);

    let peak = 0;
    for (let i = 0; i < 240; i++) {
        e.controller.addCamShake(0, 0, 0.05);
        e.tick();
        peak = Math.max(peak, Math.abs(e.camera.rotation.z));
    }
    assert.ok(peak < 0.5, `roll accumulated to ${peak}`);

    for (let i = 0; i < 240; i++) e.tick();
    assert.ok(Math.abs(e.camera.rotation.z) < 0.001, `roll did not settle: ${e.camera.rotation.z}`);
});

test('walking bob stays small at every frame rate', () => {
    for (const hz of [30, 60, 120]) {
        const e = setup(hz, () => 0, true);
        e.keys.add('KeyW');
        e.keys.add('ShiftLeft');
        e.controller.stats = new PlayerStats();
        let peak = 0;
        for (let i = 0; i < hz * 2; i++) {
            e.tick();
            peak = Math.max(peak, Math.abs(e.state.currentBobOffset));
        }
        assert.ok(peak <= e.controller.bobAmount + 0.02, `${hz} Hz bob peaked at ${peak}`);
    }
});

test('pointer unlock clears held input before notifying listeners and preserves forced lock', () => {
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const windowEvents = new EventTarget();
    const documentEvents = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentEvents });
    try {
        const input = InputSystem.getInstance();
        const element = {} as HTMLElement;
        input.init(element, new THREE.PerspectiveCamera(), new THREE.Scene());
        const hold = () => {
            windowEvents.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
            windowEvents.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }));
            windowEvents.dispatchEvent(Object.assign(new Event('mousedown'), { button: 2 }));
            input.mouseDelta.set(10, -5);
            input.update(0.5);
        };
        const assertCleared = () => {
            assert.equal(input.isKeyPressed('KeyW'), false);
            assert.equal(input.getMovementVector().length(), 0);
            assert.equal(input.keyHoldDurations.size, 0);
            assert.equal(input.isMouseDown, false);
            assert.equal(input.isRightMouseDown, false);
            assert.equal(input.isMouseJustPressed, false);
            assert.equal(input.isMouseJustReleased, false);
            assert.equal(input.mouseHoldDuration, 0);
            assert.equal(input.mouseDelta.length(), 0);
        };
        let unlocks = 0;
        input.on('pointerlockchange', locked => {
            if (!locked) {
                assertCleared();
                unlocks++;
            }
        });
        documentEvents.pointerLockElement = element;
        documentEvents.dispatchEvent(new Event('pointerlockchange'));
        hold();
        documentEvents.dispatchEvent(new Event('pointerlockchange'));
        assert.equal(input.isKeyPressed('KeyW'), true);
        assert.equal(input.isPointerLocked, true);
        documentEvents.pointerLockElement = null;
        documentEvents.dispatchEvent(new Event('pointerlockchange'));
        assertCleared();
        assert.equal(input.isPointerLocked, false);
        assert.equal(unlocks, 1);
        input.setSimulatedLock(true);
        hold();
        documentEvents.dispatchEvent(new Event('pointerlockchange'));
        assert.equal(input.isKeyPressed('KeyW'), true);
        assert.equal(input.isMouseDown, true);
        assert.equal(input.isPointerLocked, true);
        assert.equal(input.keyHoldDurations.get('KeyW'), 0.5);
        input.setSimulatedLock(false);
        assertCleared();
        assert.equal(unlocks, 2);
    } finally {
        if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});