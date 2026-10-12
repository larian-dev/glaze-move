import { describe, expect, it } from 'vitest';
import {
  BORON_ANNOTATIONS,
  BORON_DOMAIN,
  BORON_TICK_STEP_X,
  BORON_VIEWPORT,
  buildBoronModel,
} from '../src/charts/boron-chart';
import { createStullTransform, plotRect } from '../src/charts/stull-chart';

const base = { lang: 'en' } as const;
const plot = plotRect(BORON_VIEWPORT);
const transform = createStullTransform(BORON_VIEWPORT, BORON_DOMAIN);

describe('boron map geometry', () => {
  it('spans the source chart: 0–0.5 B₂O₃ against the Δ06–Δ10 cone axis', () => {
    expect(BORON_DOMAIN).toEqual({ x: [0, 0.5], y: [998, 1285] });
    expect(transform.toScreen({ x: 0, y: 998 })).toEqual({ x: plot.x, y: plot.y + plot.height });
    expect(transform.toScreen({ x: 0.5, y: 1285 })).toEqual({ x: plot.x + plot.width, y: plot.y });
  });

  it('ticks x to the Excel values and y to the six labelled cone points', () => {
    const model = buildBoronModel({ ...base, b2o3: 0.2, celsius: 1200 });
    expect(model.axes.xTicks.map((tick) => tick.text)).toEqual([
      '0.00', '0.05', '0.10', '0.15', '0.20', '0.25', '0.30', '0.35', '0.40', '0.45', '0.50',
    ]);
    // drawing1.xml labels the y axis with Δ10…Δ06 stacked evenly — equal cone
    // steps, where the old linear-degree ticks (35 °C apart) were invented:
    // no temperature point is labelled anywhere in the chart1 data.
    expect(model.axes.yTicks.map((tick) => tick.text)).toEqual([
      'Δ06', 'Δ04', 'Δ02', 'Δ2', 'Δ6', 'Δ10',
    ]);
    const ys = model.axes.yTicks.map((tick) => tick.y);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]! - ys[i - 1]!).toBeCloseTo(-plot.height / 5, 6);
    }
    // Δ06 is the bottom of the domain, so its row is the frame edge itself: the
    // 4px text-baseline nudge belongs to the label drawn on top of the row.
    expect(ys[0]).toBe(plot.y + plot.height);
    expect((BORON_DOMAIN.x[1] - BORON_DOMAIN.x[0]) / BORON_TICK_STEP_X).toBe(10);
  });

  it('labels the axes in both languages and describes itself for screen readers', () => {
    const en = buildBoronModel({ ...base, b2o3: 0.2, celsius: 1200 });
    expect(en.axes.xTitle.text).toBe('B₂O₃ (0–0.5)');
    expect(en.axes.yTitle.text).toBe('Firing temperature (°C)');
    expect(en.axes.yTitle.rotate).toBe(-90);
    expect(en.aria).toContain('B₂O₃');

    const ru = buildBoronModel({ lang: 'ru', b2o3: 0.2, celsius: 1200 });
    expect(ru.axes.yTitle.text).toBe('Температура обжига (°C)');
    expect(ru.aria).not.toBe(en.aria);
  });

  it('keeps the y-axis title clear of the cone ticks', () => {
    const model = buildBoronModel({ ...base, b2o3: 0.2, celsius: 1200 });
    // Ticks are right-anchored at plot.x − 7; the widest is a Δ-cone like "Δ06".
    const widest = Math.max(...model.axes.yTicks.map((tick) => tick.text.length));
    expect(model.axes.yTitle.x + 6).toBeLessThan(plot.x - 7 - widest * 6);
  });

  it('projects the three Excel text boxes onto the cone-stepped axis', () => {
    const model = buildBoronModel({ ...base, b2o3: 0.2, celsius: 1200 });
    expect(BORON_ANNOTATIONS.map((label) => label.text)).toEqual(['Good', 'Too Much', 'Too Little']);
    expect(model.annotations.map((label) => label.text)).toEqual([
      'Good', 'Too Much', 'Too Little',
    ]);
    // 1285 °C is Δ10 itself, so the two top labels sit on the top grid line.
    for (const label of model.annotations.slice(0, 2)) {
      expect(label.y).toBe(plot.y);
    }
    expect(model.annotations[0]!.x).toBeCloseTo(
      transform.toScreen({ x: 0.09, y: 1285 }).x,
      6,
    );
    // 1045 °C lies 47/65 of the way from Δ06 (998) to Δ04 (1063) — one cone
    // step covers 1/5 of the plot, so the label lands at that fraction.
    expect(model.annotations[2]!.y).toBeCloseTo(
      plot.y + plot.height * (1 - (47 / 65) / 5),
      2,
    );
  });
});

describe('buildBoronModel point', () => {
  it('plots the recipe at its unity B₂O₃ and calculated firing temperature', () => {
    const model = buildBoronModel({ ...base, b2o3: 0.18, celsius: 1180 });
    expect(model.point!.x).toBe(transform.toScreen({ x: 0.18, y: 1180 }).x);
    // 1180 °C is 38/80 of the way from Δ2 (1142) to Δ6 (1222), i.e. between
    // cone steps 3 and 4 of five: the point sits at (3 + 38/80)/5 from the
    // bottom — noticeably higher than a linear-degree axis would put it.
    expect(model.point!.y).toBeCloseTo(plot.y + plot.height * (1 - (3 + 38 / 80) / 5), 6);
  });

  it('leaves the map without a point when the recipe has no boron or no temperature', () => {
    expect(buildBoronModel({ ...base, b2o3: 0, celsius: 1200 }).point).toBeNull();
    expect(buildBoronModel({ ...base, b2o3: -0.1, celsius: 1200 }).point).toBeNull();
    expect(buildBoronModel({ ...base, b2o3: 0.2, celsius: null }).point).toBeNull();
  });

  it('pins a value outside the published map to its edge', () => {
    expect(buildBoronModel({ ...base, b2o3: 0.2, celsius: 1450 }).point?.y).toBeCloseTo(plot.y, 6);
    expect(buildBoronModel({ ...base, b2o3: 0.9, celsius: 1200 }).point?.x).toBeCloseTo(
      plot.x + plot.width,
      6,
    );
  });

  it('always carries the published backdrop', () => {
    expect(buildBoronModel({ ...base, b2o3: 0, celsius: null }).backdrop).toContain('b2o3');
  });
});