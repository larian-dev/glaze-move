import { describe, expect, it } from 'vitest';
import { OXIDE_BY_FORMULA, SYSTEM_MATERIALS, materialIndex } from '../src/data/catalog';
import { moleCoefficients } from '../src/core/geometry';
import { feasibleAreas } from '../src/core/hull';
import { publishedProfile } from '../src/core/normalize';
import { solveForStullTarget } from '../src/core/solve';
import type { Material, MaterialIndex, RecipeRow } from '../src/types';

const materials = materialIndex(SYSTEM_MATERIALS);

const NEPHELINE = materials.get('1') as Material;
const QUARTZ = materials.get('2') as Material;
const WHITING = materials.get('3') as Material;
const KAOLIN = materials.get('4') as Material;

const RECIPE: RecipeRow[] = [
  { materialId: NEPHELINE.id, amount: 40, kind: 'main' },
  { materialId: WHITING.id, amount: 12, kind: 'main' },
  { materialId: KAOLIN.id, amount: 20, kind: 'main' },
  { materialId: QUARTZ.id, amount: 28, kind: 'main' },
];

const ADDITION: RecipeRow = { materialId: WHITING.id, amount: 5, kind: 'additional' };

const FLUXLESS_SILICA = syntheticMaterial('fluxless-silica', [{ oxide: 'SiO2', amount: 100 }]);
const FLUXLESS_ALUMINA = syntheticMaterial('fluxless-alumina', [
  { oxide: 'Al2O3', amount: 60 },
  { oxide: 'SiO2', amount: 40 },
]);
const fluxlessMats = materialIndex([
  ...SYSTEM_MATERIALS,
  FLUXLESS_SILICA,
  FLUXLESS_ALUMINA,
]);
const FLUXLESS_ROWS: RecipeRow[] = [
  { materialId: FLUXLESS_SILICA.id, amount: 60, kind: 'main' },
  { materialId: FLUXLESS_ALUMINA.id, amount: 40, kind: 'main' },
  ADDITION,
];

function unityOf(
  rows: RecipeRow[],
  includeAdditions = false,
  index: MaterialIndex = materials,
): { x: number; y: number } {
  let flux = 0;
  let silica = 0;
  let alumina = 0;
  for (const row of rows) {
    if (row.kind !== 'main' && !includeAdditions) continue;
    const material = index.get(row.materialId);
    if (!material) continue;
    for (const [oxide, mass] of publishedProfile(material)) {
      const entry = OXIDE_BY_FORMULA.get(oxide);
      if (!entry || entry.mw <= 0) continue;
      const moles = (row.amount * mass) / 100 / entry.mw;
      if (oxide === 'SiO2') silica += moles;
      else if (oxide === 'Al2O3') alumina += moles;
      if (entry.umfType === 'R2O' || entry.umfType === 'RO') flux += moles;
    }
  }
  return { x: silica / flux, y: alumina / flux };
}

/**
 * One oxide's unity value over the displayed chemistry's typed flux — the figure
 * a clamped addition holds. `only` restricts the numerator to the rows that
 * contribute it, which is what an addition's own share means.
 */
function unityValueOf(
  rows: RecipeRow[],
  oxide: string,
  only?: (row: RecipeRow) => boolean,
  index: MaterialIndex = materials,
): number {
  const entry = OXIDE_BY_FORMULA.get(oxide);
  if (!entry || entry.mw <= 0) return Number.NaN;
  let moles = 0;
  let flux = 0;
  for (const row of rows) {
    const material = index.get(row.materialId);
    if (!material) continue;
    flux += row.amount * moleCoefficients(material).flux;
    if (only && !only(row)) continue;
    const mass = publishedProfile(material).get(oxide) ?? 0;
    moles += (row.amount * mass) / 100 / entry.mw;
  }
  return flux > 0 ? moles / flux : Number.NaN;
}

function syntheticMaterial(id: string, components: { oxide: string; amount: number }[]): Material {
  return { ...QUARTZ, id, name: id, components };
}

/** Ray casting, so a traced ring with stepped or concave edges still reads right. */
function insideRing(ring: { x: number; y: number }[], point: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

describe('solveForStullTarget with additions in the solve', () => {
  const ROWS_WITH_ADDITION: RecipeRow[] = [...RECIPE, ADDITION];

  it('is an exact fixed point for the whole batch, additions included', () => {
    const point = unityOf(ROWS_WITH_ADDITION, true);
    const result = solveForStullTarget(ROWS_WITH_ADDITION, materials, point, {
      includeAdditions: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(unityOf(result.rows, true).x).toBeCloseTo(point.x, 6);
    expect(unityOf(result.rows, true).y).toBeCloseTo(point.y, 6);
    // The entered addition is a constraint, not a variable: it comes back as typed.
    expect(result.rows.find((row) => row.kind === 'additional')?.amount).toBe(ADDITION.amount);
  });

  it('lands a dragged target in whole-batch terms, keeping the addition', () => {
    const target = { x: 3.4, y: 0.55 };
    const result = solveForStullTarget(ROWS_WITH_ADDITION, materials, target, {
      includeAdditions: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(unityOf(result.rows, true).x).toBeCloseTo(target.x, 2);
    expect(unityOf(result.rows, true).y).toBeCloseTo(target.y, 2);

    // The base is written back at exactly 100 and the clamped addition keeps the
    // unity value of its own dominant oxide; its parts are what follows the base.
    const isAddition = (row: RecipeRow): boolean => row.kind === 'additional';
    expect(
      result.rows.filter((row) => row.kind === 'main').reduce((sum, row) => sum + row.amount, 0),
    ).toBeCloseTo(100, 6);
    expect(unityValueOf(result.rows, 'CaO', isAddition)).toBeCloseTo(
      unityValueOf(ROWS_WITH_ADDITION, 'CaO', isAddition),
      3,
    );

    // Excluded from the solve, the same addition pushes the whole batch off the
    // target the user dropped the point on — the reason the two share a basis.
    const excluded = solveForStullTarget(ROWS_WITH_ADDITION, materials, target, {
      includeAdditions: false,
    });
    expect(excluded.ok).toBe(true);
    if (!excluded.ok) return;
    const missed = unityOf(excluded.rows, true);
    expect(Math.hypot(missed.x - target.x, missed.y - target.y)).toBeGreaterThan(0.05);
  });

  it('rejects a flux-free base while the addition stays out of the solve', () => {
    const target = { x: 4, y: 0.4 };
    // Base alone: no R₂O/RO anywhere — nothing to divide the silica by.
    expect(
      solveForStullTarget(FLUXLESS_ROWS, fluxlessMats, target, { includeAdditions: false }),
    ).toEqual({
      ok: false,
      reason: 'no-flux',
    });
  });

  it('lands a target on a two-carrier base, pinning the addition and the base at 100', () => {
    // Two carriers plus one pinned addition are three unknowns for the two
    // target rows and the pin, so the fit stays square — and the base still
    // comes back at exactly 100 with the addition's dominant oxide held.
    const target = { x: 4, y: 0.4 };
    const result = solveForStullTarget(FLUXLESS_ROWS, fluxlessMats, target, {
      includeAdditions: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const isAddition = (row: RecipeRow): boolean => row.kind === 'additional';
    expect(unityOf(result.rows, true, fluxlessMats).x).toBeCloseTo(target.x, 2);
    expect(unityOf(result.rows, true, fluxlessMats).y).toBeCloseTo(target.y, 2);
    expect(
      result.rows.filter((row) => row.kind === 'main').reduce((sum, row) => sum + row.amount, 0),
    ).toBeCloseTo(100, 6);
    expect(unityValueOf(result.rows, 'CaO', isAddition, fluxlessMats)).toBeCloseTo(
      unityValueOf(FLUXLESS_ROWS, 'CaO', isAddition, fluxlessMats),
      3,
    );
    // This base has RO (whiting) and no R₂O at all: there is no starting ratio
    // to drift from, and the caller must not receive a NaN for it.
    expect(Number.isFinite(result.r2oRoDrift)).toBe(true);
  });

  it('gives the hull a separate cache slot per inclusion flag', () => {
    const withBigAddition: RecipeRow[] = [
      ...RECIPE,
      { materialId: WHITING.id, amount: 40, kind: 'additional' },
    ];
    const excluded = feasibleAreas(withBigAddition, materials, {});
    const included = feasibleAreas(withBigAddition, materials, { includeAdditions: true });
    // Same rows and materials, different frozen set — a shared cache would
    // hand the first zones back for the second call.
    expect(included).not.toEqual(excluded);
    expect(feasibleAreas(withBigAddition, materials, {})).toEqual(excluded);
  });

  it('rewrites a clamped addition so its dominant oxide holds its unity value', () => {
    // A 50-part quartz addition is the richest silica row in the recipe; its
    // clamp switch is on, so it is pinned rather than picked as a carrier — the
    // drag adjusts its parts to keep its own SiO₂ unity value where it was.
    const rows: RecipeRow[] = [
      ...RECIPE,
      { materialId: QUARTZ.id, amount: 50, kind: 'additional' },
    ];
    const target = { x: 8, y: 0.7 };
    const result = solveForStullTarget(rows, materials, target, { includeAdditions: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const isAddition = (row: RecipeRow): boolean => row.kind === 'additional';
    const addition = result.rows.find(isAddition);
    expect(addition?.amount).not.toBe(50);
    expect(addition?.amount).toBeGreaterThan(0);
    expect(unityOf(result.rows, true).x).toBeCloseTo(target.x, 2);
    expect(unityOf(result.rows, true).y).toBeCloseTo(target.y, 2);
    expect(unityValueOf(result.rows, 'SiO2', isAddition)).toBeCloseTo(
      unityValueOf(rows, 'SiO2', isAddition),
      2,
    );
    expect(
      result.rows.filter((row) => row.kind === 'main').reduce((sum, row) => sum + row.amount, 0),
    ).toBeCloseTo(100, 6);
  });

  it('may rewrite an unclamped addition chosen as a carrier, still landing exactly', () => {
    // The same 50-part addition with the additions clamp OFF joins the pool and
    // wins the silica seat — the drag is then allowed to rewrite its amount,
    // while the whole-batch point still lands on the dropped target.
    const rows: RecipeRow[] = [
      ...RECIPE,
      { materialId: QUARTZ.id, amount: 50, kind: 'additional' },
    ];
    const target = { x: 5, y: 0.55 };
    const result = solveForStullTarget(rows, materials, target, {
      includeAdditions: true,
      clampAdditions: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.find((row) => row.kind === 'additional')?.amount).not.toBe(50);
    expect(unityOf(result.rows, true).x).toBeCloseTo(target.x, 2);
    expect(unityOf(result.rows, true).y).toBeCloseTo(target.y, 2);
  });
});

describe('solveForStullTarget flux-ratio clamp', () => {
  const ratioOf = (rows: RecipeRow[]): number => {
    let r2o = 0;
    let ro = 0;
    for (const row of rows) {
      if (row.kind !== 'main') continue;
      const material = materials.get(row.materialId);
      if (!material) continue;
      const c = moleCoefficients(material);
      r2o += c.r2o * row.amount;
      ro += c.ro * row.amount;
    }
    return ro > 0 ? r2o / ro : Number.NaN;
  };

  it('holds the starting ratio across a reachable drag', () => {
    const start = ratioOf(RECIPE);
    const target = { x: 3.4, y: 0.55 };
    const result = solveForStullTarget(RECIPE, materials, target, { clampFluxRatio: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(unityOf(result.rows).x).toBeCloseTo(target.x, 2);
    expect(unityOf(result.rows).y).toBeCloseTo(target.y, 2);
    // Written back in whole cents, so the ratio holds to that rounding — the
    // drift figure the solver reports agrees.
    expect(ratioOf(result.rows)).toBeCloseTo(start, 3);
    expect(result.r2oRoDrift).toBeCloseTo(1, 3);
  });

  it('refuses a target the unclamped solve would reach only by drifting', () => {
    // Near the left rim the only fit lands the point by sliding the balance
    // most of the way off its start (drift ≈ 0.57 here). Without the clamp the
    // point lands and the drift goes unnoticed; clamped, it is a refusal.
    const target = { x: 1, y: 0.2 };
    const unclamped = solveForStullTarget(RECIPE, materials, target);
    expect(unclamped.ok).toBe(true);
    if (unclamped.ok) {
      expect(Math.abs(unclamped.r2oRoDrift - 1)).toBeGreaterThan(0.3);
    }

    expect(solveForStullTarget(RECIPE, materials, target, { clampFluxRatio: true })).toEqual({
      ok: false,
      reason: 'flux-ratio',
    });
  });
});

describe('solveForStullTarget', () => {
  it('is an exact fixed point when the target is the current point', () => {
    const point = unityOf(RECIPE);
    const result = solveForStullTarget(RECIPE, materials, point);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(unityOf(result.rows).x).toBeCloseTo(point.x, 6);
    expect(unityOf(result.rows).y).toBeCloseTo(point.y, 6);
    result.rows.forEach((row, i) => {
      const expected = RECIPE[i]?.amount;
      expect(expected).toBeDefined();
      if (expected === undefined) return;
      expect(row.amount).toBeCloseTo(expected, 6);
    });
  });

  it('lands on a dragged target within the 2-decimal write-back resolution', () => {
    const result = solveForStullTarget(RECIPE, materials, { x: 3.4, y: 0.55 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(100, 6);
    // Every main row is quantized to whole cents after scaling, so the unity
    // point lands within the 2-decimal write-back resolution (±0.005 per amount).
    const point = unityOf(result.rows);
    expect(point.x).toBeCloseTo(3.4, 2);
    expect(point.y).toBeCloseTo(0.55, 2);
  });

  it('rounds the scaled main amounts to cents that sum to exactly 100.00', () => {
    const result = solveForStullTarget(RECIPE, materials, { x: 3.4, y: 0.55 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const main = result.rows.filter((row) => row.kind === 'main');
    for (const row of main) {
      expect(Math.round(row.amount * 100) / 100).toBe(row.amount);
    }
    const cents = main.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    expect(cents).toBe(10000);
    expect(main.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(100, 10);
  });

  it('leaves additions untouched and preserves row order and kinds', () => {
    const rows = RECIPE.concat([ADDITION]);
    const result = solveForStullTarget(rows, materials, { x: 3.4, y: 0.55 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows.map((row) => row.materialId)).toEqual(rows.map((row) => row.materialId));
    expect(result.rows.map((row) => row.kind)).toEqual(rows.map((row) => row.kind));
    expect(result.rows.at(-1)?.amount).toBe(ADDITION.amount);
    expect(unityOf(result.rows).x).toBeCloseTo(3.4, 2);
  });

  it('skips rows with unknown materials and zero amounts', () => {
    const rows: RecipeRow[] = [
      { materialId: 'unknown-material', amount: 50, kind: 'main' },
      { materialId: QUARTZ.id, amount: 0, kind: 'main' },
      ...RECIPE,
    ];
    expect(solveForStullTarget(rows, materials, unityOf(RECIPE)).ok).toBe(true);
  });

  it('rejects a single row', () => {
    expect(solveForStullTarget(RECIPE.slice(0, 1), materials, { x: 3, y: 0.5 })).toEqual({
      ok: false,
      reason: 'too-few-rows',
    });
  });

  it('rejects a fluxless recipe', () => {
    const silica = syntheticMaterial('fluxless-silica', [
      { oxide: 'SiO2', amount: 70 },
      { oxide: 'Al2O3', amount: 30 },
    ]);
    const alumina = syntheticMaterial('fluxless-alumina', [
      { oxide: 'Al2O3', amount: 40 },
      { oxide: 'SiO2', amount: 60 },
    ]);
    const rows: RecipeRow[] = [
      { materialId: silica.id, amount: 50, kind: 'main' },
      { materialId: alumina.id, amount: 50, kind: 'main' },
    ];
    expect(solveForStullTarget(rows, new Map([[silica.id, silica], [alumina.id, alumina]]), {
      x: 3,
      y: 0.3,
    })).toEqual({ ok: false, reason: 'no-flux' });
  });

  it('rejects when no remaining row can carry alumina', () => {
    const aluminaSource = syntheticMaterial('alumina-source', [
      { oxide: 'SiO2', amount: 60 },
      { oxide: 'Al2O3', amount: 30 },
      { oxide: 'K2O', amount: 10 },
    ]);
    const fluxOnly = syntheticMaterial('flux-only', [
      { oxide: 'CaO', amount: 56 },
      { oxide: 'SiO2', amount: 44 },
    ]);
    const rows: RecipeRow[] = [
      { materialId: aluminaSource.id, amount: 50, kind: 'main' },
      { materialId: fluxOnly.id, amount: 30, kind: 'main' },
      { materialId: WHITING.id, amount: 10, kind: 'main' },
    ];
    const index = new Map([
      [aluminaSource.id, aluminaSource],
      [fluxOnly.id, fluxOnly],
      [WHITING.id, WHITING],
    ]);
    expect(solveForStullTarget(rows, index, { x: 3, y: 0.3 })).toEqual({
      ok: false,
      reason: 'no-alumina-carrier',
    });
  });

  it('rejects a target that would make a carrier amount negative', () => {
    expect(solveForStullTarget(RECIPE, materials, { x: 0.2, y: 0.9 })).toEqual({
      ok: false,
      reason: 'negative-amount',
    });
  });

  it('rejects a singular carrier pair', () => {
    const rows: RecipeRow[] = [
      { materialId: NEPHELINE.id, amount: 40, kind: 'main' },
      { materialId: NEPHELINE.id, amount: 30, kind: 'main' },
    ];
    expect(solveForStullTarget(rows, materials, { x: 3.4, y: 0.3 })).toEqual({
      ok: false,
      reason: 'singular',
    });
  });

  it('refuses a near-duplicate carrier pair rather than fitting it with wild amounts', () => {
    const base = syntheticMaterial('near-base', [
      { oxide: 'SiO2', amount: 60 },
      { oxide: 'Al2O3', amount: 25 },
      { oxide: 'K2O', amount: 15 },
    ]);
    const twin = syntheticMaterial('near-twin', [
      { oxide: 'SiO2', amount: 60.002 },
      { oxide: 'Al2O3', amount: 25 },
      { oxide: 'K2O', amount: 15 },
    ]);
    const rows: RecipeRow[] = [
      { materialId: base.id, amount: 50, kind: 'main' },
      { materialId: twin.id, amount: 30, kind: 'main' },
    ];
    const index = new Map([
      [base.id, base],
      [twin.id, twin],
    ]);

    // Document that this determinant is small but strictly nonzero — the twin
    // composition differs from the base, unlike the exact-zero case above.
    const x = 3.4;
    const y = 0.55;
    const c1 = moleCoefficients(base);
    const c2 = moleCoefficients(twin);
    const det =
      (c1.silica - x * c1.flux) * (c2.alumina - y * c2.flux) -
      (c2.silica - x * c2.flux) * (c1.alumina - y * c1.flux);
    expect(Math.abs(det)).toBeGreaterThan(0);
    expect(Math.abs(det)).toBeLessThan(1e-9);

    // Conditioning is judged against each row's own scale — a healthy 4×4 of
    // mole fractions has a determinant of this size — so this pair is not
    // *singular*. What the fit would ask of it walks out of the non-negative
    // orthant instead, which is the refusal.
    expect(solveForStullTarget(rows, index, { x, y })).toEqual({ ok: false, reason: 'negative-amount' });
  });

  it('rejects a target whose solved flux total would not stay positive', () => {
    // The frozen row carries a negative amount (the recipe editor does not clamp
    // the sign), so its flux drags the frozen sum below zero and the carriers
    // cannot compensate — the unity basis would be undefined.
    const frozen = syntheticMaterial('nft-frozen', [
      { oxide: 'Al2O3', amount: 19 },
      { oxide: 'SiO2', amount: 63 },
      { oxide: 'Na2O', amount: 18 },
    ]);
    const silica = syntheticMaterial('nft-silica', [
      { oxide: 'SiO2', amount: 37 },
      { oxide: 'CaO', amount: 36 },
      { oxide: 'K2O', amount: 27 },
    ]);
    const alumina = syntheticMaterial('nft-alumina', [
      { oxide: 'SiO2', amount: 12 },
      { oxide: 'Al2O3', amount: 67 },
      { oxide: 'K2O', amount: 21 },
    ]);
    const rows: RecipeRow[] = [
      { materialId: frozen.id, amount: -41, kind: 'main' },
      { materialId: silica.id, amount: 22, kind: 'main' },
      { materialId: alumina.id, amount: 41, kind: 'main' },
    ];
    const index = new Map([
      [frozen.id, frozen],
      [silica.id, silica],
      [alumina.id, alumina],
    ]);
    expect(solveForStullTarget(rows, index, { x: 5.68, y: 0.28 })).toEqual({
      ok: false,
      reason: 'no-flux-total',
    });
  });

  it('picks the alumina carrier among the remaining rows when the silica carrier is pure silica', () => {
    // The silica seat goes to the most concentrated SiO₂ source (quartz), so a
    // kaolin-heavy row — the most concentrated Al₂O₃ source left — takes the
    // alumina seat, and all three rows move.
    const rows: RecipeRow[] = [
      { materialId: KAOLIN.id, amount: 45, kind: 'main' },
      { materialId: NEPHELINE.id, amount: 35, kind: 'main' },
      { materialId: QUARTZ.id, amount: 20, kind: 'main' },
    ];
    const target = unityOf(rows);
    const result = solveForStullTarget(rows, materials, { x: target.x * 1.1, y: target.y * 1.1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kaolin = result.rows.find((row) => row.materialId === KAOLIN.id);
    const nepheline = result.rows.find((row) => row.materialId === NEPHELINE.id);
    expect(kaolin?.amount).not.toBeCloseTo(45, 2);
    expect(nepheline?.amount).not.toBeCloseTo(35, 2);

    const point = unityOf(result.rows);
    expect(point.x).toBeCloseTo(target.x * 1.1, 2);
    expect(point.y).toBeCloseTo(target.y * 1.1, 2);
  });

  it('keeps cent precision through to the write-back', () => {
    // The solved amounts are fractions of the batch and only become percentages
    // at the scaling step. Rounding them to cents *there* quantises the recipe to
    // whole percent, which threw the solved point ~0.2 SiO₂ off the target —
    // every carrier came back an exact integer.
    const rows: RecipeRow[] = [
      { materialId: KAOLIN.id, amount: 45, kind: 'main' },
      { materialId: NEPHELINE.id, amount: 35, kind: 'main' },
      { materialId: QUARTZ.id, amount: 20, kind: 'main' },
    ];
    const target = unityOf(rows);
    const result = solveForStullTarget(rows, materials, { x: target.x * 1.1, y: target.y * 1.1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fractions = result.rows.filter((row) => row.kind === 'main');
    expect(fractions.some((row) => !Number.isInteger(row.amount))).toBe(true);
    // Only the final write-back may quantise, so the point lands on the target to
    // well inside the 2-decimal resolution rather than a percent away.
    const point = unityOf(result.rows);
    expect(Math.abs(point.x - target.x * 1.1)).toBeLessThan(0.01);
    expect(Math.abs(point.y - target.y * 1.1)).toBeLessThan(0.01);
  });
});

describe('feasibleAreas', () => {
  it('returns rings inside the map box, with the current point draggable', () => {
    const point = unityOf(RECIPE);
    const areas = feasibleAreas(RECIPE, materials);
    expect(areas.draggable.length).toBeGreaterThan(0);
    for (const ring of [...areas.draggable, ...areas.emptied]) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      for (const vertex of ring) {
        expect(vertex.x).toBeGreaterThanOrEqual(0);
        expect(vertex.x).toBeLessThanOrEqual(9);
        expect(vertex.y).toBeGreaterThanOrEqual(0);
        expect(vertex.y).toBeLessThanOrEqual(1);
      }
    }
    // The recipe's own point solves without emptying anything, so it belongs to
    // the draggable zone, not to the hatched band around it.
    expect(areas.draggable.some((ring) => insideRing(ring, point))).toBe(true);
    expect(areas.emptied.some((ring) => insideRing(ring, point))).toBe(false);
  });

  it('is memoised on the recipe identity', () => {
    expect(feasibleAreas(RECIPE, materials)).toBe(feasibleAreas(RECIPE, materials));
  });
});

describe('solveForStullTarget carrier seats', () => {
  /** A share-link recipe: frit as a main row next to a big kaolin row. With the
   *  old carry-max seats the kaolin out-carried the pure quartz for the silica
   *  seat, quartz froze, and the reachable set collapsed to a strip covering
   *  7% of the box — until one accepted move silently rewrote the frit six-fold
   *  and blew the zone open. */
  const FRIT_RECIPE: RecipeRow[] = [
    { materialId: '25', amount: 14.94, kind: 'main' },
    { materialId: '1', amount: 15.22, kind: 'main' },
    { materialId: '4', amount: 42.66, kind: 'main' },
    { materialId: '26', amount: 3.91, kind: 'main' },
    { materialId: '28', amount: 23.27, kind: 'main' },
    { materialId: '23', amount: 11.42, kind: 'additional' },
    { materialId: '19', amount: 5.25, kind: 'additional' },
  ];

  it('keeps the frit near entered across a small move', () => {
    const start = unityOf(FRIT_RECIPE, true);
    const target = { x: start.x + 0.25, y: start.y };
    const result = solveForStullTarget(FRIT_RECIPE, materials, target, { includeAdditions: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frit = result.rows.find((row) => row.materialId === '28');
    expect(Math.abs((frit?.amount ?? 0) - 23.27)).toBeLessThan(3);
    expect(unityOf(result.rows, true).x).toBeCloseTo(target.x, 2);
    expect(unityOf(result.rows, true).y).toBeCloseTo(target.y, 2);
    expect(
      result.rows.filter((row) => row.kind === 'main').reduce((sum, row) => sum + row.amount, 0),
    ).toBeCloseTo(100, 6);
  });

  it('offers a wide zone instead of the strip the frozen quartz used to leave', () => {
    const zones = feasibleAreas(FRIT_RECIPE, materials, {
      includeAdditions: true,
      clampAdditions: true,
    });
    expect(zones.draggable.length).toBeGreaterThan(0);
    const maxX = Math.max(...zones.draggable.flat().map((point) => point.x));
    expect(maxX).toBeGreaterThan(8);
  });
});

describe('solveForStullTarget clamp boron', () => {
  /** The working recipe: mains 2-40, 1-30, 3-20, 4-10; additions 13-5, 15-2,
   *  18-1, 23-3 — id–percentage into the bundled catalog. */
  const WORKING_RECIPE: RecipeRow[] = [
    { materialId: '2', amount: 40, kind: 'main' },
    { materialId: '1', amount: 30, kind: 'main' },
    { materialId: '3', amount: 20, kind: 'main' },
    { materialId: '4', amount: 10, kind: 'main' },
    { materialId: '13', amount: 5, kind: 'additional' },
    { materialId: '15', amount: 2, kind: 'additional' },
    { materialId: '18', amount: 1, kind: 'additional' },
    { materialId: '23', amount: 3, kind: 'additional' },
  ];

  it('is a no-op on a recipe without any B₂O₃', () => {
    const target = { x: 3.4, y: 0.55 };
    expect(
      solveForStullTarget(WORKING_RECIPE, materials, target, { includeAdditions: true, clampBoron: true }),
    ).toEqual(solveForStullTarget(WORKING_RECIPE, materials, target, { includeAdditions: true }));
  });

  it('holds the batch unity B₂O₃ through a drag when the boron source is a mover', () => {
    // Five usable rows seat four movers — three plus the hold's own — and the
    // boron salt takes the second leverage seat. The hold lands the target with
    // the batch B₂O₃ intact to the cent rounding of the write-back.
    const boronSalt = syntheticMaterial('boron-salt', [
      { oxide: 'SiO2', amount: 30 },
      { oxide: 'B2O3', amount: 40 },
      { oxide: 'Na2O', amount: 30 },
    ]);
    const index = materialIndex([...SYSTEM_MATERIALS, boronSalt]);
    const rows: RecipeRow[] = [
      { materialId: boronSalt.id, amount: 30, kind: 'main' },
      { materialId: QUARTZ.id, amount: 30, kind: 'main' },
      { materialId: KAOLIN.id, amount: 20, kind: 'main' },
      { materialId: NEPHELINE.id, amount: 20, kind: 'main' },
      { materialId: WHITING.id, amount: 20, kind: 'main' },
    ];
    const before = unityValueOf(rows, 'B2O3', undefined, index);
    const start = unityOf(rows, false, index);
    const target = { x: start.x + 0.3, y: start.y };
    const clamped = solveForStullTarget(rows, index, target, { clampBoron: true });
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    expect(unityOf(clamped.rows, false, index).x).toBeCloseTo(target.x, 2);
    // The hold survives the cent rounding of the write-back.
    expect(unityValueOf(clamped.rows, 'B2O3', undefined, index)).toBeCloseTo(before, 3);
    expect(
      clamped.rows.filter((row) => row.kind === 'main').reduce((sum, row) => sum + row.amount, 0),
    ).toBeCloseTo(100, 6);
  });

  it('stays solvable when a pinned frit already enforces the boron hold', () => {
    // The frit is the sole B₂O₃ source and clamped on its dominant oxide: the
    // hold would duplicate that pin's row verbatim, so it drops out and the pin
    // keeps the value — the solve lands instead of going singular.
    const rows: RecipeRow[] = [...WORKING_RECIPE, { materialId: '5', amount: 10, kind: 'additional' }];
    const start = unityOf(rows, true);
    const before = unityValueOf(rows, 'B2O3');
    const target = { x: start.x + 0.3, y: start.y };
    const result = solveForStullTarget(rows, materials, target, { includeAdditions: true, clampBoron: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(unityOf(result.rows, true).x).toBeCloseTo(target.x, 2);
    expect(unityValueOf(result.rows, 'B2O3')).toBeCloseTo(before, 3);
  });

  it('refuses a recipe that cannot afford the hold a mover of its own', () => {
    // Three usable rows seat two movers and freeze one; the hold needs a third
    // mover, so the fit is over-constrained and the drag is refused.
    const boronFrit = syntheticMaterial('boron-frit', [
      { oxide: 'SiO2', amount: 65 },
      { oxide: 'B2O3', amount: 15 },
      { oxide: 'CaO', amount: 12 },
      { oxide: 'Na2O', amount: 8 },
    ]);
    const index = materialIndex([...SYSTEM_MATERIALS, boronFrit]);
    const rows: RecipeRow[] = [
      { materialId: boronFrit.id, amount: 40, kind: 'main' },
      { materialId: QUARTZ.id, amount: 30, kind: 'main' },
      { materialId: NEPHELINE.id, amount: 30, kind: 'main' },
    ];
    const start = unityOf(rows, false, index);
    const target = { x: start.x + 0.2, y: start.y };
    expect(solveForStullTarget(rows, index, target, { clampBoron: true })).toEqual({
      ok: false,
      reason: 'over-constrained',
    });
    // Without the clamp the same drag lands.
    expect(solveForStullTarget(rows, index, target).ok).toBe(true);
  });
});