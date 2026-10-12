import {
  STULL_Q_LINE,
  STULL_REGION_LABELS,
  STULL_REGIONS,
  STULL_DOMAIN,
  STULL_VIEWPORT,
  type Pt,
} from './stull-data';
import { t, type Lang } from '../i18n';

export type Rect = { x: number; y: number; width: number; height: number };

export type Viewport = {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
};

export type Domain = { x: readonly [number, number]; y: readonly [number, number] };

export type Label = {
  text: string;
  x: number;
  y: number;
  opacity: number;
  /** Degrees clockwise about (x, y). Used for the vertical axis title. */
  rotate?: number;
};

/** Pixels a y tick's text is drawn below the row it names: the baseline sits on
 *  that row, so the glyphs need the offset to look centred on the grid line.
 *  Only the label takes it — a grid line drawn with it sits 4px off its data. */
export const Y_TICK_LABEL_NUDGE = 4;

export type StullAxes = {
  /** One label per grid line: `x`/`y` is the exact column or row the grid line
   *  is drawn on, and y labels are drawn Y_TICK_LABEL_NUDGE lower so their
   *  baseline centres on that row. */
  xTicks: Label[];
  yTicks: Label[];
  xTitle: Label;
  yTitle: Label;
};

export type StullModel = {
  readonly viewport: Viewport;
  readonly domain: Domain;
  readonly plot: Rect;

  /** Surface regions and the Q-line, projected into screen space by the same
   *  transform as the ticks, so their edges land on the numbers they read against. */
  readonly regions: { fill: string; hatch: boolean; points: Pt[] }[];
  readonly qLine: Pt[];
  readonly regionLabels: Label[];
  readonly axes: StullAxes;
  /** Sampled zones in screen space: what a drag accepts, and the band that
   *  would empty a row. Empty arrays mean neither is drawn. */
  readonly areas: { draggable: Pt[][]; emptied: Pt[][] };
  readonly point: Pt | null;
  readonly aria: string;
};

export type StullModelInput = {
  lang: Lang;
  /** Base-glaze unity SiO₂ / Al₂O₃, domain coordinates. */
  point: Pt | null;
  /** Domain-space zones from `feasibleAreas()`; absent means nothing to draw. */
  areas?: { draggable: Pt[][]; emptied: Pt[][] };
  viewport?: Viewport;
  /** Visible domain window while zoomed; `null`/absent means the full
   *  `STULL_DOMAIN`. */
  domain?: Domain | null;
};

export type StullTransform = {
  plot: Rect;
  toScreen: (p: Pt) => Pt;
  toDomain: (p: Pt) => Pt;
};

/** Grid steps from the segerlab chart: a line every 0.6 SiO₂ × 0.1 Al₂O₃. */
export const STULL_TICK_STEP_X = 0.6;
export const STULL_TICK_STEP_Y = 0.1;
export const STULL_NUDGE_X = 0.25;
export const STULL_NUDGE_Y = 0.05;
/** Ctrl + drag (or Ctrl + arrow) pulls the target onto this grid. */
export const STULL_SNAP_X = 0.1;
export const STULL_SNAP_Y = 0.01;

/** `value` pulled onto the nearest multiple of `step`, float noise trimmed. */
export function snapTo(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6));
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Grid values from `min` to `max` inclusive, rounded to kill float drift. */
export function domainTicks(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) values.push(round(Number(v.toFixed(6))));
  return values;
}

/** Grid numbers print bare: `1` not `1.0`, `0.25` not `0.250` — enough
 *  precision for the zoomed-in steps, no trailing zeros. */
function tickText(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Keeps roughly 4–12 grid lines however far the map is zoomed: halves the
 *  base step while the visible span would show fewer than four lines. */
function zoomedTickStep(base: number, span: number): number {
  let step = base;
  while (span / step < 4 && step > span / 64) step /= 2;
  return step;
}

/** Ticks at multiples of `step` inside (min, max): a zoomed window starts
 *  wherever the point was, so edge-anchored ticks would print ragged labels
 *  like 3.696 instead of landing on round numbers — and, like the segerlab
 *  chart's calcTicks, the exact window edges are left to the frame. */
function snappedTicks(min: number, max: number, step: number): number[] {
  const first = Math.ceil(min / step - 1e-9) * step;
  return domainTicks(first, max, step).filter((value) => value > min + 1e-9 && value < max - 1e-9);
}

/** Screen rectangle of the map box, i.e. the viewport minus its margins. */
export function plotRect(viewport: Viewport): Rect {
  return {
    x: viewport.margin.left,
    y: viewport.margin.top,
    width: viewport.width - viewport.margin.left - viewport.margin.right,
    height: viewport.height - viewport.margin.top - viewport.margin.bottom,
  };
}

/** Domain ↔ screen mapping. Both directions clamp to the map box, so a point
 *  can never escape the chart. */
export function createStullTransform(
  viewport: Viewport = STULL_VIEWPORT,
  domain: Domain = STULL_DOMAIN,
): StullTransform {
  const plot = plotRect(viewport);
  const [x0, x1] = domain.x;
  const [y0, y1] = domain.y;
  return {
    plot,
    toScreen: (p) => ({
      x: round(plot.x + ((clamp(p.x, x0, x1) - x0) / (x1 - x0)) * plot.width),
      y: round(plot.y + plot.height - ((clamp(p.y, y0, y1) - y0) / (y1 - y0)) * plot.height),
    }),
    toDomain: (p) => ({
      x: round(clamp(x0 + ((clamp(p.x, plot.x, plot.x + plot.width) - plot.x) / plot.width) * (x1 - x0), x0, x1)),
      y: round(
        clamp(
          y0 + ((plot.y + plot.height - clamp(p.y, plot.y, plot.y + plot.height)) / plot.height) * (y1 - y0),
          y0,
          y1,
        ),
      ),
    }),
  };
}

/**
 * Client pixels → viewBox units, for an `<svg>` that CSS has scaled to fit its
 * column. `rect` is that element's `getBoundingClientRect()`.
 *
 * `.chart svg` caps the SVG at 100% of its box and lets the height follow, so it
 * is normally rendered *smaller* than its viewBox and a client pixel is worth
 * more than one viewBox unit — the factor has to multiply. Dividing here instead
 * pulls every dragged point back towards the origin by the shrink ratio: exact
 * while the chart renders at its intrinsic width, visibly offset the moment the
 * column is any narrower.
 */
export function clientToViewBox(
  client: Pt,
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): Pt {
  const scaleX = rect.width > 0 ? viewport.width / rect.width : 1;
  const scaleY = rect.height > 0 ? viewport.height / rect.height : 1;
  return {
    x: round((client.x - rect.left) * scaleX),
    y: round((client.y - rect.top) * scaleY),
  };
}

/** Everything the renderers paint, in domain order — no DOM, no d3, no Plotly. */
export function buildStullModel(input: StullModelInput): StullModel {
  const viewport = input.viewport ?? STULL_VIEWPORT;
  const domain = input.domain ?? STULL_DOMAIN;
  const transform = createStullTransform(viewport, domain);
  const plot = transform.plot;
  /** The same mapping without the transform's clamp — overlay geometry may
   *  reach past the visible window; the renderer clips it, so crossing edges
   *  stay straight instead of folding onto the frame. */
  const projectRaw = (points: readonly Pt[]): Pt[] =>
    points.map((p) => ({
      x: round(plot.x + ((p.x - domain.x[0]) / (domain.x[1] - domain.x[0])) * plot.width),
      y: round(
        plot.y + plot.height - ((p.y - domain.y[0]) / (domain.y[1] - domain.y[0])) * plot.height,
      ),
    }));
  const point = input.point ? transform.toScreen(input.point) : null;
  const regions = STULL_REGIONS.map((region) => ({
    fill: region.fill,
    hatch: region.hatch === true,
    points: projectRaw(region.points),
  }));
  const qLine = projectRaw(STULL_Q_LINE);
  // Labels whose anchor falls outside the window are dropped, not clamped:
  // a name pinned to the border would claim a position it does not have.
  const regionLabels = STULL_REGION_LABELS.filter(
    (label) =>
      label.at.x >= domain.x[0] &&
      label.at.x <= domain.x[1] &&
      label.at.y >= domain.y[0] &&
      label.at.y <= domain.y[1],
  ).map((label) => ({
    text: label.text,
    ...transform.toScreen(label.at),
    // Legacy used 0.6 over pale grey fills; the raster colours are saturated,
    // so the names need more ink to stay readable on them.
    opacity: 0.85,
  }));

  return {
    viewport,
    domain,
    plot,
    regions,
    qLine,
    regionLabels,
    axes: {
      // Tick numbers sit just outside the frame, matching the grid they label.
      xTicks: snappedTicks(domain.x[0], domain.x[1], zoomedTickStep(STULL_TICK_STEP_X, domain.x[1] - domain.x[0])).map((value) => ({
        text: tickText(value),
        x: transform.toScreen({ x: value, y: 0 }).x,
        y: plot.y + plot.height + 14,
        opacity: 0.7,
      })),
      yTicks: snappedTicks(domain.y[0], domain.y[1], zoomedTickStep(STULL_TICK_STEP_Y, domain.y[1] - domain.y[0])).map((value) => ({
        text: tickText(value),
        x: plot.x - 7,
        y: transform.toScreen({ x: 0, y: value }).y,
        opacity: 0.7,
      })),
      xTitle: { text: t(input.lang, 'stull.axisX'), x: plot.x + plot.width, y: plot.y + plot.height + 33, opacity: 1 },
      yTitle: {
        text: t(input.lang, 'stull.axisY'),
        x: 13,
        y: plot.y + plot.height / 2,
        opacity: 1,
        rotate: -90,
      },
    },
    areas: {
      draggable: (input.areas?.draggable ?? []).map((ring) => projectRaw(ring)),
      emptied: (input.areas?.emptied ?? []).map((ring) => projectRaw(ring)),
    },
    point,
    aria: t(input.lang, 'stull.aria'),
  };
}