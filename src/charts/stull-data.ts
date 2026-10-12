export type Pt = { x: number; y: number };

/** A piece of chart text placed at a domain point; also used by the boron map. */
export type ChartLabel = {
  text: string;
  at: Pt;
};

/** A named Stull surface region as a domain-space polygon. `hatch` lays the
 *  diagonal-hatch pattern the renderer defines over the shape; `fill` paints
 *  beneath it (`'none'` for a bare hatch). */
export type StullRegion = {
  fill: string;
  hatch?: boolean;
  points: Pt[];
};

/**
 * The Stull surface regions as plain domain coordinates, verbatim from the
 * legacy chart's polygons (`resources/js/stull-chart-d3.js`, archived locally,
 * not in the repo); labels and the
 * Q-line come from the same file. The map projects them through the same
 * transform as its ticks, so every edge lands on the axis number it is read
 * against. Fills keep the raster-sampled palette: purple fields hatched, teal
 * bands solid, crazed bare plus hatch.
 */
export const STULL_REGIONS: readonly StullRegion[] = [
  { fill: '#a86fa6', hatch: true, points: [{ x: 0.6, y: 0.42 }, { x: 0.6, y: 1 }, { x: 2.8, y: 1 }] },
  { fill: '#11b9d3', points: [{ x: 0.6, y: 0.08 }, { x: 0.6, y: 0.42 }, { x: 2.8, y: 1 }, { x: 4, y: 1 }] },
  { fill: '#7fcbc6', points: [{ x: 1.2, y: 0.242 }, { x: 4, y: 1 }, { x: 5, y: 1 }] },
  { fill: '#8772b0', hatch: true, points: [{ x: 2.4, y: 0.08 }, { x: 7.2, y: 0.65 }, { x: 7.2, y: 0.08 }] },
  {
    fill: 'none',
    hatch: true,
    points: [
      { x: 0.6, y: 0.08 }, { x: 0.6, y: 1 }, { x: 1.67, y: 1 }, { x: 2.1, y: 0.5 },
      { x: 2.38, y: 0.25 }, { x: 2.7, y: 0.23 }, { x: 3.3, y: 0.25 }, { x: 3.9, y: 0.28 },
      { x: 4.2, y: 0.29 }, { x: 5.4, y: 0.49 }, { x: 7.2, y: 0.615 }, { x: 7.2, y: 0.08 },
    ],
  },
];

/** The dashed Q-line, drawn linearly. Its last leg keeps the (6,0.8)→(7.2,0.92)
 *  heading only until it meets the top of the chart, so it closes at the
 *  top-right corner instead of shooting past the axis. */
export const STULL_Q_LINE: readonly Pt[] = [
  { x: 1.8, y: 0.2 },
  { x: 4.2, y: 0.6 },
  { x: 6, y: 0.8 },
  { x: 7.2, y: 0.92 },
  { x: 9, y: 1 },
];

/** Region names as domain anchors, from the legacy chart (baseline at `at`). */
export const STULL_REGION_LABELS: readonly ChartLabel[] = [
  { text: 'UNFUSED', at: { x: 1.85, y: 0.96 } },
  { text: 'MATTE', at: { x: 3.1, y: 0.96 } },
  { text: 'SEMI-MATTE', at: { x: 4.02, y: 0.96 } },
  { text: 'CRAZED', at: { x: 1.9, y: 0.14 } },
  { text: 'UNDER-FIRED', at: { x: 4.3, y: 0.21 } },
];

export const STULL_DOMAIN = { x: [0, 9], y: [0, 1] } as const;

export const STULL_VIEWPORT = {
  width: 750,
  height: 500,
  // Left/bottom margins leave room for the tick numbers and the axis titles.
  margin: { top: 20, right: 20, bottom: 40, left: 46 },
} as const;

export const TRIAXIAL_RO_FLUXES = [
  'CaO',
  'MgO',
  'SrO',
  'ZnO',
  'BaO',
  'MnO',
  'FeO',
  'Fe2O3',
] as const;

export type TriaxialRo = (typeof TRIAXIAL_RO_FLUXES)[number];