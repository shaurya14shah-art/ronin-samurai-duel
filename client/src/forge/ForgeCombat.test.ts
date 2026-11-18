import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createForgedWeapon,
    BladeGeometry,
} from './physics';
import {
    computeBlendedMetallurgy,
    MaterialBlendEntry,
} from './materials';
import { forgedWeaponToInventory } from '../inventory/InventorySystem';

(globalThis as any).CustomEvent = class {
    public type: string;
    public detail: any;
    constructor(type: string, init?: any) {
        this.type = type;
        this.detail = init?.detail;
    }
};
(globalThis as any).window = { dispatchEvent: () => true };
(globalThis as any).document = {
    createElement: (tag: string) => {
        if (tag === 'canvas') {
            const canvas: any = { width: 0, height: 0 };
            canvas.getContext = () => ({
                fillStyle: '',
                globalAlpha: 1,
                strokeStyle: '',
                lineWidth: 1,
                beginPath() {},
                moveTo() {},
                lineTo() {},
                closePath() {},
                fill() {},
                stroke() {},
                fillRect() {},
                arc() {},
            });
            return canvas;
        }
        return {};
    },
};

const GEOMETRY: BladeGeometry = {
    bladeLength: 110,
    curvature: 2.8,
    baseWidth: 3.6,
    tipWidth: 2.4,
    baseThickness: 0.85,
    tipThickness: 0.5,
    tsukaLength: 30,
    balanceShift: 0.5,
    hamonPattern: 'choji',
    tsubaStyle: 'iron_mokko',
    tsukaWrapColor: 'charcoal',
};

function buildForgedWeapon() {
    const blend: MaterialBlendEntry[] = [
        { materialId: 'meteoric_iron', ratio: 0.6 },
        { materialId: 'tamahagane', ratio: 0.4 },
    ];
    const metallurgy = computeBlendedMetallurgy(blend, 14);
    return createForgedWeapon('Akatsuki', GEOMETRY, metallurgy);
}

test('forgedWeaponToInventory carries full forge physics into weapon stats', () => {
    const forged = buildForgedWeapon();
    const weapon = forgedWeaponToInventory(forged);
    assert.equal(weapon.ability, 'none');
    assert.equal(weapon.stats.damage, Math.floor(forged.stats.cuttingEfficiency));
    assert.equal(
        weapon.stats.speed,
        Math.min(1.35, Math.max(0.75, 300 / forged.stats.swingSpeedMs)),
    );
    assert.equal(weapon.stats.weight, forged.stats.weightKg);
    assert.equal(weapon.stats.reachCm, forged.stats.tipReachCm);
    assert.equal(weapon.stats.recoveryMs, forged.stats.recoveryMs);
    assert.equal(weapon.stats.staminaCost, forged.stats.staminaCost);
    assert.equal(weapon.stats.parryWindowMs, forged.stats.parryWindowMs);
    assert.equal(weapon.stats.composureDamage, forged.stats.composureDamage);
    assert.equal(weapon.stats.clashStability, forged.stats.clashStability);
    assert.equal(weapon.stats.inertia, forged.stats.inertia);
    assert.equal(weapon.stats.balancePointCm, forged.stats.balancePointCm);
    assert.equal(weapon.stats.feintRecoveryMs, forged.stats.feintRecoveryMs);
    assert.ok(weapon.stats.reachCm! > 0 && weapon.stats.staminaCost! > 0);
});
