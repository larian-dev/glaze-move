import type { Material, RecipeRow } from '../types';

export function to100(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) return values.map(() => 0);
  return values.map((v) => (v * 100) / total);
}

/** Oxide mass % of a material exactly as its analysis publishes them. The LOI
 *  and any unlisted remainder contribute no oxides, so the map may sum below
 *  100: a whiting at CaO 56.1 must yield 56.1 CaO per 100 parts — renormalizing
 *  the list to 100 would inflate every LOI-bearing material and shift the whole
 *  unity formula. */
export function publishedProfile(material: Material): Map<string, number> {
  const profile = new Map<string, number>();
  for (const component of material.components) {
    profile.set(component.oxide, (profile.get(component.oxide) ?? 0) + component.amount);
  }
  return profile;
}

/** Renormalizes the base to 100 parts. The additions keep the amounts they were
 *  entered with: they read as percentages over the base, so after the base lands
 *  on 100 the number in the field is the share of the base it says it is —
 *  scaling them by the same factor would silently rewrite every entered
 *  addition percentage. Returns `null` when the base sums to nothing and there
 *  is nothing to normalize against. */
export function renormalizeRecipe(rows: RecipeRow[]): RecipeRow[] | null {
  const mainTotal = rows.reduce((sum, row) => (row.kind === 'main' ? sum + row.amount : sum), 0);
  if (mainTotal <= 0) return null;
  const factor = 100 / mainTotal;
  return rows.map((row) =>
    row.kind === 'main' ? { ...row, amount: row.amount * factor } : { ...row },
  );
}

/** The material's loss on ignition as its datasheet reads it: contents + LOI
 *  make up the 100%. An entered LOI wins — negative means gain on ignition —
 *  and with none entered, the share the oxides leave is the loss. A material
 *  with no components entered at all is unknown, not 100% volatile. */
export function effectiveLoi(material: Material): number {
  if (material.components.length === 0 || material.loi !== 0) return material.loi;
  return 100 - material.components.reduce((sum, c) => sum + c.amount, 0);
}