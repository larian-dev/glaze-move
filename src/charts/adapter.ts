import type { Pt } from './stull-data';
import type { Domain, StullModel } from './stull-chart';
import type { TriaxialModel } from './triaxial-chart';
import type { BoronModel } from './boron-chart';

export type StullInteraction = {
  /** Committed target: pointer release or arrow key. */
  onTarget: (target: Pt) => void;
  /** Escape, or a rejected solve — revert to the last committed model. */
  onCancel?: () => void;
  /** d3-zoom changed the visible domain window; `null` = back at 1×. */
  onViewport: (window: Domain | null) => void;
};

/** A map whose point can be dragged. The target is in the map's own
 *  coordinates; the adapter snaps it to the map's grid while Ctrl is held. */
export type MapInteraction<T> = {
  onTarget: (target: T) => void;
  /** Escape cancels the drag; a rejected solve reverts through the caller. */
  onCancel?: () => void;
};

/** Ternary shares of the two plotted axes: Si and Al, the RO corner implicit. */
export type TriaxialTarget = { sio2: number; al2o3: number };

export type TriaxialInteraction = MapInteraction<TriaxialTarget>;

export type ChartAdapter = {
  mountStull(el: HTMLElement, model: StullModel, interaction: StullInteraction): void;
  updateStull(model: StullModel): void;
  /** A null model clears the host — the recipe has no RO flux to plot against. */
  mountTriaxial(el: HTMLElement, model: TriaxialModel | null, interaction: TriaxialInteraction): void;
  updateTriaxial(model: TriaxialModel | null): void;
  /** The boron map is a reading: it takes no interaction. The map itself always
   *  draws; a null point is the recipe's, not the host's. */
  mountBoron(el: HTMLElement, model: BoronModel): void;
  updateBoron(model: BoronModel): void;
};
