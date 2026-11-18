export type MaterialCategory = 'iron_ore' | 'carbon_source' | 'exotic_metal' | 'organic' | 'wood' | 'wrapping' | 'stone' | 'clay';

export type MaterialId = 
  | 'tamahagane' | 'magnetite' | 'bog_iron' | 'black_sand_iron' | 'wrought_iron'
  | 'pine_charcoal' | 'bamboo_charcoal' | 'oak_charcoal' | 'rice_straw_ash'
  | 'meteoric_iron' | 'ancient_bronze' | 'copper' | 'tin' | 'silver' | 'gold'
  | 'bone' | 'antler' | 'horn' | 'sharkskin'
  | 'oak' | 'bamboo' | 'magnolia' | 'cherry' | 'cryptomeria' | 'ebony'
  | 'silk_cord' | 'cotton_cord' | 'leather_strip' | 'ray_skin'
  | 'coarse_whetstone' | 'medium_whetstone' | 'fine_whetstone' | 'ultra_fine_whetstone'
  | 'mountain_clay' | 'river_clay';

export interface Material {
  id: MaterialId;
  name: string;
  category: MaterialCategory;
  density: number;             // g/cm³ (0.1 - 22.0)
  hardness: number;            // Mohs (1 - 10)
  elasticity: number;          // 0.0 - 1.0
  heatCapacity: number;        // 0.1 - 2.0 (how long it stays workable)
  grainStructure: number;      // 0.0 - 1.0 (crystalline order)
  impurityLevel: number;       // 0.0 - 1.0
  corrosionResistance: number; // 0.0 - 1.0
  meltingPoint: number;        // °C
  color: [number, number, number]; // RGB
}

export const MATERIALS: Record<MaterialId, Material> = {
  // Iron Ores
  tamahagane: { id: 'tamahagane', name: 'Tamahagane', category: 'iron_ore', density: 7.8, hardness: 6.5, elasticity: 0.6, heatCapacity: 1.2, grainStructure: 0.8, impurityLevel: 0.2, corrosionResistance: 0.6, meltingPoint: 1500, color: [169, 169, 169] },
  magnetite: { id: 'magnetite', name: 'Magnetite', category: 'iron_ore', density: 5.2, hardness: 5.5, elasticity: 0.4, heatCapacity: 1.0, grainStructure: 0.5, impurityLevel: 0.4, corrosionResistance: 0.8, meltingPoint: 1538, color: [40, 40, 40] },
  bog_iron: { id: 'bog_iron', name: 'Bog Iron', category: 'iron_ore', density: 4.0, hardness: 4.0, elasticity: 0.3, heatCapacity: 0.8, grainStructure: 0.3, impurityLevel: 0.7, corrosionResistance: 0.4, meltingPoint: 1538, color: [139, 69, 19] },
  black_sand_iron: { id: 'black_sand_iron', name: 'Black Sand Iron', category: 'iron_ore', density: 5.0, hardness: 6.0, elasticity: 0.5, heatCapacity: 1.1, grainStructure: 0.6, impurityLevel: 0.3, corrosionResistance: 0.7, meltingPoint: 1538, color: [20, 20, 20] },
  wrought_iron: { id: 'wrought_iron', name: 'Wrought Iron', category: 'iron_ore', density: 7.7, hardness: 4.5, elasticity: 0.8, heatCapacity: 1.3, grainStructure: 0.7, impurityLevel: 0.1, corrosionResistance: 0.5, meltingPoint: 1538, color: [200, 200, 200] },
  
  // Carbon Sources
  pine_charcoal: { id: 'pine_charcoal', name: 'Pine Charcoal', category: 'carbon_source', density: 0.4, hardness: 1.5, elasticity: 0.1, heatCapacity: 0.5, grainStructure: 0.2, impurityLevel: 0.1, corrosionResistance: 0.1, meltingPoint: 3500, color: [30, 30, 30] },
  bamboo_charcoal: { id: 'bamboo_charcoal', name: 'Bamboo Charcoal', category: 'carbon_source', density: 0.5, hardness: 2.0, elasticity: 0.1, heatCapacity: 0.6, grainStructure: 0.3, impurityLevel: 0.05, corrosionResistance: 0.2, meltingPoint: 3500, color: [25, 25, 25] },
  oak_charcoal: { id: 'oak_charcoal', name: 'Oak Charcoal', category: 'carbon_source', density: 0.6, hardness: 2.5, elasticity: 0.1, heatCapacity: 0.8, grainStructure: 0.4, impurityLevel: 0.15, corrosionResistance: 0.1, meltingPoint: 3500, color: [45, 45, 45] },
  rice_straw_ash: { id: 'rice_straw_ash', name: 'Rice Straw Ash', category: 'carbon_source', density: 0.2, hardness: 1.0, elasticity: 0.05, heatCapacity: 0.3, grainStructure: 0.1, impurityLevel: 0.3, corrosionResistance: 0.3, meltingPoint: 3500, color: [180, 180, 180] },
  
  // Exotic Metals
  meteoric_iron: { id: 'meteoric_iron', name: 'Meteoric Iron', category: 'exotic_metal', density: 8.0, hardness: 7.5, elasticity: 0.7, heatCapacity: 1.5, grainStructure: 0.95, impurityLevel: 0.05, corrosionResistance: 0.9, meltingPoint: 1500, color: [140, 150, 160] },
  ancient_bronze: { id: 'ancient_bronze', name: 'Ancient Bronze', category: 'exotic_metal', density: 8.8, hardness: 5.0, elasticity: 0.5, heatCapacity: 0.9, grainStructure: 0.6, impurityLevel: 0.3, corrosionResistance: 0.85, meltingPoint: 950, color: [205, 127, 50] },
  copper: { id: 'copper', name: 'Copper', category: 'exotic_metal', density: 8.96, hardness: 3.0, elasticity: 0.4, heatCapacity: 0.8, grainStructure: 0.5, impurityLevel: 0.1, corrosionResistance: 0.8, meltingPoint: 1085, color: [184, 115, 51] },
  tin: { id: 'tin', name: 'Tin', category: 'exotic_metal', density: 7.3, hardness: 1.5, elasticity: 0.2, heatCapacity: 0.6, grainStructure: 0.4, impurityLevel: 0.1, corrosionResistance: 0.9, meltingPoint: 232, color: [211, 212, 213] },
  silver: { id: 'silver', name: 'Silver', category: 'exotic_metal', density: 10.49, hardness: 2.5, elasticity: 0.6, heatCapacity: 0.7, grainStructure: 0.7, impurityLevel: 0.05, corrosionResistance: 0.95, meltingPoint: 961, color: [192, 192, 192] },
  gold: { id: 'gold', name: 'Gold', category: 'exotic_metal', density: 19.3, hardness: 2.5, elasticity: 0.7, heatCapacity: 0.6, grainStructure: 0.8, impurityLevel: 0.01, corrosionResistance: 1.0, meltingPoint: 1064, color: [255, 215, 0] },
  
  // Organic
  bone: { id: 'bone', name: 'Bone', category: 'organic', density: 1.9, hardness: 4.0, elasticity: 0.3, heatCapacity: 0.5, grainStructure: 0.4, impurityLevel: 0.5, corrosionResistance: 0.6, meltingPoint: 1670, color: [227, 218, 201] },
  antler: { id: 'antler', name: 'Antler', category: 'organic', density: 1.8, hardness: 4.5, elasticity: 0.4, heatCapacity: 0.5, grainStructure: 0.5, impurityLevel: 0.4, corrosionResistance: 0.6, meltingPoint: 1670, color: [200, 185, 160] },
  horn: { id: 'horn', name: 'Horn', category: 'organic', density: 1.3, hardness: 3.5, elasticity: 0.6, heatCapacity: 0.4, grainStructure: 0.7, impurityLevel: 0.2, corrosionResistance: 0.8, meltingPoint: 150, color: [30, 30, 30] },
  sharkskin: { id: 'sharkskin', name: 'Sharkskin', category: 'organic', density: 1.1, hardness: 3.0, elasticity: 0.8, heatCapacity: 0.3, grainStructure: 0.8, impurityLevel: 0.1, corrosionResistance: 0.9, meltingPoint: 120, color: [100, 100, 100] },
  
  // Wood
  oak: { id: 'oak', name: 'Oak', category: 'wood', density: 0.75, hardness: 3.5, elasticity: 0.7, heatCapacity: 0.5, grainStructure: 0.6, impurityLevel: 0.2, corrosionResistance: 0.5, meltingPoint: 300, color: [139, 90, 43] },
  bamboo: { id: 'bamboo', name: 'Bamboo', category: 'wood', density: 0.6, hardness: 4.0, elasticity: 0.9, heatCapacity: 0.4, grainStructure: 0.8, impurityLevel: 0.1, corrosionResistance: 0.6, meltingPoint: 300, color: [218, 165, 32] },
  magnolia: { id: 'magnolia', name: 'Magnolia', category: 'wood', density: 0.5, hardness: 2.5, elasticity: 0.5, heatCapacity: 0.4, grainStructure: 0.7, impurityLevel: 0.1, corrosionResistance: 0.7, meltingPoint: 300, color: [245, 245, 220] },
  cherry: { id: 'cherry', name: 'Cherry', category: 'wood', density: 0.6, hardness: 3.0, elasticity: 0.6, heatCapacity: 0.5, grainStructure: 0.6, impurityLevel: 0.2, corrosionResistance: 0.5, meltingPoint: 300, color: [139, 35, 35] },
  cryptomeria: { id: 'cryptomeria', name: 'Cryptomeria', category: 'wood', density: 0.4, hardness: 2.0, elasticity: 0.5, heatCapacity: 0.4, grainStructure: 0.5, impurityLevel: 0.2, corrosionResistance: 0.8, meltingPoint: 300, color: [205, 133, 63] },
  ebony: { id: 'ebony', name: 'Ebony', category: 'wood', density: 1.1, hardness: 5.5, elasticity: 0.4, heatCapacity: 0.7, grainStructure: 0.9, impurityLevel: 0.1, corrosionResistance: 0.9, meltingPoint: 300, color: [20, 20, 20] },
  
  // Wrapping
  silk_cord: { id: 'silk_cord', name: 'Silk Cord', category: 'wrapping', density: 1.3, hardness: 1.0, elasticity: 0.8, heatCapacity: 0.2, grainStructure: 0.9, impurityLevel: 0.05, corrosionResistance: 0.7, meltingPoint: 200, color: [100, 100, 200] },
  cotton_cord: { id: 'cotton_cord', name: 'Cotton Cord', category: 'wrapping', density: 1.5, hardness: 1.0, elasticity: 0.6, heatCapacity: 0.2, grainStructure: 0.6, impurityLevel: 0.1, corrosionResistance: 0.5, meltingPoint: 200, color: [230, 230, 230] },
  leather_strip: { id: 'leather_strip', name: 'Leather Strip', category: 'wrapping', density: 0.9, hardness: 1.5, elasticity: 0.7, heatCapacity: 0.3, grainStructure: 0.5, impurityLevel: 0.2, corrosionResistance: 0.6, meltingPoint: 200, color: [139, 69, 19] },
  ray_skin: { id: 'ray_skin', name: 'Ray Skin', category: 'wrapping', density: 1.2, hardness: 4.0, elasticity: 0.5, heatCapacity: 0.3, grainStructure: 0.8, impurityLevel: 0.1, corrosionResistance: 0.9, meltingPoint: 200, color: [240, 240, 240] },
  
  // Stones
  coarse_whetstone: { id: 'coarse_whetstone', name: 'Coarse Whetstone', category: 'stone', density: 2.5, hardness: 7.0, elasticity: 0.1, heatCapacity: 1.0, grainStructure: 0.3, impurityLevel: 0.5, corrosionResistance: 1.0, meltingPoint: 2000, color: [120, 120, 120] },
  medium_whetstone: { id: 'medium_whetstone', name: 'Medium Whetstone', category: 'stone', density: 2.6, hardness: 7.5, elasticity: 0.1, heatCapacity: 1.0, grainStructure: 0.6, impurityLevel: 0.3, corrosionResistance: 1.0, meltingPoint: 2000, color: [150, 150, 150] },
  fine_whetstone: { id: 'fine_whetstone', name: 'Fine Whetstone', category: 'stone', density: 2.7, hardness: 8.0, elasticity: 0.1, heatCapacity: 1.0, grainStructure: 0.8, impurityLevel: 0.1, corrosionResistance: 1.0, meltingPoint: 2000, color: [180, 180, 180] },
  ultra_fine_whetstone: { id: 'ultra_fine_whetstone', name: 'Ultra-Fine Whetstone', category: 'stone', density: 2.8, hardness: 8.5, elasticity: 0.1, heatCapacity: 1.0, grainStructure: 0.95, impurityLevel: 0.05, corrosionResistance: 1.0, meltingPoint: 2000, color: [200, 200, 200] },
  
  // Clay
  mountain_clay: { id: 'mountain_clay', name: 'Mountain Clay', category: 'clay', density: 1.7, hardness: 2.0, elasticity: 0.2, heatCapacity: 1.8, grainStructure: 0.2, impurityLevel: 0.4, corrosionResistance: 0.8, meltingPoint: 1200, color: [160, 82, 45] },
  river_clay: { id: 'river_clay', name: 'River Clay', category: 'clay', density: 1.5, hardness: 1.5, elasticity: 0.3, heatCapacity: 1.5, grainStructure: 0.1, impurityLevel: 0.6, corrosionResistance: 0.7, meltingPoint: 1100, color: [112, 128, 144] }
};

export function getMaterialCategory(id: MaterialId): string {
  return MATERIALS[id].category;
}

export function mixAlloy(materials: {id: MaterialId, ratio: number}[]): Material {
  if (materials.length === 0) throw new Error("Cannot mix 0 materials");
  
  const totalRatio = materials.reduce((sum, m) => sum + m.ratio, 0);
  const normalized = materials.map(m => ({ ...m, ratio: m.ratio / totalRatio }));
  
  const mixed: Omit<Material, 'id' | 'name' | 'category'> = {
    density: 0, hardness: 0, elasticity: 0, heatCapacity: 0, 
    grainStructure: 0, impurityLevel: 0, corrosionResistance: 0, 
    meltingPoint: 0, color: [0, 0, 0]
  };
  
  for (const m of normalized) {
    const mat = MATERIALS[m.id];
    mixed.density += mat.density * m.ratio;
    mixed.hardness += mat.hardness * m.ratio;
    mixed.elasticity += mat.elasticity * m.ratio;
    mixed.heatCapacity += mat.heatCapacity * m.ratio;
    mixed.grainStructure += mat.grainStructure * m.ratio;
    mixed.impurityLevel += mat.impurityLevel * m.ratio;
    mixed.corrosionResistance += mat.corrosionResistance * m.ratio;
    mixed.meltingPoint += mat.meltingPoint * m.ratio;
    mixed.color[0] += mat.color[0] * m.ratio;
    mixed.color[1] += mat.color[1] * m.ratio;
    mixed.color[2] += mat.color[2] * m.ratio;
  }
  
  mixed.color = [Math.round(mixed.color[0]), Math.round(mixed.color[1]), Math.round(mixed.color[2])];

  const hasTamahagane = normalized.find(m => m.id === 'tamahagane');
  const hasPineCharcoal = normalized.find(m => m.id === 'pine_charcoal');
  const hasMeteoricIron = normalized.find(m => m.id === 'meteoric_iron');
  
  if (hasTamahagane && hasPineCharcoal) {
    mixed.grainStructure = Math.min(1.0, mixed.grainStructure * 1.2);
    mixed.impurityLevel = Math.max(0.0, mixed.impurityLevel * 0.5);
    mixed.hardness = Math.min(10, mixed.hardness * 1.1);
  }
  
  if (hasTamahagane && hasMeteoricIron) {
    mixed.hardness = Math.min(10, mixed.hardness * 1.3);
    mixed.elasticity = Math.min(1.0, mixed.elasticity * 1.2);
  }

  return {
    id: 'tamahagane' as MaterialId, // Synthetic alloy ID
    name: 'Custom Alloy',
    category: 'exotic_metal',
    ...mixed
  };
}
