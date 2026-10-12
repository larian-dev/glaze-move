import type { MaterialIndex, OxideIndex, RecipeRow } from '../types';
import { resolveRows } from './batch';
import { effectiveLoi } from './normalize';

export type MeltabilityResult = { k: number | null; approximate: boolean };

export type FiringTemperature = { celsius: number | null; approximate: boolean };

const ALUMINA_FLUX_LIMIT = 3;
const ALUMINA_REFRACTORY = 1.2;
const ALUMINA_FLUX = 0.3;
const REFRACTORY_OXIDES: ReadonlySet<string> = new Set(['SiO2', 'P2O5', 'SnO2']);
const BORON_RATIO_OXIDES: readonly string[] = ['Li2O', 'Na2O', 'K2O', 'BaO', 'CaO'];
const ALKALI_OXIDES: readonly string[] = ['Li2O', 'Na2O', 'K2O'];

const K_TABLE: readonly number[] = [
  2.0, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1,
];

const CELSIUS_TABLE: readonly number[] = [
  750, 751, 753, 754, 755, 756, 758, 759, 765, 771, 778, 800, 829, 861, 905, 1025, 1100, 1200, 1300, 1450,
];

function sumOf(oxides: readonly string[], source: Map<string, number>): number {
  let sum = 0;
  for (const oxide of oxides) sum += source.get(oxide) ?? 0;
  return sum;
}

/** Si/Al = n(SiO₂)/n(Al₂O₃); null when either is ≤ 0. */
export function siAlRatio(moles: Map<string, number>): number | null {
  const silica = moles.get('SiO2') ?? 0;
  const alumina = moles.get('Al2O3') ?? 0;
  if (silica <= 0 || alumina <= 0) return null;
  return silica / alumina;
}

function expansionCoefficient(
  formula: string,
  oxides: OxideIndex,
  silicaShare: number,
  alkaliShare: number,
  boronRatio: number,
): number {
  switch (formula) {
    case 'SiO2':
      return silicaShare <= 67 ? 0.38 : 0.38 - 0.01 * (silicaShare - 67);
    case 'TiO2':
      return 0.3 - 0.015 * (silicaShare - 50);
    case 'B2O3':
      return boronRatio > 4 ? -0.5 : 0.125 * (4 - boronRatio) - 0.5;
    case 'PbO':
      return 1.15 + 0.05 * alkaliShare;
    default:
      return oxides.get(formula)?.cte ?? 0;
  }
}

/** Appen: α·10⁷ = Σ cᵢ·xᵢ, with the four composition-dependent cᵢ; null without SiO₂. */
export function cte(molePercent: Map<string, number>, oxides: OxideIndex): number | null {
  const silicaShare = molePercent.get('SiO2') ?? 0;
  if (!(silicaShare > 0)) return null;

  const alkaliShare = sumOf(ALKALI_OXIDES, molePercent);
  const boron = molePercent.get('B2O3') ?? 0;
  const boronRatio = boron > 0 ? sumOf(BORON_RATIO_OXIDES, molePercent) / boron : 4;

  let total = 0;
  for (const [formula, share] of molePercent) {
    total += share * expansionCoefficient(formula, oxides, silicaShare, alkaliShare, boronRatio);
  }
  return total;
}

/** K = Σ(aᵢ·mᵢ)/Σ(bⱼ·mⱼ); a stored 0 means "no data" and makes the estimate approximate. */
export function meltabilityK(
  massPercent: Map<string, number>,
  oxides: OxideIndex,
): MeltabilityResult {
  let numerator = 0;
  let denominator = 0;
  let approximate = false;

  for (const [formula, mass] of massPercent) {
    const oxide = oxides.get(formula);
    if (!oxide) continue;
    if (formula === 'Al2O3') {
      if (mass > ALUMINA_FLUX_LIMIT) denominator += ALUMINA_REFRACTORY * mass;
      else numerator += ALUMINA_FLUX * mass;
      continue;
    }
    if (REFRACTORY_OXIDES.has(formula)) {
      denominator += (oxide.meltability ?? 0) * mass;
      continue;
    }
    if (!oxide.meltability) {
      if (mass > 0) approximate = true;
      continue;
    }
    numerator += oxide.meltability * mass;
  }

  if (denominator <= 0 || numerator <= 0) return { k: null, approximate };
  return { k: numerator / denominator, approximate };
}

/** The side of the 3 mass % step the batch's Al₂O₃ sits on: below it alumina
 *  melts as a flux, above it as a refractory. The step makes K — and with it the
 *  firing temperature — discontinuous, so a solver must freeze the side it
 *  starts on and re-check where it landed. */
export function aluminaRole(massPercent: Map<string, number>): 'flux' | 'refractory' {
  return (massPercent.get('Al2O3') ?? 0) > ALUMINA_FLUX_LIMIT ? 'refractory' : 'flux';
}

/** Per-part meltability weights: `K = Σ amountⱼ·aⱼ / Σ amountⱼ·bⱼ` over the very
 *  coefficients `meltabilityK` applies to the batch — so with the alumina role
 *  frozen, a fixed K target is linear in the amounts. */
export function meltabilityCoefficients(
  profile: Map<string, number>,
  oxides: OxideIndex,
  role: 'flux' | 'refractory',
): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const [formula, mass] of profile) {
    const oxide = oxides.get(formula);
    if (!oxide) continue;
    const share = mass / 100;
    if (formula === 'Al2O3') {
      if (role === 'refractory') b += ALUMINA_REFRACTORY * share;
      else a += ALUMINA_FLUX * share;
      continue;
    }
    if (REFRACTORY_OXIDES.has(formula)) {
      b += (oxide.meltability ?? 0) * share;
      continue;
    }
    if (!oxide.meltability) continue;
    a += oxide.meltability * share;
  }
  return { a, b };
}

/** Inverse of `firingTemperatureK`: the K a temperature target needs. Null
 *  outside the table, where the forward map clamps and several K share one
 *  round temperature. */
export function kForCelsius(celsius: number): number | null {
  const last = CELSIUS_TABLE.length - 1;
  const hottest = CELSIUS_TABLE[0];
  const coldest = CELSIUS_TABLE[last];
  if (hottest === undefined || coldest === undefined) return null;
  if (celsius < hottest || celsius > coldest) return null;
  for (let i = 0; i < last; i += 1) {
    const lowC = CELSIUS_TABLE[i];
    const highC = CELSIUS_TABLE[i + 1];
    const lowK = K_TABLE[i];
    const highK = K_TABLE[i + 1];
    if (lowC === undefined || highC === undefined || lowK === undefined || highK === undefined) {
      continue;
    }
    if (celsius < lowC || celsius > highC) continue;
    const t = (celsius - lowC) / (highC - lowC);
    return lowK + t * (highK - lowK);
  }
  return null;
}

/** K → °C by linear interpolation of the reference table, clamped outside it. */
export function firingTemperatureK(k: number | null, approximate = false): FiringTemperature {
  if (k === null || !Number.isFinite(k)) return { celsius: null, approximate };
  const lastIndex = K_TABLE.length - 1;
  const hottest = K_TABLE[0];
  const coldest = K_TABLE[lastIndex];
  if (hottest !== undefined && k >= hottest) return { celsius: CELSIUS_TABLE[0] ?? null, approximate };
  if (coldest !== undefined && k <= coldest) return { celsius: CELSIUS_TABLE[lastIndex] ?? null, approximate };

  for (let i = 0; i < lastIndex; i += 1) {
    const high = K_TABLE[i];
    const low = K_TABLE[i + 1];
    const highC = CELSIUS_TABLE[i];
    const lowC = CELSIUS_TABLE[i + 1];
    if (high === undefined || low === undefined || highC === undefined || lowC === undefined) continue;
    if (k <= low || k > high) continue;
    const t = (high - k) / (high - low);
    return { celsius: highC + t * (lowC - highC), approximate };
  }
  return { celsius: null, approximate };
}

/** cost = Σ (amountᵢ/T)·priceᵢ over main and additional rows; 0 for an empty batch. */
export function costPerKg(rows: RecipeRow[], materials: MaterialIndex): number {
  const resolved = resolveRows(rows, materials);
  const total = resolved.reduce((sum, row) => sum + row.amount, 0);
  if (total <= 0) return 0;
  return resolved.reduce((sum, row) => sum + (row.amount / total) * row.material.price, 0);
}

/** LOI = Σ (amountᵢ/T)·loiᵢ over main and additional rows; 0 for an empty batch.
 *  A material with no LOI entered contributes the share its oxides leave of
 *  its own 100%, negative values (gain on ignition) included. */
export function loiPercent(rows: RecipeRow[], materials: MaterialIndex): number {
  const resolved = resolveRows(rows, materials);
  const total = resolved.reduce((sum, row) => sum + row.amount, 0);
  if (total <= 0) return 0;
  return resolved.reduce((sum, row) => sum + (row.amount / total) * effectiveLoi(row.material), 0);
}