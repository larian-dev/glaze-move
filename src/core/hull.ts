import type { Material, RecipeRow } from '../types';
import { debugLog } from '../debug';
import { solveForStullTarget, type SolveOptions } from './solve';
import type { MaterialChemistry } from './geometry';

export const FEASIBLE_GRID_STEP_X = 0.2;
export const FEASIBLE_GRID_STEP_Y = 0.05;

export const STULL_BOX = { minX: 0, maxX: 9, minY: 0, maxY: 1 };

export type Point = { x: number; y: number };

/** A closed ring of points; the first point is not repeated at the end. */
export type Outline = Point[];

export type FeasibleAreas = {
  /** Where a drag lands: the solve fits the target and no movable row empties. */
  draggable: Outline[];
  /** The band just outside it: the solve fits only by clamping a movable row
   *  onto zero, so the page refuses the drag and names the material. */
  emptied: Outline[];
};

/** Boundary smoothing: about a fifth of the x sample step, well under the y one. */
const OUTLINE_TOLERANCE = 0.04;

function gridValues(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) values.push(Number(v.toFixed(6)));
  return values;
}

/** Sampled cells that hold a mark — what the region log counts. */
function countCells(cells: boolean[][]): number {
  return cells.reduce((sum, column) => sum + column.filter(Boolean).length, 0);
}

/** The solve options a zone scan varies — the same switches the drag commits
 *  through, minus the per-scan chemistry cache. */
type ZoneOptions = Pick<
  SolveOptions,
  'includeAdditions' | 'clampFluxRatio' | 'additionClamp' | 'clampBoron'
>;

function regionKey(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  options: ZoneOptions,
): string {
  const rowsKey = rows
    .map((row) => `${row.kind}:${row.materialId}:${row.amount}`)
    .join('|');
  // The solve reads a material only through its oxide components, so the cache
  // must notice a composition change — a price or rename it may ignore.
  const ids = new Set(rows.map((row) => row.materialId));
  const materialsKey = [...ids]
    .map((id) => {
      const material = materials.get(id);
      if (!material) return `${id}:?`;
      return `${id}:${material.components.map((c) => `${c.oxide}=${c.amount}`).join(',')}`;
    })
    .join('|');
  // The options decide what the solve freezes, the ratio it must hold and the
  // boron it must hold, so all of them decide the region too.
  return `${rowsKey}#${materialsKey}#adds:${options.includeAdditions === true}#clamp:${
    options.clampFluxRatio === true
  }#addClamp:${options.additionClamp ?? 'amount'}#boron:${options.clampBoron === true ? 1 : 0}`;
}

/**
 * Row indices the solve can move: a main row that does not already start at zero.
 * A main row sitting at zero is not a candidate, keeps its zero whatever the
 * target, and so must not be counted as one the region emptied.
 */
function movableRows(rows: RecipeRow[]): Set<number> {
  return new Set(rows.flatMap((row, index) => (row.kind === 'main' && row.amount !== 0 ? [index] : [])));
}

function perpendicularDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length;
}

/** Douglas–Peucker on a closed ring, so a staircase of sample steps reads as the
 *  boundary it approximates instead of forty-five right angles. */
function simplifyRing(ring: Outline): Outline {
  if (ring.length <= 4) return ring;
  const points = [...ring, ring[0]!];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length > 0) {
    const range = pending.pop();
    if (!range) continue;
    const [first, last] = range;
    const from = points[first];
    const to = points[last];
    if (!from || !to) continue;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const point = points[i];
      if (!point) continue;
      const distance = perpendicularDistance(point, from, to);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index > 0 && worst > OUTLINE_TOLERANCE) {
      keep[index] = true;
      pending.push([first, index], [index, last]);
    }
  }

  const simplified = points.filter((_, index) => keep[index]);
  simplified.pop();
  return simplified;
}

/** Walks the boundary edges of a cell grid into closed rings — one per connected
 *  piece of the set, plus one per hole, which even-odd filling then treats as a
 *  hole. Cells are `[x][y]`, one sample step each. */
function traceRings(cells: boolean[][], xs: number[], ys: number[]): Outline[] {
  const columns = cells.length;
  const rowCount = cells[0]?.length ?? 0;
  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < columns && y < rowCount && cells[x]?.[y] === true;
  const keyOf = (corner: [number, number]): string => `${corner[0]},${corner[1]}`;

  /** Boundary edges by starting corner, walked counter-clockwise in the set. */
  const outgoing = new Map<string, [number, number][]>();
  const addEdge = (from: [number, number], to: [number, number]): void => {
    const list = outgoing.get(keyOf(from));
    if (list) list.push(to);
    else outgoing.set(keyOf(from), [to]);
  };

  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rowCount; y += 1) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge([x, y], [x + 1, y]);
      if (!filled(x + 1, y)) addEdge([x + 1, y], [x + 1, y + 1]);
      if (!filled(x, y + 1)) addEdge([x + 1, y + 1], [x, y + 1]);
      if (!filled(x - 1, y)) addEdge([x, y + 1], [x, y]);
    }
  }

  const rings: Outline[] = [];
  const stepLimit = 4 * columns * rowCount + 8;
  for (const [startKey, edges] of outgoing) {
    while (edges.length > 0) {
      const first = edges.pop();
      if (!first) break;
      const ring: Outline = [];
      let corner = first;
      let closed = false;
      for (let step = 0; step < stepLimit; step += 1) {
        const next = outgoing.get(keyOf(corner))?.pop();
        if (!next) break;
        ring.push({ x: xs[corner[0]] ?? 0, y: ys[corner[1]] ?? 0 });
        corner = next;
        if (keyOf(corner) === startKey) {
          closed = true;
          break;
        }
      }
      if (closed && ring.length >= 4) rings.push(simplifyRing(ring));
    }
  }
  return rings;
}

let cachedKey: string | null = null;
let cachedAreas: FeasibleAreas = { draggable: [], emptied: [] };

/**
 * The two zones the Stull map draws, sampled one solve per grid cell and
 * memoised on the recipe rows, the oxide composition of the materials they
 * reference, and the solve options.
 *
 * `draggable` is what a drag accepts. `emptied` is the band just outside it:
 * targets the solve reaches only by clamping a carrier onto zero, which the page
 * refuses with a notice naming that material. Both are traced from the cells
 * themselves — a region that is thin, curved or non-convex draws as itself,
 * where a convex hull around it would either hide it or claim refused targets.
 */
export function feasibleAreas(
  rows: RecipeRow[],
  materials: Map<string, Material>,
  options: ZoneOptions = {},
): FeasibleAreas {
  const key = regionKey(rows, materials, options);
  if (key === cachedKey) {
    debugLog('region', { key, cached: true });
    return cachedAreas;
  }

  const xs = gridValues(STULL_BOX.minX, STULL_BOX.maxX, FEASIBLE_GRID_STEP_X);
  const ys = gridValues(STULL_BOX.minY, STULL_BOX.maxY, FEASIBLE_GRID_STEP_Y);
  const columns = Math.max(0, xs.length - 1);
  const rowCount = Math.max(0, ys.length - 1);
  const movable = movableRows(rows);

  const draggableCells: boolean[][] = Array.from({ length: columns }, () =>
    new Array<boolean>(rowCount).fill(false),
  );
  const emptiedCells: boolean[][] = Array.from({ length: columns }, () =>
    new Array<boolean>(rowCount).fill(false),
  );

  // One chemistry derivation per material for the whole scan: the 900 sampled
  // targets read the same coefficients, and the cache dies with the scan, so
  // an in-place edit elsewhere can never serve a stale entry.
  const chemistry = new Map<Material, MaterialChemistry>();

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      // Cell centres: the cells tile the map box, so a fully reachable recipe
      // draws right up to its edges.
      const x = ((xs[column] ?? 0) + (xs[column + 1] ?? 0)) / 2;
      const y = ((ys[row] ?? 0) + (ys[row + 1] ?? 0)) / 2;
      const result = solveForStullTarget(rows, materials, { x, y }, { ...options, chemistry });
      if (!result.ok) continue;
      const emptied = result.rows.some((solved, index) => movable.has(index) && solved.amount <= 0);
      if (emptied) emptiedCells[column]![row] = true;
      else draggableCells[column]![row] = true;
    }
  }

  const areas: FeasibleAreas = {
    draggable: traceRings(draggableCells, xs, ys),
    emptied: traceRings(emptiedCells, xs, ys),
  };
  cachedKey = key;
  cachedAreas = areas;
  debugLog('region', {
    key,
    cached: false,
    draggable: countCells(draggableCells),
    emptied: countCells(emptiedCells),
    rings: `${areas.draggable.length}/${areas.emptied.length}`,
  });
  return areas;
}
