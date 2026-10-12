import { OXIDE_BY_FORMULA } from '../data/catalog';
import type { Material } from '../types';
import { publishedProfile } from './normalize';

/** Moles of one oxide per amount-part: profile/100/MW, 0 when the oxide is unknown. */
export function oxideMolesPerPart(profile: Map<string, number>, oxide: string): number {
  const mass = profile.get(oxide);
  if (mass === undefined) return 0;
  const entry = OXIDE_BY_FORMULA.get(oxide);
  if (!entry || entry.mw <= 0) return 0;
  return mass / 100 / entry.mw;
}

function dominantOxideOf(profile: Map<string, number>): { oxide: string; moles: number } | null {
  let oxide: string | undefined;
  let largest = 0;
  for (const [name, mass] of profile) {
    if (mass > largest) {
      largest = mass;
      oxide = name;
    }
  }
  if (oxide === undefined) return null;
  const moles = oxideMolesPerPart(profile, oxide);
  return moles > 0 ? { oxide, moles } : null;
}

/** The material's dominant oxide by mass share, with its moles per amount-part.
 *  `null` when the profile holds nothing an equation could hold constant. This
 *  is the quantity a clamped addition keeps through a drag — `unityValue`. */
export function dominantOxideMolesPerPart(material: Material): { oxide: string; moles: number } | null {
  return dominantOxideOf(publishedProfile(material));
}

/** SiO2 / Al2O3 / flux moles contributed by one amount-part of a material.
 *  The flux is also split by class: the solver has to be able to steer the
 *  R2O : RO balance, and one lumped number cannot express that. */
export type MoleCoefficients = {
  silica: number;
  alumina: number;
  r2o: number;
  ro: number;
  /** R2O + RO — the flux basis the Stull point normalises by. */
  flux: number;
};

function coefficientsOf(profile: Map<string, number>): MoleCoefficients {
  let r2o = 0;
  let ro = 0;
  for (const [oxide, mass] of profile) {
    const entry = OXIDE_BY_FORMULA.get(oxide);
    if (!entry || entry.mw <= 0) continue;
    const moles = mass / 100 / entry.mw;
    if (entry.umfType === 'R2O') r2o += moles;
    else if (entry.umfType === 'RO') ro += moles;
  }
  return {
    silica: oxideMolesPerPart(profile, 'SiO2'),
    alumina: oxideMolesPerPart(profile, 'Al2O3'),
    r2o,
    ro,
    flux: r2o + ro,
  };
}

export function moleCoefficients(material: Material): MoleCoefficients {
  return coefficientsOf(publishedProfile(material));
}

/** Everything the solve reads off one material, derived once: the normalized
 *  oxide profile, the per-part SiO2/Al2O3/flux coefficients and the dominant
 *  oxide a clamp holds. A `feasibleAreas` scan derives this once per material
 *  and reuses it across all sampled targets — see `SolveOptions.chemistry`. */
export type MaterialChemistry = {
  profile: Map<string, number>;
  coefficients: MoleCoefficients;
  dominant: { oxide: string; moles: number } | null;
};

export function materialChemistry(material: Material): MaterialChemistry {
  const profile = publishedProfile(material);
  return { profile, coefficients: coefficientsOf(profile), dominant: dominantOxideOf(profile) };
}
