// Minimal ambient types for the slices of d3-zoom / d3-selection this app uses,
// like d3-shape.d.ts: the packages ship no types and no @types are installed.

declare module 'd3-selection' {
  export interface Selection {
    on(type: string, listener: ((event: unknown) => void) | null): Selection;
    call<A extends unknown[]>(
      fn: (selection: Selection, ...args: A) => unknown,
      ...args: A
    ): Selection;
  }

  export function select(node: Element | string): Selection;
}

declare module 'd3-zoom' {
  import type { Selection } from 'd3-selection';

  export type Transform = { k: number; x: number; y: number };

  export const zoomIdentity: Transform;

  export type ZoomEvent = {
    type: 'zoom';
    transform: Transform;
    sourceEvent: Event | null;
  };

  export type ZoomBehavior = {
    (selection: Selection): void;
    scaleExtent(extent: [number, number]): ZoomBehavior;
    extent(extent: [[number, number], [number, number]]): ZoomBehavior;
    translateExtent(extent: [[number, number], [number, number]]): ZoomBehavior;
    scaleBy(selection: Selection, k: number): void;
    transform(selection: Selection, transform: Transform): void;
    filter(predicate: (event: Event) => boolean): ZoomBehavior;
    on(type: string, listener: ((event: ZoomEvent) => void) | null): ZoomBehavior;
  };

  export function zoom(): ZoomBehavior;
}