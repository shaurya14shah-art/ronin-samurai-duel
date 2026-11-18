import { ForgeState, ForgeStep, ControlPoint, HammerStrike, GrindPass } from './forge-state.js';
import { MaterialId } from './material-properties.js';

export function applyHammerStrike(state: ForgeState, position: {x:number, y:number, z:number}, force: number, direction: {x:number, y:number, z:number}): ForgeState {
  if (state.currentStep !== ForgeStep.HAMMERING && state.currentStep !== ForgeStep.SHAPING) {
    return state;
  }

  const newState = { ...state, billetControlPoints: [...state.billetControlPoints] };
  const strike: HammerStrike = { position, force, direction, timestamp: state.elapsedTime };
  newState.hammerStrikes = [...state.hammerStrikes, strike];

  const malleability = Math.max(0.01, (state.temperature - 600) / 1000.0);
  const isDangerous = state.temperature < 600;

  const radius = 2.0;
  let crackRiskAcc = 0;

  for (let x = 0; x < state.gridDimensions.x; x++) {
    newState.billetControlPoints[x] = [...state.billetControlPoints[x]];
    for (let y = 0; y < state.gridDimensions.y; y++) {
      newState.billetControlPoints[x][y] = [...state.billetControlPoints[x][y]];
      for (let z = 0; z < state.gridDimensions.z; z++) {
        const cp = { ...newState.billetControlPoints[x][y][z] };
        
        const dx = cp.x - position.x;
        const dy = cp.y - position.y;
        const dz = cp.z - position.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (dist < radius) {
          const influence = (1 - (dist / radius)) * force * malleability;
          
          cp.x += direction.x * influence;
          cp.y += direction.y * influence;
          cp.z += direction.z * influence;
          
          cp.hardness = Math.min(10, cp.hardness + (influence * 0.1));

          if (isDangerous) {
            crackRiskAcc += influence;
          }
        }
        newState.billetControlPoints[x][y][z] = cp;
      }
    }
  }

  if (isDangerous && crackRiskAcc > 0.5) {
    newState.defects = [...state.defects, {
      type: 'crack',
      severity: Math.min(1, crackRiskAcc * 0.2),
      position: { ...position }
    }];
  }

  return newState;
}

export function updateTemperature(state: ForgeState, dt: number, heatInput: number): ForgeState {
  const ambientTemp = 25; 
  const surfaceAreaFactor = 0.05; 
  
  const heatLoss = (state.temperature - ambientTemp) * surfaceAreaFactor * dt;
  let newTemp = state.temperature - heatLoss + (heatInput * dt);
  newTemp = Math.max(ambientTemp, newTemp);

  const newState = { ...state, temperature: newTemp, elapsedTime: state.elapsedTime + dt };
  
  newState.billetControlPoints = state.billetControlPoints.map(plane => 
    plane.map(row => 
      row.map(cp => ({
        ...cp,
        temperature: newTemp 
      }))
    )
  );

  return newState;
}

export function applyClay(state: ForgeState, pattern: number[][]): ForgeState {
  if (state.currentStep !== ForgeStep.QUENCHING) return state;
  return { ...state, clayPattern: pattern };
}

export function quenchBlade(state: ForgeState, medium: 'water' | 'oil' | 'air'): ForgeState {
  if (state.currentStep !== ForgeStep.QUENCHING) return state;

  const newState = { ...state, billetControlPoints: [...state.billetControlPoints] };
  const coolingRateBase = medium === 'water' ? 1000 : (medium === 'oil' ? 500 : 50);

  for (let x = 0; x < state.gridDimensions.x; x++) {
    newState.billetControlPoints[x] = [...state.billetControlPoints[x]];
    for (let y = 0; y < state.gridDimensions.y; y++) {
      newState.billetControlPoints[x][y] = [...state.billetControlPoints[x][y]];
      for (let z = 0; z < state.gridDimensions.z; z++) {
        const cp = { ...newState.billetControlPoints[x][y][z] };
        
        const clayThickness = state.clayPattern[x]?.[z] || 0;
        const effectiveCoolingRate = coolingRateBase / (1 + clayThickness);
        
        if (effectiveCoolingRate > 600 && cp.temperature > 800) {
          cp.hardness = Math.min(10, cp.hardness * 1.5); 
        } else {
          cp.hardness = Math.max(1, cp.hardness * 0.8); 
        }
        
        cp.temperature = 25; 
        newState.billetControlPoints[x][y][z] = cp;
      }
    }
  }

  newState.temperature = 25;
  return newState;
}

export function grindEdge(state: ForgeState, angle: number, pressure: number, stoneType: MaterialId): ForgeState {
  if (state.currentStep !== ForgeStep.GRINDING) return state;
  
  const pass: GrindPass = { angle, pressure, stoneType, timestamp: state.elapsedTime };
  return {
    ...state,
    grindPasses: [...state.grindPasses, pass]
  };
}

export function advanceStep(state: ForgeState): ForgeState {
  const transitions: Record<ForgeStep, ForgeStep> = {
    [ForgeStep.MATERIAL_SELECTION]: ForgeStep.SMELTING,
    [ForgeStep.SMELTING]: ForgeStep.HAMMERING,
    [ForgeStep.HAMMERING]: ForgeStep.SHAPING,
    [ForgeStep.SHAPING]: ForgeStep.QUENCHING,
    [ForgeStep.QUENCHING]: ForgeStep.GRINDING,
    [ForgeStep.GRINDING]: ForgeStep.HANDLE_ASSEMBLY,
    [ForgeStep.HANDLE_ASSEMBLY]: ForgeStep.TESTING,
    [ForgeStep.TESTING]: ForgeStep.COMPLETE,
    [ForgeStep.COMPLETE]: ForgeStep.COMPLETE
  };

  return {
    ...state,
    currentStep: transitions[state.currentStep] || state.currentStep
  };
}
