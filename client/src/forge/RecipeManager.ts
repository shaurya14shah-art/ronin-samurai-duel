import type { BladeGeometry } from './physics';
import type { BlendedMetallurgy } from './materials';

export type MaterialType = 'iron' | 'wood' | 'leather' | 'magic';
export type WeaponType = 'sword' | 'axe' | 'bow' | 'dagger' | 'spear' | 'mace';
export type WeaponAbility = 'none' | 'blood_price' | 'wind_step' | 'empty_ground';

export interface Material {
    id: string;
    name: string;
    type: MaterialType;
}

export interface WeaponStats {
    damage: number;
    speed: number;
    durability: number;
    weight: number;
    // Forge-derived combat overrides (optional: absent on non-forged weapons).
    // These are REAL combat values, blade length feeds the duel sim via DuelDirector.equipWeapon; the rest is not yet wired (see docs/PROJECT_STATE.md).
    reachCm?: number;
    recoveryMs?: number;
    staminaCost?: number;
    parryWindowMs?: number;
    composureDamage?: number;
    clashStability?: number;
    inertia?: number;
    balancePointCm?: number;
    feintRecoveryMs?: number;
    sweetSpotStartCm?: number;
    sweetSpotEndCm?: number;
}

export interface Weapon {
    id: string;
    name: string;
    type: WeaponType;
    ability: WeaponAbility;
    stats: WeaponStats;
    geometry?: BladeGeometry;
    metallurgy?: BlendedMetallurgy;
}

export interface Recipe {
    id: string;
    name: string;
    inputs: string[]; // Array of Material IDs required
    output: Weapon;
}

export class RecipeManager {
    private recipes: Map<string, Recipe> = new Map();
    private materials: Map<string, Material> = new Map();

    constructor() {
        this.initializeDefaultMaterials();
        this.initializeDefaultRecipes();
    }

    /**
     * Seeds the registry with initial available materials.
     */
    private initializeDefaultMaterials(): void {
        const defaultMaterials: Material[] = [
            { id: 'mat_tamahagane', name: 'Tamahagane', type: 'iron' },
            { id: 'mat_iron_ingot', name: 'Iron Ingot', type: 'iron' },
            { id: 'mat_steel_ingot', name: 'Steel Ingot', type: 'iron' },
            { id: 'mat_oak_wood', name: 'Oak Wood', type: 'wood' },
            { id: 'mat_pine_wood', name: 'Pine Wood', type: 'wood' },
            { id: 'mat_leather_strips', name: 'Leather Strips', type: 'leather' },
            { id: 'mat_hard_leather', name: 'Hard Leather', type: 'leather' },
            { id: 'mat_high_carbon_steel', name: 'High Carbon Steel', type: 'iron' },
            { id: 'mat_silk_wrap', name: 'Silk Wrap', type: 'leather' },
            { id: 'mat_wind_gem', name: 'Wind Gem', type: 'magic' },
            { id: 'mat_blood_gem', name: 'Blood Gem', type: 'magic' },
            { id: 'mat_void_gem', name: 'Void Gem', type: 'magic' },
        ];

        for (const mat of defaultMaterials) {
            this.registerMaterial(mat);
        }
    }

    /**
     * Seeds the registry with initial available recipes.
     */
    private initializeDefaultRecipes(): void {
        const defaultRecipes: Recipe[] = [
            {
                id: 'rec_katana',
                name: 'Katana',
                // Accepts any of the gems as the 3rd material slot, or leather strips
                inputs: ['mat_tamahagane', 'mat_oak_wood'],
                output: {
                    id: 'wpn_katana',
                    name: 'Katana',
                    type: 'sword',
                    ability: 'none',
                    stats: { damage: 55, speed: 1.4, durability: 100, weight: 3.5 }
                }
            },
            {
                id: 'rec_iron_sword',
                name: 'Iron Sword Recipe',
                inputs: ['mat_iron_ingot', 'mat_pine_wood', 'mat_leather_strips'],
                output: {
                    id: 'wpn_iron_sword',
                    name: 'Iron Sword',
                    type: 'sword',
                    ability: 'none',
                    stats: { damage: 30, speed: 1.0, durability: 80, weight: 4.5 }
                }
            },
            {
                id: 'rec_steel_axe',
                name: 'Steel Axe Recipe',
                inputs: ['mat_steel_ingot', 'mat_steel_ingot', 'mat_oak_wood'],
                output: {
                    id: 'wpn_steel_axe',
                    name: 'Steel Axe',
                    type: 'axe',
                    ability: 'none',
                    stats: { damage: 45, speed: 0.8, durability: 120, weight: 6.0 }
                }
            },
            {
                id: 'rec_hunting_bow',
                name: 'Hunting Bow Recipe',
                inputs: ['mat_pine_wood', 'mat_pine_wood', 'mat_leather_strips'],
                output: {
                    id: 'wpn_hunting_bow',
                    name: 'Hunting Bow',
                    type: 'bow',
                    ability: 'none',
                    stats: { damage: 25, speed: 1.2, durability: 60, weight: 2.0 }
                }
            },
            {
                id: 'rec_nodachi',
                name: 'Nodachi',
                inputs: ['mat_high_carbon_steel', 'mat_hard_leather', 'mat_oak_wood'],
                output: {
                    id: 'wpn_nodachi',
                    name: 'Nodachi',
                    type: 'sword',
                    ability: 'none',
                    stats: { damage: 80, speed: 0.7, durability: 150, weight: 8 }
                }
            },
            {
                id: 'rec_wakizashi',
                name: 'Wakizashi',
                inputs: ['mat_tamahagane', 'mat_silk_wrap'],
                output: {
                    id: 'wpn_wakizashi',
                    name: 'Wakizashi',
                    type: 'sword',
                    ability: 'none',
                    stats: { damage: 35, speed: 1.8, durability: 60, weight: 1.5 }
                }
            }
        ];

        for (const recipe of defaultRecipes) {
            this.registerRecipe(recipe);
        }
    }

    /**
     * Registers a new material into the manager.
     */
    public registerMaterial(material: Material): void {
        this.materials.set(material.id, material);
    }

    /**
     * Registers a new recipe into the manager.
     */
    public registerRecipe(recipe: Recipe): void {
        const key = this.generateRecipeKey(recipe.inputs);
        this.recipes.set(key, recipe);
    }

    /**
     * Retrieves a material by its ID.
     */
    public getMaterial(id: string): Material | undefined {
        return this.materials.get(id);
    }

    /**
     * Returns a list of all registered materials.
     */
    public getAllMaterials(): Material[] {
        return Array.from(this.materials.values());
    }

    /**
     * Returns a list of all registered recipes.
     */
    public getAllRecipes(): Recipe[] {
        return Array.from(this.recipes.values());
    }

    /**
     * Finds a recipe that matches the exact set of provided materials.
     * Order of materials does not matter.
     */
    public findRecipe(materials: Material[]): Recipe | null {
        if (!materials || materials.length === 0) {
            return null;
        }

        const inputIds = materials.map(m => m.id);

        // Special case for Katana: requires Tamahagane, Oak Wood, and any 3rd material (usually a gem)
        if (inputIds.length === 3 && inputIds.includes('mat_tamahagane') && inputIds.includes('mat_oak_wood')) {
            return this.recipes.get(this.generateRecipeKey(['mat_tamahagane', 'mat_oak_wood'])) || null;
        }

        const key = this.generateRecipeKey(inputIds);
        
        return this.recipes.get(key) || null;
    }

    /**
     * Generates a unique, order-independent key for a set of material IDs.
     */
    private generateRecipeKey(materialIds: string[]): string {
        return [...materialIds].sort().join('|');
    }
}

// Provide a default singleton instance for convenience
export const recipeManager = new RecipeManager();
