import { MaterialId } from './material-properties.js';
import { HandleConfig, SurfaceFinish } from './weapon-blueprint.js';

export enum ForgeStep {
  MATERIAL_SELECTION = 'MATERIAL_SELECTION',
  SMELTING = 'SMELTING',
  HAMMERING = 'HAMMERING',
  SHAPING = 'SHAPING',
  QUENCHING = 'QUENCHING',
  GRINDING = 'GRINDING',
  HANDLE_ASSEMBLY = 'HANDLE_ASSEMBLY',
  TESTING = 'TESTING',
  COMPLETE = 'COMPLETE'
}

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
  temperature: number; // °C
  hardness: number;
  carbonContent: number;
}

export interface HammerStrike {
  position: { x: number, y: number, z: number };
  force: number;
  direction: { x: number, y: number, z: number };
  timestamp: number;
}

export interface GrindPass {
  angle: number;
  pressure: number;
  stoneType: MaterialId;
  timestamp: number;
}

export interface Defect {
  type: 'crack' | 'inclusion' | 'warping';
  severity: number; // 0-1
  position: { x: number, y: number, z: number };
}

export interface ForgeState {
  currentStep: ForgeStep;
  billetControlPoints: ControlPoint[][][]; // 3D grid
  temperature: number; // °C
  materialComposition: { id: MaterialId; ratio: number }[];
  hammerStrikes: HammerStrike[];
  clayPattern: number[][]; // 2D thickness map
  grindPasses: GrindPass[];
  handleConfig: HandleConfig | null;
  defects: Defect[];
  elapsedTime: number;
  // Dimensions of the billet grid
  gridDimensions: { x: number, y: number, z: number };
}

export type ForgeAction = 
  | { type: 'SELECT_MATERIALS'; materials: { id: MaterialId; ratio: number }[] }
  | { type: 'HEAT_FURNACE'; heatInput: number; dt: number }
  | { type: 'STRIKE_HAMMER'; position: {x:number, y:number, z:number}; force: number; direction: {x:number, y:number, z:number} }
  | { type: 'APPLY_CLAY'; pattern: number[][] }
  | { type: 'QUENCH'; medium: 'water' | 'oil' | 'air' }
  | { type: 'GRIND'; angle: number; pressure: number; stoneType: MaterialId }
  | { type: 'ASSEMBLE_HANDLE'; config: HandleConfig }
  | { type: 'TEST_WEAPON' }
  | { type: 'ADVANCE_STEP' };
