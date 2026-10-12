import { TRIAXIAL_RO_FLUXES, type Pt, type TriaxialRo } from './stull-data';
import type { TernaryVertices } from './ternary';

/**
 * Screen-space corners of the plotted triangle inside each published background
 * (`src/assets/<flux>-triaxial.webp`; the source PNGs stay in the local
 * `resources/` archive, not in the repo), in TRIAXIAL_VIEWPORT coordinates:
 *   a = SiO₂ apex, b = Al₂O₃ corner, c = RO corner.
 *
 * Those coordinates assume the raster fills the 520×460 viewport exactly — i.e.
 * it is stretched independently in x and y, as the calibration page's
 * `width/height: 100%` image and the chart's `preserveAspectRatio="none"`
 * both do. The sources are ~1285×1080, so that stretch is not uniform (~5%
 * taller than wide); letting either side letterbox or fit-scale the PNG
 * instead would shift these corners off the printed diagram.
 *
 * Source-of-truth defaults for committing measured values. Interactive edits are
 * stored separately in localStorage under `glaze-calc.triaxialCalibration` and
 * take precedence via `calibrationFor`. An absent entry everywhere falls back to
 * the ideal box built from the chart viewport, which is what
 * `buildTriaxialModel` uses when no override is given.
 */
export const TRIAXIAL_CALIBRATION: Partial<Record<TriaxialRo, TernaryVertices>> = {
  CaO: { a: { x: 260, y: 37 }, b: { x: 476, y: 407 }, c: { x: 43, y: 407 } },
  MgO: { a: { x: 260, y: 36 }, b: { x: 477, y: 408 }, c: { x: 43, y: 408 } },
  SrO: { a: { x: 260, y: 37 }, b: { x: 477, y: 407 }, c: { x: 42, y: 408 } },
  ZnO: { a: { x: 260, y: 36 }, b: { x: 477, y: 407 }, c: { x: 43, y: 407 } },
  BaO: { a: { x: 260, y: 37 }, b: { x: 476, y: 407 }, c: { x: 43, y: 407 } },
  MnO: { a: { x: 260, y: 37 }, b: { x: 477, y: 407 }, c: { x: 43, y: 407 } },
  FeO: { a: { x: 260, y: 36 }, b: { x: 477, y: 407 }, c: { x: 42, y: 407 } },
  Fe2O3: { a: { x: 260, y: 38 }, b: { x: 477, y: 407 }, c: { x: 44, y: 407 } },
};

const STORAGE_KEY = 'glaze-calc.triaxialCalibration';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isPt(value: unknown): value is Pt {
  if (typeof value !== 'object' || value === null) return false;
  const pt = value as Record<string, unknown>;
  return typeof pt.x === 'number' && Number.isFinite(pt.x) && typeof pt.y === 'number' && Number.isFinite(pt.y);
}

function isVertices(value: unknown): value is TernaryVertices {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isPt(v.a) && isPt(v.b) && isPt(v.c);
}

/** Shape-checked copy of the saved corners; anything malformed is dropped. */
export function loadCalibration(): Partial<Record<TriaxialRo, TernaryVertices>> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Partial<Record<TriaxialRo, TernaryVertices>> = {};
    const known = TRIAXIAL_RO_FLUXES as readonly string[];
    for (const [key, value] of Object.entries(parsed)) {
      // Values are shape-checked; keys must be a real flux, or junk would ride
      // along on every save and never be clearable.
      if (known.includes(key) && isVertices(value)) out[key as TriaxialRo] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persists one flux's corners; best-effort like the rest of the app's storage. */
export function saveCalibration(ro: TriaxialRo, vertices: TernaryVertices): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...loadCalibration(), [ro]: vertices }));
  } catch {
    // private browsing / quota — persistence is best-effort
  }
}

/** Forgets one flux's corners (`ro` omitted: forgets all of them). */
export function clearCalibration(ro?: TriaxialRo): void {
  const store = storage();
  if (!store) return;
  try {
    if (ro === undefined) {
      store.removeItem(STORAGE_KEY);
      return;
    }
    const rest = loadCalibration();
    delete rest[ro];
    if (Object.keys(rest).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // ignore
  }
}

/**
 * Corner set the chart should use: the interactive override from localStorage
 * when valid, otherwise the committed defaults table, otherwise undefined.
 * Never throws — garbage in storage degrades to the table fallback.
 */
export function calibrationFor(ro: TriaxialRo): TernaryVertices | undefined {
  return loadCalibration()[ro] ?? TRIAXIAL_CALIBRATION[ro];
}