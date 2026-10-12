import type { Material, RecipeRow } from '../types';

export function to100(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) return values.map(() => 0);
  return values.map((v) => (v * 100) / total);
}

/** Oxide mass % of a material renormalized to 100; non-oxide mass is inert and drops out. */
export function normalizedProfile(material: Material): Map<string, number> {
  const amounts = new Map<string, number>();
  for (const component of material.components) {
    amounts.set(component.oxide, (amounts.get(component.oxide) ?? 0) + component.amount);
  }
  const total = [...amounts.values()].reduce((sum, v) => sum + v, 0);
  const profile = new Map<string, number>();
  for (const [oxide, amount] of amounts) {
    profile.set(oxide, total === 0 ? 0 : (amount * 100) / total);
  }
  return profile;
}

/** Renormalizes the base to 100 parts. The additions travel at the same factor:
 *  they are percentages over the base, so rescaling the base without them would
 *  silently change their share of the batch — and with it the unity formula,
 *  mole % and everything else chemistry-side. Returns `null` when the base sums
 *  to nothing and there is nothing to normalize against. */
export function renormalizeRecipe(rows: RecipeRow[]): RecipeRow[] | null {
  const mainTotal = rows.reduce((sum, row) => (row.kind === 'main' ? sum + row.amount : sum), 0);
  if (mainTotal <= 0) return null;
  const factor = 100 / mainTotal;
  return rows.map((row) => ({ ...row, amount: row.amount * factor }));
}

/** The material's loss on ignition as its datasheet reads it: contents + LOI
 *  make up the 100%. An entered LOI wins — negative means gain on ignition —
 *  and with none entered, the share the oxides leave is the loss. A material
 *  with no components entered at all is unknown, not 100% volatile. */
export function effectiveLoi(material: Material): number {
  if (material.components.length === 0 || material.loi !== 0) return material.loi;
  return 100 - material.components.reduce((sum, c) => sum + c.amount, 0);
}