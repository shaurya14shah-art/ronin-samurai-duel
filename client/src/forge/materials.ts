export interface ForgeMaterial {
  id: string;
  name: string;
  kanji: string;
  description: string;
  origin: string;
  density: number; // g/cm³
  carbonContent: number; // percentage (0.2% - 1.8%)
  tensileStrength: number; // MPa (400 - 1800)
  toughness: number; // 0 - 100 (shock resistance)
  hardnessHRC: number; // Rockwell C (45 - 67)
  resonanceDampening: number; // 0 - 100 (vibration absorption on blade clash)
  baseColor: string; // hex representation
  luster: number; // 0 - 1 shininess
  grainTexture: "folded" | "crystalline" | "crucible" | "smooth" | "damascus" | "obsidian";
}

export const FORGE_MATERIALS: Record<string, ForgeMaterial> = {
  tamahagane: {
    id: "tamahagane",
    name: "Tatara Tamahagane",
    kanji: "玉鋼",
    description: "Traditional jewel steel smelted in a clay tatara furnace using black iron sand and pine charcoal. Unmatched balance of carbon purity and layered ductility.",
    origin: "Izumo Province",
    density: 7.85,
    carbonContent: 1.25,
    tensileStrength: 1250,
    toughness: 82,
    hardnessHRC: 62,
    resonanceDampening: 78,
    baseColor: "#cbd5e1",
    luster: 0.85,
    grainTexture: "folded",
  },
  meteoric_iron: {
    id: "meteoric_iron",
    name: "Nickel Steel",
    kanji: "鋼",
    description: "Dense steel: a harder edge than sand steel, but more mass slows the swing and toughness is lower.",
    origin: "Hida Mountains Crater",
    density: 8.12,
    carbonContent: 0.95,
    tensileStrength: 1480,
    toughness: 76,
    hardnessHRC: 64,
    resonanceDampening: 90,
    baseColor: "#94a3b8",
    luster: 0.92,
    grainTexture: "crystalline",
  },
  folded_river_steel: {
    id: "folded_river_steel",
    name: "Folded River Sand Steel",
    kanji: "川砂鋼",
    description: "Washed river sand iron smelted at low temperature and folded repeatedly with soft iron core. Exceptionally supple, springy, and forgiving under heavy parries.",
    origin: "Yoshino River",
    density: 7.78,
    carbonContent: 0.75,
    tensileStrength: 1100,
    toughness: 94,
    hardnessHRC: 58,
    resonanceDampening: 85,
    baseColor: "#9ca3af",
    luster: 0.72,
    grainTexture: "folded",
  },
  charcoal_damascus: {
    id: "charcoal_damascus",
    name: "Charcoal Crucible Damascus",
    kanji: "炭焼鋼",
    description: "Smelted inside closed ceramic crucibles with ironwood charcoal. Micro-carbide segregation creates high-contrast serpentine banding and vicious cutting bite.",
    origin: "Sakai Master Kilns",
    density: 7.92,
    carbonContent: 1.45,
    tensileStrength: 1390,
    toughness: 70,
    hardnessHRC: 65,
    resonanceDampening: 65,
    baseColor: "#475569",
    luster: 0.78,
    grainTexture: "damascus",
  },
  obsidian_steel: {
    id: "obsidian_steel",
    name: "High Carbon Tool Steel",
    kanji: "炭素鋼",
    description: "The hardest edge in this workshop, with the lowest toughness. Light stock, but less forgiving under impact.",
    origin: "Mount Aso Caldera",
    density: 7.65,
    carbonContent: 1.60,
    tensileStrength: 1520,
    toughness: 60,
    hardnessHRC: 66,
    resonanceDampening: 55,
    baseColor: "#1e293b",
    luster: 0.95,
    grainTexture: "obsidian",
  },
  white_paper_steel: {
    id: "white_paper_steel",
    name: "White Paper High Purity",
    kanji: "白紙鋼",
    description: "Ultra-pure iron sand with virtually zero phosphorus or sulfur impurities. Takes the keenest razor edge in the realm, rewarding surgical precision.",
    origin: "Shimane Forge",
    density: 7.82,
    carbonContent: 1.35,
    tensileStrength: 1320,
    toughness: 68,
    hardnessHRC: 65,
    resonanceDampening: 72,
    baseColor: "#f1f5f9",
    luster: 0.90,
    grainTexture: "smooth",
  },
};

export interface MaterialBlendEntry {
  materialId: string;
  ratio: number; // 0 - 1 (sum across entries should equal 1)
}

export interface BlendedMetallurgy {
  density: number;
  carbonContent: number;
  tensileStrength: number;
  toughness: number;
  hardnessHRC: number;
  resonanceDampening: number;
  baseColor: string;
  luster: number;
  grainTexture: string;
  foldCount: number;
  effectiveLayers: number;
}

export function computeBlendedMetallurgy(
  entries: MaterialBlendEntry[],
  foldCount: number = 10
): BlendedMetallurgy {
  if (entries.length === 0) {
    const base = FORGE_MATERIALS.tamahagane;
    return {
      density: base.density,
      carbonContent: base.carbonContent,
      tensileStrength: base.tensileStrength,
      toughness: base.toughness,
      hardnessHRC: base.hardnessHRC,
      resonanceDampening: base.resonanceDampening,
      baseColor: base.baseColor,
      luster: base.luster,
      grainTexture: base.grainTexture,
      foldCount,
      effectiveLayers: Math.pow(2, foldCount),
    };
  }

  // Normalize ratios
  const totalRatio = entries.reduce((acc, e) => acc + (e.ratio || 0), 0) || 1;
  let blendedDensity = 0;
  let blendedCarbon = 0;
  let blendedTensile = 0;
  let blendedToughness = 0;
  let blendedHRC = 0;
  let blendedDampening = 0;
  let blendedLuster = 0;

  for (const entry of entries) {
    const mat = FORGE_MATERIALS[entry.materialId] || FORGE_MATERIALS.tamahagane;
    const weight = entry.ratio / totalRatio;
    blendedDensity += mat.density * weight;
    blendedCarbon += mat.carbonContent * weight;
    blendedTensile += mat.tensileStrength * weight;
    blendedToughness += mat.toughness * weight;
    blendedHRC += mat.hardnessHRC * weight;
    blendedDampening += mat.resonanceDampening * weight;
    blendedLuster += mat.luster * weight;
  }

  // Folding effect: enhances grain toughness, homogenizes carbon, slight work-hardening
  const foldBonus = Math.min(foldCount, 16) * 1.2;
  const finalToughness = Math.min(99, blendedToughness + foldBonus * 0.4);
  const finalHRC = Math.min(67, blendedHRC + (foldCount > 8 ? 0.8 : 0));
  const effectiveLayers = Math.pow(2, Math.min(foldCount, 16));

  const primaryMaterial = FORGE_MATERIALS[entries[0].materialId] || FORGE_MATERIALS.tamahagane;

  return {
    density: parseFloat(blendedDensity.toFixed(3)),
    carbonContent: parseFloat(blendedCarbon.toFixed(3)),
    tensileStrength: Math.round(blendedTensile),
    toughness: Math.round(finalToughness),
    hardnessHRC: Math.round(finalHRC),
    resonanceDampening: Math.round(blendedDampening),
    baseColor: primaryMaterial.baseColor,
    luster: parseFloat(blendedLuster.toFixed(2)),
    grainTexture: primaryMaterial.grainTexture,
    foldCount,
    effectiveLayers,
  };
}
