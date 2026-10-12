import { describe, expect, it } from 'vitest';
import {
  TRIAXIAL_VIEWPORT,
  buildTriaxialModel,
  presentRoFluxes,
  resolveRoFlux,
} from '../src/charts/triaxial-chart';
import { plotRect } from '../src/charts/stull-chart';

const base = { lang: 'en', roFlux: 'CaO' } as const;

describe('presentRoFluxes', () => {
  it('offers only the charted oxides the recipe actually contains', () => {
    const moles = new Map([
      ['CaO', 0.5],
      ['Fe2O3', 0.2],
      ['MgO', 0.05],
      ['K2O', 0.4],
      ['SiO2', 3],
    ]);
    expect(presentRoFluxes(moles)).toEqual(['CaO', 'MgO', 'Fe2O3']);
  });

  it('keeps canonical chart order rather than recipe order', () => {
    expect(presentRoFluxes(new Map([['Fe2O3', 9], ['CaO', 1]]))).toEqual(['CaO', 'Fe2O3']);
  });

  it('offers nothing for a recipe with no charted RO', () => {
    expect(presentRoFluxes(new Map([['SiO2', 3], ['Al2O3', 0.4], ['K2O', 0.3]]))).toEqual([]);
    expect(presentRoFluxes(new Map())).toEqual([]);
  });

  it('ignores a flux that is present but only in trace amounts', () => {
    expect(presentRoFluxes(new Map([['CaO', 0.5], ['BaO', 0]]))).toEqual(['CaO']);
  });
});

describe('resolveRoFlux', () => {
  const moles = new Map([
    ['CaO', 0.2],
    ['MgO', 0.6],
    ['Fe2O3', 0.05],
  ]);
  const present = presentRoFluxes(moles);

  it('keeps the stored corner while the recipe still contains it', () => {
    expect(resolveRoFlux('MgO', moles, present)).toBe('MgO');
  });

  it('falls back to the most abundant corner when the stored one is absent', () => {
    expect(resolveRoFlux('BaO', moles, present)).toBe('MgO');
    expect(resolveRoFlux('Nonsense', moles, present)).toBe('MgO');
    expect(resolveRoFlux(undefined, moles, present)).toBe('MgO');
  });

  it('returns null when the recipe has no charted RO at all', () => {
    expect(resolveRoFlux('CaO', new Map([['SiO2', 3]]), [])).toBeNull();
  });
});

describe('buildTriaxialModel flux ratio', () => {
  it('reports the alkali basis and the selected flux\'s own unity value', () => {
    const model = buildTriaxialModel({
      ...base,
      unity: { sio2: 3.6, al2o3: 0.45, ro: 0.56 },
      alkaliMoles: 0.2,
    });
    expect(model.fluxRatio?.map((line) => line.text)).toEqual(['KNaO = 0.20', 'CaO = 0.56']);
  });

  it('names whichever flux is selected', () => {
    const model = buildTriaxialModel({
      ...base,
      roFlux: 'Fe2O3',
      unity: { sio2: 3.6, al2o3: 0.45, ro: 0.16 },
      alkaliMoles: 0.2,
    });
    expect(model.fluxRatio?.map((line) => line.text)).toEqual(['KNaO = 0.20', 'Fe2O3 = 0.16']);
  });

  it('parks the block a third of the plot height above the vertical middle', () => {
    const plot = plotRect(TRIAXIAL_VIEWPORT);
    const model = buildTriaxialModel({
      ...base,
      unity: { sio2: 3.6, al2o3: 0.45, ro: 0.56 },
      alkaliMoles: 0.2,
    });
    const expected = plot.y + plot.height / 2 - plot.height / 3;
    expect(model.fluxRatio![0]!.y).toBeCloseTo(expected, 6);
    // The second line steps down from the first.
    expect(model.fluxRatio![1]!.y).toBeGreaterThan(model.fluxRatio![0]!.y);
    for (const line of model.fluxRatio!) expect(line.x).toBeLessThanOrEqual(plot.x + 8);
  });

  it('keeps both lines when there is no alkali, and drops the block with no point', () => {
    const noAlkali = buildTriaxialModel({
      ...base,
      unity: { sio2: 3.6, al2o3: 0.45, ro: 0.56 },
      alkaliMoles: 0,
    });
    expect(noAlkali.fluxRatio?.map((line) => line.text)).toEqual(['KNaO = 0.00', 'CaO = 0.56']);
    expect(buildTriaxialModel({ ...base, unity: null, alkaliMoles: 0.2 }).fluxRatio).toBeNull();
  });
});