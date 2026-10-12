import type { Pt } from './stull-data';

export type TernaryPoint = { a: number; b: number; c: number };

export type TernaryVertices = { a: Pt; b: Pt; c: Pt };

export function ternaryToXY(p: TernaryPoint, vertices: TernaryVertices): Pt {
  return {
    x: p.a * vertices.a.x + p.b * vertices.b.x + p.c * vertices.c.x,
    y: p.a * vertices.a.y + p.b * vertices.b.y + p.c * vertices.c.y,
  };
}

export function unityToTernary(sio2: number, al2o3: number, ro: number): TernaryPoint {
  const total = sio2 + al2o3 + ro;
  if (total === 0) {
    return { a: 0, b: 0, c: 0 };
  }
  return { a: sio2 / total, b: al2o3 / total, c: ro / total };
}

/**
 * Inverse of `ternaryToXY`: the barycentric weights of a screen point in the
 * triangle `vertices`. Weights sum to 1; a point outside the triangle gets a
 * negative one, which is what tells a drag it is aimed off the map.
 */
export function xyToTernary(point: Pt, vertices: TernaryVertices): TernaryPoint {
  const { a, b, c } = vertices;
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0, c: 0 };
  const dx = point.x - a.x;
  const dy = point.y - a.y;
  const bWeight = (dx * (c.y - a.y) - (c.x - a.x) * dy) / det;
  const cWeight = ((b.x - a.x) * dy - dx * (b.y - a.y)) / det;
  return { a: 1 - bWeight - cWeight, b: bWeight, c: cWeight };
}