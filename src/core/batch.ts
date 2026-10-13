import type { Material, MaterialIndex, OxideIndex, RecipeRow } from '../types';
import { publishedProfile } from './normalize';

export type ResolvedRow = { amount: number; material: Material };

/**
 * Rows that feed the chemistry. With `includeAdditions` off, `additional` rows
 * are bench additions on top of the finished base rather than part of its
 * chemistry, so the unity formula, mole %, CTE and firing temperature describe
 * the base glaze alone. Cost and LOI deliberately keep using every row — those
 * are properties of what is weighed into the pot, not of the base's chemistry.
 */
export function chemistryRows(rows: RecipeRow[], includeAdditions: boolean): RecipeRow[] {
  return includeAdditions ? rows : rows.filter((row) => row.kind === 'main');
}

/** One line of the printable weighing sheet: a material and what to weigh out.
 *  `weight` is null while there is no base to scale against. */
export type WeighLine = { name: string; amount: number; weight: number | null };

/**
 * The weighing sheet's two lists — the base and the additions, each largest
 * amount first (ties keep recipe order). `batchWeight` is the mass the base is
 * scaled to: every line weighs `amount / Σ base · batchWeight`, so an addition
 * reads as its share of the base — the same reading `renormalizeRecipe` gives
 * the number in its field. Rows with no amount or no material never reach a
 * sheet, and never count towards the base either.
 */
export function weighingSheet(
  rows: RecipeRow[],
  materials: MaterialIndex,
  batchWeight: number,
): { main: WeighLine[]; additional: WeighLine[] } {
  const collect = (kind: RecipeRow['kind']): WeighLine[] => {
    const lines: WeighLine[] = [];
    for (const row of rows) {
      if (row.kind !== kind || row.amount <= 0) continue;
      const material = materials.get(row.materialId);
      if (!material) continue;
      lines.push({ name: material.name, amount: row.amount, weight: null });
    }
    lines.sort((a, b) => b.amount - a.amount);
    return lines;
  };

  const main = collect('main');
  const additional = collect('additional');
  const base = main.reduce((sum, line) => sum + line.amount, 0);
  if (base > 0 && batchWeight > 0) {
    const factor = batchWeight / base;
    for (const line of [...main, ...additional]) line.weight = line.amount * factor;
  }
  return { main, additional };
}

/** Rows paired with their material; unknown ids and zero amounts are dropped. */
export function resolveRows(rows: RecipeRow[], materials: MaterialIndex): ResolvedRow[] {
  const resolved: ResolvedRow[] = [];
  for (const row of rows) {
    const material = materials.get(row.materialId);
    if (!material || row.amount === 0) continue;
    resolved.push({ amount: row.amount, material });
  }
  return resolved;
}

function totalAmount(resolved: ResolvedRow[]): number {
  return resolved.reduce((sum, row) => sum + row.amount, 0);
}

/** m(O) = Σ wᵢ · profileᵢ(O) with wᵢ = amountᵢ / Σ amount over main and additional rows.
 *  Profiles are the published analyses, so m sums to the batch's oxide share of its own
 *  mass — below 100 whenever the materials carry LOI. */
export function batchMassPercent(
  rows: RecipeRow[],
  materials: MaterialIndex,
): Map<string, number> {
  const resolved = resolveRows(rows, materials);
  const total = totalAmount(resolved);
  const massPercent = new Map<string, number>();
  if (total <= 0) return massPercent;
  for (const row of resolved) {
    const weight = row.amount / total;
    for (const [oxide, mass] of publishedProfile(row.material)) {
      massPercent.set(oxide, (massPercent.get(oxide) ?? 0) + weight * mass);
    }
  }
  return massPercent;
}

/** n(O) = m(O) / MW(O); oxides missing from the catalog or with MW ≤ 0 are skipped. */
export function moles(massPercent: Map<string, number>, oxides: OxideIndex): Map<string, number> {
  const result = new Map<string, number>();
  for (const [formula, mass] of massPercent) {
    const oxide = oxides.get(formula);
    if (!oxide || oxide.mw <= 0) continue;
    result.set(formula, mass / oxide.mw);
  }
  return result;
}

/** x(O) = 100 · n(O) / Σ n; empty when the batch holds no moles at all. */
export function molePercent(moles: Map<string, number>): Map<string, number> {
  const total = [...moles.values()].reduce((sum, v) => sum + v, 0);
  const result = new Map<string, number>();
  if (total === 0) return result;
  for (const [formula, value] of moles) {
    result.set(formula, (100 * value) / total);
  }
  return result;
}

export function batchMoles(
  rows: RecipeRow[],
  materials: MaterialIndex,
  oxides: OxideIndex,
): Map<string, number> {
  return moles(batchMassPercent(rows, materials), oxides);
}