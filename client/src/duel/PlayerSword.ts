import * as THREE from 'three';
import type { Duelist } from '@ronin/combat';
import { FirstPersonRig } from './FirstPersonRig';

// First-person blade and arms. Pure presentation: it watches the player's duelist and poses the
// rig to match. It never decides whether anything happened.

export class PlayerSword {
    public readonly weapon: FirstPersonRig;
    private lastPhase = '';

    constructor(camera: THREE.PerspectiveCamera) {
        this.weapon = new FirstPersonRig(camera);
    }

    public get bladeLength(): number {
        return this.weapon.bladeLength;
    }

    public sync(d: Duelist, dt: number, mouseDelta: THREE.Vector2, moving: boolean): void {
        if (d.phase !== this.lastPhase) {
            const from = this.lastPhase;
            this.lastPhase = d.phase;
            if (d.phase === 'active' && d.attack) window.dispatchEvent(new CustomEvent('combat-swing', { detail: { heavy: d.attack.committed } }));
            if (d.phase === 'drawing') window.dispatchEvent(new CustomEvent('sword-state', { detail: { state: 'drawing' } }));
            if (d.phase === 'sheathing') window.dispatchEvent(new CustomEvent('sword-state', { detail: { state: 'sheathing' } }));
            if (d.phase === 'windup' && from === 'sheathed') window.dispatchEvent(new CustomEvent('sword-state', { detail: { state: 'drawing' } }));
        }
        this.weapon.sync(d, dt, moving, mouseDelta);
    }

    /** Blade meets something: a short jolt back up the arms. */
    public impact(strength: number): void {
        this.weapon.impulse((Math.random() - 0.5) * 0.02 * strength, 0.012 * strength, 0.03 * strength);
    }

    public reset(_sheathed: boolean): void {
        this.lastPhase = '';
    }
}
