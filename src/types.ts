export type OxideClass = 'R2O' | 'RO' | 'R2O3' | 'RO2' | 'B2O3' | 'Other';

export const OXIDE_CLASSES: readonly OxideClass[] = ['R2O', 'RO', 'R2O3', 'RO2', 'B2O3', 'Other'];

/** Classification of a flux-forming oxide. `Other` oxides may still join the flux basis
 *  once their unity value clears OTHER_FLUX_THRESHOLD — see core/umf.ts. */
export type FluxClass = 'R2O' | 'RO' | 'Other';

export type MaterialType = 'feldspar' | 'frit' | 'colorant' | 'clay' | 'other';

export type Region = 'world' | 'EU' | 'US' | 'Russia';

/** Coefficient used by the meltability estimate. `0` means "no data", not "inert" —
 *  see core/ratios.ts. */
export type Oxide = {
  formula: string;
  /** Pipe-separated localised names, e.g. `"Natrium|Sodium"`. Index 0 is ru, 1 is en. */
  displayName: string;
  umfType: OxideClass;
  mw: number;
  density: number;
  meltpoint: number;
  meltability: number | null;
  /** Appen expansion coefficient, stored as α·10⁷/100. `null` = composition-dependent
   *  rule (SiO₂, TiO₂, B₂O₃, PbO). */
  cte: number | null;
};

export type OxideAmount = {
  oxide: string;
  /** Mass % of the oxide within the material, as published. */
  amount: number;
};

export type Material = {
  id: string;
  name: string;
  density: number;
  region: Region;
  price: number;
  loi: number;
  type: MaterialType;
  components: OxideAmount[];
  local: boolean;
};

/** One row of the recipe. `kind` distinguishes the base from additions over 100%. */
export type RecipeRow = {
  materialId: string;
  amount: number;
  kind: 'main' | 'additional';
};

export type MaterialIndex = Map<string, Material>;
export type OxideIndex = Map<string, Oxide>;
