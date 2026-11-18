import { Weapon } from '../forge/RecipeManager';
import { ForgedWeapon, createForgedWeapon } from '../forge/physics';

export function forgedWeaponToInventory(forged: ForgedWeapon): Weapon {
    const weapon = createForgedWeapon(forged.name, forged.geometry, forged.metallurgy);
    return {
        id: `wpn_${weapon.stats.bladeCategory}`,
        name: weapon.name,
        type: 'sword',
        ability: 'none',
        geometry: weapon.geometry,
        metallurgy: weapon.metallurgy,
        stats: {
            damage: Math.floor(weapon.stats.cuttingEfficiency),
            speed: Math.min(1.35, Math.max(0.75, 300 / weapon.stats.swingSpeedMs)),
            durability: Math.floor(weapon.metallurgy.toughness),
            weight: weapon.stats.weightKg,
            reachCm: weapon.stats.tipReachCm,
            recoveryMs: weapon.stats.recoveryMs,
            staminaCost: weapon.stats.staminaCost,
            parryWindowMs: weapon.stats.parryWindowMs,
            composureDamage: weapon.stats.composureDamage,
            clashStability: weapon.stats.clashStability,
            inertia: weapon.stats.inertia,
            balancePointCm: weapon.stats.balancePointCm,
            feintRecoveryMs: weapon.stats.feintRecoveryMs,
            sweetSpotStartCm: weapon.stats.sweetSpotStartCm,
            sweetSpotEndCm: weapon.stats.sweetSpotEndCm,
        },
    };
}

export class InventorySystem {
    private weapons: Weapon[] = [];
    private activeIndex: number = -1;

    // Callbacks
    private onWeaponAddedCallback: (weapon: Weapon) => void = () => {};
    private onWeaponEquippedCallback: (weapon: Weapon | null) => void = () => {};

    constructor() {}

    public addForgedWeapon(weapon: ForgedWeapon): Weapon {
        const finished = forgedWeaponToInventory(weapon);
        this.addWeapon(finished);
        return finished;
    }

    public addWeapon(weapon: Weapon): void {
        if (weapon.geometry && weapon.metallurgy) {
            weapon = forgedWeaponToInventory(createForgedWeapon(weapon.name, weapon.geometry, weapon.metallurgy));
        }
        this.weapons.push(weapon);
        this.onWeaponAddedCallback(weapon);
        // Automatically equip if it's the first weapon
        if (this.weapons.length === 1) {
            this.equipWeapon(0);
        }
    }

    public equipWeapon(index: number): void {
        if (index >= 0 && index < this.weapons.length) {
            this.activeIndex = index;
            this.onWeaponEquippedCallback(this.weapons[this.activeIndex]);
        }
    }

    public unequipWeapon(): void {
        this.activeIndex = -1;
        this.onWeaponEquippedCallback(null);
    }

    public getWeapons(): Weapon[] {
        return this.weapons;
    }

    public getActiveWeapon(): Weapon | null {
        if (this.activeIndex >= 0 && this.activeIndex < this.weapons.length) {
            return this.weapons[this.activeIndex];
        }
        return null;
    }

    public getActiveIndex(): number {
        return this.activeIndex;
    }

    public setCallbacks(
        onWeaponAdded: (weapon: Weapon) => void,
        onWeaponEquipped: (weapon: Weapon | null) => void
    ): void {
        this.onWeaponAddedCallback = onWeaponAdded;
        this.onWeaponEquippedCallback = onWeaponEquipped;
    }
}
