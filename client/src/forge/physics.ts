import { BlendedMetallurgy } from "./materials";

export interface BladeGeometry {
  bladeLength: number; // cm (e.g. 74cm standard katana, 45cm wakizashi, 120cm nodachi)
  curvature: number; // cm sori (0.0 straight, 1.8 torii-sori, 3.2 deep sori)
  baseWidth: number; // cm motohaba (e.g. 3.2cm)
  tipWidth: number; // cm sakihaba (e.g. 2.2cm)
  baseThickness: number; // cm motokasane (e.g. 0.75cm)
  tipThickness: number; // cm sakikasane (distal taper, e.g. 0.45cm)
  tsukaLength: number; // cm handle length (e.g. 26cm)
  balanceShift: number; // -1 to +1 (tunes weight distribution towards pommel or tip)
  hamonPattern: "gunome" | "suguha" | "notare" | "midare" | "choji";
  tsubaStyle: "iron_mokko" | "sukashi_crane" | "dragon_maru" | "octagonal" | "minimal_plain";
  tsukaWrapColor: string;
}

export interface CalculatedWeaponStats {
  weightKg: number;
  inertia: number; // kg*m^2
  balancePointCm: number; // distance from guard in cm
  sweetSpotStartCm: number; // center of percussion optimal cutting zone start
  sweetSpotEndCm: number; // optimal cutting zone end
  tipReachCm: number;
  swingSpeedMs: number; // attack wind-up duration
  recoveryMs: number; // vulnerable recovery duration
  staminaCost: number; // stamina consumed per standard cut
  composureDamage: number; // posture disruption dealt to opponent's composure
  cuttingEfficiency: number; // 0 - 100 based on edge keenness, curvature, and velocity
  parryWindowMs: number; // duration of deflection counter window
  clashStability: number; // resistance to weapon deflection when colliding with enemy blade
  feintRecoveryMs: number; // cost/time to feint cancel
  bladeCategory: "tanto" | "wakizashi" | "katana" | "tachi" | "nodachi" | "naginata_hybrid";
}

export interface ForgedWeapon {
  name: string;
  geometry: BladeGeometry;
  metallurgy: BlendedMetallurgy;
  stats: CalculatedWeaponStats;
}

export function normalizeBladeGeometry(geo: BladeGeometry): BladeGeometry {
  const clamp = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) throw new Error('Blade dimensions must be finite.');
    return Math.min(max, Math.max(min, value));
  };
  const baseWidth = clamp(geo.baseWidth, 2.4, 4.5);
  const baseThickness = clamp(geo.baseThickness, 0.45, 1.1);
  return {
    bladeLength: clamp(geo.bladeLength, 35, 140),
    curvature: clamp(geo.curvature, 0, 4.5),
    baseWidth,
    tipWidth: clamp(geo.tipWidth, 1.2, baseWidth),
    baseThickness,
    tipThickness: clamp(geo.tipThickness, 0.2, baseThickness),
    tsukaLength: clamp(geo.tsukaLength, 18, 50),
    balanceShift: clamp(geo.balanceShift, -1, 1),
    hamonPattern: ['gunome', 'suguha', 'notare', 'midare', 'choji'].includes(geo.hamonPattern) ? geo.hamonPattern : 'suguha',
    tsubaStyle: ['iron_mokko', 'sukashi_crane', 'dragon_maru', 'octagonal', 'minimal_plain'].includes(geo.tsubaStyle) ? geo.tsubaStyle : 'iron_mokko',
    tsukaWrapColor: ['charcoal', 'crimson', 'indigo', 'leather', 'unbleached'].includes(geo.tsukaWrapColor) ? geo.tsukaWrapColor : 'charcoal',
  };
}

export function createForgedWeapon(name: string, geometry: BladeGeometry, metallurgy: BlendedMetallurgy): ForgedWeapon {
  const geo = normalizeBladeGeometry(geometry);
  for (const key of ['density', 'carbonContent', 'tensileStrength', 'toughness', 'hardnessHRC', 'resonanceDampening', 'luster', 'foldCount', 'effectiveLayers'] as const) {
    if (!Number.isFinite(metallurgy[key]) || metallurgy[key] < 0) throw new Error('Invalid steel properties.');
  }
  if (metallurgy.density <= 0 || !/^#[0-9a-f]{6}$/i.test(metallurgy.baseColor)) throw new Error('Invalid steel material.');
  const metal = { ...metallurgy };
  const stats = calculateWeaponPhysics(geo, metal);
  if (Object.values(stats).some(value => typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid weapon statistics.');
  return { name: name.trim().slice(0, 60) || 'Workshop Blade', geometry: geo, metallurgy: metal, stats };
}

export function calculateWeaponPhysics(
  geo: BladeGeometry,
  metal: BlendedMetallurgy
): CalculatedWeaponStats {
  geo = normalizeBladeGeometry(geo);
  // Discretize blade along length in 20 sections to compute exact mass distribution and rotational inertia
  const segments = 20;
  const dx = geo.bladeLength / segments; // in cm
  let totalBladeMassGrams = 0;
  let firstMoment = 0; // for center of mass
  let secondMoment = 0; // for moment of inertia

  for (let i = 0; i < segments; i++) {
    const x = (i + 0.5) * dx; // distance from habaki/guard in cm
    const tRatio = x / geo.bladeLength;

    // Linearly interpolated width and thickness
    const currentWidth = geo.baseWidth * (1 - tRatio) + geo.tipWidth * tRatio;
    const currentThickness = geo.baseThickness * (1 - tRatio) + geo.tipThickness * tRatio;

    // Cross-sectional area (approximated as diamond/shinogi-zukuri: 0.65 factor)
    const crossSectionalAreaCm2 = currentWidth * currentThickness * 0.65;
    const volumeCm3 = crossSectionalAreaCm2 * dx;

    // Mass of this slice in grams (density is g/cm³)
    const sliceMassG = volumeCm3 * metal.density;

    totalBladeMassGrams += sliceMassG;
    firstMoment += sliceMassG * x;
    secondMoment += sliceMassG * (x * x);
  }

  // Handle, Tsuba, and Kashira mass
  const tsubaMassG = geo.tsubaStyle === "minimal_plain" ? 110 : geo.tsubaStyle === "iron_mokko" ? 160 : 140;
  const tsukaMassG = (geo.tsukaLength / 26) * 180; // wood, rayskin, ito, fuchi-kashira
  // Balance weight adjustor (counterweight in pommel)
  const pommelShiftMassG = -geo.balanceShift * 90;

  const totalMassKg = (totalBladeMassGrams + tsubaMassG + tsukaMassG + pommelShiftMassG) / 1000;

  // Center of mass (Balance Point) from tsuba in cm
  // Negative positions for tsuka components (behind guard)
  const tsukaFirstMoment = -(tsukaMassG + pommelShiftMassG) * (geo.tsukaLength * 0.45);
  const totalFirstMoment = firstMoment + tsukaFirstMoment;
  const balancePointCm = Math.max(3.0, totalFirstMoment / (totalBladeMassGrams + tsubaMassG + tsukaMassG + pommelShiftMassG));

  // Rotational inertia around the wrist pivot point (~8cm down the handle from tsuba, or x = -8cm)
  const pivotOffsetCm = 8.0;
  let totalInertiaCg = 0;
  for (let i = 0; i < segments; i++) {
    const x = (i + 0.5) * dx + pivotOffsetCm; // distance from pivot in cm
    const tRatio = i / segments;
    const currentWidth = geo.baseWidth * (1 - tRatio) + geo.tipWidth * tRatio;
    const currentThickness = geo.baseThickness * (1 - tRatio) + geo.tipThickness * tRatio;
    const sliceMassKg = (currentWidth * currentThickness * 0.65 * dx * metal.density) / 1000;
    const xMeters = x / 100;
    totalInertiaCg += sliceMassKg * (xMeters * xMeters);
  }
  const handleInertia = (tsukaMassG / 1000) * Math.pow((geo.tsukaLength * 0.45 - pivotOffsetCm) / 100, 2);
  const inertiaKgM2 = Math.max(0.01, totalInertiaCg + handleInertia);

  // Center of Percussion (Sweet Spot zone): node where impact transmits zero shock to hands
  // q = I / (m * r_cm)
  const sweetSpotCenterCm = Math.min(
    geo.bladeLength - 6,
    Math.max(geo.bladeLength * 0.55, balancePointCm + (inertiaKgM2 / Math.max(0.3, totalMassKg * 0.01)) * 3.5)
  );
  const sweetSpotRangeHalf = Math.max(4.0, (geo.bladeLength * 0.12) * (metal.toughness / 80));
  const sweetSpotStartCm = Math.max(balancePointCm + 5, sweetSpotCenterCm - sweetSpotRangeHalf);
  const sweetSpotEndCm = Math.min(geo.bladeLength - 1, sweetSpotCenterCm + sweetSpotRangeHalf);

  // Dynamic combat metrics derived purely from physics:
  // Heavier/longer blades have longer wind-up and recovery, but superior composure damage and reach
  const baseSwingTime = 220; // ms
  const swingSpeedMs = Math.round(baseSwingTime + inertiaKgM2 * 180 + (totalMassKg - 1.0) * 110);
  const recoveryMs = Math.round(180 + inertiaKgM2 * 210 + (totalMassKg - 1.0) * 130);
  const staminaCost = Math.round(14 + totalMassKg * 8 + inertiaKgM2 * 12);

  // Cutting efficiency: enhanced by curvature (draw-cut shearing angle), metallurgy hardness, and tip speed
  const curvatureBonus = Math.min(22, geo.curvature * 8);
  const hardnessBonus = (metal.hardnessHRC - 50) * 1.8;
  const cuttingEfficiency = Math.min(99, Math.max(30, 45 + curvatureBonus + hardnessBonus));

  // Composure damage (posture destruction on hit or blocked strike)
  const momentumFactor = totalMassKg * (1 + inertiaKgM2 * 0.8);
  const composureDamage = Math.round(22 + momentumFactor * 14 + (metal.density / 7.85) * 5);

  // Parry window: Lighter, agile blades with balance point closer to hands yield faster deflection
  // e.g. 170ms for nimble blade, 110ms for massive nodachi
  const agilityFactor = Math.max(0.4, 2.2 - (balancePointCm / 15) - inertiaKgM2);
  const parryWindowMs = Math.round(Math.min(210, Math.max(90, 110 + agilityFactor * 35)));

  // Clash stability (deflection resistance during blade bind)
  const clashStability = Math.round(Math.min(98, (metal.resonanceDampening * 0.4) + (totalMassKg * 25) + (geo.baseThickness * 20)));

  // Feint cancellation recovery time
  const feintRecoveryMs = Math.round(80 + inertiaKgM2 * 90);

  // Determine blade category classification
  let bladeCategory: CalculatedWeaponStats["bladeCategory"] = "katana";
  if (geo.bladeLength <= 40) {
    bladeCategory = "tanto";
  } else if (geo.bladeLength <= 58) {
    bladeCategory = "wakizashi";
  } else if (geo.bladeLength >= 105) {
    bladeCategory = "nodachi";
  } else if (geo.bladeLength > 82 && geo.curvature >= 2.6) {
    bladeCategory = "tachi";
  } else if (geo.tsukaLength >= 50 || (geo.bladeLength > 90 && geo.baseWidth > 4.0)) {
    bladeCategory = "naginata_hybrid";
  }

  return {
    weightKg: parseFloat(totalMassKg.toFixed(2)),
    inertia: parseFloat(inertiaKgM2.toFixed(3)),
    balancePointCm: parseFloat(balancePointCm.toFixed(1)),
    sweetSpotStartCm: parseFloat(sweetSpotStartCm.toFixed(1)),
    sweetSpotEndCm: parseFloat(sweetSpotEndCm.toFixed(1)),
    tipReachCm: parseFloat((geo.bladeLength + geo.tsukaLength * 0.5).toFixed(1)),
    swingSpeedMs,
    recoveryMs,
    staminaCost,
    composureDamage,
    cuttingEfficiency: Math.round(cuttingEfficiency),
    parryWindowMs,
    clashStability,
    feintRecoveryMs,
    bladeCategory,
  };
}
