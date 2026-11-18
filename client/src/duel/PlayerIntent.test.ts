import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { forward } from '@ronin/combat';
import { PlayerIntent } from './PlayerIntent';
import type { InputSystem } from '../core/InputSystem';

type Listener = (data?: any) => void;

function fakeInput() {
    const listeners = new Map<string, Listener[]>();
    const keys = new Set<string>();
    const fake = {
        isPointerLocked: true,
        mouseDelta: new THREE.Vector2(),
        on(name: string, cb: Listener) { listeners.set(name, [...(listeners.get(name) ?? []), cb]); },
        isKeyPressed(code: string) { return keys.has(code); },
        getMovementVector() {
            const v = new THREE.Vector3();
            if (keys.has('KeyW')) v.z -= 1;
            if (keys.has('KeyS')) v.z += 1;
            if (keys.has('KeyA')) v.x -= 1;
            if (keys.has('KeyD')) v.x += 1;
            return v.lengthSq() ? v.normalize() : v;
        },
        emit(name: string, data?: any) { for (const cb of listeners.get(name) ?? []) cb(data); },
        keys,
    };
    return fake;
}

function setup() {
    const input = fakeInput();
    const intent = new PlayerIntent(input as unknown as InputSystem);
    const flick = (x: number, y: number) => { input.mouseDelta.set(x, y); intent.frame(); input.mouseDelta.set(0, 0); };
    return { input, intent, flick };
}

test('camera yaw + π is the sim facing: walking forward and cutting forward agree', () => {
    for (const yaw of [0, 0.7, -2.1, Math.PI]) {
        const cameraForward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const f = forward(yaw + Math.PI);
        assert.ok(Math.abs(f.x - cameraForward.x) < 1e-9 && Math.abs(f.z - cameraForward.z) < 1e-9);
    }
});

test('the cut follows the mouse gesture that precedes the click', () => {
    const cases: [number, number, string][] = [
        [0, -40, 'overhead'], [0, 40, 'low'], [40, 0, 'horiz_l'], [-40, 0, 'horiz_r'], [40, 25, 'diag_l'], [-40, 25, 'diag_r'],
    ];
    for (const [x, y, dir] of cases) {
        const { input, intent, flick } = setup();
        flick(x, y);
        input.emit('mousedown');
        assert.equal(intent.build(0, 'middle').attack?.dir, dir, `flick ${x},${y}`);
    }
    const { input, intent } = setup();
    input.keys.add('KeyW');
    input.emit('mousedown');
    assert.equal(intent.build(0, 'middle').attack?.dir, 'thrust', 'no flick while pressing forward thrusts');
});

test('R commits, T parries, Q steps (back when standing still), V cycles stance', () => {
    const { input, intent } = setup();
    input.emit('keydown', 'KeyR');
    assert.equal(intent.build(0, 'middle').attack?.committed, true);
    input.emit('keydown', 'KeyT');
    assert.equal(intent.build(0, 'middle').parry, true);
    input.emit('keydown', 'KeyQ');
    assert.deepEqual(intent.build(0, 'middle').step, { x: 0, z: -1 });
    input.emit('keydown', 'KeyV');
    assert.equal(intent.build(0, 'middle').stance, 'high');
    assert.equal(intent.build(0, 'high').stance, undefined, 'one-shot intents are consumed once');
});

test('guard line follows the flick while F is held', () => {
    const { input, intent, flick } = setup();
    input.keys.add('KeyF');
    flick(0, -40);
    assert.equal(intent.build(0, 'middle').guardLine, 'high');
    flick(-60, 0);
    const i = intent.build(0, 'middle');
    assert.equal(i.guardLine, 'left');
    assert.equal(i.guard, true);
});

test('clicks without a captured pointer never become cuts', () => {
    const { input, intent } = setup();
    input.isPointerLocked = false;
    input.emit('mousedown');
    input.emit('keydown', 'KeyT');
    const i = intent.build(0, 'middle');
    assert.equal(i.attack, undefined);
    assert.equal(i.parry, undefined);
});
