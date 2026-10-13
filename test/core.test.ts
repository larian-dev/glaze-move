import { describe, expect, it } from 'vitest';
import { OXIDE_BY_FORMULA, SYSTEM_MATERIALS, materialIndex } from '../src/data/catalog';
import type { Material, OxideAmount, OxideClass, OxideIndex, RecipeRow } from '../src/types';
import {
  batchMassPercent,
  batchMoles,
  chemistryRows,
  costPerKg,
  cte,
  effectiveLoi,
  firingTemperatureK,
  loiPercent,
  meltabilityK,
  moleCoefficients,
  molePercent,
  moles,
  publishedProfile,
  renormalizeRecipe,
  oxideMolesPerPart,
  siAlRatio,
  stullPoint,
  to100,
  unityFormula,
  weighingSheet,
} from '../src/core';

const MATERIALS = materialIndex(SYSTEM_MATERIALS);

const pure = (id: string, oxide: string): Material => ({
  id,
  name: id,
  density: 0,
  region: 'world',
  price: 0,
  loi: 0,
  type: 'other',
  local: false,
  components: [{ oxide, amount: 100 }],
});

const row = (materialId: string, amount: number, kind: RecipeRow['kind'] = 'main'): RecipeRow => ({
  materialId,
  amount,
  kind,
});

/** Oxide index with hand-picked classes. Classification tests build on this so
 *  they keep asserting the rule itself and not whatever the shipped oxides table
 *  happens to say about a given oxide today. */
const stubOxides = (classes: Record<string, OxideClass>): OxideIndex =>
  new Map(
    Object.entries(classes).map(([formula, umfType]) => [
      formula,
      {
        formula,
        displayName: formula,
        umfType,
        mw: 60,
        density: 0,
        meltpoint: 0,
        meltability: null,
        cte: null,
      },
    ]),
  );

const ALL_GROUPS: readonly OxideClass[] = ['R2O', 'RO', 'R2O3', 'RO2', 'B2O3', 'Other'];

describe('normalize', () => {
  it('normalizes to 100 and collapses to zeros on an empty input', () => {
    expect(to100([1, 1, 2])).toEqual([25, 25, 50]);
    expect(to100([])).toEqual([]);
    expect(to100([0, 0])).toEqual([0, 0]);
  });

  it('keeps the analysis as published and never renormalizes the LOI away', () => {
    const whiting = SYSTEM_MATERIALS.find((m) => m.id === '3');
    const profile = publishedProfile(whiting!);
    expect(profile.size).toBe(1);
    expect(profile.get('CaO')).toBe(56.1);
  });

  it('sums duplicate component entries for one oxide before weighting', () => {
    const split: Material = {
      ...pure('dup-split', 'SiO2'),
      components: [
        { oxide: 'SiO2', amount: 30 },
        { oxide: 'SiO2', amount: 30 },
        { oxide: 'Na2O', amount: 40 },
      ],
    };
    const merged: Material = {
      ...pure('dup-merged', 'SiO2'),
      components: [
        { oxide: 'SiO2', amount: 60 },
        { oxide: 'Na2O', amount: 40 },
      ],
    };
    expect(publishedProfile(split).get('SiO2')).toBe(60);

    const index = materialIndex([split, merged]);
    const expansion = (material: Material): number | null =>
      cte(molePercent(batchMoles([row(material.id, 100)], index, OXIDE_BY_FORMULA)), OXIDE_BY_FORMULA);
    expect(expansion(split)).toBe(expansion(merged));
    expect(expansion(split)).not.toBeNull();
  });
});

describe('batch', () => {
  it('skips unknown material ids and weights the published profiles', () => {
    const rows = [row('1', 40), row('nope', 60), row('2', 20)];
    const massPercent = batchMassPercent(rows, MATERIALS);
    // Nepheline's oxides sum to 97.92, quartz's to 99.963. The unknown row is
    // dropped from both sides, so the total is the weighted published-share
    // average — not 100.
    const total = [...massPercent.values()].reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo((40 * 97.92 + 20 * 99.963) / 60, 10);
    expect(massPercent.get('SiO2')).toBeCloseTo((40 * 62.93 + 20 * 99.7) / 60, 10);
  });

  it('skips oxides with no catalog entry or no molecular weight', () => {
    const result = moles(
      new Map([
        ['SiO2', 60.08],
        ['Unobtainium', 10],
      ]),
      OXIDE_BY_FORMULA,
    );
    expect([...result.keys()]).toEqual(['SiO2']);
    expect(result.get('SiO2')).toBeCloseTo(1, 12);
  });

  it('returns an empty map for a zero mole total', () => {
    expect(molePercent(new Map([['SiO2', 0]])).size).toBe(0);
  });

  it('drops the additional rows from the chemistry when the toggle is off', () => {
    const rows: RecipeRow[] = [row('1', 40), row('3', 12), row('2', 28)];
    const addition: RecipeRow = { materialId: '3', amount: 5, kind: 'additional' };
    const all = [...rows, addition];

    expect(chemistryRows(all, true)).toEqual(all);
    expect(chemistryRows(all, false)).toEqual(rows);

    // And the point of it: the unity formula moves when the addition is excluded.
    const withAddition = unityFormula(batchMoles(all, MATERIALS, OXIDE_BY_FORMULA), OXIDE_BY_FORMULA);
    const withoutAddition = unityFormula(
      batchMoles(chemistryRows(all, false), MATERIALS, OXIDE_BY_FORMULA),
      OXIDE_BY_FORMULA,
    );
    expect(withAddition.values.get('CaO')).toBeGreaterThan(withoutAddition.values.get('CaO')!);
    expect(withAddition.fluxMoles).toBeGreaterThan(withoutAddition.fluxMoles);
  });

  it('leaves cost and LOI on the whole batch either way', () => {
    const rows: RecipeRow[] = [row('1', 40), row('3', 12)];
    // Kaolin as the addition: it carries a price of its own, so the batch cost
    // moves. Those two weight every row into the pot regardless of the chemistry
    // toggle, which is why `chemistryRows` is not applied to them.
    const all = [...rows, { materialId: '4', amount: 8, kind: 'additional' } as RecipeRow];

    expect(costPerKg(all, MATERIALS)).not.toBeCloseTo(costPerKg(rows, MATERIALS), 6);
    // Kaolin's implied LOI (0.01, the share its oxides leave) sits far below
    // the batch average, so its only effect is to widen the denominator — the
    // dilution is the proof it is being counted at all.
    expect(loiPercent(all, MATERIALS)).toBeLessThan(loiPercent(rows, MATERIALS));
  });

  it('sorts the weighing sheet by amount and scales it to the batch weight', () => {
    const rows: RecipeRow[] = [
      row('1', 10),
      row('2', 30),
      row('nope', 50), // unknown id: no line, and no share of the base
      row('2', 0), // nothing to weigh
      row('5', 5, 'additional'),
      row('3', 20, 'additional'),
    ];
    const sheet = weighingSheet(rows, MATERIALS, 200);

    // The base is 40 (10 + 30) — the unknown and zero-amount rows never enter it.
    expect(sheet.main.map((line) => line.amount)).toEqual([30, 10]);
    expect(sheet.main.map((line) => line.weight)).toEqual([150, 50]);
    expect(sheet.main.map((line) => line.name)).toEqual([
      MATERIALS.get('2')!.name,
      MATERIALS.get('1')!.name,
    ]);
    // Additions read as percentages over the base, so they scale by the same
    // factor: 20 parts of 100 is a fifth of the base and a fifth of the batch.
    expect(sheet.additional.map((line) => line.amount)).toEqual([20, 5]);
    expect(sheet.additional.map((line) => line.weight)).toEqual([100, 25]);
  });

  it('leaves the weights off a sheet with no base to scale', () => {
    const rows: RecipeRow[] = [row('5', 5, 'additional')];
    expect(weighingSheet(rows, MATERIALS, 1000).main).toEqual([]);
    expect(weighingSheet(rows, MATERIALS, 1000).additional).toEqual([
      { name: MATERIALS.get('5')!.name, amount: 5, weight: null },
    ]);
    expect(weighingSheet(rows, MATERIALS, 0).additional[0]?.weight).toBeNull();
  });
});

describe('renormalizeRecipe', () => {
  /** Mains deliberately short of 100 plus a colorant addition: the shape the
   *  To-100% button meets in the wild. */
  const shortRows: RecipeRow[] = [
    row('2', 30),
    row('1', 20),
    row('4', 10),
    { materialId: '23', amount: 11.42, kind: 'additional' },
  ];

  it('brings the main total to exactly 100 and leaves the additions as entered', () => {
    const scaled = renormalizeRecipe(shortRows)!;
    expect(
      scaled.filter((r) => r.kind === 'main').reduce((sum, r) => sum + r.amount, 0),
    ).toBeCloseTo(100, 10);
    // An addition reads as a percentage over the base: the entered number is
    // the one the button leaves alone.
    expect(scaled[3]?.amount).toBe(11.42);
    expect(scaled.map((r) => r.kind)).toEqual(shortRows.map((r) => r.kind));
  });

  it('never moves the base chemistry, though the whole-batch figures do move', () => {
    const scaled = renormalizeRecipe(shortRows)!;
    const umfOf = (list: RecipeRow[], additions: boolean) =>
      unityFormula(
        batchMoles(chemistryRows(list, additions), MATERIALS, OXIDE_BY_FORMULA),
        OXIDE_BY_FORMULA,
      );

    const baseBefore = umfOf(shortRows, false);
    const baseAfter = umfOf(scaled, false);
    for (const [oxide, value] of baseBefore.values) {
      expect(baseAfter.values.get(oxide)).toBeCloseTo(value, 12);
    }
    expect(baseAfter.subtotals.R2O).toBeCloseTo(baseBefore.subtotals.R2O, 12);
    expect(baseAfter.subtotals.RO).toBeCloseTo(baseBefore.subtotals.RO, 12);

    // With the additions in the chemistry the batch does change: 11.42 parts
    // now sit against a 100-part base instead of a 60-part one.
    const wholeBefore = umfOf(shortRows, true);
    const wholeAfter = umfOf(scaled, true);
    expect(wholeAfter.values.get('CaO')).not.toBeCloseTo(wholeBefore.values.get('CaO')!, 3);
  });

  it('returns null when the base sums to nothing', () => {
    expect(renormalizeRecipe([row('2', 0), row('1', 0)])).toBeNull();
  });
});

describe('effectiveLoi', () => {
  const withContents = (components: OxideAmount[], loi: number): Material => ({
    ...pure('loi-material', 'SiO2'),
    components,
    loi,
  });

  it('lets an entered LOI win over the implied remainder', () => {
    expect(effectiveLoi(withContents([{ oxide: 'SiO2', amount: 97.92 }], 1))).toBe(1);
  });

  it('reads the share the oxides leave as the loss when none is entered', () => {
    expect(effectiveLoi(withContents([{ oxide: 'CaO', amount: 56.1 }], 0))).toBeCloseTo(43.9, 10);
    expect(effectiveLoi(withContents([{ oxide: 'SiO2', amount: 100 }], 0))).toBe(0);
  });

  it('treats an over-100 total as gain on ignition, not as an error', () => {
    expect(effectiveLoi(withContents([{ oxide: 'SiO2', amount: 102 }], 0))).toBeCloseTo(-2, 10);
  });

  it('leaves a material with nothing entered at its stored LOI', () => {
    expect(effectiveLoi(withContents([], 0))).toBe(0);
    expect(effectiveLoi(withContents([], 5))).toBe(5);
  });

  it('keeps negative LOI finite through the weighted batch report', () => {
    const goi: Material = { ...pure('goi', 'SiO2'), loi: -2 };
    const index = materialIndex([...SYSTEM_MATERIALS, goi]);
    const rows: RecipeRow[] = [row('2', 50), row('goi', 50)];
    // Quartz carries no entered LOI, so its share of its own 100% (0.037) is
    // implied; the GOI material drags the batch figure below zero — finite.
    expect(loiPercent(rows, index)).toBeCloseTo((50 * 0.037 + 50 * -2) / 100, 10);
  });
});

describe('geometry', () => {
  it('converts a known oxide mass share to moles per part', () => {
    expect(oxideMolesPerPart(new Map([['SiO2', 60.08]]), 'SiO2')).toBeCloseTo(0.01, 12);
  });

  it('returns 0 for unknown oxides and for unusable molecular weights', () => {
    const profile = new Map([
      ['SiO2', 60.08],
      ['Unobtainium', 10],
    ]);
    expect(oxideMolesPerPart(profile, 'Unobtainium')).toBe(0);

    // No shipped catalog entry has MW ≤ 0, so stub one and remove it again.
    OXIDE_BY_FORMULA.set('NoMwOxide', {
      formula: 'NoMwOxide',
      displayName: 'NoMwOxide',
      umfType: 'Other',
      mw: 0,
      density: 0,
      meltpoint: 0,
      meltability: null,
      cte: null,
    });
    try {
      expect(oxideMolesPerPart(new Map([['NoMwOxide', 50]]), 'NoMwOxide')).toBe(0);
    } finally {
      OXIDE_BY_FORMULA.delete('NoMwOxide');
    }
  });

  it('accumulates only R2O and RO oxides into the flux coefficient', () => {
    const material: Material = {
      ...pure('geometry', 'SiO2'),
      components: [
        { oxide: 'SiO2', amount: 30 },
        { oxide: 'Al2O3', amount: 10 },
        { oxide: 'Na2O', amount: 25 },
        { oxide: 'CaO', amount: 25 },
        { oxide: 'TiO2', amount: 10 },
      ],
    };
    const coefficients = moleCoefficients(material);
    expect(coefficients.silica).toBeCloseTo(0.3 / 60.08, 12);
    expect(coefficients.alumina).toBeCloseTo(0.1 / 101.96, 12);
    expect(coefficients.flux).toBeCloseTo(0.25 / 61.98 + 0.25 / 56.08, 12);
  });
});

describe('unity formula', () => {
  const OXIDE_ORDER = ['K2O', 'SiO2', 'TiO2', 'SnO2', 'CuO', 'Fe2O3', 'CoO'];
  const amounts = [100, 40, 4, 5, 2, 2, 1.5];
  const index = materialIndex(OXIDE_ORDER.map((o, i) => pure(String(i + 1), o)));
  const batch = batchMoles(
    OXIDE_ORDER.map((_, i) => row(String(i + 1), amounts[i] ?? 0)),
    index,
    OXIDE_BY_FORMULA,
  );

  it('places every oxide in the one group its table entry declares', () => {
    const umf = unityFormula(batch, OXIDE_BY_FORMULA);
    for (const formula of OXIDE_ORDER) {
      const declared = OXIDE_BY_FORMULA.get(formula)!.umfType;
      const placed = ALL_GROUPS.filter((group) => umf.groups[group].includes(formula));
      expect(placed).toEqual([declared]);
    }
  });

  it('scales to a unity flux basis and keeps below-threshold oxides out of group sums', () => {
    const umf = unityFormula(batch, OXIDE_BY_FORMULA);

    expect(umf.unityDefined).toBe(true);
    expect(umf.subtotals.R2O + umf.subtotals.RO).toBeCloseTo(1, 10);
    expect(umf.values.get('SiO2')!).toBeCloseTo(batch.get('SiO2')! / umf.fluxMoles, 12);
    expect(umf.subtotals.Other).toBe(0);
    expect(umf.values.get('CoO')!).toBeGreaterThan(0);
  });

  it('promotes an Other oxide into the flux basis only once it clears the threshold', () => {
    const oxides = stubOxides({ Na2O: 'R2O', CaO: 'RO', ZrO2: 'RO2', Fe2O3: 'Other' });
    const typed = new Map([['Na2O', 0.5], ['CaO', 0.25], ['ZrO2', 3]]);

    const below = unityFormula(new Map([...typed, ['Fe2O3', 0.05]]), oxides);
    expect(below.fluxMoles).toBeCloseTo(0.75, 12);
    expect(below.isFlux.get('Fe2O3')).toBe(false);
    expect(below.groups.Other).toContain('Fe2O3');
    expect(below.subtotals.Other).toBe(0);

    const above = unityFormula(new Map([...typed, ['Fe2O3', 0.5]]), oxides);
    expect(above.isFlux.get('Fe2O3')).toBe(true);
    expect(above.fluxMoles).toBeCloseTo(1.25, 12);
  });

  it('refuses to define a unity formula without any flux', () => {
    const oxides = stubOxides({ SiO2: 'RO2', Al2O3: 'R2O3', P2O5: 'Other' });
    const fluxless = new Map([['SiO2', 0.6], ['Al2O3', 0.3], ['P2O5', 0.1]]);
    const result = unityFormula(fluxless, oxides);

    expect(result.unityDefined).toBe(false);
    expect(result.fluxMoles).toBe(0);
    expect(result.isFlux.get('P2O5')).toBe(false);
    expect(result.values.get('P2O5')).toBe(fluxless.get('P2O5'));
    expect(result.subtotals.RO2).toBeCloseTo(fluxless.get('SiO2')!, 12);
    expect([...result.values.values()].every(Number.isFinite)).toBe(true);
    expect(stullPoint(fluxless, result.fluxMoles)).toBeNull();
  });

  it('never promotes an Other-typed oxide to flux while nothing is typed as flux', () => {
    // With nTyped = 0 the threshold ratio is undefined, so the nTyped > 0 guard
    // must keep the Other oxide out of the flux basis entirely.
    const oxides = stubOxides({ SiO2: 'RO2', Al2O3: 'R2O3', ZrO2: 'RO2', CoO: 'Other' });
    const fluxless = new Map([['SiO2', 0.6], ['Al2O3', 0.3], ['ZrO2', 0.1], ['CoO', 0.4]]);
    const result = unityFormula(fluxless, oxides);

    expect(result.unityDefined).toBe(false);
    expect(result.fluxMoles).toBe(0);
    expect(result.isFlux.get('CoO')).toBe(false);
    expect(result.groups.Other).toContain('CoO');
    expect(result.subtotals.Other).toBe(0);
  });
});

describe('ratios', () => {
  it('computes Si/Al or reports it as unavailable', () => {
    expect(siAlRatio(new Map([['SiO2', 4], ['Al2O3', 2]]))).toBe(2);
    expect(siAlRatio(new Map([['SiO2', 4]]))).toBeNull();
    expect(siAlRatio(new Map([['SiO2', 0], ['Al2O3', 2]]))).toBeNull();
  });

  it('weights expansion coefficients by mole %', () => {
    const expansion = cte(
      new Map([
        ['SiO2', 70],
        ['Na2O', 10],
        ['CaO', 20],
      ]),
      OXIDE_BY_FORMULA,
    );
    expect(expansion).toBeCloseTo(0.35 * 70 + 3.95 * 10 + 1.3 * 20, 10);
  });

  it('applies the composition-dependent SiO2, B2O3 and PbO rules', () => {
    expect(cte(new Map([['SiO2', 50], ['Na2O', 50], ['B2O3', 0]]), OXIDE_BY_FORMULA)).toBeCloseTo(
      0.38 * 50 + 3.95 * 50,
      10,
    );
    expect(
      cte(
        new Map([
          ['SiO2', 80],
          ['B2O3', 20],
        ]),
        OXIDE_BY_FORMULA,
      ),
    ).toBeCloseTo(0.25 * 80 + 0 * 20, 10);
    expect(
      cte(
        new Map([
          ['SiO2', 60],
          ['Na2O', 10],
          ['PbO', 30],
        ]),
        OXIDE_BY_FORMULA,
      ),
    ).toBeCloseTo(0.38 * 60 + 3.95 * 10 + 1.65 * 30, 10);
  });

  it('shifts the TiO2 coefficient by 0.015 per point of silica around 50%', () => {
    expect(cte(new Map([['SiO2', 60], ['TiO2', 10], ['Na2O', 30]]), OXIDE_BY_FORMULA)).toBeCloseTo(
      0.38 * 60 + (0.3 - 0.015 * (60 - 50)) * 10 + 3.95 * 30,
      10,
    );
    expect(cte(new Map([['SiO2', 40], ['TiO2', 20], ['Na2O', 40]]), OXIDE_BY_FORMULA)).toBeCloseTo(
      0.38 * 40 + (0.3 - 0.015 * (40 - 50)) * 20 + 3.95 * 40,
      10,
    );
  });

  it('flattens the B2O3 coefficient once the modifiers exceed four times the boron', () => {
    // φ = (Li₂O+Na₂O+K₂O+BaO+CaO)/B₂O₃ = 45/10 = 4.5 > 4 → flat −0.5
    expect(cte(new Map([['SiO2', 45], ['Na2O', 25], ['CaO', 20], ['B2O3', 10]]), OXIDE_BY_FORMULA)).toBeCloseTo(
      0.38 * 45 + 3.95 * 25 + 1.3 * 20 - 0.5 * 10,
      10,
    );
    // φ = 30/15 = 2 ≤ 4 → 0.125·(4 − φ) − 0.5 = −0.25
    expect(cte(new Map([['SiO2', 55], ['Na2O', 30], ['B2O3', 15]]), OXIDE_BY_FORMULA)).toBeCloseTo(
      0.38 * 55 + 3.95 * 30 + (0.125 * (4 - 2) - 0.5) * 15,
      10,
    );
  });

  it('gives no expansion estimate without silica', () => {
    expect(cte(new Map([['Na2O', 100]]), OXIDE_BY_FORMULA)).toBeNull();
  });

  it('splits meltability into a flux numerator and a refractory denominator', () => {
    const base = meltabilityK(
      new Map([
        ['SiO2', 70],
        ['Na2O', 20],
        ['CaO', 10],
      ]),
      OXIDE_BY_FORMULA,
    );
    expect(base.k).toBeCloseTo(0.4, 12);
    expect(base.approximate).toBe(false);
    expect(firingTemperatureK(base.k).celsius).toBe(1100);
  });

  it('switches Al2O3 between flux and refractory at 3 mass %', () => {
    const asFlux = meltabilityK(
      new Map([
        ['SiO2', 70],
        ['Al2O3', 3],
        ['Na2O', 27],
      ]),
      OXIDE_BY_FORMULA,
    );
    const asRefractory = meltabilityK(
      new Map([
        ['SiO2', 70],
        ['Al2O3', 5],
        ['Na2O', 25],
      ]),
      OXIDE_BY_FORMULA,
    );
    expect(asFlux.k).toBeCloseTo((27 + 0.3 * 3) / 70, 12);
    expect(asRefractory.k).toBeCloseTo(25 / (70 + 1.2 * 5), 12);
  });

  it('flags oxides with no meltability data and skips them from K', () => {
    const result = meltabilityK(
      new Map([
        ['SiO2', 70],
        ['Na2O', 25],
        ['TiO2', 5],
      ]),
      OXIDE_BY_FORMULA,
    );
    expect(result.approximate).toBe(true);
    expect(result.k).toBeCloseTo(25 / 70, 12);
    expect(firingTemperatureK(null).celsius).toBeNull();
    expect(meltabilityK(new Map([['Na2O', 100]]), OXIDE_BY_FORMULA).k).toBeNull();
  });

  it('interpolates the K to celsius table and clamps outside it', () => {
    expect(firingTemperatureK(1.25).celsius).toBeCloseTo(762, 10);
    expect(firingTemperatureK(0.95).celsius).toBeCloseTo(789, 10);
    expect(firingTemperatureK(0.55).celsius).toBeCloseTo(965, 10);
    expect(firingTemperatureK(1).celsius).toBe(778);
    expect(firingTemperatureK(2).celsius).toBe(750);
    expect(firingTemperatureK(3).celsius).toBe(750);
    expect(firingTemperatureK(0.1).celsius).toBe(1450);
    expect(firingTemperatureK(0.05).celsius).toBe(1450);
  });

  it('weights cost and LOI by the whole batch', () => {
    const rows = [row('1', 40), row('2', 20), row('3', 10), row('4', 5, 'additional')];
    expect(costPerKg(rows, MATERIALS)).toBeCloseTo((40 * 150 + 20 * 90 + 10 * 80 + 5 * 45) / 75, 10);
    // Stored LOI only on the nepheline. Quartz, whiting and kaolin enter none,
    // so each contributes the share its oxides leave of its own 100% —
    // whiting's 43.9 = 100 − 56.1 CaO is the datasheet convention.
    const weightedLoi =
      (40 * 1 + 20 * (100 - 99.963) + 10 * (100 - 56.1) + 5 * (100 - 99.99)) / 75;
    expect(loiPercent(rows, MATERIALS)).toBeCloseTo(weightedLoi, 10);
    expect(costPerKg([], MATERIALS)).toBe(0);
    expect(loiPercent([], MATERIALS)).toBe(0);
  });
});

describe('a realistic glaze stays finite', () => {
  const rows = [row('1', 40), row('2', 20), row('3', 10), row('5', 15, 'additional')];
  const massPercent = batchMassPercent(rows, MATERIALS);
  const batch = batchMoles(rows, MATERIALS, OXIDE_BY_FORMULA);
  const shares = molePercent(batch);
  const umf = unityFormula(batch, OXIDE_BY_FORMULA);
  const melt = meltabilityK(massPercent, OXIDE_BY_FORMULA);
  const temperature = firingTemperatureK(melt.k, melt.approximate);

  it('produces finite values across the whole pipeline', () => {
    expect([...massPercent.values()].every(Number.isFinite)).toBe(true);
    expect([...batch.values()].every(Number.isFinite)).toBe(true);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(100, 8);
    expect([...umf.values.values()].every(Number.isFinite)).toBe(true);
    expect(Object.values(umf.subtotals).every(Number.isFinite)).toBe(true);
    expect(cte(shares, OXIDE_BY_FORMULA)!).toBeGreaterThan(0);
    expect(siAlRatio(batch)!).toBeGreaterThan(0);
    expect(Number.isFinite(melt.k)).toBe(true);
    expect(temperature.celsius!).toBeGreaterThanOrEqual(750);
    expect(temperature.celsius!).toBeLessThanOrEqual(1450);
  });

  it('places the base glaze on the Stull map and closes the unity basis', () => {
    const base = batchMoles(
      rows.filter((r) => r.kind === 'main'),
      MATERIALS,
      OXIDE_BY_FORMULA,
    );
    const baseUmf = unityFormula(base, OXIDE_BY_FORMULA);
    const point = stullPoint(base, baseUmf.fluxMoles)!;
    expect(point.x).toBeCloseTo(baseUmf.values.get('SiO2')!, 12);
    expect(point.y).toBeCloseTo(baseUmf.values.get('Al2O3')!, 12);
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeGreaterThan(0);
    expect(baseUmf.subtotals.R2O + baseUmf.subtotals.RO).toBeCloseTo(1, 10);
  });
});