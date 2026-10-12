import { line } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type Transform, type ZoomBehavior } from 'd3-zoom';
import type {
  ChartAdapter,
  StullInteraction,
  TriaxialInteraction,
  TriaxialTarget,
} from './adapter';
import {
  clientToViewBox,
  createStullTransform,
  snapTo,
  STULL_NUDGE_X,
  STULL_NUDGE_Y,
  STULL_SNAP_X,
  STULL_SNAP_Y,
  Y_TICK_LABEL_NUDGE,
  type Domain,
  type Label,
  type StullModel,
  type Viewport,
} from './stull-chart';
import type { BoronModel } from './boron-chart';
import { TRIAXIAL_NUDGE, TRIAXIAL_SNAP, type TriaxialModel } from './triaxial-chart';
import { ternaryToXY, xyToTernary, type TernaryPoint } from './ternary';
import type { Pt } from './stull-data';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Half-diagonal of the boron map's diamond, matching the Excel marker. */
const BORON_MARKER_HALF = 7;
/** Fill-pattern id for hatched regions; the pattern itself is painted in
 *  paintStull's defs. */
const STULL_HATCH_ID = 'stull-hatch';
/** Clip id for the map overlay: off-window geometry is cut at the frame. */
const STULL_CLIP_ID = 'stull-plot-clip';
/** Hatch id for the band of targets that would empty a component. */
const STULL_EMPTY_HATCH_ID = 'stull-emptied-hatch';
/** Radius of the triaxial point marker, in viewBox units. */
const TRIAXIAL_POINT_RADIUS = 5;
/** Clip id for the triaxial map: the magnified content is cut at the frame. */
const TRIAXIAL_CLIP_ID = 'triaxial-map-clip';
/** The triaxial map's zoom range, matching the Stull map's. */
const TRIAXIAL_ZOOM_RANGE: readonly [number, number] = [1, 8];

function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function textNode(label: Label, size: number, anchor: 'start' | 'middle' | 'end'): SVGElement {
  const node = svgEl('text', {
    x: label.x,
    y: label.y,
    'font-size': size,
    'text-anchor': anchor,
    fill: '#111111',
    opacity: label.opacity,
  });
  if (label.rotate !== undefined) {
    node.setAttribute('transform', `rotate(${label.rotate} ${label.x} ${label.y})`);
  }
  node.textContent = label.text;
  return node;
}

/** An annotation sitting on the boron colour field. White on a dark halo, so it
 *  survives the dark violet of the low-boron corner as well as the bright
 *  orange of the band the map marks as good. */
function haloText(label: Label, size: number): SVGElement {
  const node = textNode(label, size, 'middle');
  node.setAttribute('fill', '#ffffff');
  node.setAttribute('stroke', '#1a1a1a');
  node.setAttribute('stroke-width', '3');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('paint-order', 'stroke');
  return node;
}

function straightPath(points: Pt[], close: boolean): string {
  const first = points[0];
  const data = close && first !== undefined ? [...points, first] : points;
  return (
    line<Pt>()
      .x((p) => p.x)
      .y((p) => p.y)(data) ?? ''
  );
}

/** The point marker: the only part of the Stull map repainted while dragging.
 *  `label` is the drag readout, parked at the marker's top-right. */
function paintMarker(layer: SVGElement | null, target: Pt | null, label: string[] | null = null): void {
  if (!layer) return;
  layer.textContent = '';
  if (!target) return;
  layer.appendChild(
    svgEl('circle', { cx: target.x, cy: target.y, r: 7, fill: 'none', stroke: '#111111', 'stroke-width': 3.5, opacity: 0.85 }),
  );
  layer.appendChild(
    svgEl('circle', { cx: target.x, cy: target.y, r: 4.5, fill: '#ffffff', stroke: '#111111', 'stroke-width': 1.5 }),
  );
  if (label) layer.appendChild(readoutText(label, target));
}

/** A readout parked at a point's top-right: white on a dark halo, so it stays
 *  legible over the pale chart fields and the dark raster corners alike. One
 *  line per entry, the first on top. */
function readoutText(lines: string[], at: Pt, size = 11): SVGElement {
  const node = svgEl('text', {
    x: at.x + 10,
    y: at.y - 10,
    'font-size': size,
    'text-anchor': 'start',
    fill: '#ffffff',
    stroke: '#1a1a1a',
    'stroke-width': 3,
    'stroke-linejoin': 'round',
    'paint-order': 'stroke',
  });
  lines.forEach((line, index) => {
    const tspan = svgEl('tspan', { x: at.x + 10, dy: index === 0 ? 0 : size * 1.25 });
    tspan.textContent = line;
    node.appendChild(tspan);
  });
  return node;
}

/** The Stull marker's readout: the point's two coordinates, then their ratio —
 *  the figure the results panel reports. A coordinate at zero leaves the ratio
 *  undefined, and only the values are shown then. */
function stullReadout(x: number, y: number): string[] {
  const lines = [`SiO₂ ${x.toFixed(2)} · Al₂O₃ ${y.toFixed(2)}`];
  if (x > 0 && y > 0) lines.push(`SiO₂:Al₂O₃ ${(x / y).toFixed(2)}`);
  return lines;
}

function paintStull(model: StullModel, target: Pt | null, surface: SVGElement): SVGElement {
  surface.textContent = '';
  const { plot } = model;

  const grid = svgEl('g');
  for (const tick of model.axes.xTicks) {
    grid.appendChild(
      svgEl('line', { x1: tick.x, y1: plot.y, x2: tick.x, y2: plot.y + plot.height, stroke: '#cccccc', 'stroke-width': 0.5 }),
    );
  }
  for (const tick of model.axes.yTicks) {
    grid.appendChild(
      svgEl('line', { x1: plot.x, y1: tick.y, x2: plot.x + plot.width, y2: tick.y, stroke: '#cccccc', 'stroke-width': 0.5 }),
    );
  }
  // Painter's order mirrors the published chart: solid colour fields, then each
  // field's hatch, then the gridlines on top of the colours, then the Q-line.
  // All of it sits in one group clipped to the frame: while zoomed, geometry
  // crosses the window edges as straight as it was drawn, and the browser cuts
  // it exactly at the border instead of the transform's clamp folding it there.
  const defs = svgEl('defs');
  const hatch = svgEl('pattern', {
    id: STULL_HATCH_ID,
    width: 6,
    height: 6,
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  hatch.appendChild(svgEl('line', { x1: 3, y1: 0, x2: 3, y2: 6, stroke: '#222222', 'stroke-width': 0.1875 }));
  defs.appendChild(hatch);
  // The emptied band's own hatch: same idea, opposite slant and a warm tone, so
  // it never reads as one of the published chart's hatched regions.
  const emptyHatch = svgEl('pattern', {
    id: STULL_EMPTY_HATCH_ID,
    width: 5,
    height: 5,
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(-45)',
  });
  emptyHatch.appendChild(svgEl('line', { x1: 2.5, y1: 0, x2: 2.5, y2: 5, stroke: '#b45309', 'stroke-width': 0.25 }));
  defs.appendChild(emptyHatch);
  const clip = svgEl('clipPath', { id: STULL_CLIP_ID });
  clip.appendChild(
    svgEl('rect', { x: plot.x, y: plot.y, width: plot.width, height: plot.height }),
  );
  defs.appendChild(clip);
  surface.appendChild(defs);

  const overlay = svgEl('g', { 'clip-path': `url(#${STULL_CLIP_ID})` });
  surface.appendChild(overlay);

  /** Filled copy of a region's polygon. */
  const regionShape = (region: { points: Pt[] }, fill: string): SVGElement =>
    svgEl('polygon', {
      points: region.points.map((p) => `${p.x},${p.y}`).join(' '),
      fill,
    });

  for (const region of model.regions) {
    if (region.fill !== 'none') overlay.appendChild(regionShape(region, region.fill));
  }
  for (const region of model.regions) {
    if (region.hatch) overlay.appendChild(regionShape(region, `url(#${STULL_HATCH_ID})`));
  }
  overlay.appendChild(grid);

  overlay.appendChild(
    svgEl('path', {
      d: straightPath(model.qLine, false),
      fill: 'none',
      stroke: '#000000',
      'stroke-width': 1,
      'stroke-dasharray': '3,3',
      opacity: 0.9,
    }),
  );

  for (const label of model.regionLabels) {
    surface.appendChild(textNode(label, 18, 'start'));
  }

  surface.appendChild(
    svgEl('rect', {
      x: plot.x,
      y: plot.y,
      width: plot.width,
      height: plot.height,
      fill: 'none',
      stroke: '#333333',
      'stroke-width': 1,
    }),
  );

  // The band that would empty a component sits just outside the draggable area:
  // hatched in amber, so a drag that will be refused there is explained before it
  // is tried. It goes in first — the draggable region's halo and fill then cover
  // the boundary the two share. Even-odd filling keeps a ring's hole open.
  if (model.areas.emptied.length > 0) {
    overlay.appendChild(
      svgEl('path', {
        d: model.areas.emptied.map((ring) => straightPath(ring, true)).join(' '),
        fill: `url(#${STULL_EMPTY_HATCH_ID})`,
        'fill-rule': 'evenodd',
        stroke: '#b45309',
        'stroke-width': 1,
        'stroke-dasharray': '2,2',
        'stroke-opacity': 0.85,
      }),
    );
  }

  if (model.areas.draggable.length > 0) {
    const d = model.areas.draggable.map((ring) => straightPath(ring, true)).join(' ');
    // Two passes: a white halo under a dark dash, so the outline survives both
    // the pale BRIGHT field and the dark violet of the crazed and under-fired
    // corners alike. Both sit under the frame clip, like the regions.
    surface.appendChild(
      svgEl('path', {
        d,
        'clip-path': `url(#${STULL_CLIP_ID})`,
        fill: '#ffffff',
        'fill-opacity': 0.28,
        'fill-rule': 'evenodd',
        stroke: '#ffffff',
        'stroke-width': 3.5,
        'stroke-linejoin': 'round',
        'stroke-dasharray': '4,3',
        opacity: 0.85,
      }),
    );
    surface.appendChild(
      svgEl('path', {
        d,
        'clip-path': `url(#${STULL_CLIP_ID})`,
        fill: 'none',
        'fill-rule': 'evenodd',
        stroke: '#1f4e79',
        'stroke-width': 1.5,
        'stroke-dasharray': '4,3',
      }),
    );
  }

  const marker = svgEl('g');
  surface.appendChild(marker);
  paintMarker(marker, target);

  const tickLabels = svgEl('g');
  for (const tick of model.axes.xTicks) tickLabels.appendChild(textNode(tick, 15, 'middle'));
  for (const tick of model.axes.yTicks) {
    tickLabels.appendChild(textNode({ ...tick, y: tick.y + Y_TICK_LABEL_NUDGE }, 15, 'end'));
  }
  surface.appendChild(tickLabels);

  surface.appendChild(textNode(model.axes.xTitle, 18, 'end'));
  surface.appendChild(textNode(model.axes.yTitle, 18, 'middle'));
  return marker;
}

/** Hand-written SVG rendering of the shared chart models. No d3-selection. */
export function createD3Adapter(): ChartAdapter {
  let triaxialHost: HTMLElement | null = null;
  /** The triaxial map keeps one SVG for the host's lifetime: a rebuild per
   *  update would cut a gesture in progress. */
  let triaxialSvg: SVGSVGElement | null = null;
  let triaxialImage: SVGElement | null = null;
  let triaxialEdge: SVGElement | null = null;
  let triaxialMarker: SVGElement | null = null;
  let triaxialLabels: SVGGElement | null = null;
  /** The group the triaxial gestures transform: raster, triangle and marker. */
  let triaxialContent: SVGGElement | null = null;
  /** The map's live zoom transform; the point drag maps the pointer through it. */
  let triaxialTransform: Transform = zoomIdentity;
  let triaxialModel: TriaxialModel | null = null;
  let triaxialInteraction: TriaxialInteraction | null = null;
  let triaxialDragging = false;
  let triaxialPointer: number | null = null;
  let boronHost: HTMLElement | null = null;
  let boronMarker: SVGElement | null = null;
  let svg: SVGSVGElement | null = null;
  let surface: SVGElement | null = null;
  let committed: StullModel | null = null;
  let interaction: StullInteraction | null = null;
  let dragging = false;
  /** The pointer whose button started the current drag. */
  let capturedPointer: number | null = null;
  /** The marker group inside the Stull layer; repainted alone while dragging. */
  let markerLayer: SVGElement | null = null;
  /** ViewBox size the zoom behaviour reports transforms against; set on mount. */
  let viewSize = { width: 0, height: 0 };

  const toDomain = (model: StullModel, event: PointerEvent): Pt => {
    const rect = (svg as SVGSVGElement).getBoundingClientRect();
    const point = createStullTransform(model.viewport, model.domain).toDomain(
      clientToViewBox({ x: event.clientX, y: event.clientY }, rect, model.viewport),
    );
    if (!(event.ctrlKey || event.metaKey)) return point;
    return { x: snapTo(point.x, STULL_SNAP_X), y: snapTo(point.y, STULL_SNAP_Y) };
  };

  /** Ends the drag and lets go of pointer capture; idempotent. */
  const endDrag = (): void => {
    dragging = false;
    if (svg && capturedPointer !== null && svg.hasPointerCapture(capturedPointer)) {
      svg.releasePointerCapture(capturedPointer);
    }
    capturedPointer = null;
  };

  /** The map holds focus while it is being steered — and that is when the
   *  readout belongs beside the marker. */
  const stullFocused = (): boolean => svg !== null && document.activeElement === svg;

  /** Repaints the marker at a domain target, carrying the ratio readout while
   *  the map holds focus or a drag is live. */
  const repaintAt = (target: Pt | null): void => {
    const model = committed;
    if (!model || !markerLayer) return;
    const transform = createStullTransform(model.viewport, model.domain);
    const screen = target ? transform.toScreen(target) : null;
    const show = target !== null && (dragging || stullFocused());
    paintMarker(markerLayer, screen, show ? stullReadout(target.x, target.y) : null);
  };

  /** Repaints the last committed point: what a finished or cancelled drag falls
   *  back to. */
  const repaintCommitted = (): void => {
    const model = committed;
    if (!model || !markerLayer) return;
    if (!model.point) {
      repaintAt(null);
      return;
    }
    repaintAt(createStullTransform(model.viewport, model.domain).toDomain(model.point));
  };

  const preview = (event: PointerEvent): void => {
    if (!committed) return;
    repaintAt(toDomain(committed, event));
  };

  /** The domain window a d3 zoom transform is showing, or null at 1×. The
   *  transform maps content to screen, so the visible content is its inverse
   *  read through the unzoomed transform. */
  const windowFromTransform = (t: Transform): Domain | null => {
    if (Math.abs(t.k - 1) < 1e-9) return null;
    const inv = createStullTransform();
    const a = inv.toDomain({ x: -t.x / t.k, y: -t.y / t.k });
    const b = inv.toDomain({ x: (viewSize.width - t.x) / t.k, y: (viewSize.height - t.y) / t.k });
    return {
      x: [Math.min(a.x, b.x), Math.max(a.x, b.x)],
      y: [Math.min(a.y, b.y), Math.max(a.y, b.y)],
    };
  };

  /** d3's controls on the map itself: wheel zooms at the cursor, shift-drag
   *  pans, double-click jumps a step in. Plain drags are filtered out so they
   *  keep moving the recipe point, and ctrl-wheel stays with the browser. */
  const zoomBehavior: ZoomBehavior = zoom()
    .scaleExtent([1, 8])
    .filter(
      (event): boolean =>
        (event instanceof WheelEvent && !event.ctrlKey) ||
        event.type === 'dblclick' ||
        (event instanceof MouseEvent && event.shiftKey && event.button === 0) ||
        (event instanceof TouchEvent && event.touches.length > 1),
    )
    .on('zoom', (event) => {
      if (!interaction) return;
      interaction.onViewport(windowFromTransform(event.transform));
    });

  const onPointerDown = (event: PointerEvent): void => {
    // Shift-drag belongs to d3's pan, not to the point.
    if (!committed || !svg || event.button !== 0 || event.shiftKey) return;
    dragging = true;
    capturedPointer = event.pointerId;
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    // preventDefault swallows the focus the click would have given; take it
    // explicitly so the arrow-key hint works right after a click.
    svg.focus({ preventScroll: true });
    preview(event);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragging) preview(event);
  };

  const onPointerUp = (event: PointerEvent): void => {
    // Only the button that started the drag may commit it: a secondary button
    // released mid-drag must not end the drag early.
    if (!dragging || !committed || event.button !== 0 || event.pointerId !== capturedPointer) return;
    endDrag();
    interaction?.onTarget(toDomain(committed, event));
  };

  /** A cancelled pointer is not a commit: drop the drag and repaint at the
   *  last committed point, leaving `onTarget` untouched. */
  const onPointerCancel = (): void => {
    if (!dragging || !markerLayer) return;
    endDrag();
    repaintCommitted();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const model = committed;
    const node = surface;
    if (!model || !node) return;
    const transform = createStullTransform(model.viewport, model.domain);
    const here = model.point ? transform.toDomain(model.point) : null;

    const snap = event.ctrlKey || event.metaKey;
    const stepX = snap ? STULL_SNAP_X : STULL_NUDGE_X;
    const stepY = snap ? STULL_SNAP_Y : STULL_NUDGE_Y;
    const step: Record<string, Pt> = here
      ? {
          ArrowLeft: { x: here.x - stepX, y: here.y },
          ArrowRight: { x: here.x + stepX, y: here.y },
          ArrowDown: { x: here.x, y: here.y - stepY },
          ArrowUp: { x: here.x, y: here.y + stepY },
        }
      : {};

    if (event.key === 'Escape') {
      // Escape must also end an active pointer drag, or the pending pointerup
      // would commit the very target that was just cancelled.
      endDrag();
      interaction?.onCancel?.();
      repaintCommitted();
      return;
    }
    const moved = step[event.key];
    if (!moved) return;
    event.preventDefault();
    // Ctrl walks the snap grid; a free step lands wherever the nudge takes it.
    const settled = snap
      ? { x: snapTo(moved.x, STULL_SNAP_X), y: snapTo(moved.y, STULL_SNAP_Y) }
      : moved;
    // `settled` is already domain space: round-trip it through toScreen so the
    // pixel clamp + 3-decimal rounding apply without re-projecting domain as pixels.
    const target = transform.toDomain(transform.toScreen(settled));
    repaintAt(target);
    interaction?.onTarget(target);
  };

  /** Drops the previous Stull SVG before a re-mount. There is no public
   *  unmount: leaving the page is a navigation, which discards the DOM. */
  const releaseSvg = (): void => {
    if (svg) {
      select(svg).on('zoom', null);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerCancel);
      svg.removeEventListener('keydown', onKeyDown);
    }
    svg = null;
    surface = null;
    markerLayer = null;
    dragging = false;
    capturedPointer = null;
  };

  /** Paints the triaxial marker at its map point. The map carries no readout:
   *  the shares it stands for are the triangle's own axes, drawn on the map.
   *  The radius is counter-scaled, so a magnified map shows the same dot. */
  const paintTriaxialPoint = (point: Pt): void => {
    if (!triaxialMarker) return;
    triaxialMarker.setAttribute('visibility', 'visible');
    triaxialMarker.setAttribute('cx', String(point.x));
    triaxialMarker.setAttribute('cy', String(point.y));
    triaxialMarker.setAttribute('r', String(TRIAXIAL_POINT_RADIUS / triaxialTransform.k));
  };

  const triaxialTernary = (target: TriaxialTarget): TernaryPoint => ({
    a: target.sio2,
    b: target.al2o3,
    c: 1 - target.sio2 - target.al2o3,
  });

  /** A viewport point read back into the map's own space: the inverse of the
   *  live zoom transform, so a drag lands where the pointer is at any scale. */
  const triaxialMapPoint = (view: Pt): Pt => ({
    x: (view.x - triaxialTransform.x) / triaxialTransform.k,
    y: (view.y - triaxialTransform.y) / triaxialTransform.k,
  });

  /** The share of the triangle under the pointer, snapped while Ctrl is held. */
  const triaxialTargetAt = (event: PointerEvent): TriaxialTarget | null => {
    const model = triaxialModel;
    const root = triaxialSvg;
    if (!model || !root) return null;
    const rect = root.getBoundingClientRect();
    const view = clientToViewBox({ x: event.clientX, y: event.clientY }, rect, model.viewport);
    const ternary = xyToTernary(triaxialMapPoint(view), model.vertices);
    const snap = event.ctrlKey || event.metaKey;
    return {
      sio2: snap ? snapTo(ternary.a, TRIAXIAL_SNAP) : ternary.a,
      al2o3: snap ? snapTo(ternary.b, TRIAXIAL_SNAP) : ternary.b,
    };
  };

  const previewTriaxial = (event: PointerEvent): void => {
    const model = triaxialModel;
    const target = triaxialTargetAt(event);
    if (!model || !target) return;
    paintTriaxialPoint(ternaryToXY(triaxialTernary(target), model.vertices));
  };

  /** Ends the triaxial drag and lets go of capture; idempotent. */
  const endTriaxialDrag = (): void => {
    if (triaxialSvg && triaxialPointer !== null && triaxialSvg.hasPointerCapture(triaxialPointer)) {
      triaxialSvg.releasePointerCapture(triaxialPointer);
    }
    triaxialDragging = false;
    triaxialPointer = null;
  };

  const onTriaxialPointerDown = (event: PointerEvent): void => {
    // Shift-drag belongs to the map's pan; the point takes a plain drag.
    if (!triaxialSvg || !triaxialModel?.point || event.button !== 0 || event.shiftKey) return;
    triaxialDragging = true;
    triaxialPointer = event.pointerId;
    triaxialSvg.setPointerCapture(event.pointerId);
    event.preventDefault();
    // preventDefault swallows the focus the click would have given; take it
    // explicitly so the arrow keys are live right away.
    triaxialSvg.focus({ preventScroll: true });
    previewTriaxial(event);
  };

  const onTriaxialPointerMove = (event: PointerEvent): void => {
    if (triaxialDragging) previewTriaxial(event);
  };

  const onTriaxialPointerUp = (event: PointerEvent): void => {
    if (!triaxialDragging || event.button !== 0 || event.pointerId !== triaxialPointer) return;
    const target = triaxialTargetAt(event);
    endTriaxialDrag();
    if (target) triaxialInteraction?.onTarget(target);
  };

  const onTriaxialPointerCancel = (): void => {
    if (!triaxialDragging) return;
    endTriaxialDrag();
    paintTriaxial(triaxialModel);
  };

  /** Arrow keys step the shares one nudge, or one snap cell with Ctrl. False
   *  when the key is not an arrow. */
  const nudgeTriaxial = (event: KeyboardEvent): boolean => {
    const model = triaxialModel;
    if (!model?.point) return false;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowDown: [0, -1],
      ArrowUp: [0, 1],
    };
    const move = delta[event.key];
    if (!move) return false;
    event.preventDefault();
    const snap = event.ctrlKey || event.metaKey;
    const step = snap ? TRIAXIAL_SNAP : TRIAXIAL_NUDGE;
    const at = xyToTernary(model.point, model.vertices);
    const target: TriaxialTarget = {
      sio2: snap ? snapTo(at.a + move[0] * step, TRIAXIAL_SNAP) : at.a + move[0] * step,
      al2o3: snap ? snapTo(at.b + move[1] * step, TRIAXIAL_SNAP) : at.b + move[1] * step,
    };
    paintTriaxialPoint(ternaryToXY(triaxialTernary(target), model.vertices));
    triaxialInteraction?.onTarget(target);
    return true;
  };

  const releaseTriaxial = (): void => {
    if (triaxialSvg) select(triaxialSvg).on('zoom', null);
    triaxialSvg = null;
    triaxialImage = null;
    triaxialEdge = null;
    triaxialMarker = null;
    triaxialDragging = false;
    triaxialPointer = null;
    triaxialLabels = null;
    triaxialContent = null;
    triaxialTransform = zoomIdentity;
    triaxialModel = null;
  };

  /** The triaxial map's own wheel: zoom at the pointer, shift-drag pan,
   *  double-click step in. The transform rides on the content group, so the
   *  published raster magnifies in place and stays registered with the
   *  calibrated triangle drawn over it. Plain drags are filtered out so they
   *  keep moving the recipe point, and ctrl-wheel stays with the browser. */
  const triaxialZoomBehavior: ZoomBehavior = zoom()
    .scaleExtent([TRIAXIAL_ZOOM_RANGE[0], TRIAXIAL_ZOOM_RANGE[1]])
    .filter(
      (event): boolean =>
        (event instanceof WheelEvent && !event.ctrlKey) ||
        event.type === 'dblclick' ||
        (event instanceof MouseEvent && event.shiftKey && event.button === 0) ||
        (event instanceof TouchEvent && event.touches.length > 1),
    )
    .on('zoom', (event) => {
      triaxialTransform = event.transform;
      triaxialContent?.setAttribute(
        'transform',
        `translate(${event.transform.x} ${event.transform.y}) scale(${event.transform.k})`,
      );
      // The marker sits in the scaled group: repaint it so the counter-scale
      // keeps the dot its own size at every zoom step.
      if (triaxialModel?.point) paintTriaxialPoint(triaxialModel.point);
    });

  /** Wires the behavior to the mounted map. The extents are the map box itself:
   *  the frame stays put while the content under it magnifies. */
  const attachTriaxialZoom = (root: SVGSVGElement, viewport: Viewport): void => {
    triaxialZoomBehavior
      .extent([
        [0, 0],
        [viewport.width, viewport.height],
      ])
      .translateExtent([
        [0, 0],
        [viewport.width, viewport.height],
      ]);
    select(root).call(triaxialZoomBehavior);
  };

  /** The triaxial map's keyboard: Escape cancels a drag, the arrows step the
   *  shares, and ± / 0 drive the zoom the wheel otherwise owns. */
  const attachTriaxialKeys = (root: SVGSVGElement): void => {
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        endTriaxialDrag();
        triaxialInteraction?.onCancel?.();
        paintTriaxial(triaxialModel);
        return;
      }
      if (nudgeTriaxial(event)) return;
      const node = select(root);
      if (event.key === '+' || event.key === '=') triaxialZoomBehavior.scaleBy(node, 1.4);
      else if (event.key === '-' || event.key === '_') triaxialZoomBehavior.scaleBy(node, 1 / 1.4);
      else if (event.key === '0') triaxialZoomBehavior.transform(node, zoomIdentity);
      else return;
      event.preventDefault();
    });
  };

  /** Builds the triaxial skeleton once per host: a clipped frame, the content
   *  group the map's gestures move, and the margin labels outside both. */
  const mountTriaxialSvg = (host: HTMLElement, model: TriaxialModel): void => {
    host.textContent = '';
    const { viewport } = model;
    const root = svgEl('svg', {
      width: viewport.width,
      height: viewport.height,
      viewBox: `0 0 ${viewport.width} ${viewport.height}`,
      tabindex: 0,
      role: 'img',
      'aria-label': model.aria,
    }) as SVGSVGElement;
    root.style.display = 'block';
    root.style.cursor = 'crosshair';
    root.style.touchAction = 'none';

    const defs = svgEl('defs');
    const clip = svgEl('clipPath', { id: TRIAXIAL_CLIP_ID });
    clip.appendChild(svgEl('rect', { x: 0, y: 0, width: viewport.width, height: viewport.height }));
    defs.appendChild(clip);

    // The clip has to sit outside the transform: a clip path is read in the
    // user space of the element carrying it, so clipping the magnified group
    // would move the frame along with the raster instead of holding it.
    const frame = svgEl('g', { 'clip-path': `url(#${TRIAXIAL_CLIP_ID})` });
    const content = svgEl('g') as SVGGElement;

    const image = svgEl('image', {
      href: model.backdrop,
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
      // Must stay 'none'. The backgrounds are ~1285x1080 in a 520x460 viewport,
      // so the default 'xMidYMid meet' would letterbox them: uniformly scaled
      // and shifted down ~11px. The calibration page stretches the very same
      // PNG with `width/height: 100%`, and every corner in TRIAXIAL_CALIBRATION
      // is measured against that stretched raster — letterboxing here put the
      // apex ~24 raster px high and the base ~22 px low. Magnifying the content
      // group keeps the raster and those corners registered at every scale.
      preserveAspectRatio: 'none',
    });
    const edge = svgEl('path', {
      d: straightPath(model.edge, true),
      fill: 'none',
      stroke: '#111111',
      'stroke-width': 1.5,
      // The triangle magnifies with the raster; its outline keeps its width.
      'vector-effect': 'non-scaling-stroke',
    });
    const marker = svgEl('circle', {
      cx: 0,
      cy: 0,
      r: TRIAXIAL_POINT_RADIUS,
      fill: '#d81b60',
      stroke: '#ffffff',
      'stroke-width': 1.5,
      visibility: 'hidden',
      'vector-effect': 'non-scaling-stroke',
    });
    content.append(image, edge, marker);
    frame.appendChild(content);

    const labels = svgEl('g') as SVGGElement;
    root.append(defs, frame, labels);
    host.appendChild(root);

    root.addEventListener('pointerdown', onTriaxialPointerDown);
    root.addEventListener('pointermove', onTriaxialPointerMove);
    root.addEventListener('pointerup', onTriaxialPointerUp);
    root.addEventListener('pointercancel', onTriaxialPointerCancel);

    triaxialSvg = root;
    triaxialImage = image;
    triaxialEdge = edge;
    triaxialMarker = marker;
    triaxialLabels = labels;
    triaxialContent = content;
    attachTriaxialZoom(root, viewport);
    attachTriaxialKeys(root);
  };

  /** Paints the triaxial map into its skeleton; a null model clears the host. */
  const paintTriaxial = (model: TriaxialModel | null): void => {
    const host = triaxialHost;
    if (!host) return;
    if (!model) {
      releaseTriaxial();
      host.textContent = '';
      return;
    }
    if (!triaxialSvg) mountTriaxialSvg(host, model);
    if (!triaxialSvg || !triaxialImage || !triaxialEdge || !triaxialMarker || !triaxialLabels) return;

    triaxialModel = model;
    triaxialSvg.setAttribute('aria-label', model.aria);
    triaxialImage.setAttribute('href', model.backdrop);
    triaxialEdge.setAttribute('d', straightPath(model.edge, true));
    if (model.point) paintTriaxialPoint(model.point);
    else triaxialMarker.setAttribute('visibility', 'hidden');
    triaxialLabels.replaceChildren(...(model.fluxRatio ?? []).map((line) => textNode(line, 11, 'start')));
  };

  /** The marker's diamond, matching the published Excel marker. */
  const boronPath = (point: Pt): string =>
    `M ${point.x - BORON_MARKER_HALF} ${point.y} L ${point.x} ${point.y - BORON_MARKER_HALF} L ${point.x + BORON_MARKER_HALF} ${point.y} L ${point.x} ${point.y + BORON_MARKER_HALF} Z`;

  /** Paints the recipe's place on the map, and hides the marker when there is
   *  none. The map is a reading of the batch: nothing on it is draggable. */
  const paintBoronPoint = (model: BoronModel): void => {
    if (!boronMarker) return;
    if (!model.point) {
      boronMarker.setAttribute('visibility', 'hidden');
      return;
    }
    boronMarker.setAttribute('visibility', 'visible');
    boronMarker.setAttribute('d', boronPath(model.point));
  };

  /** The boron map: a published colour field with the recipe plotted on top. */
  const renderBoron = (host: HTMLElement, model: BoronModel): void => {
    host.textContent = '';
    const { plot, viewport } = model;
    const root = svgEl('svg', {
      width: viewport.width,
      height: viewport.height,
      viewBox: `0 0 ${viewport.width} ${viewport.height}`,
      role: 'img',
      'aria-label': model.aria,
    }) as SVGSVGElement;
    root.style.display = 'block';

    root.appendChild(
      svgEl('image', {
        href: model.backdrop,
        x: plot.x,
        y: plot.y,
        width: plot.width,
        height: plot.height,
        // Must stay 'none'. Excel set the picture as the plot area's fill with
        // a plain stretched blipFill (no srcRect), so the raster is a
        // "squeezed into whatever box" field, not a map with a fixed aspect:
        // letterboxing it would slide every region off the axis it is read on.
        preserveAspectRatio: 'none',
      }),
    );

    const grid = svgEl('g');
    const gridStyle = { stroke: '#ffffff', 'stroke-width': 0.5, opacity: 0.28 };
    for (const tick of model.axes.xTicks) {
      grid.appendChild(svgEl('line', { ...gridStyle, x1: tick.x, y1: plot.y, x2: tick.x, y2: plot.y + plot.height }));
    }
    for (const tick of model.axes.yTicks) {
      grid.appendChild(svgEl('line', { ...gridStyle, x1: plot.x, y1: tick.y, x2: plot.x + plot.width, y2: tick.y }));
    }
    root.appendChild(grid);

    root.appendChild(
      svgEl('rect', {
        x: plot.x,
        y: plot.y,
        width: plot.width,
        height: plot.height,
        fill: 'none',
        stroke: '#333333',
        'stroke-width': 1,
      }),
    );

    const names = svgEl('g');
    for (const label of model.annotations) names.appendChild(haloText(label, 13));
    root.appendChild(names);

    const marker = svgEl('path', {
      d: '',
      fill: '#ff99ff',
      stroke: '#4f81bd',
      'stroke-width': 1.5,
      visibility: 'hidden',
    });
    root.appendChild(marker);

    const tickLabels = svgEl('g');
    for (const tick of model.axes.xTicks) tickLabels.appendChild(textNode(tick, 10, 'middle'));
    for (const tick of model.axes.yTicks) {
      tickLabels.appendChild(textNode({ ...tick, y: tick.y + Y_TICK_LABEL_NUDGE }, 10, 'end'));
    }
    root.appendChild(tickLabels);

    root.appendChild(textNode(model.axes.xTitle, 12, 'end'));
    root.appendChild(textNode(model.axes.yTitle, 12, 'middle'));

    host.appendChild(root);
    boronMarker = marker;
    paintBoronPoint(model);
  };

  return {
    mountStull(host: HTMLElement, model: StullModel, handlers: StullInteraction): void {
      releaseSvg();
      committed = model;
      interaction = handlers;
      host.textContent = '';

      const root = svgEl('svg', {
        width: model.viewport.width,
        height: model.viewport.height,
        viewBox: `0 0 ${model.viewport.width} ${model.viewport.height}`,
        tabindex: 0,
        role: 'application',
        'aria-label': model.aria,
      }) as SVGSVGElement;
      root.style.display = 'block';
      root.style.cursor = 'crosshair';
      root.style.touchAction = 'none';

      const layer = svgEl('g');
      root.appendChild(layer);

      root.addEventListener('focus', repaintCommitted);
      root.addEventListener('blur', repaintCommitted);
      root.addEventListener('pointerdown', onPointerDown);
      root.addEventListener('pointermove', onPointerMove);
      root.addEventListener('pointerup', onPointerUp);
      root.addEventListener('pointercancel', onPointerCancel);
      root.addEventListener('keydown', onKeyDown);

      host.appendChild(root);
      svg = root;
      surface = layer;
      markerLayer = paintStull(model, model.point, layer);
      viewSize = { width: model.viewport.width, height: model.viewport.height };
      // The window may never leave the map box: extent is what the wheel and
      // drag gestures steer, translateExtent what they are allowed to reach.
      zoomBehavior
        .extent([
          [0, 0],
          [model.viewport.width, model.viewport.height],
        ])
        .translateExtent([
          [0, 0],
          [model.viewport.width, model.viewport.height],
        ]);
      select(root).call(zoomBehavior);
    },

    updateStull(model: StullModel): void {
      committed = model;
      if (!surface) return;
      markerLayer = paintStull(model, model.point, surface);
      // `paintStull` draws a bare marker; the readout goes back on top whenever
      // the map still holds the focus the drag that got here gave it.
      repaintCommitted();
    },

    mountTriaxial(host: HTMLElement, model: TriaxialModel | null, handlers: TriaxialInteraction): void {
      triaxialHost = host;
      triaxialInteraction = handlers;
      paintTriaxial(model);
    },

    updateTriaxial(model: TriaxialModel | null): void {
      if (triaxialHost) paintTriaxial(model);
    },

    mountBoron(host: HTMLElement, model: BoronModel): void {
      boronHost = host;
      renderBoron(host, model);
    },

    updateBoron(model: BoronModel): void {
      if (boronHost) renderBoron(boronHost, model);
    },
  };
}