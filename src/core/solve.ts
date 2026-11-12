import type { Material, RecipeRow } from '../types';
import { OXIDE_BY_FORMULA } from '../data/catalog';
import { debugLog, debugRows } from '../debug';
import {
  materialChemistry,
  oxideMolesPerPart,
  type MaterialChemistry,
  type MoleCoefficients,
} from './geometry';

export type SolveRejection =
  | 'too-few-rows'
  | 'no-flux'
  | 'no-alumina-carrier'
  | 'singular'
  | 'negative-amount'
  | 'no-flux-total'
  | 'over-constrained'
  | 'umf-drift';

export type SolveResult =
  | { ok: true; rows: RecipeRow[]; r2oRoDrift: number; /** Indices of the main rows the solve drove to zero. */ emptied: number[] }
  | { ok: false; reason: SolveRejection };

/** What a drag may do to the `additional` rows. `unity` holds each addition's
 *  share of the flux — its contribution to the unity formula — within the
 *  drag's UMF tolerance; `free` leaves the additions in the carrier pool, where
 *  the solver may rewrite them. */
export type AdditionClamp = 'unity' | 'free';

export type SolveOptions = {
  /** UMF gate: `additional` rows join the displayed chemistry and the point
   *  when set. */
  includeAdditions?: boolean;
  /** How every addition is treated while a drag refits the base — see
   *  `AdditionClamp`. `unity` by default. */
  additionClamp?: AdditionClamp;
  /** Absolute UMF tolerance for the oxides the drag does not target. The target
   *  recipe is the starting glaze with the two chart coordinates replaced; every
   *  other unity value must stay within this distance or the solve is refused
   *  as `umf-drift`. Absent, the check is off — the app always passes its
   *  persisted value (0.01 by default). */
  umfTolerance?: number;
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

/**
 * One chart coordinate: `value = Σ amount·of / Σ amount·per`, with both sides
 * linear in the row amounts — the shape every draggable axis has to have. The
 * Stull map reads (SiO₂, Al₂O₃) over the typed flux; the triaxial map reads the
 * same two over the triangle's three corners.
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

/** The displayed chemistry's oxide moles and typed flux at the given amounts —
 *  the basis the UMF target and its tolerance check are read on. */
type UmfBasis = { moles: Map<string, number>; flux: number };

function umfBasisOf(
  rows: RecipeRow[],
  display: Carry[],
  materials: Map<string, Material>,
  chemistryOf: (material: Material) => MaterialChemistry,
  amounts: number[],
): UmfBasis {
  const moles = new Map<string, number>();
  let flux = 0;
  for (const carried of display) {
    const material = materials.get(rows[carried.rowIndex]?.materialId ?? '');
    if (!material) continue;
    const amount = amounts[carried.rowIndex] ?? 0;
    if (amount === 0) continue;
    for (const [oxide, mass] of chemistryOf(material).profile) {
      const entry = OXIDE_BY_FORMULA.get(oxide);
      if (!entry || entry.mw <= 0) continue;
      const value = (amount * mass) / 100 / entry.mw;
      moles.set(oxide, (moles.get(oxide) ?? 0) + value);
      if (entry.umfType === 'R2O' || entry.umfType === 'RO') flux += value;
    }
  }
  return { moles, flux };
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
 * coordinate, then the rest of `count` by how hard they swing the R₂O:RO
 * balance. The axes name their own carriers — the Stull and triaxial maps seat
 * the most concentrated SiO₂ source and the most concentrated Al₂O₃ source of
 * the rest. The seats go by per-part concentration, not by total carry: a drag
 * needs decoupled control, and only a pure source moves one axis without
 * dragging the others along — a large dilute row out-carries the pure one by
 * sheer amount, freezes it, and leaves the fit trying to steer x by destroying
 * flux, which collapses the reachable set to a strip and hands the family a
 * near-singular direction. A row whose chemistry is a copy of one already
 * seated is skipped: a duplicate column cannot be solved for and would only
 * make the fit singular. Returns null when no row can carry the second
 * coordinate of a two-axis target.
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
 * solutions are a line, which the caller then spends on the written recipe —
 * this is the shape a hold takes when it repeats a target row, as holding SiO₂
 * does, since the Stull x axis *is* the SiO₂ unity value. `null` when the row is
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
 * solution family when one degree of freedom is left for the written recipe.
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
 * carriers exactly, then spending the remaining freedom on the written recipe.
 * Every draggable map shares this body: `target` names the two coordinate axes
 * and the values wanted. The Stull map reads (SiO₂, Al₂O₃) over the typed flux,
 * the triaxial map the same two over the triangle's corners — see
 * `solveForStullTarget` and `triaxialAxes`.
 *
 * Two hard constraints and three free carriers leave a one-parameter family of
 * exact solutions, x(t) = p + t·q; non-negative amounts bound t to an interval.
 * The fit takes the point on the family closest to the entered amounts, unless
 * a UMF tolerance is set — then it takes the point whose held unity values move
 * least.
 *
 * With only two carriers there is no such family and the point may move only
 * along the curve its materials can reach, at best.
 *
 * With `options.includeAdditions`, every `additional` row joins the displayed
 * chemistry and the carrier pool. `options.additionClamp` then says what a drag
 * may do to them: `unity` (the default) holds each addition's share of the
 * displayed flux within `options.umfTolerance`; `free` leaves the share
 * unconstrained. Every other displayed oxide is held within the same tolerance.
 *
 * Every row — base and additions alike — is written back scaled so the base
 * totals exactly 100. All the ratios survive that scaling, so the held unity
 * values and the dragged point both come out where they were fitted.
 */
function solveTarget(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  target: SolveTarget,
  options: SolveOptions = {},
): SolveResult {
  const { includeAdditions = false, additionClamp = 'unity' } = options;
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
  // The pool the solver may pick carriers from: every main row plus every
  // addition that is part of the displayed chemistry. The additions clamp no
  // longer pins an amount — it only decides whether each addition's flux share
  // is held within the UMF tolerance.
  const mainCands = candidatesOf(rows, materials, 'main', chemistryOf);
  const addCands = includeAdditions ? candidatesOf(rows, materials, 'additional', chemistryOf) : [];
  const pool = [...mainCands, ...addCands];
  if (pool.length < 2) return { ok: false, reason: 'too-few-rows' };

  // The displayed chemistry — the basis the point divides over, and therefore
  // the basis the restored ratio and the held unity values are measured on — is
  // every main row plus every addition while the UMF switch is on.
  const display = [...carry(mainCands, rows, target), ...carry(addCands, rows, target)];
  if (display.every((c) => c.flux <= 0)) return { ok: false, reason: 'no-flux' };
  const displayFlux = display.reduce((sum, c) => sum + c.flux, 0);
  const startR2o = display.reduce((sum, c) => sum + c.r2o, 0);
  const startRo = display.reduce((sum, c) => sum + c.ro, 0);
  const baseRatio = startRo > 0 ? startR2o / startRo : 0;
  // The target recipe's held values: the starting glaze's UMF, read on the same
  // typed-flux basis as the chart point. Only needed when the caller asks for
  // the tolerance check.
  const startUmf =
    options.umfTolerance !== undefined
      ? umfBasisOf(rows, display, materials, chemistryOf, rows.map((row) => row.amount))
      : null;

  // Movers: the usual three seats. Never seat more rows than the recipe has,
  // and always leave one *usable* displayed row frozen: with every row in the
  // fit the equations turn homogeneous, the free parameter scales the batch
  // instead of steering the ratio, and the clamp loses the very thing it
  // spends.
  const usable = display.filter(
    (carried) =>
      carried.firstOf > 0 || carried.firstPer > 0 || carried.secondOf > 0 || carried.secondPer > 0,
  ).length;
  const seats = Math.min(3, Math.max(2, usable - 1));
  const moving = chooseCarriers(carry(pool, rows, target), startR2o, startRo, seats);
  if (!moving) return { ok: false, reason: target.second.empty };

  const enteredMainTotal = rows.reduce(
    (sum, row) => (row.kind === 'main' ? sum + row.amount : sum),
    0,
  );

  // Additions locked by UMF keep their share of the displayed flux within the
  // drag's tolerance. The amount itself is free to follow the batch.
  const lockedAdditions =
    additionClamp === 'unity'
      ? display.flatMap((carried) => {
          const row = rows[carried.rowIndex];
          if (row?.kind !== 'additional' || row.amount <= 0) return [];
          return [
            {
              rowIndex: carried.rowIndex,
              share: (row.amount * carried.coefficients.flux) / displayFlux,
              fluxPerPart: carried.coefficients.flux,
            },
          ];
        })
      : [];

  // Unknowns: the carriers. Each keeps its per-part axis values, so the target
  // rows below never re-derive a profile.
  const unknowns = [...moving];
  const unknownIndex = new Map(unknowns.map((unknown, index) => [unknown.rowIndex, index]));

  let constFirstOf = 0;
  let constFirstPer = 0;
  let constSecondOf = 0;
  let constSecondPer = 0;
  for (const carried of display) {
    if (unknownIndex.has(carried.rowIndex)) continue;
    const amount = rows[carried.rowIndex]?.amount ?? 0;
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
  let constMainTotal = 0;
  rows.forEach((row, rowIndex) => {
    if (row.kind === 'main' && !unknownIndex.has(rowIndex)) constMainTotal += row.amount;
  });

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

  // The family's one free parameter goes where the written recipe changes
  // least: of the family's points, the one whose base shares sit closest to the
  // entered ones. The write-back normalizes the base to 100, so the distance is
  // measured there — X(t)/B(t) against the entered shares, with X(t) = p + t·q
  // and B = c + t·d the base total along the family. The apparent nonlinearity
  // closes:
  //   d/dt Σ (X/B − E)² = 0   ⇔   cross + t · curvature = 0
  // where the coefficients below are free of t. Only the base's own shares are
  // measured, so the additions take no part; a fold, or a target the family
  // only grazes, lands on the interval's end.
  let t = Math.min(Math.max(0, lo), hi);
  if (family.hasFamily) {
    let baseZero = constMainTotal;
    let baseSlope = 0;
    unknowns.forEach((unknown, index) => {
      if (rows[unknown.rowIndex]?.kind !== 'main') return;
      baseZero += family.particular[index] ?? 0;
      baseSlope += family.direction[index] ?? 0;
    });
    let cross = 0;
    let curvature = 0;
    unknowns.forEach((unknown, index) => {
      const row = rows[unknown.rowIndex];
      if (row?.kind !== 'main') return;
      const p = family.particular[index] ?? 0;
      const q = family.direction[index] ?? 0;
      const share = row.amount / enteredMainTotal;
      const h = q * baseZero - p * baseSlope;
      cross += (p - share * baseZero) * h;
      curvature += (q - share * baseSlope) * h;
    });
    if (Math.abs(curvature) > DETERMINANT_EPSILON) {
      t = Math.min(Math.max(-cross / curvature, lo), hi);
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

  // With a UMF tolerance the family's freedom goes where the held unity values
  // move least, not where the written recipe changes least: the target recipe
  // is the starting glaze with the new Si/Al values, and the rest must stay
  // put. The drift is a ratio of linear functions of t, so a dense sample of
  // the feasible interval finds the best point without a closed form.
  if (startUmf && family.hasFamily) {
    const held = [...startUmf.moles.keys()].filter(
      (oxide) => oxide !== 'SiO2' && oxide !== 'Al2O3',
    );
    const driftAt = (candidate: number): number => {
      const amounts = amountsAt(candidate);
      const basis = umfBasisOf(rows, display, materials, chemistryOf, amounts);
      if (!(basis.flux > PIVOT_EPSILON)) return Number.POSITIVE_INFINITY;
      let worst = 0;
      for (const oxide of held) {
        const target = (startUmf.moles.get(oxide) ?? 0) / startUmf.flux;
        const actual = (basis.moles.get(oxide) ?? 0) / basis.flux;
        worst = Math.max(worst, Math.abs(actual - target));
      }
      // The additions lock uses the same tolerance: each locked addition keeps
      // its share of the displayed flux.
      for (const add of lockedAdditions) {
        const share = ((amounts[add.rowIndex] ?? 0) * add.fluxPerPart) / basis.flux;
        worst = Math.max(worst, Math.abs(share - add.share));
      }
      // A candidate that empties a main row is refused by the caller, so the
      // search prefers one that keeps every material in the base.
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (row?.kind === 'main' && row.amount > 0 && (amounts[rowIndex] ?? 0) <= PIVOT_EPSILON) {
          return worst + 1e6;
        }
      }
      return worst;
    };
    const initial = t;
    const from = Number.isFinite(lo) ? lo : initial - 10;
    const to = Number.isFinite(hi) ? hi : initial + 10;
    let bestT = initial;
    let bestDrift = driftAt(initial);
    const samples = 32;
    for (let i = 0; i <= samples; i += 1) {
      const candidate = from + ((to - from) * i) / samples;
      const drift = driftAt(candidate);
      if (
        drift < bestDrift - 1e-12 ||
        (Math.abs(drift - bestDrift) <= 1e-12 &&
          Math.abs(candidate - initial) < Math.abs(bestT - initial))
      ) {
        bestT = candidate;
        bestDrift = drift;
      }
    }
    t = bestT;
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
  // point lands on the target and each locked addition keeps its share of the
  // flux. A row outside the displayed chemistry (an addition the UMF switch
  // excludes) is left alone.
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

  // The target recipe is the starting glaze with the two chart coordinates
  // replaced: every other unity value must stay where it was, within the
  // caller's tolerance. The check runs on the written-back amounts, so the
  // cent rounding is part of what the user will see.
  if (options.umfTolerance !== undefined) {
    const tolerance = Math.max(0, options.umfTolerance);
    const start = umfBasisOf(rows, display, materials, chemistryOf, rows.map((row) => row.amount));
    const solved = umfBasisOf(rows, display, materials, chemistryOf, rounded.map((row) => row.amount));
    if (!(start.flux > PIVOT_EPSILON) || !(solved.flux > PIVOT_EPSILON)) {
      return { ok: false, reason: 'no-flux-total' };
    }
    const oxides = new Set([...start.moles.keys(), ...solved.moles.keys()]);
    for (const oxide of oxides) {
      if (oxide === 'SiO2' || oxide === 'Al2O3') continue;
      const target = (start.moles.get(oxide) ?? 0) / start.flux;
      const actual = (solved.moles.get(oxide) ?? 0) / solved.flux;
      if (Math.abs(actual - target) > tolerance + 1e-9) {
        return { ok: false, reason: 'umf-drift' };
      }
    }
    for (const add of lockedAdditions) {
      const share = ((rounded[add.rowIndex]?.amount ?? 0) * add.fluxPerPart) / solved.flux;
      if (Math.abs(share - add.share) > tolerance + 1e-9) {
        return { ok: false, reason: 'umf-drift' };
      }
    }
  }

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

/** A single solve, as the drags run it — and one console line when the debug
 *  flag is on: the target, the switches, the verdict and the rows either side.
 *  A zone scan passes a per-scan chemistry cache and solves hundreds of cells;
 *  those stay quiet, and the scan logs one line of its own. */
export function solveForTarget(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  target: SolveTarget,
  options: SolveOptions = {},
): SolveResult {
  const result = solveTarget(rows, materials, target, options);
  if (!options.chemistry) {
    const detail: Record<string, unknown> = {
      target: { x: target.x, y: target.y },
      switches: {
        inUmf: options.includeAdditions === true,
        additions: options.additionClamp ?? 'unity',
        umfTolerance: options.umfTolerance ?? null,
      },
      verdict: result.ok ? 'landed' : `refused: ${result.reason}`,
      rows: `${debugRows(rows)} → ${result.ok ? debugRows(result.rows) : 'unchanged'}`,
    };
    if (result.ok) {
      detail.drift = Number(result.r2oRoDrift.toFixed(6));
      detail.emptied = result.emptied;
    }
    debugLog('solve', detail);
  }
  return result;
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