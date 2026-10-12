import { TRIAXIAL_RO_FLUXES, type Pt, type TriaxialRo } from './stull-data';
import { ternaryToXY, unityToTernary, type TernaryPoint, type TernaryVertices } from './ternary';
import { t, type Lang } from '../i18n';
import { plotRect, type Label, type Rect, type Viewport } from './stull-chart';

export type TriaxialModel = {
  readonly viewport: Viewport;
  readonly roFlux: TriaxialRo;
  readonly backdrop: string;
  readonly vertices: TernaryVertices;
  readonly edge: Pt[];
  /** Selected RO over (K₂O + Na₂O), two small lines at the left. Null when
   *  the recipe has no point to report on. */
  readonly fluxRatio: Label[] | null;
  readonly point: Pt | null;
  readonly aria: string;
};

export type TriaxialModelInput = {
  lang: Lang;
  roFlux: TriaxialRo;
  /** Unity SiO₂ / Al₂O₃ / RO of the whole batch, normalized internally. */
  unity: { sio2: number; al2o3: number; ro: number } | null;
  /** Unity K₂O + Na₂O of the same batch, the denominator of the flux ratio. */
  alkaliMoles: number;
  viewport?: Viewport;
  /** Per-flux screen vertices from `triaxial-calibration.ts`; absent falls back
   *  to `idealTriaxialVertices()`, the same symmetric triangle the calibration
   *  page starts from. */
  vertices?: TernaryVertices;
};

export const TRIAXIAL_VIEWPORT: Viewport = {
  width: 520,
  height: 460,
  margin: { top: 24, right: 20, bottom: 34, left: 34 },
};

/**
 * The triangle used when a flux has no calibration at all: a symmetric
 * three-corner layout in the plot box — top-centre apex, bottom corners. Shared
 * with the calibration page, which starts from exactly these corners.
 */
export function idealTriaxialVertices(viewport: Viewport = TRIAXIAL_VIEWPORT): TernaryVertices {
  const plot = plotRect(viewport);
  return {
    a: { x: plot.x + plot.width / 2, y: plot.y },
    b: { x: plot.x + plot.width, y: plot.y + plot.height },
    c: { x: plot.x, y: plot.y + plot.height },
  };
}

/** Baseline distance between the two flux-ratio lines, ~ the 11px label size. */
const RATIO_LINE_GAP = 13;

/**
 * The eight charted RO fluxes this recipe actually contains, in canonical chart
 * order. Backgrounds for absent oxides would only offer a corner the point can
 * never sit in, so they are not offered at all.
 */
export function presentRoFluxes(moles: Map<string, number>): TriaxialRo[] {
  return TRIAXIAL_RO_FLUXES.filter((ro) => (moles.get(ro) ?? 0) > 0);
}

/**
 * The stored corner while it is still available, otherwise the most abundant
 * one in the recipe. `null` when the recipe holds no charted RO at all.
 */
export function resolveRoFlux(
  stored: unknown,
  moles: Map<string, number>,
  present: readonly TriaxialRo[],
): TriaxialRo | null {
  if (present.length === 0) return null;
  const known = TRIAXIAL_RO_FLUXES as readonly string[];
  if (typeof stored === 'string' && known.includes(stored) && present.includes(stored as TriaxialRo)) {
    return stored as TriaxialRo;
  }
  return present.reduce((best, ro) => ((moles.get(ro) ?? 0) > (moles.get(best) ?? 0) ? ro : best));
}

export const TRIAXIAL_BACKGROUNDS: Record<TriaxialRo, string> = {
  CaO: new URL('../assets/cao-triaxial.webp', import.meta.url).href,
  MgO: new URL('../assets/mgo-triaxial.webp', import.meta.url).href,
  SrO: new URL('../assets/sro-triaxial.webp', import.meta.url).href,
  ZnO: new URL('../assets/zno-triaxial.webp', import.meta.url).href,
  BaO: new URL('../assets/bao-triaxial.webp', import.meta.url).href,
  MnO: new URL('../assets/mno-triaxial.webp', import.meta.url).href,
  FeO: new URL('../assets/feo-triaxial.webp', import.meta.url).href,
  Fe2O3: new URL('../assets/fe2o3-triaxial.webp', import.meta.url).href,
};

/**
 * Two small lines in the empty left margin: the alkali basis, then the selected
 * flux's own unity value. The block's baseline sits a third of the plot height
 * above the vertical middle, clear of the triangle and the plotted point.
 */
export function fluxRatioLines(
  plot: Rect,
  flux: TriaxialRo,
  alkaliMoles: number,
  fluxMoles: number,
): Label[] {
  const baseline = plot.y + plot.height / 2 - plot.height / 3;
  const line = (text: string, offset: number): Label => ({
    text,
    x: plot.x + 4,
    y: baseline + offset,
    opacity: 0.7,
  });
  return [
    line(`KNaO = ${alkaliMoles.toFixed(2)}`, 0),
    line(`${flux} = ${fluxMoles.toFixed(2)}`, RATIO_LINE_GAP),
  ];
}

const warmed = new Set<string>();
/** In-flight preload images, kept referenced until the fetch settles. */
const inFlight = new Set<HTMLImageElement>();

/**
 * Warms the browser cache for one backdrop.
 *
 * Switching maps re-creates the SVG `<image>` element, and a fetch still in
 * flight is cancelled along with the element that owns it — switching again
 * before it lands cancels that one too, leaving the chart with no background at
 * all. Decoding the maps the recipe can actually reach up front turns every
 * switch into a cache hit. The `Image` never joins the document, but it is held
 * in `inFlight` until it loads or errors so nothing can collect it mid-fetch.
 */
export function preloadBackdrop(ro: TriaxialRo): void {
  const href = TRIAXIAL_BACKGROUNDS[ro];
  if (warmed.has(href)) return;
  warmed.add(href);
  const image = new Image();
  inFlight.add(image);
  const settle = (): void => {
    inFlight.delete(image);
  };
  image.addEventListener('load', settle, { once: true });
  image.addEventListener('error', () => {
    settle();
    warmed.delete(href);
  }, { once: true });
  image.src = href;
}

/** Screen geometry of the ternary triangle and the plotted point. */
export function buildTriaxialModel(input: TriaxialModelInput): TriaxialModel {
  const viewport = input.viewport ?? TRIAXIAL_VIEWPORT;
  const plot = plotRect(viewport);
  const vertices = input.vertices ?? idealTriaxialVertices(viewport);
  const project = (p: TernaryPoint) => ternaryToXY(p, vertices);

  const unity = input.unity;
  const point = unity ? project(unityToTernary(unity.sio2, unity.al2o3, unity.ro)) : null;

  // Alkali basis and the selected flux's unity value, parked in the empty left
  // margin so they never sit on the triangle or the plotted point.
  const fluxRatio = unity ? fluxRatioLines(plot, input.roFlux, input.alkaliMoles, unity.ro) : null;

  return {
    viewport,
    roFlux: input.roFlux,
    backdrop: TRIAXIAL_BACKGROUNDS[input.roFlux],
    vertices,
    edge: [vertices.a, vertices.b, vertices.c],
    fluxRatio,
    point,
    aria: t(input.lang, 'triaxial.aria'),
  };
}