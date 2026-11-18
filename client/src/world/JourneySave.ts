import type { PlayerStats } from '../player/PlayerStats';
import { freshWay, validateWay, type WayState } from '../progression/Way';
import type { Weapon } from '../forge/RecipeManager';
import { createForgedWeapon, type BladeGeometry } from '../forge/physics';
import type { BlendedMetallurgy } from '../forge/materials';
import { forgedWeaponToInventory } from '../inventory/InventorySystem';

export const JOURNEY_KEY = 'ronin.journey.v1';
export const RIVAL_IDS = ['shrine', 'hamlet', 'bridge', 'battlefield', 'bamboo'] as const;
export type RivalId = typeof RIVAL_IDS[number];
export type RivalMemory = { encounters: number; wins: number; falls: number; defeatedUntil: number };
export interface JourneyState {
    version: 1;
    position: { x: number; y: number; z: number };
    time: number;
    totalWorldTime: number;
    /** Where the body's resources stood. There are no levels or stat points: skill is the player's. */
    stats: { hp: number; stamina: number; composure: number };
    /** Training: conditioning, blade proficiency, techniques and their mastery (progression/Way). */
    way: WayState;
    weapons: Weapon[];
    activeIndex: number;
    rivals: Record<RivalId, RivalMemory>;
}

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const number = (value: unknown, fallback: number, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const integer = (value: unknown, fallback: number, max: number): number => Number.isSafeInteger(value) ? number(value, fallback, 0, max) : fallback;
const text = (value: unknown, fallback: string): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) || fallback : fallback;

export function starterWeapon(): Weapon {
    return { id: 'wpn_katana', name: 'Wayfarer’s Sword', type: 'sword', ability: 'none', stats: { damage: 25, speed: 1, durability: 80, weight: 1.2 } };
}

export function freshJourney(): JourneyState {
    return {
        version: 1, position: { x: 0, y: 1.7, z: 8 }, time: 0.85, totalWorldTime: 0,
        stats: { hp: 200, stamina: 100, composure: 200 },
        way: freshWay(),
        weapons: [starterWeapon()], activeIndex: 0,
        rivals: Object.fromEntries(RIVAL_IDS.map(id => [id, { encounters: 0, wins: 0, falls: 0, defeatedUntil: 0 }])) as Record<RivalId, RivalMemory>
    };
}

function equipment(value: unknown): Weapon | null {
    const entry = object(value), stats = object(entry.stats);
    const name = text(entry.name, 'Workshop Blade');
    if (entry.geometry || entry.metallurgy) {
        const geo = object(entry.geometry), metal = object(entry.metallurgy);
        const geometryKeys = ['bladeLength', 'curvature', 'baseWidth', 'tipWidth', 'baseThickness', 'tipThickness', 'tsukaLength', 'balanceShift'];
        const metalLimits: Record<string, [number, number]> = { density: [1, 20], carbonContent: [0, 5], tensileStrength: [1, 5000], toughness: [0, 100], hardnessHRC: [0, 100], resonanceDampening: [0, 100], luster: [0, 1], foldCount: [0, 30], effectiveLayers: [1, 1073741824] };
        if (geometryKeys.some(key => !Number.isFinite(geo[key]) || Math.abs(geo[key] as number) > 1000)) return null;
        if (Object.entries(metalLimits).some(([key, [min, max]]) => number(metal[key], -1, min, max) < 0)) return null;
        if (typeof metal.baseColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(metal.baseColor)) return null;
        const cleanMetal = Object.fromEntries(Object.keys(metalLimits).map(key => [key, metal[key]]));
        cleanMetal.baseColor = metal.baseColor;
        cleanMetal.grainTexture = ['folded', 'crystalline', 'crucible', 'smooth', 'damascus', 'obsidian'].includes(String(metal.grainTexture)) ? metal.grainTexture : 'folded';
        try {
            return forgedWeaponToInventory(createForgedWeapon(name, geo as unknown as BladeGeometry, cleanMetal as unknown as BlendedMetallurgy));
        } catch { return null; }
    }
    if (!['sword', 'axe', 'bow', 'dagger', 'spear', 'mace'].includes(String(entry.type))) return null;
    const limits = { damage: [1, 150], speed: [0.2, 3], durability: [0, 100], weight: [0.1, 20] };
    if (Object.entries(limits).some(([key, [min, max]]) => number(stats[key], -1, min, max) < 0)) return null;
    return { id: text(entry.id, 'wpn_saved'), name, type: entry.type as Weapon['type'], ability: ['none', 'blood_price', 'wind_step', 'empty_ground'].includes(String(entry.ability)) ? entry.ability as Weapon['ability'] : 'none', stats: { damage: stats.damage as number, speed: stats.speed as number, durability: stats.durability as number, weight: stats.weight as number } };
}

export function validateJourney(value: unknown): JourneyState | null {
    const data = object(value);
    if (data.version !== 1) return null;
    const result = freshJourney();
    // Older saves also carried level, experience, base stats and skill points; they are dropped.
    const pos = object(data.position), stats = object(data.stats);
    result.position = { x: number(pos.x, 0, -100000, 100000), y: number(pos.y, 1.7, -100, 200), z: number(pos.z, 8, -100000, 100000) };
    result.time = number(data.time, 0.32, 0, 1) % 1;
    result.totalWorldTime = number(data.totalWorldTime, 0, 0, 1e9);
    result.stats.hp = number(stats.hp, 200, 0, 5000);
    result.stats.stamina = number(stats.stamina, 100, 0, 5000);
    result.stats.composure = number(stats.composure, 200, 0, 5000);
    result.way = validateWay(data.way);
    const rawWeapons = Array.isArray(data.weapons) ? data.weapons.slice(0, 32) : [];
    result.weapons = rawWeapons.map(entry => equipment(entry) ?? starterWeapon());
    if (!result.weapons.length) result.weapons.push(starterWeapon());
    result.activeIndex = integer(data.activeIndex, 0, result.weapons.length - 1);
    const memories = object(data.rivals);
    for (const id of RIVAL_IDS) {
        const memory = object(memories[id]);
        const encounters = integer(memory.encounters, 0, 1000000);
        result.rivals[id] = { encounters, wins: integer(memory.wins, 0, encounters), falls: integer(memory.falls, 0, encounters), defeatedUntil: number(memory.defeatedUntil, 0, 0, result.totalWorldTime + 2400) };
    }
    return result;
}

/** Put the saved resources back into the live stats. */
export function restoreResources(stats: PlayerStats, state: JourneyState): void {
    stats.currentHp = Math.min(stats.maxHp, state.stats.hp);
    stats.currentStamina = Math.min(stats.maxStamina, state.stats.stamina);
    stats.currentComposure = Math.min(stats.maxComposure, state.stats.composure);
}

export function loadJourney(storage?: Pick<Storage, 'getItem'>): JourneyState | null {
    try {
        const raw = (storage ?? localStorage).getItem(JOURNEY_KEY);
        if (!raw || raw.length > 262144) return null;
        return validateJourney(JSON.parse(raw));
    } catch { return null; }
}

export function storeJourney(state: JourneyState, storage?: Pick<Storage, 'setItem'>): boolean {
    try {
        const validated = validateJourney(state);
        if (!validated) return false;
        const raw = JSON.stringify(validated);
        if (raw.length > 262144) return false;
        (storage ?? localStorage).setItem(JOURNEY_KEY, raw);
        return true;
    } catch { return false; }
}
