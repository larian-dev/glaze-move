import { t, type Lang } from '../i18n';
import {
  createStullTransform,
  domainTicks,
  type Domain,
  type Label,
  type Rect,
  type StullAxes,
  type Viewport,
} from './stull-chart';
import type { ChartLabel, Pt } from './stull-data';

/**
 * The colour field of the boron map, exported from Excel as
 * `resources/Chart1.crtx` and lifted out of it unchanged
 * (`chart/media/image2.jpg`; the .crtx source is archived locally, not in the
 * repo). Excel filled the plot area with it as a stretched
 * blip fill, so the renderer must stretch it too — see `adapter-d3.ts`.
 */
export const BORON_BACKDROP = new URL('../assets/b2o3-temperature.webp', import.meta.url).href;

/** Unity B₂O₃ per one mole of flux against the calculated firing temperature.
 *  The y extent is the cone axis itself: Δ06 at the bottom, Δ10 at the top. */
export const BORON_DOMAIN = { x: [0, 0.5], y: [998, 1285] } as const;

export const BORON_VIEWPORT: Viewport = {
  width: 520,
  height: 460,
  // The left margin holds the six cone ticks, clear of the rotated title.
  margin: { top: 24, right: 20, bottom: 40, left: 90 },
};

export const BORON_TICK_STEP_X = 0.05;

/**
 * The y-axis points of the source chart, bottom first — the only y-axis labels
 * in the chart1 data: `chart/drawings/drawing1.xml` stacks Δ10…Δ06 evenly in a
 * left-margin text box, while `chart.xml` deletes Excel's own tick labels
 * (`tickLblPos="none"`, no majorUnit, no numeric points anywhere). The stack is
 * evenly spaced although the cone equivalents are not (65/39/40/80/63 °C apart),
 * so the published axis is cone-stepped, not linear in degrees. °C are the
 * standard 60 °C/hr Edward Orton Jr. Foundation temperature equivalents.
 */
const BORON_CONE_AXIS: readonly { cone: string; celsius: number }[] = [
  { cone: '06', celsius: 998 },
  { cone: '04', celsius: 1063 },
  { cone: '02', celsius: 1102 },
  { cone: '2', celsius: 1142 },
  { cone: '6', celsius: 1222 },
  { cone: '10', celsius: 1285 },
];

/** Fraction of the plot height above the bottom for a firing temperature: the
 *  six cone points sit at equal steps; degrees interpolate between neighbouring
 *  points, so the axis stays monotone but is not linear in °C. Outside the
 *  labelled range the fraction clamps to the frame, like the other maps. */
function coneFraction(celsius: number): number {
  const steps = BORON_CONE_AXIS.length - 1;
  if (celsius <= BORON_CONE_AXIS[0]!.celsius) return 0;
  if (celsius >= BORON_CONE_AXIS[steps]!.celsius) return 1;
  for (let i = 0; i < steps; i += 1) {
    const a = BORON_CONE_AXIS[i]!;
    const b = BORON_CONE_AXIS[i + 1]!;
    if (celsius <= b.celsius) {
      return (i + (celsius - a.celsius) / (b.celsius - a.celsius)) / steps;
    }
  }
  return 1;
}

/**
 * The three text boxes of the Excel chart, re-expressed in domain space and
 * kept in English like the Stull region names — they name regions of the
 * published map, not parts of the interface.
 */
export const BORON_ANNOTATIONS: ChartLabel[] = [
  { text: 'Good', at: { x: 0.09, y: 1285 } },
  { text: 'Too Much', at: { x: 0.44, y: 1285 } },
  { text: 'Too Little', at: { x: 0.09, y: 1045 } },
];

export type BoronModel = {
  readonly viewport: Viewport;
  readonly domain: Domain;
  readonly plot: Rect;
  readonly backdrop: string;
  readonly axes: StullAxes;
  readonly annotations: Label[];
  readonly point: Pt | null;
  readonly aria: string;
};

export type BoronModelInput = {
  lang: Lang;
  /** Unity B₂O₃ of the batch. Not positive leaves the map without a point. */
  b2o3: number;
  /** Calculated firing temperature in °C; null leaves the map without a point. */
  celsius: number | null;
  viewport?: Viewport;
};

/** Screen geometry of the map box, its backdrop, its ticks and the point. */
export function buildBoronModel(input: BoronModelInput): BoronModel {
  const viewport = input.viewport ?? BORON_VIEWPORT;
  // `createStullTransform` is the generic domain ↔ box mapping, not Stull-specific.
  const transform = createStullTransform(viewport, BORON_DOMAIN);
  const plot = transform.plot;

  const axes: StullAxes = {
    xTicks: domainTicks(BORON_DOMAIN.x[0], BORON_DOMAIN.x[1], BORON_TICK_STEP_X).map((value) => ({
      text: value.toFixed(2),
      x: transform.toScreen({ x: value, y: 0 }).x,
      y: plot.y + plot.height + 14,
      opacity: 0.7,
    })),
    yTicks: BORON_CONE_AXIS.map((entry) => ({
      text: `Δ${entry.cone}`,
      x: plot.x - 7,
      // The exact row of the cone; the label's 4px baseline offset is applied
      // where the text is drawn, so the grid line stays on the row.
      y: plot.y + plot.height * (1 - coneFraction(entry.celsius)),
      opacity: 0.7,
    })),
    xTitle: { text: t(input.lang, 'boron.axisX'), x: plot.x + plot.width, y: plot.y + plot.height + 33, opacity: 1 },
    yTitle: {
      text: t(input.lang, 'boron.axisY'),
      x: 13,
      y: plot.y + plot.height / 2,
      opacity: 1,
      rotate: -90,
    },
  };

  const point =
    input.b2o3 > 0 && input.celsius !== null && Number.isFinite(input.celsius)
      ? { x: input.b2o3, y: input.celsius }
      : null;

  return {
    viewport,
    domain: BORON_DOMAIN,
    plot,
    backdrop: BORON_BACKDROP,
    axes,
    annotations: BORON_ANNOTATIONS.map((label) => ({
      text: label.text,
      x: transform.toScreen(label.at).x,
      y: plot.y + plot.height * (1 - coneFraction(label.at.y)),
      opacity: 0.95,
    })),
    // Values outside the published map are pinned to its edge, as on the Stull
    // map; the exact figures are printed next to the chart instead.
    point: point
      ? {
          x: transform.toScreen(point).x,
          y: plot.y + plot.height * (1 - coneFraction(point.y)),
        }
      : null,
    aria: t(input.lang, 'boron.aria'),
  };
}