import type { Material, RecipeRow } from '../types';
import { OXIDE_BY_FORMULA } from '../data/catalog';
import { batchMassPercent, batchMoles, chemistryRows } from './batch';
import {
  materialChemistry,
  oxideMolesPerPart,
  type MaterialChemistry,
  type MoleCoefficients,
} from './geometry';
import { aluminaRole, firingTemperatureK, kForCelsius, meltabilityCoefficients, meltabilityK } from './ratios';
import { unityFormula } from './umf';

export type SolveRejection =
  | 'too-few-rows'
  | 'no-flux'
  | 'no-alumina-carrier'
  | 'singular'
  | 'negative-amount'
  | 'no-flux-total'
  | 'flux-ratio'
  | 'no-temperature-carrier'
  | 'temperature-drift'
  | 'over-constrained';

export type SolveResult =
  | { ok: true; rows: RecipeRow[]; r2oRoDrift: number; /** Indices of the main rows the solve drove to zero. */ emptied: number[] }
  | { ok: false; reason: SolveRejection };

export type SolveOptions = {
  /** UMF gate: `additional` rows join the displayed chemistry and the point
   *  when set. */
  includeAdditions?: boolean;
  /** Promise the starting R₂O:RO ratio: any target that cannot keep it is
   *  refused instead of letting the balance drift quietly. */
  clampFluxRatio?: boolean;
  /** Clamp every addition: each keeps its dominant oxide's unity value while a
   *  drag moves its parts along with the base. Off, the additions join the
   *  carrier pool and the solver may rewrite their amounts. True by default —
   *  the behaviour additions always had. */
  clampAdditions?: boolean;
  /** Hold the displayed chemistry's unity B₂O₃ through the drag — one extra
   *  equation that buys no unknown, so the fit needs a mover of its own; a
   *  recipe that cannot afford one is refused as over-constrained. A batch
   *  without B₂O₃ has nothing to hold and the clamp drops out. */
  clampBoron?: boolean;
  /** Seat the fewest movers the target needs — the two coordinate rows — instead
   *  of the usual three. Nothing is left over to spend on the R₂O:RO balance, so
   *  the ratio drifts (or, with `clampFluxRatio`, most targets are refused); what
   *  it buys is the smallest diff: at most two materials change. */
  leastChange?: boolean;
  /** Per-material chemistry shared across many solves. A zone scan samples
   *  hundreds of targets over the same recipe, so `hull` derives each
   *  material's coefficients once and passes the map in; a bare call derives
   *  as it goes. Keyed by material object and only alive for the scan, so an
   *  edit — which clones the material — can never read a stale entry. */
  chemistry?: Map<Material, MaterialChemistry>;
};

const DETERMINANT_EPSILON = 1e-9;
/** Pivot guard for the linear solve: below this the elimination is unstable. */
const PIVOT_EPSILON = 1e-12;
/** A boron-map temperature target has to come back within this many degrees. */
const TEMPERATURE_TOLERANCE = 1;

/**
 * One chart coordinate: `value = Σ amount·of / Σ amount·per`, with both sides
 * linear in the row amounts — the shape every draggable axis has to have. The
 * Stull map reads (SiO₂, Al₂O₃) over the typed flux; the triaxial map reads the
 * same two over the triangle's three corners; the boron map reads unity B₂O₃
 * over the flux and the meltability ratio K over its own weighted sums.
 */
export type SolveAxis = {
  of: (chemistry: MaterialChemistry) => number;
  per: (chemistry: MaterialChemistry) => number;
  /** Reported when no row in the pool can carry this axis at all. */
  empty: SolveRejection;
};

/** Where a drag wants a chart's two coordinates to land. */
export type SolveTarget = {
  first: SolveAxis;
  second: SolveAxis;
  x: number;
  y: number;
};

/** Stull coordinates, so the drag functions can share one shapes. */
export const STULL_AXES: { first: SolveAxis; second: SolveAxis } = {
  first: {
    of: (chemistry) => chemistry.coefficients.silica,
    per: (chemistry) => chemistry.coefficients.flux,
    empty: 'no-flux',
  },
  second: {
    of: (chemistry) => chemistry.coefficients.alumina,
    per: (chemistry) => chemistry.coefficients.flux,
    empty: 'no-alumina-carrier',
  },
};

/**
 * Triaxial coordinates: the plotted point is the (SiO₂, Al₂O₃, RO) split of the
 * unity formula, `roFlux` naming the RO corner the map is drawn against. Its
 * basis is the triangle's own three corners, not the flux — the two axes share
 * one denominator, so a scene change of scale leaves the shares alone.
 */
export function triaxialAxes(roFlux: string): { first: SolveAxis; second: SolveAxis } {
  const basis = (chemistry: MaterialChemistry): number =>
    chemistry.coefficients.silica +
    chemistry.coefficients.alumina +
    oxideMolesPerPart(chemistry.profile, roFlux);
  return {
    first: { of: (chemistry) => chemistry.coefficients.silica, per: basis, empty: 'no-flux' },
    second: { of: (chemistry) => chemistry.coefficients.alumina, per: basis, empty: 'no-alumina-carrier' },
  };
}

/** The boron map's temperature axis: K, the meltability ratio, whose per-part
 *  weights come from the same coefficients `meltabilityK` applies to the batch. */
function meltabilityAxis(role: 'flux' | 'refractory'): SolveAxis {
  return {
    of: (chemistry) => meltabilityCoefficients(chemistry.profile, OXIDE_BY_FORMULA, role).a,
    per: (chemistry) => meltabilityCoefficients(chemistry.profile, OXIDE_BY_FORMULA, role).b,
    empty: 'no-temperature-carrier',
  };
}

type Candidate = {
  rowIndex: number;
  /** Everything the fit reads off the material, derived once per scan. */
  chemistry: MaterialChemistry;
  /** Coefficient vector per amount-part: SiO₂, Al₂O₃, R₂O, RO. */
  coefficients: MoleCoefficients;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function candidatesOf(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  kind: RecipeRow['kind'],
  chemistryOf: (material: Material) => MaterialChemistry,
): Candidate[] {
  const candidates: Candidate[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.kind !== kind || row.amount === 0) return;
    const material = materials.get(row.materialId);
    if (!material) return;
    const chemistry = chemistryOf(material);
    candidates.push({ rowIndex, chemistry, coefficients: chemistry.coefficients });
  });
  return candidates;
}

interface Carry {
  rowIndex: number;
  coefficients: MoleCoefficients;
  r2o: number;
  ro: number;
  flux: number;
  /** Per-part values of the target's two coordinate axes, read once here so
   *  seating and the equations never re-derive a profile. */
  firstOf: number;
  firstPer: number;
  secondOf: number;
  secondPer: number;
}

function carry(candidates: Candidate[], rows: RecipeRow[], target: SolveTarget): Carry[] {
  return candidates.map((c) => {
    const amount = rows[c.rowIndex]?.amount ?? 0;
    return {
      rowIndex: c.rowIndex,
      coefficients: c.coefficients,
      r2o: amount * c.coefficients.r2o,
      ro: amount * c.coefficients.ro,
      flux: amount * c.coefficients.flux,
      firstOf: target.first.of(c.chemistry),
      firstPer: target.first.per(c.chemistry),
      secondOf: target.second.of(c.chemistry),
      secondPer: target.second.per(c.chemistry),
    };
  });
}

/**
 * How much leverage a material has over the R₂O:RO balance, as the swing
 * between the share of the recipe's alkali it would supply and the share of its
 * alkaline earth. Zero for a flux-free material (quartz) or an evenly mixed one
 * — neither can shift the balance, which is exactly why they are poor choices
 * for the spare carrier. An R₂O-only or RO-only material scores up to 1.
 */
function leverage(row: Carry, totalR2o: number, totalRo: number): number {
  if (row.r2o <= 0 && row.ro <= 0) return 0;
  const alkali = totalR2o > 0 ? row.r2o / totalR2o : row.r2o > 0 ? 1 : 0;
  const alkaline = totalRo > 0 ? row.ro / totalRo : row.ro > 0 ? 1 : 0;
  return Math.abs(alkali - alkaline);
}

/** A row's chemistry as ratios, so two materials can be told apart at any scale. */
function profileOf(coefficients: MoleCoefficients): number[] {
  const values = [coefficients.silica, coefficients.alumina, coefficients.r2o, coefficients.ro];
  const largest = values.reduce((best, value) => Math.max(best, Math.abs(value)), 0);
  return largest > 0 ? values.map((value) => value / largest) : values;
}

function sameProfile(a: number[], b: number[]): boolean {
  return a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 1e-6);
}

/**
 * Seats the rows the fit will move: the strongest carrier of each target
 * coordinate, then `count - 2` more by how hard they swing the R₂O:RO balance.
 * The axes name their own carriers — the Stull and triaxial maps seat the most
 * concentrated SiO₂ source and the most concentrated Al₂O₃ source of the rest,
 * the boron map the richest B₂O₃ source and the row that moves K hardest. The
 * seats go by per-part concentration, not by total carry: a drag needs decoupled
 * control, and only a pure source moves one axis without dragging the others
 * along — a large dilute row out-carries the pure one by sheer amount, freezes
 * it, and leaves the fit trying to steer x by destroying flux, which collapses
 * the reachable set to a strip and hands the family a near-singular direction.
 * The seats past the second buy degrees of freedom for holds — each hold is a
 * row over amounts the fit already has, so it needs a mover of its own. A row
 * whose chemistry is a copy of one already seated is skipped: a duplicate
 * column cannot be solved for and would only make the fit singular. Returns
 * null when no row can carry the second coordinate.
 */
function chooseCarriers(
  parts: Carry[],
  totalR2o: number,
  totalRo: number,
  count: number,
): Carry[] | null {
  const chosen: Carry[] = [];
  const profiles: number[][] = [];
  const seat = (candidate: Carry): void => {
    chosen.push(candidate);
    profiles.push(profileOf(candidate.coefficients));
  };

  const first = parts.reduce((best, c) => (c.firstOf > best.firstOf ? c : best));
  seat(first);
  const second = parts
    .filter((c) => c !== first && c.secondOf > 0)
    .reduce<Carry | undefined>(
      (best, c) => (!best || c.secondOf > best.secondOf ? c : best),
      undefined,
    );
  if (!second) return null;
  seat(second);

  while (chosen.length < count) {
    let next: Carry | null = null;
    let bestScore = 0;
    for (const c of parts) {
      if (chosen.includes(c)) continue;
      const score = leverage(c, totalR2o, totalRo);
      if (score <= bestScore) continue;
      if (profiles.some((profile) => sameProfile(profile, profileOf(c.coefficients)))) continue;
      next = c;
      bestScore = score;
    }
    if (!next) break;
    seat(next);
  }
  return chosen;
}

/** A linear equation over the fit's unknown amounts. */
type SolveEquation = { coefficients: number[]; rhs: number };

/** The fit's solution set: x(t) = particular + t·direction. `hasFamily` is false
 *  when the equations pin every unknown, leaving no parameter to spend. */
type FitFamily = { particular: number[]; direction: number[]; hasFamily: boolean };

/** Gaussian elimination with partial pivoting; null when the system is singular. */
function solveSquare(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  // Row equilibration: scaling each row to its own largest coefficient makes
  // every pivot below a *relative* one, so the near-singular test no longer
  // depends on whether the system is a 2×2 of parts or a 4×4 of mole fractions.
  const rows = matrix.map((row, i) => {
    const largest = row.reduce((best, value) => Math.max(best, Math.abs(value)), 0);
    const divisor = largest > 0 ? largest : 1;
    return [...row.map((value) => value / divisor), (rhs[i] ?? 0) / divisor];
  });
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(rows[row]?.[col] ?? 0) > Math.abs(rows[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotValue = rows[pivot]?.[col] ?? 0;
    if (Math.abs(pivotValue) <= DETERMINANT_EPSILON) return null;
    const swap = rows[col]!;
    rows[col] = rows[pivot]!;
    rows[pivot] = swap;
    for (let row = col + 1; row < n; row += 1) {
      const factor = (rows[row]?.[col] ?? 0) / pivotValue;
      for (let k = col; k <= n; k += 1) {
        rows[row]![k] = (rows[row]?.[k] ?? 0) - factor * (rows[col]?.[k] ?? 0);
      }
    }
  }
  const solved = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let total = rows[row]?.[n] ?? 0;
    for (let col = row + 1; col < n; col += 1) total -= (rows[row]?.[col] ?? 0) * (solved[col] ?? 0);
    solved[row] = total / (rows[row]?.[row] ?? 1);
  }
  return solved;
}

/** Determinant by elimination. */
function determinant(matrix: number[][]): number {
  const n = matrix.length;
  const rows = matrix.map((row) => [...row]);
  let result = 1;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(rows[row]?.[col] ?? 0) > Math.abs(rows[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotValue = rows[pivot]?.[col] ?? 0;
    if (pivotValue === 0) return 0;
    if (pivot !== col) {
      const swap = rows[col]!;
      rows[col] = rows[pivot]!;
      rows[pivot] = swap;
      result = -result;
    }
    result *= pivotValue;
    for (let row = col + 1; row < n; row += 1) {
      const factor = (rows[row]?.[col] ?? 0) / pivotValue;
      for (let k = col; k < n; k += 1) rows[row]![k] = (rows[row]?.[k] ?? 0) - factor * (rows[col]?.[k] ?? 0);
    }
  }
  return result;
}

/** Null vector of a small square matrix of rank n−1, from the cofactors of a row. */
function nullVector(matrix: number[][]): number[] | null {
  const n = matrix.length;
  for (let row = 0; row < n; row += 1) {
    const cofactors: number[] = [];
    for (let col = 0; col < n; col += 1) {
      const minor = matrix.filter((_, i) => i !== row).map((line) => line.filter((_, j) => j !== col));
      cofactors.push(((row + col) % 2 === 0 ? 1 : -1) * determinant(minor));
    }
    if (cofactors.some((value) => Math.abs(value) > DETERMINANT_EPSILON)) return cofactors;
  }
  return null;
}

/**
 * A square system that elimination cannot solve: with one redundant row its
 * solutions are a line, which the caller then spends on the R₂O:RO balance — this
 * is the shape a hold takes when it repeats a target row, as holding SiO₂ does,
 * since the Stull x axis *is* the SiO₂ unity value. `null` when the row is
 * redundant *and* contradicted (no solution at all), or when the rank is lower
 * still, which leaves more than one degree of freedom.
 */
function deficientFamily(matrix: number[][], rhs: number[]): FitFamily | null {
  const n = rhs.length;
  const direction = nullVector(matrix);
  const leftNull = nullVector(matrix[0]?.map((_, column) => matrix.map((row) => row[column] ?? 0)) ?? []);
  if (!direction || !leftNull) return null;

  // Consistency: a left null vector must annihilate the right-hand side too.
  const residual = leftNull.reduce((sum, value, index) => sum + value * (rhs[index] ?? 0), 0);
  const span = leftNull.reduce((sum, value) => sum + Math.abs(value), 0);
  if (Math.abs(residual) > DETERMINANT_EPSILON * Math.max(1, span)) return null;

  // A particular solution: zero one coordinate and solve the largest minor.
  let bestRow = -1;
  let bestColumn = -1;
  let bestDet = 0;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const minor = matrix
        .filter((_, index) => index !== row)
        .map((line) => line.filter((_, index) => index !== column));
      const det = Math.abs(determinant(minor));
      if (det > bestDet) {
        bestDet = det;
        bestRow = row;
        bestColumn = column;
      }
    }
  }
  if (bestRow < 0 || bestDet <= PIVOT_EPSILON) return null;
  const square = matrix
    .filter((_, index) => index !== bestRow)
    .map((line) => line.filter((_, index) => index !== bestColumn));
  const solved = solveSquare(
    square,
    rhs.filter((_, index) => index !== bestRow),
  );
  if (!solved) return null;
  const particular = insertAt(solved, bestColumn, 0, n);

  if (particular.every((value) => Math.abs(value) <= PIVOT_EPSILON)) {
    // Homogeneous: the solution set is the ray through the null direction, and a
    // direction carrying both signs has no non-negative multiple at all.
    const positive = direction.some((value) => value > PIVOT_EPSILON);
    const negative = direction.some((value) => value < -PIVOT_EPSILON);
    if (positive === negative) return null;
  }
  return { particular, direction, hasFamily: true };
}

/** Splices `value` into a vector at `index`, filling the rest from `values`. */
function insertAt(values: number[], index: number, value: number, length: number): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (let i = 0; i < length; i += 1) out.push(i === index ? value : (values[cursor++] ?? 0));
  return out;
}

/**
 * Solves the fit's equations: a particular solution plus the direction of the
 * solution family when one degree of freedom is left for the R₂O:RO balance.
 * `null` when the system is over-determined, or singular with no reachable ray.
 */
function solveFit(equations: SolveEquation[], unknownCount: number): FitFamily | null {
  // Equilibration first: one row carries mole amounts of order 1e-2 while another
  // carries flux differences of order 1e-3, and the conditioning tests below
  // compare determinants. On a scale-free basis those comparisons mean something
  // — a perfectly healthy 4×4 of mole fractions has an absolute determinant of
  // about 1e-10 — and the solution set is unchanged by scaling a row.
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (const equation of equations) {
    const largest = equation.coefficients.reduce((best, value) => Math.max(best, Math.abs(value)), 0);
    const divisor = largest > 0 ? largest : 1;
    matrix.push(equation.coefficients.map((value) => value / divisor));
    rhs.push(equation.rhs / divisor);
  }
  const rows = matrix.length;
  const zeros = new Array<number>(unknownCount).fill(0);

  if (unknownCount === rows) {
    // `solveSquare` equilibrates its rows, so a near-colinear carrier pair — a
    // determinant inside the singular epsilon at any scale — comes back null
    // rather than fitting a target with huge amounts of near-identical materials.
    const exact = solveSquare(matrix, rhs);
    if (exact) return { particular: exact, direction: zeros, hasFamily: false };
    return deficientFamily(matrix, rhs);
  }
  if (unknownCount !== rows + 1) return null;

  // One free column: pick the column whose removal leaves the best-conditioned
  // square system. Pinning a badly conditioned set can collapse the particular
  // solution onto zero and take the whole solve with it.
  let bestFree = -1;
  let bestDet = 0;
  for (let free = 0; free < unknownCount; free += 1) {
    const minor = matrix.map((row) => row.filter((_, index) => index !== free));
    const det = Math.abs(determinant(minor));
    if (det > bestDet) {
      bestDet = det;
      bestFree = free;
    }
  }
  if (bestFree < 0 || bestDet <= DETERMINANT_EPSILON) return null;
  const square = matrix.map((row) => row.filter((_, index) => index !== bestFree));
  const particularSquare = solveSquare(square, rhs);
  const directionSquare = solveSquare(square, matrix.map((row) => -(row[bestFree] ?? 0)));
  if (!particularSquare || !directionSquare) return null;
  return {
    particular: insertAt(particularSquare, bestFree, 0, unknownCount),
    direction: insertAt(directionSquare, bestFree, 1, unknownCount),
    hasFamily: true,
  };
}

/**
 * Refits the base to a dragged chart target by solving the two coordinate
 * carriers exactly, then spending the remaining freedom on the R₂O:RO balance.
 * Every draggable map shares this body: `target` names the two coordinate axes
 * and the values wanted. The Stull map reads (SiO₂, Al₂O₃) over the typed flux,
 * the triaxial map the same two over the triangle's corners, and the boron map
 * unity B₂O₃ against the meltability ratio K — see `solveForStullTarget`,
 * `triaxialAxes` and `solveForBoronTarget`.
 *
 * Two hard constraints and three free carriers leave a one-parameter family of
 * exact solutions, x(t) = p + t·q. The ratio is R(t) = (N0 + t·N1)/(D0 + t·D1),
 * so the point that restores the starting ratio exactly is available in closed
 * form; non-negative amounts bound t to an interval, and the best we can do is
 * that point clamped to the interval.
 *
 * With only two carriers there is no such family and the ratio drifts — which
 * is why a quartz-led base (a flux-free silica source) holds steady while a
 * nepheline-led one does not. A base of two rows is then only draggable along
 * the curve its materials can reach, at best.
 *
 * With `options.includeAdditions`, every `additional` row joins the displayed
 * chemistry. With `options.clampAdditions` (the default), each of them is then
 * **pinned**: its amount becomes an unknown constrained to keep the unity value
 * of its dominant oxide where it was, so the addition follows the base instead
 * of its recipe percentage being held — one equation per pinned row, and the
 * carrier family keeps the ratio freedom. With the clamp off, the additions
 * stay in the carrier pool, where the solver may pick and rewrite them. With
 * `options.clampBoron`, one more equation holds the displayed chemistry's unity
 * B₂O₃ — it buys no unknown, so the fit seats a mover to pay for it, and a
 * recipe that cannot afford one is refused as over-constrained. The ratio
 * restored is the whole batch's; `options.clampFluxRatio` turns that
 * restoration into a promise — see `SolveOptions`.
 *
 * Every row — base and additions alike — is written back scaled so the base
 * totals exactly 100. All the ratios survive that scaling, so the pinned unity
 * values and the dragged point both come out where they were fitted.
 */
export function solveForTarget(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  target: SolveTarget,
  options: SolveOptions = {},
): SolveResult {
  const {
    includeAdditions = false,
    clampFluxRatio = false,
    clampAdditions = true,
    clampBoron = false,
    leastChange = false,
  } = options;
  // One chemistry derivation per material per scan: `hull` passes a cache in so
  // the sampled targets reuse it; a bare call derives as it goes.
  const cache = options.chemistry;
  const chemistryOf = (material: Material): MaterialChemistry => {
    let entry = cache?.get(material);
    if (!entry) {
      entry = materialChemistry(material);
      cache?.set(material, entry);
    }
    return entry;
  };
  // The pool the solver may pick carriers from: every main row plus — while
  // additions are part of the chemistry and the clamp leaves them free — the
  // additions, whose amounts the solver may then rewrite.
  const mainCands = candidatesOf(rows, materials, 'main', chemistryOf);
  const addCands = includeAdditions ? candidatesOf(rows, materials, 'additional', chemistryOf) : [];
  const pool = clampAdditions ? [...mainCands] : [...mainCands, ...addCands];
  if (pool.length < 2) return { ok: false, reason: 'too-few-rows' };

  // The displayed chemistry — the basis the point divides over, and therefore
  // the basis the restored ratio and the pinned unity values are measured on —
  // is every main row plus every addition while the UMF switch is on.
  const display = [...carry(mainCands, rows, target), ...carry(addCands, rows, target)];
  if (display.every((c) => c.flux <= 0)) return { ok: false, reason: 'no-flux' };
  const displayFlux = display.reduce((sum, c) => sum + c.flux, 0);
  const startR2o = display.reduce((sum, c) => sum + c.r2o, 0);
  const startRo = display.reduce((sum, c) => sum + c.ro, 0);
  const baseRatio = startRo > 0 ? startR2o / startRo : 0;

  // The boron clamp is a hold: one row over the displayed chemistry that keeps
  // the batch's unity B₂O₃ where it entered. Like any hold it weighs on amounts
  // the fit already has, so it buys no unknown and must be given a mover of its
  // own — and with no B₂O₃ in the batch it holds nothing and drops out.
  const holds = (clampBoron ? ['B2O3'] : [])
    .map((oxide) => {
      const molesPerRow = new Map<number, number>();
      let enteredMoles = 0;
      for (const carried of display) {
        const material = materials.get(rows[carried.rowIndex]?.materialId ?? '');
        const moles = material ? oxideMolesPerPart(chemistryOf(material).profile, oxide) : 0;
        molesPerRow.set(carried.rowIndex, moles);
        enteredMoles += (rows[carried.rowIndex]?.amount ?? 0) * moles;
      }
      return { oxide, molesPerRow, enteredMoles };
    })
    .filter((hold) => hold.enteredMoles > 0)
    .filter((hold) => {
      // A hold a pinned addition already enforces verbatim — the sole boron
      // source, clamped on its dominant B₂O₃ — would repeat that pin's row
      // exactly and throw the fit off its rows+1 shape. The pin is the stronger
      // statement, so the hold drops out; the value stays clamped through it.
      const carriers = [...hold.molesPerRow].filter(([, moles]) => moles > 0);
      if (carriers.length !== 1) return true;
      const [rowIndex] = carriers[0]!;
      const row = rows[rowIndex];
      if (row?.kind !== 'additional' || !clampAdditions || row.amount <= 0) return true;
      const material = materials.get(row.materialId);
      const dominant = material ? chemistryOf(material).dominant : null;
      return !(dominant && dominant.oxide === hold.oxide);
    });

  // Movers: the usual three seats, plus one per hold — a hold is a row over
  // amounts the fit already has, so it needs a mover of its own. Two bounds
  // keep it honest. Never seat more rows than the recipe has, and always leave
  // one *usable* displayed row frozen: with every row in the fit the equations
  // turn homogeneous, the free parameter scales the batch instead of steering
  // the ratio, and the clamp loses the very thing it spends.
  const usable = display.filter(
    (carried) =>
      carried.firstOf > 0 || carried.firstPer > 0 || carried.secondOf > 0 || carried.secondPer > 0,
  ).length;
  const seats = Math.min((leastChange ? 2 : 3) + holds.length, Math.max(2, usable - 1));
  const moving = chooseCarriers(carry(pool, rows, target), startR2o, startRo, seats);
  if (!moving) return { ok: false, reason: target.second.empty };

  // A clamped addition keeps the unity value of its dominant oxide — the figure
  // a formula actually reads — while its own parts are solved for, so the
  // addition follows the base instead of its recipe percentage being held.
  const pinned: { carried: Carry; molesPerPart: number; unityValue: number }[] = [];
  if (clampAdditions) {
    for (const carried of display) {
      const row = rows[carried.rowIndex];
      if (row?.kind !== 'additional' || row.amount <= 0) continue;
      const material = materials.get(row.materialId);
      const held = material ? chemistryOf(material).dominant : null;
      // Nothing to hold: the row stays a constant at its entered amount.
      if (!held) continue;
      pinned.push({
        carried,
        molesPerPart: held.moles,
        unityValue: (row.amount * held.moles) / displayFlux,
      });
    }
  }

  // Unknowns: the carriers, then one amount per pinned addition. Each keeps its
  // per-part axis values, so the target rows below never re-derive a profile.
  const unknowns = [...moving, ...pinned.map((add) => add.carried)];
  const unknownIndex = new Map(unknowns.map((unknown, index) => [unknown.rowIndex, index]));

  let constFlux = 0;
  let constFirstOf = 0;
  let constFirstPer = 0;
  let constSecondOf = 0;
  let constSecondPer = 0;
  for (const carried of display) {
    if (unknownIndex.has(carried.rowIndex)) continue;
    const amount = rows[carried.rowIndex]?.amount ?? 0;
    constFlux += amount * carried.coefficients.flux;
    constFirstOf += amount * carried.firstOf;
    constFirstPer += amount * carried.firstPer;
    constSecondOf += amount * carried.secondOf;
    constSecondPer += amount * carried.secondPer;
  }

  const { x: X, y: Y } = target;
  // Target rows: coordinate minus (target · basis), so each reads
  // Σ amount·(coordinate − target·basis) = target·basis₀ − constants.
  const equations: SolveEquation[] = [
    {
      coefficients: unknowns.map((u) => u.firstOf - X * u.firstPer),
      rhs: X * constFirstPer - constFirstOf,
    },
    {
      coefficients: unknowns.map((u) => u.secondOf - Y * u.secondPer),
      rhs: Y * constSecondPer - constSecondOf,
    },
  ];
  // One row per pinned addition: its dominant oxide's moles per part less its
  // share of the batch flux, so `c_o · amount − unityValue · F = 0` holds.
  for (const add of pinned) {
    equations.push({
      coefficients: unknowns.map((u) => {
        const own = u.rowIndex === add.carried.rowIndex ? add.molesPerPart : 0;
        return own - add.unityValue * u.coefficients.flux;
      }),
      rhs: add.unityValue * constFlux,
    });
  }

  // Each hold weighs on amounts that are unknowns already; the movers that pay
  // for it were seated above, so all that is left is to write the row.
  for (const hold of holds) {
    const unityValue = hold.enteredMoles / displayFlux;
    let constMoles = 0;
    for (const [rowIndex, moles] of hold.molesPerRow) {
      if (!unknownIndex.has(rowIndex)) constMoles += (rows[rowIndex]?.amount ?? 0) * moles;
    }
    // Σ amount·moles + constMoles = unityValue · (Σ amount·flux + constFlux).
    equations.push({
      coefficients: unknowns.map(
        (u) => (hold.molesPerRow.get(u.rowIndex) ?? 0) - unityValue * u.coefficients.flux,
      ),
      rhs: unityValue * constFlux - constMoles,
    });
  }

  if (equations.length > unknowns.length) return { ok: false, reason: 'over-constrained' };

  const family = solveFit(equations, unknowns.length);
  if (!family) return { ok: false, reason: 'singular' };

  /** Every row's amount along the fit: unknowns from x(t), constants as entered. */
  const amountsAt = (t: number): number[] =>
    rows.map((row, rowIndex) => {
      const index = unknownIndex.get(rowIndex);
      if (index === undefined) return row.amount;
      return (family.particular[index] ?? 0) + t * (family.direction[index] ?? 0);
    });

  /** R₂O and RO of the displayed chemistry at those amounts. The coefficient is
   *  per amount-part, so a `Carry`'s already-scaled sums must not be reused. */
  const ratioAt = (amounts: number[]): { n: number; d: number } => {
    let n = 0;
    let d = 0;
    for (const carried of display) {
      const amount = amounts[carried.rowIndex] ?? 0;
      n += amount * carried.coefficients.r2o;
      d += amount * carried.coefficients.ro;
    }
    return { n, d };
  };

  // Non-negative amounts restrict t to an interval (possibly empty).
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  family.direction.forEach((slope, i) => {
    if (Math.abs(slope) <= DETERMINANT_EPSILON) return;
    const bound = -(family.particular[i] ?? 0) / slope;
    if (slope > 0) lo = Math.max(lo, bound);
    else hi = Math.min(hi, bound);
  });
  if (lo > hi) return { ok: false, reason: 'negative-amount' };

  // Spend the family's freedom on the R₂O:RO balance. R(t) = (N0 + t·N1)/(D0 +
  // t·D1) is a Möbius function of t, so the t that restores the entered ratio is
  // closed form — clamped into the interval where every amount stays positive.
  let t = Math.min(Math.max(0, lo), hi);
  if (family.hasFamily && startRo > 0) {
    const atZero = ratioAt(amountsAt(0));
    const perT = ratioAt(
      rows.map((_, rowIndex) => family.direction[unknownIndex.get(rowIndex) ?? -1] ?? 0),
    );
    const slope = perT.n - baseRatio * perT.d;
    if (Math.abs(slope) > DETERMINANT_EPSILON) {
      t = Math.min(Math.max((baseRatio * atZero.d - atZero.n) / slope, lo), hi);
    }
  }

  // An all-zero particular solution leaves the solution set as the ray {t·q}:
  // its ratios are fixed, so any multiple with non-negative amounts does — take
  // the one whose amounts sum to 1, and let the write-back scale it.
  if (family.hasFamily && family.particular.every((value) => Math.abs(value) <= DETERMINANT_EPSILON)) {
    const sum = family.direction.reduce((total, value) => total + value, 0);
    const ray = Math.abs(sum) > DETERMINANT_EPSILON ? 1 / sum : 1;
    if (ray >= lo && ray <= hi) t = ray;
  }

  if (clampFluxRatio && startRo > 0) {
    // Holding the ratio is a promise, not a best effort: a target that cannot
    // keep R₂O:RO where it started is refused rather than drifting quietly.
    const held = ratioAt(amountsAt(t));
    const ratio = held.d > 0 ? held.n / held.d : Number.POSITIVE_INFINITY;
    if (Math.abs(ratio - baseRatio) > 1e-6 * Math.max(1, Math.abs(baseRatio))) {
      return { ok: false, reason: 'flux-ratio' };
    }
  }

  const solvedAmounts = amountsAt(t);
  if (
    family.particular
      .map((value, i) => value + t * (family.direction[i] ?? 0))
      .every((value) => Math.abs(value) <= DETERMINANT_EPSILON)
  ) {
    return { ok: false, reason: 'negative-amount' };
  }

  // `c.flux` is the coefficient per amount-part, like `ratioAt`'s — the `Carry`
  // sums are already scaled by the entered amount.
  const fluxTotal = display.reduce(
    (sum, c) => sum + (solvedAmounts[c.rowIndex] ?? 0) * c.coefficients.flux,
    0,
  );
  // Relative, not `<= 0`: a fit that drives the batch flux to nothing (a hold
  // that contradicts the target, say) leaves a rounding-noise flux behind, and
  // normalizing that to a base of 100 would return nonsense amounts.
  if (!(fluxTotal > PIVOT_EPSILON)) return { ok: false, reason: 'no-flux-total' };

  // Write-back: the displayed chemistry — base and additions alike — is scaled
  // so the base reads exactly 100. Every ratio survives that scaling, so the
  // point lands on the target and each clamped addition keeps its dominant
  // oxide's unity value while its own parts follow the base. A row outside the
  // displayed chemistry (an addition the UMF switch excludes) is left alone.
  const displayed = new Set(display.map((carried) => carried.rowIndex));
  const raw = rows.map((row, rowIndex) => {
    const index = unknownIndex.get(rowIndex);
    return index === undefined ? row.amount : Math.max(0, solvedAmounts[rowIndex] ?? 0);
  });
  const total = raw.reduce((sum, amount, rowIndex) => (rows[rowIndex]?.kind === 'main' ? sum + amount : sum), 0);
  // Same reasoning as the flux guard: a base of practically nothing scales into
  // noise once it is normalized to 100.
  if (!(total > PIVOT_EPSILON)) return { ok: false, reason: 'negative-amount' };
  const scale = 100 / total;

  // Amounts are quantized to whole cents and the rounding residual is pushed
  // onto the largest main row, so the written base totals exactly 100.00.
  const rounded = rows.map((row, rowIndex) =>
    displayed.has(rowIndex) ? { ...row, amount: round2((raw[rowIndex] ?? 0) * scale) } : { ...row },
  );
  const mainIndices = rounded.flatMap((row, index) => (row.kind === 'main' ? [index] : []));
  const amountAt = (index: number): number => rounded[index]?.amount ?? 0;
  const residual = 10000 - mainIndices.reduce((sum, index) => sum + Math.round(amountAt(index) * 100), 0);

  let largest = -1;
  for (const index of mainIndices) {
    if (largest < 0 || amountAt(index) > amountAt(largest)) largest = index;
  }
  const largestRow = rounded[largest];
  // mainIndices holds every non-zero main candidate, so it is non-empty here.
  if (!largestRow) return { ok: false, reason: 'too-few-rows' };
  rounded[largest] = { ...largestRow, amount: (Math.round(largestRow.amount * 100) + residual) / 100 };

  let solvedR2o = 0;
  let solvedRo = 0;
  for (const row of rounded) {
    if (row.kind !== 'main' && !(includeAdditions && row.kind === 'additional')) continue;
    const material = materials.get(row.materialId);
    if (!material) continue;
    const c = chemistryOf(material).coefficients;
    solvedR2o += c.r2o * row.amount;
    solvedRo += c.ro * row.amount;
  }
  // Same basis as `baseRatio` — the displayed chemistry — with each carrier's
  // final amount, so a rewritten addition counts where the point counts it.
  const solvedRatio = solvedRo > 0 && startRo > 0 ? solvedR2o / solvedRo : 1;

  // Rows that started non-zero and came back at zero: the clamp put a carrier on
  // the interval's closed end, so the row survives but the material leaves the
  // base. Reported rather than rejected — the target was reachable, just at the
  // price of that material — so the caller can name it.
  const emptied = rounded.flatMap((row, index) =>
    row.kind === 'main' && row.amount <= 0 && (rows[index]?.amount ?? 0) > 0 ? [index] : [],
  );

  // A base with RO but no R₂O has no starting ratio to drift from (0/0); report
  // it as unchanged rather than handing the caller a NaN.
  return {
    ok: true,
    rows: rounded,
    r2oRoDrift: startRo > 0 && baseRatio > 0 ? solvedRatio / baseRatio : 1,
    emptied,
  };
}

/** The Stull map's drag: the point is `(SiO₂, Al₂O₃)` over the typed flux. */
export function solveForStullTarget(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  target: { x: number; y: number },
  options: SolveOptions = {},
): SolveResult {
  return solveForTarget(rows, materials, { ...STULL_AXES, x: target.x, y: target.y }, options);
}

/**
 * The boron map's drag: unity B₂O₃ against the calculated firing temperature.
 * The y axis is the meltability ratio K, and K's own per-part weights depend on
 * the branch the recipe sits on — the Al₂O₃ step at 3 mass % and the oxides
 * with no meltability data. So the branch is frozen where the drag started, the
 * fit runs `leastChange` (at most two materials move), and the written recipe is
 * measured again: a fit that landed on the other side of the step, or under a
 * different skip set, is refused rather than left reading the wrong cone.
 */
export function solveForBoronTarget(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  target: { b2o3: number; celsius: number },
  options: SolveOptions = {},
): SolveResult {
  const includeAdditions = options.includeAdditions ?? false;
  const k = kForCelsius(target.celsius);
  if (k === null) return { ok: false, reason: 'temperature-drift' };
  const role = aluminaRole(batchMassPercent(chemistryRows(rows, includeAdditions), materials));

  const solved = solveForTarget(
    rows,
    materials,
    {
      first: {
        of: (chemistry) => oxideMolesPerPart(chemistry.profile, 'B2O3'),
        per: (chemistry) => chemistry.coefficients.flux,
        empty: 'no-flux',
      },
      second: meltabilityAxis(role),
      x: target.b2o3,
      y: k,
    },
    { ...options, leastChange: true },
  );
  if (!solved.ok) return solved;

  // Measure what was written, not what was fitted: the write-back rounds the
  // amounts to cents, and the temperature map is piecewise and branchy.
  const written = chemistryRows(solved.rows, includeAdditions);
  const melt = meltabilityK(batchMassPercent(written, materials), OXIDE_BY_FORMULA);
  const celsius = firingTemperatureK(melt.k, melt.approximate).celsius;
  if (celsius === null || Math.abs(celsius - target.celsius) > TEMPERATURE_TOLERANCE) {
    return { ok: false, reason: 'temperature-drift' };
  }
  const umf = unityFormula(batchMoles(written, materials, OXIDE_BY_FORMULA), OXIDE_BY_FORMULA);
  if (Math.abs((umf.values.get('B2O3') ?? 0) - target.b2o3) > 1e-3) {
    return { ok: false, reason: 'temperature-drift' };
  }
  return solved;
}