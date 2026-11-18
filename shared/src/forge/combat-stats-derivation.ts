import { WeaponPhysics, WeaponCombat, BladeGeometry } from './weapon-blueprint.js';
import { MaterialId, mixAlloy } from './material-properties.js';

export function calculatePhysics(geometry: BladeGeometry, materials: {id: MaterialId, ratio: number}[]): WeaponPhysics {
  const alloy = mixAlloy(materials);
  
  // Total Mass: density * volume (approx, cm^3 converted from geometry)
  const volumeCm3 = geometry.length * geometry.width * (geometry.thickness / 10);
  const totalMass = alloy.density * volumeCm3; // grams

  // Balance Point: from mass distribution along blade length
  const taperFactor = geometry.taperProfile.reduce((a, b) => a + b, 0) / (geometry.taperProfile.length || 1);
  const balancePoint = (geometry.length / 2) * (taperFactor / (geometry.thickness || 1));

  // Moment of Inertia: Mass * distance^2 (integrated roughly from pivot)
  const momentOfInertia = totalMass * Math.pow(balancePoint, 2);

  // Edge Retention: Hardness * grain * (1 - impurity)
  const edgeRetention = alloy.hardness * alloy.grainStructure * (1.0 - alloy.impurityLevel);

  // Flexibility: elasticity * (1/thickness) * length
  const flexibility = alloy.elasticity * (1.0 / Math.max(0.1, geometry.thickness)) * geometry.length;

  // Resonance Frequency: sqrt(elasticity/density) / (2 * length)
  const resonanceFrequency = Math.sqrt(alloy.elasticity / alloy.density) / (2 * geometry.length / 100);

  return {
    totalMass,
    balancePoint,
    momentOfInertia,
    edgeRetention,
    flexibility,
    resonanceFrequency
  };
}

export function calculateCombatStats(physics: WeaponPhysics, geometry: BladeGeometry, handleLength: number): WeaponCombat {
  // Swing Speed: clamped 0.2 - 1.5
  let swingSpeed = 1.0 / (physics.momentOfInertia * 0.00001 + 0.3);
  swingSpeed = Math.max(0.2, Math.min(1.5, swingSpeed));

  // Edge Sharpness
  const edgeSharpness = Math.max(0, 1.0 - (geometry.edgeAngle / 90.0));

  // Cutting Power: (edgeSharpness * mass * swingSpeed * hardness) / 4 (clamped 0 - 1)
  const massKg = physics.totalMass / 1000.0;
  let cuttingPower = (edgeSharpness * massKg * swingSpeed * physics.edgeRetention) / 4.0;
  cuttingPower = Math.max(0, Math.min(1, cuttingPower));

  // Thrust Power: taperSharpness * rigidity * mass
  const taperEnd = geometry.taperProfile[geometry.taperProfile.length - 1] || geometry.thickness;
  const taperSharpness = Math.max(0, 1.0 - (taperEnd / 10.0));
  const rigidity = 1.0 / Math.max(0.1, physics.flexibility);
  let thrustPower = taperSharpness * rigidity * massKg;
  thrustPower = Math.max(0, Math.min(1, thrustPower));

  // Parry Strength: elasticity * mass * (1 - balancePoint/bladeLength)
  const parryFactor = 1.0 - (physics.balancePoint / Math.max(1, geometry.length));
  let parryStrength = physics.flexibility * massKg * Math.max(0, parryFactor);
  parryStrength = Math.max(0, Math.min(1, parryStrength));

  // Stamina Cost Per Swing
  const idealBalance = geometry.length * 0.2; 
  let staminaCostPerSwing = massKg * (1 + Math.abs(physics.balancePoint - idealBalance) * 2);
  staminaCostPerSwing = Math.max(0, Math.min(1, staminaCostPerSwing / 10.0));

  // Reach Advantage
  const reachAdvantage = (geometry.length + handleLength) / 100.0;

  // Recovery Speed
  let recoverySpeed = 1.0 / (massKg * 0.5 + (physics.momentOfInertia * 0.00001) * 0.3);
  recoverySpeed = Math.max(0, Math.min(1, recoverySpeed));

  // Durability
  let durability = physics.edgeRetention * (geometry.thickness / 10.0);
  durability = Math.max(0, Math.min(1, durability / 10.0)); 

  return {
    swingSpeed,
    cuttingPower,
    thrustPower,
    parryStrength,
    staminaCostPerSwing,
    reachAdvantage,
    recoverySpeed,
    durability
  };
}
