import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEASIBLE_GRID_STEP_X,
  FEASIBLE_GRID_STEP_Y,
  STULL_BOX,
  feasibleAreas,
  type Outline,
} from '../src/core/hull';
import { solveForStullTarget } from '../src/core/solve';
import { SYSTEM_MATERIALS, materialIndex } from '../src/data/catalog';
import type { RecipeRow } from '../src/types';

const materials = materialIndex(SYSTEM_MATERIALS);

const RECIPE: RecipeRow[] = [
  { materialId: materials.get('1')!.id, amount: 40, kind: 'main' },
  { materialId: materials.get('3')!.id, amount: 12, kind: 'main' },
  { materialId: materials.get('4')!.id, amount: 20, kind: 'main' },
  { materialId: materials.get('2')!.id, amount: 28, kind: 'main' },
];

type Scan = {
  /** Sample cell centres, `[column][row]` — one per drawn cell. */
  centres: { x: number; y: number }[][];
  draggable: boolean[][];
  emptied: boolean[][];
};

/** Replays the region scan on the same cell grid, so the tests can see both
 *  populations the tracing is supposed to enclose. */
function scan(rows: RecipeRow[]): Scan {
  const movable = new Set(rows.flatMap((row, index) => (row.kind === 'main' && row.amount !== 0 ? [index] : [])));
  const xs: number[] = [];
  for (let x = STULL_BOX.minX; x <= STULL_BOX.maxX + 1e-9; x += FEASIBLE_GRID_STEP_X) xs.push(Number(x.toFixed(6)));
  const ys: number[] = [];
  for (let y = STULL_BOX.minY; y <= STULL_BOX.maxY + 1e-9; y += FEASIBLE_GRID_STEP_Y) ys.push(Number(y.toFixed(6)));

  const columns = Math.max(0, xs.length - 1);
  const rowCount = Math.max(0, ys.length - 1);
  const centres = Array.from({ length: columns }, (_, column) =>
    Array.from({ length: rowCount }, (_, row) => ({
      x: ((xs[column] ?? 0) + (xs[column + 1] ?? 0)) / 2,
      y: ((ys[row] ?? 0) + (ys[row + 1] ?? 0)) / 2,
    })),
  );
  const draggable = Array.from({ length: columns }, () => new Array<boolean>(rowCount).fill(false));
  const emptied = Array.from({ length: columns }, () => new Array<boolean>(rowCount).fill(false));

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      const centre = centres[column]?.[row];
      if (!centre) continue;
      const result = solveForStullTarget(rows, materials, centre);
      if (!result.ok) continue;
      const emptiedHere = result.rows.some((solved, index) => movable.has(index) && solved.amount <= 0);
      if (emptiedHere) emptied[column]![row] = true;
      else draggable[column]![row] = true;
    }
  }
  return { centres, draggable, emptied };
}

/** Ray casting, so a traced ring with stepped or concave edges still reads right. */
function insideRing(ring: Outline, point: { x: number; y: number }): boolean {
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

/** Centres whose four orthogonal neighbours are in the same set, so a test never
 *  leans on where the outline smoothing put an edge cell's boundary. */
function interiorCentres(cells: Scan, set: boolean[][]): { x: number; y: number }[] {
  const columns = set.length;
  const rowCount = set[0]?.length ?? 0;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < columns && y < rowCount && set[x]?.[y] === true;

  const centres: { x: number; y: number }[] = [];
  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rowCount; y += 1) {
      if (!inside(x, y) || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) continue;
      const centre = cells.centres[x]?.[y];
      if (centre) centres.push(centre);
    }
  }
  return centres;
}

describe('feasibleAreas', () => {
  const areas = feasibleAreas(RECIPE, materials);

  it('traces closed rings for both zones', () => {
    expect(areas.draggable.length).toBeGreaterThan(0);
    expect(areas.emptied.length).toBeGreaterThan(0);
    for (const ring of [...areas.draggable, ...areas.emptied]) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      for (const point of ring) {
        expect(point.x).toBeGreaterThanOrEqual(STULL_BOX.minX - 1e-9);
        expect(point.x).toBeLessThanOrEqual(STULL_BOX.maxX + 1e-9);
        expect(point.y).toBeGreaterThanOrEqual(STULL_BOX.minY - 1e-9);
        expect(point.y).toBeLessThanOrEqual(STULL_BOX.maxY + 1e-9);
      }
    }
  });

  it('encloses the draggable cells the scan found', () => {
    const cells = scan(RECIPE);
    const interior = interiorCentres(cells, cells.draggable);
    expect(interior.length).toBeGreaterThan(0);
    for (const point of interior) {
      expect(areas.draggable.some((ring) => insideRing(ring, point))).toBe(true);
    }
  });

  it('encloses the cells that fit only by emptying a row, and keeps them out of the draggable zone', () => {
    const cells = scan(RECIPE);
    const interior = interiorCentres(cells, cells.emptied);
    expect(interior.length).toBeGreaterThan(0);
    for (const point of interior) {
      expect(areas.emptied.some((ring) => insideRing(ring, point))).toBe(true);
      expect(areas.draggable.some((ring) => insideRing(ring, point))).toBe(false);
    }
  });

  it('does not blame a main row that already started at zero', () => {
    // A zero-amount main row is not a solve candidate and stays zero for every
    // target, so the two zones must not move.
    const withEmptyRow: RecipeRow[] = [
      ...RECIPE,
      { materialId: materials.get('2')!.id, amount: 0, kind: 'main' },
    ];
    expect(feasibleAreas(withEmptyRow, materials)).toEqual(areas);
  });

  it('returns nothing for a recipe that reaches nothing', () => {
    const noAlumina: RecipeRow[] = [
      { materialId: materials.get('2')!.id, amount: 70, kind: 'main' },
      { materialId: materials.get('1')!.id, amount: 30, kind: 'main' },
    ];
    expect(feasibleAreas(noAlumina, materials)).toEqual({ draggable: [], emptied: [] });
  });
});

describe('solveForStullTarget emptied rows', () => {
  /** A grid point the solve reaches only by clamping a carrier to zero. */
  function emptyingTarget(): { x: number; y: number } | undefined {
    const cells = scan(RECIPE);
    for (let column = 0; column < cells.emptied.length; column += 1) {
      for (let row = 0; row < (cells.emptied[column]?.length ?? 0); row += 1) {
        if (cells.emptied[column]?.[row] === true) return cells.centres[column]?.[row];
      }
    }
    return undefined;
  }

  it('names the rows a clamped carrier left at zero', () => {
    const target = emptyingTarget();
    expect(target).toBeDefined();
    if (!target) return;

    const result = solveForStullTarget(RECIPE, materials, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.emptied.length).toBeGreaterThan(0);
    for (const index of result.emptied) {
      expect(result.rows[index]?.kind).toBe('main');
      expect(result.rows[index]?.amount).toBe(0);
      expect(RECIPE[index]?.amount).toBeGreaterThan(0);
    }
  });

  it('reports nothing for a target that empties no row', () => {
    const result = solveForStullTarget(RECIPE, materials, { x: 3.4, y: 0.55 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.emptied).toEqual([]);
  });

  it('does not blame a main row that already started at zero', () => {
    const target = emptyingTarget();
    expect(target).toBeDefined();
    if (!target) return;

    const before = solveForStullTarget(RECIPE, materials, target);
    const withEmptyRow: RecipeRow[] = [
      ...RECIPE,
      { materialId: materials.get('2')!.id, amount: 0, kind: 'main' },
    ];
    const after = solveForStullTarget(withEmptyRow, materials, target);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    // Same carriers reported, and the trailing row that started at zero is not
    // among them — it was never moved by the solve.
    expect(after.emptied).toEqual(before.emptied);
    expect(after.emptied).not.toContain(RECIPE.length);
  });
});

describe('debug output', () => {
  /** The recipe from the share link that raised the region-change question — a
   *  frit-led base with a Gzhel addition, distinct from the fixture above. */
  const REPORTED: RecipeRow[] = [
    { materialId: '1', amount: 24.44, kind: 'main' },
    { materialId: '25', amount: 62.77, kind: 'main' },
    { materialId: '16', amount: 3.48, kind: 'main' },
    { materialId: '3', amount: 9.31, kind: 'main' },
    { materialId: '37', amount: 26.57, kind: 'additional' },
  ];
  const options = { includeAdditions: true, clampFluxRatio: true };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays silent without the flag', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    solveForStullTarget(REPORTED, materials, { x: 4.2, y: 0.82 }, options);
    feasibleAreas(REPORTED, materials, options);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs one line per scan and per single solve, not one per sampled cell', () => {
    vi.stubGlobal('localStorage', { getItem: () => '1' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    solveForStullTarget(REPORTED, materials, { x: 4.2, y: 0.82 }, options);
    feasibleAreas(REPORTED, materials, options);
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([
      '[glaze-calc solve]',
      '[glaze-calc region]',
    ]);

    // The scan's own solves — one per cell — stay quiet, and a repeat scan
    // reports the cache hit instead of re-solving.
    feasibleAreas(REPORTED, materials, options);
    expect(spy).toHaveBeenCalledTimes(3);
    const repeat = spy.mock.calls[2]?.[1];
    const cachedFlag =
      typeof repeat === 'object' && repeat !== null && 'cached' in repeat ? repeat.cached : undefined;
    expect(cachedFlag).toBe(true);
  });
});
