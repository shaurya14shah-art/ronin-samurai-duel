import { MaterialId } from './material-properties.js';
import { ForgeAction } from './forge-state.js';

export type CrossSectionType = 'hira-zukuri' | 'shinogi-zukuri' | 'kiriha-zukuri' | 'shobu-zukuri';
export type WrapPattern = 'hineri-maki' | 'katate-maki' | 'tsumami-maki' | 'none';
export type GuardType = 'maru' | 'kaku' | 'mokko' | 'sukashi' | 'none';
export type SurfaceFinish = 'rough' | 'polished' | 'mirror' | 'acid-etched';

export interface BladeGeometry {
  length: number;           // cm, from hammering extent
  width: number;            // cm, from hammering spread
  thickness: number;        // mm, from hammering compression
  curvature: number;        // 0=straight, 1=extreme curve
  taperProfile: number[];   // thickness samples along blade length (16 points)
  crossSection: CrossSectionType;
  edgeAngle: number;        // degrees, from grinding
  hasFuller: boolean;
  fullerDepth: number;
  fullerPosition: number;   // 0-1 along blade
}

export interface HandleConfig {
  length: number;           // cm
  material: MaterialId;
  wrapMaterial: MaterialId | null;
  wrapPattern: WrapPattern;
  guardType: GuardType;
  guardMaterial: MaterialId;
  pommelWeight: number;     // grams
  pommelMaterial: MaterialId;
}

export interface WeaponPhysics {
  totalMass: number;
  balancePoint: number;
  momentOfInertia: number;
  edgeRetention: number;
  flexibility: number;
  resonanceFrequency: number;
}

export interface WeaponCombat {
  swingSpeed: number;
  cuttingPower: number;
  thrustPower: number;
  parryStrength: number;
  staminaCostPerSwing: number;
  reachAdvantage: number;
  recoverySpeed: number;
  durability: number;
}

export interface WeaponAppearance {
  hamonLine: boolean;
  hamonPattern: number[];
  bladeColor: [number, number, number];
  surfaceFinish: SurfaceFinish;
  patinaLevel: number;
}

export interface WeaponBlueprint {
  id: string;
  name: string;
  blade: BladeGeometry;
  handle: HandleConfig;
  physics: WeaponPhysics;
  combat: WeaponCombat;
  appearance: WeaponAppearance;
  materials: { blade: MaterialId[], handle: MaterialId[], guard: MaterialId[] };
  forgedBy: string;
  forgeDate: number;
  forgeQuality: number;
  history: ForgeAction[];
}

export function createBlankBlueprint(): WeaponBlueprint {
  return {
    id: crypto.randomUUID?.() ?? Math.random().toString(36).substring(2),
    name: 'Unfinished Blade',
    blade: {
      length: 0,
      width: 0,
      thickness: 0,
      curvature: 0,
      taperProfile: new Array(16).fill(0),
      crossSection: 'shinogi-zukuri',
      edgeAngle: 45,
      hasFuller: false,
      fullerDepth: 0,
      fullerPosition: 0
    },
    handle: {
      length: 0,
      material: 'oak',
      wrapMaterial: null,
      wrapPattern: 'none',
      guardType: 'none',
      guardMaterial: 'magnetite',
      pommelWeight: 0,
      pommelMaterial: 'magnetite'
    },
    physics: {
      totalMass: 0,
      balancePoint: 0,
      momentOfInertia: 0,
      edgeRetention: 0,
      flexibility: 0,
      resonanceFrequency: 0
    },
    combat: {
      swingSpeed: 0,
      cuttingPower: 0,
      thrustPower: 0,
      parryStrength: 0,
      staminaCostPerSwing: 0,
      reachAdvantage: 0,
      recoverySpeed: 0,
      durability: 0
    },
    appearance: {
      hamonLine: false,
      hamonPattern: [],
      bladeColor: [200, 200, 200],
      surfaceFinish: 'rough',
      patinaLevel: 0
    },
    materials: { blade: [], handle: [], guard: [] },
    forgedBy: 'Unknown Smith',
    forgeDate: Date.now(),
    forgeQuality: 0,
    history: []
  };
}
