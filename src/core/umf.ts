import type { Oxide, OxideIndex } from '../types';

export const OTHER_FLUX_THRESHOLD = 0.1;

export type UnityGroup = 'R2O' | 'RO' | 'R2O3' | 'RO2' | 'B2O3' | 'Other';

export type UmfResult = {
  values: Map<string, number>;
  groups: Record<UnityGroup, string[]>;
  subtotals: Record<UnityGroup, number>;
  fluxMoles: number;
  isFlux: Map<string, boolean>;
  unityDefined: boolean;
};

export type StullPoint = { x: number; y: number };

function emptyGroups(): Record<UnityGroup, string[]> {
  return { R2O: [], RO: [], R2O3: [], RO2: [], B2O3: [], Other: [] };
}

function emptySubtotals(): Record<UnityGroup, number> {
  return { R2O: 0, RO: 0, R2O3: 0, RO2: 0, B2O3: 0, Other: 0 };
}

function groupOf(oxide: Oxide | undefined): UnityGroup {
  return oxide?.umfType ?? 'Other';
}

function catalogOrder(moles: Map<string, number>, oxides: OxideIndex): string[] {
  const ordered: string[] = [];
  for (const formula of oxides.keys()) if (moles.has(formula)) ordered.push(formula);
  for (const formula of moles.keys()) if (!oxides.has(formula)) ordered.push(formula);
  return ordered;
}

const isTypedFlux = (group: UnityGroup): boolean => group === 'R2O' || group === 'RO';

/** flux(O) ⇔ type ∈ {R₂O, RO} ∨ (type = Other ∧ n_typed > 0 ∧ n(O)/n_typed ≥ OTHER_FLUX_THRESHOLD) */
export function unityFormula(
  moles: Map<string, number>,
  oxides: OxideIndex,
): UmfResult {
  const ordered = catalogOrder(moles, oxides);
  const groups = emptyGroups();
  const isFlux = new Map<string, boolean>();

  let nTyped = 0;
  for (const formula of ordered) {
    if (isTypedFlux(groupOf(oxides.get(formula)))) nTyped += moles.get(formula) ?? 0;
  }

  for (const formula of ordered) {
    const group = groupOf(oxides.get(formula));
    const flux =
      isTypedFlux(group) ||
      (group === 'Other' && nTyped > 0 && (moles.get(formula) ?? 0) / nTyped >= OTHER_FLUX_THRESHOLD);
    isFlux.set(formula, flux);
    groups[group].push(formula);
  }

  let fluxMoles = 0;
  for (const formula of ordered) if (isFlux.get(formula)) fluxMoles += moles.get(formula) ?? 0;

  const unityDefined = fluxMoles > 0;
  const k = unityDefined ? 1 / fluxMoles : 1;

  const values = new Map<string, number>();
  const subtotals = emptySubtotals();
  for (const formula of ordered) {
    const scaled = (moles.get(formula) ?? 0) * k;
    values.set(formula, scaled);
    const group = groupOf(oxides.get(formula));
    // Below-threshold "other" oxides are listed but join no group sum.
    if (group !== 'Other' || isFlux.get(formula)) subtotals[group] += scaled;
  }

  return { values, groups, subtotals, fluxMoles, isFlux, unityDefined };
}

/** X = n(SiO₂)/F, Y = n(Al₂O₃)/F over the chart's rows — the base alone, or the
 *  whole batch when additions join the map; null without flux. */
export function stullPoint(moles: Map<string, number>, fluxMoles: number): StullPoint | null {
  if (!(fluxMoles > 0)) return null;
  return {
    x: (moles.get('SiO2') ?? 0) / fluxMoles,
    y: (moles.get('Al2O3') ?? 0) / fluxMoles,
  };
}