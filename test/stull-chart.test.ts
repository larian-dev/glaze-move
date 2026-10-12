import { describe, expect, it } from 'vitest';
import {
  buildStullModel,
  clientToViewBox,
  createStullTransform,
  plotRect,
} from '../src/charts/stull-chart';
import { STULL_VIEWPORT } from '../src/charts/stull-data';

const EPSILON = 1e-6;

describe('client pixels → viewBox units', () => {
  const plot = plotRect(STULL_VIEWPORT);

  it('is the identity when the SVG renders at its intrinsic size', () => {
    const rect = { left: 100, top: 40, width: 750, height: 500 };
    expect(clientToViewBox({ x: 260, y: 140 }, rect, STULL_VIEWPORT)).toEqual({ x: 160, y: 100 });
  });

  it('scales up when CSS has shrunk the SVG to fit its column', () => {
    // 750px chart rendered into a 600px column: 0.8 of a viewBox unit per pixel,
    // so the cursor at the far right of the element must map to viewBox x = 750,
    // not 600 — the drag has to stay under the cursor, not lag behind it.
    const rect = { left: 100, top: 40, width: 600, height: 400 };
    expect(clientToViewBox({ x: 700, y: 440 }, rect, STULL_VIEWPORT)).toEqual({ x: 750, y: 500 });
    expect(clientToViewBox({ x: 400, y: 240 }, rect, STULL_VIEWPORT)).toEqual({ x: 375, y: 250 });
  });

  it('round-trips through the domain transform at both scales', () => {
    const transform = createStullTransform();
    const target = { x: 3.25, y: 0.42 };
    const unscaled = { left: 0, top: 0, ...STULL_VIEWPORT };
    expect(transform.toDomain(clientToViewBox(transform.toScreen(target), unscaled, STULL_VIEWPORT))).toEqual(
      target,
    );

    const shrink = 0.72;
    const scaled = {
      left: 17,
      top: 23,
      width: STULL_VIEWPORT.width * shrink,
      height: STULL_VIEWPORT.height * shrink,
    };
    const screen = transform.toScreen(target);
    const cursor = { x: scaled.left + screen.x * shrink, y: scaled.top + screen.y * shrink };
    const back = transform.toDomain(clientToViewBox(cursor, scaled, STULL_VIEWPORT));
    expect(back.x).toBeCloseTo(target.x, 6);
    expect(back.y).toBeCloseTo(target.y, 6);
  });

  it('degrades to the identity rather than dividing by a zero-width box', () => {
    const collapsed = { left: 0, top: 0, width: 0, height: 0 };
    expect(clientToViewBox({ x: 12, y: 34 }, collapsed, STULL_VIEWPORT)).toEqual({ x: 12, y: 34 });
  });

  it('leaves the plot box edges pinned however the chart is scaled', () => {
    for (const width of [750, 716, 480]) {
      const rect = { left: 30, top: 9, width, height: (width / 750) * 500 };
      const shrink = width / STULL_VIEWPORT.width;
      // Where the plot box's left and right edges land on screen at this scale.
      const leftEdge = { x: rect.left + plot.x * shrink, y: rect.top };
      const rightEdge = { x: rect.left + (plot.x + plot.width) * shrink, y: rect.top };
      expect(clientToViewBox(leftEdge, rect, STULL_VIEWPORT).x).toBeCloseTo(plot.x, 6);
      expect(clientToViewBox(rightEdge, rect, STULL_VIEWPORT).x).toBeCloseTo(plot.x + plot.width, 6);
    }
  });
});

describe('stull domain ↔ screen mapping', () => {
  const transform = createStullTransform();
  const plot = plotRect(STULL_VIEWPORT);

  it('maps the domain corners onto the plot box edges', () => {
    expect(transform.toScreen({ x: 0, y: 0.5 }).x).toBeCloseTo(plot.x, 6);
    expect(transform.toScreen({ x: 9, y: 0.5 }).x).toBeCloseTo(plot.x + plot.width, 6);
    expect(transform.toScreen({ x: 4.5, y: 0 }).y).toBeCloseTo(plot.y + plot.height, 6);
    expect(transform.toScreen({ x: 4.5, y: 1 }).y).toBeCloseTo(plot.y, 6);
  });

  it('places known domain points on exact screen pixels', () => {
    // Default viewport 750×500, margins 20/20/40/46 → plot box (46,20)–(730,460);
    // domain x ∈ [0,9], y ∈ [0,1] with y flipped.
    expect(transform.toScreen({ x: 0, y: 0 })).toEqual({ x: 46, y: 460 });
    expect(transform.toScreen({ x: 0, y: 1 })).toEqual({ x: 46, y: 20 });
    expect(transform.toScreen({ x: 9, y: 1 })).toEqual({ x: 730, y: 20 });
    expect(transform.toScreen({ x: 4.5, y: 0.5 })).toEqual({ x: 388, y: 240 });
  });

  it('clamps a point outside the domain instead of letting it escape', () => {
    const over = transform.toDomain({ x: plot.x + plot.width + 500, y: plot.y + plot.height + 500 });
    expect(over.x).toBeCloseTo(9, 6);
    expect(over.y).toBeCloseTo(0, 6);

    const model = buildStullModel({ lang: 'en', point: { x: 42, y: -3 } });
    expect(model.point).not.toBeNull();
    expect(model.point?.x).toBeCloseTo(plot.x + plot.width, 6);
    expect(model.point?.y).toBeCloseTo(plot.y + plot.height, 6);
    expect(Math.abs(model.point!.x - plot.x)).toBeGreaterThan(EPSILON);
  });
});

describe('buildStullModel axes', () => {
  const transform = createStullTransform();

  it('keeps every y tick on its exact grid row', () => {
    // Regression: the 4px offset that centres a y label's text on its row used
    // to sit on the tick itself, so every horizontal grid line was drawn 4px
    // below the row it names. The tick is the grid row; adapter-d3 adds
    // Y_TICK_LABEL_NUDGE only where it draws the label.
    const model = buildStullModel({ lang: 'en', point: null });
    expect(model.axes.yTicks.length).toBeGreaterThan(4);
    for (const tick of model.axes.yTicks) {
      expect(tick.y).toBe(transform.toScreen({ x: 0, y: Number(tick.text) }).y);
    }
    // Grid rows are data rows, not label baselines: the lowest tick (0.1 —
    // snappedTicks leaves the window edges to the frame) sits a tenth-step
    // above the frame bottom, without the extra 4px.
    const plot = plotRect(STULL_VIEWPORT);
    const ticks = model.axes.yTicks;
    expect(ticks[0]!.text).toBe('0.1');
    expect(ticks[0]!.y).toBeCloseTo(plot.y + plot.height * 0.9, 6);
    expect(ticks[ticks.length - 1]!.y).toBeCloseTo(plot.y + plot.height * 0.1, 6);
  });
});

describe('buildStullModel regions', () => {
  const model = buildStullModel({ lang: 'en', point: null });
  const plot = plotRect(STULL_VIEWPORT);

  it('draws the legacy d3 polygons, which stop short of the frame', () => {
    // resources/js/stull-chart-d3.js cuts its regions at SiO₂ 0.6 / 7.2 and
    // Al₂O₃ 0.08 — the frame background outside that span stays bare.
    expect(model.regions).toHaveLength(5);
    const xs = model.regions.flatMap((r) => r.points).map((p) => p.x);
    const ys = model.regions.flatMap((r) => r.points).map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(plot.x + (0.6 / 9) * plot.width, 6);
    expect(Math.max(...xs)).toBeCloseTo(plot.x + (7.2 / 9) * plot.width, 6);
    expect(Math.max(...ys)).toBeCloseTo(plot.y + plot.height * (1 - 0.08), 6);
    expect(Math.min(...ys)).toBeCloseTo(plot.y, 6);
    expect(model.qLine).toHaveLength(5);
  });

  it('carries the region labels from the legacy chart', () => {
    expect(model.regionLabels.map((label) => label.text)).toEqual([
      'UNFUSED',
      'MATTE',
      'SEMI-MATTE',
      'CRAZED',
      'UNDER-FIRED',
    ]);
    for (const label of model.regionLabels) {
      expect(label.x).toBeGreaterThanOrEqual(model.plot.x);
      expect(label.x).toBeLessThanOrEqual(model.plot.x + model.plot.width);
      expect(label.y).toBeGreaterThanOrEqual(model.plot.y);
      expect(label.y).toBeLessThanOrEqual(model.plot.y + model.plot.height);
    }
  });
});

describe('buildStullModel zoom window', () => {
  const window = { x: [3, 7] as const, y: [0.2, 0.6] as const };

  it('re-projects the point through the visible window', () => {
    const model = buildStullModel({ lang: 'en', point: { x: 5, y: 0.4 }, domain: window });
    const zoomed = createStullTransform(STULL_VIEWPORT, window);
    expect(model.domain).toEqual(window);
    expect(model.point).toEqual(zoomed.toScreen({ x: 5, y: 0.4 }));
    // The window centre lands on the plot centre.
    expect(model.point!.x).toBeCloseTo(46 + 684 / 2, 6);
  });

  it('refines the grid and keeps every tick inside the window', () => {
    const model = buildStullModel({
      lang: 'en',
      point: null,
      domain: { x: [4, 5], y: [0.4, 0.6] },
    });
    expect(model.axes.xTicks.map((tick) => tick.text)).toEqual([
      '4.05', '4.2', '4.35', '4.5', '4.65', '4.8', '4.95',
    ]);
    for (const tick of model.axes.yTicks) {
      const value = Number(tick.text);
      expect(value).toBeGreaterThanOrEqual(0.4);
      expect(value).toBeLessThanOrEqual(0.6);
    }
  });
  it('leaves off-window overlay geometry unclamped for the renderer to clip', () => {
    const model = buildStullModel({ lang: 'en', point: null, domain: window });
    const plot = plotRect(STULL_VIEWPORT);
    const points = model.regions.flatMap((r) => r.points);
    expect(Math.min(...points.map((p) => p.x))).toBeLessThan(plot.x);
    expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(plot.x + plot.width);
    expect(Math.min(...points.map((p) => p.y))).toBeLessThan(plot.y);
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(plot.y + plot.height);
  });
});

describe('buildStullModel areas', () => {
  const transform = createStullTransform();

  it('projects every ring of both zones through the screen transform', () => {
    const draggable = [
      { x: 1, y: 0.2 },
      { x: 4.5, y: 0.55 },
      { x: 8, y: 0.85 },
    ];
    const emptied = [
      { x: 0.5, y: 0.1 },
      { x: 2, y: 0.3 },
      { x: 3, y: 0.45 },
      { x: 1, y: 0.6 },
    ];
    const model = buildStullModel({
      lang: 'en',
      point: null,
      areas: { draggable: [draggable], emptied: [emptied] },
    });
    expect(model.areas.draggable).toEqual([draggable.map((point) => transform.toScreen(point))]);
    expect(model.areas.emptied).toEqual([emptied.map((point) => transform.toScreen(point))]);
  });

  it('draws nothing when no zones are given', () => {
    const model = buildStullModel({ lang: 'en', point: null });
    expect(model.areas).toEqual({ draggable: [], emptied: [] });
  });
});