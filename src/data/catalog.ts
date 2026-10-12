import type { Oxide, Material, OxideIndex, MaterialIndex } from '../types';
import oxidesJson from './oxides.json';
import materialsJson from './materials.json';

/** Legacy numeric codes used by the bundled material file. */
const REGION_BY_CODE: Record<number, Material['region']> = {
  0: 'world',
  1: 'EU',
  2: 'US',
  3: 'Russia',
};

const TYPE_BY_CODE: Record<number, Material['type']> = {
  0: 'feldspar',
  1: 'frit',
  2: 'colorant',
  3: 'clay',
  4: 'other',
};

// Bundled JSON is shape-checked at build time; a plain boundary cast keeps raw values as-is.
const oxides = oxidesJson as { oxides: Oxide[] };

export const OXIDES: Oxide[] = oxides.oxides;

export const OXIDE_BY_FORMULA: OxideIndex = new Map(OXIDES.map((o) => [o.formula, o]));

export const SYSTEM_MATERIALS: Material[] = (
  materialsJson as { materials: Omit<Material, 'region' | 'type'>[] }
).materials.map((m) => ({
  ...m,
  region: REGION_BY_CODE[(m as unknown as { region: number }).region] ?? 'world',
  type: TYPE_BY_CODE[(m as unknown as { type: number }).type] ?? 'other',
}));

export function materialIndex(materials: Material[]): MaterialIndex {
  return new Map(materials.map((m) => [m.id, m]));
}
