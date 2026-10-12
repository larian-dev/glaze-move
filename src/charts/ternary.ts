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