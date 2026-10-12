import type { Pt } from './stull-data';
import type { Domain, StullModel } from './stull-chart';
import type { TriaxialModel } from './triaxial-chart';
import type { BoronModel } from './boron-chart';

export type StullInteraction = {
  /** Committed target: pointer release, arrow key or Enter. */
  onTarget: (target: Pt) => void;
  /** Escape, or a rejected solve — revert to the last committed model. */
  onCancel?: () => void;
  /** d3-zoom changed the visible domain window; `null` = back at 1×. */
  onViewport: (window: Domain | null) => void;
};

export type ChartAdapter = {
  mountStull(el: HTMLElement, model: StullModel, interaction: StullInteraction): void;
  updateStull(model: StullModel): void;
  /** A null model clears the host — the recipe has no RO flux to plot against. */
  mountTriaxial(el: HTMLElement, model: TriaxialModel | null): void;
  updateTriaxial(model: TriaxialModel | null): void;
  /** The map itself always draws; a null point is the recipe's, not the host's. */
  mountBoron(el: HTMLElement, model: BoronModel): void;
  updateBoron(model: BoronModel): void;
};
