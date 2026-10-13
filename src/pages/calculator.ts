import { createD3Adapter } from '../charts/adapter-d3';
import type {
  ChartAdapter,
  StullInteraction,
  TriaxialInteraction,
  TriaxialTarget,
} from '../charts/adapter';
import { buildStullModel, type Domain } from '../charts/stull-chart';
import type { StullModel } from '../charts/stull-chart';
import type { Pt, TriaxialRo } from '../charts/stull-data';
import { buildTriaxialModel, preloadBackdrop, presentRoFluxes, resolveRoFlux } from '../charts/triaxial-chart';
import type { TriaxialModel } from '../charts/triaxial-chart';
import { buildBoronModel } from '../charts/boron-chart';
import type { BoronModel } from '../charts/boron-chart';
import { calibrationFor } from '../charts/triaxial-calibration';
import {
  batchMassPercent,
  batchMoles,
  chemistryRows,
  costPerKg,
  cte,
  feasibleAreas,
  firingTemperatureK,
  loiPercent,
  meltabilityK,
  moleCoefficients,
  molePercent,
  siAlRatio,
  solveForStullTarget,
  solveForTarget,
  stullPoint,
  triaxialAxes,
  unityFormula,
} from '../core';
import type { AdditionClamp, SolveRejection } from '../core';
import { OXIDE_BY_FORMULA, SYSTEM_MATERIALS, materialIndex } from '../data/catalog';
import { debugLog, debugRows } from '../debug';
import { t } from '../i18n';
import type { Lang, TranslationKey } from '../i18n';
import { bindStore, createStore } from '../state/form';
import type { FormState } from '../state/form';
import {
  SHARE_PARAM,
  DEFAULT_FORM,
  exportToFile,
  importRecipeText,
  loadForm,
  rowsFromLocation,
  saveForm,
  shareUrl,
} from '../state/persistence';
import type { PersistedForm } from '../state/persistence';
import type { Material, MaterialIndex, RecipeRow } from '../types';
import { createChangeHistory, createRecipeEditor, createResults, el, setText } from '../ui';
import type { ResultsValues, UnitDisplay } from '../ui';
import { cycleToggle, switchToggle } from '../ui/dom';

export type CalculatorPage = {
  setLang: (lang: Lang) => void;
};

type Computed = {
  values: ResultsValues;
  stull: StullModel;
  /** Charted RO fluxes this recipe contains, in chart order. */
  roPresent: TriaxialRo[];
  /** The active corner, or null when the recipe holds no charted RO. */
  roSelected: TriaxialRo | null;
  triaxial: TriaxialModel | null;
  boron: BoronModel;
  /** Unity B₂O₃ of the whole batch — the boron map's x. */
  b2o3: number;
  /** Calculated firing temperature — the boron map's y; null without one. */
  celsius: number | null;
};

/** How long the recipe must sit still before it becomes a history checkpoint. */
const CHECKPOINT_DELAY_MS = 600;

function materialIndexOf(state: FormState): MaterialIndex {
  return materialIndex(state.materials);
}

/**
 * Shown on a first visit so the app opens on a real recipe rather than an empty
 * form. Ids are the ones in `src/data/materials.json`: quartz, nepheline,
 * kaolin, chalk, plus Gzhel clay body as an addition — something for the
 * additions clamp to act on. Applied only when nothing is stored and no share
 * link is present.
 */
const DEFAULT_RECIPE: RecipeRow[] = [
  { materialId: '1', amount: 40.5, kind: 'main' },
  { materialId: '2', amount: 36, kind: 'main' },
  { materialId: '3', amount: 15, kind: 'main' },
  { materialId: '5', amount: 8.5, kind: 'main' },
  { materialId: '15', amount: 4, kind: 'additional' },
  { materialId: '38', amount: 0.4, kind: 'additional' },
  { materialId: '39', amount: 0.5, kind: 'additional' },
  { materialId: '37', amount: 1, kind: 'additional' },
];

/** The additions clamp's three states, in cycle order, and the label each one
 *  shows: the switch names the state it is in, so the row needs no legend. */
const ADDITION_CLAMPS: readonly AdditionClamp[] = ['amount', 'unity', 'free'];
const additionClampKeys: Record<AdditionClamp, TranslationKey> = {
  amount: 'stull.clampAmount',
  unity: 'stull.clampUnity',
  free: 'stull.clampFree',
};

/** `?recipe=` wins over the stored form; display settings always come from storage. */
function initialState(lang: Lang, materials: Material[]): FormState {
  const stored = loadForm();
  const shared = rowsFromLocation(window.location.search);
  if (shared) {
    // Payload consumed — drop `?recipe=` from the address bar, keep other
    // params and the hash, without reloading.
    const url = new URL(window.location.href);
    url.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(null, '', url.toString());
  }
  const rows = shared ?? stored?.rows ?? DEFAULT_RECIPE;
  // Passed through unvalidated on purpose: `compute` re-resolves the corner
  // against the recipe on every pass, so a stored one the recipe does not
  // contain can never survive a render.
  return {
    rows,
    unitDisplay: stored?.unitDisplay ?? 'unity',
    lang,
    roFlux: stored?.roFlux ?? '',
    includeAdditions: stored?.includeAdditions ?? DEFAULT_FORM.includeAdditions,
    clampFluxRatio: stored?.clampFluxRatio ?? DEFAULT_FORM.clampFluxRatio,
    additionClamp: stored?.additionClamp ?? DEFAULT_FORM.additionClamp,
    clampBoron: stored?.clampBoron ?? DEFAULT_FORM.clampBoron,
    materials,
  };
}

function persistable(state: FormState): PersistedForm {
  return {
    rows: state.rows,
    unitDisplay: state.unitDisplay,
    lang: state.lang,
    roFlux: state.roFlux,
    includeAdditions: state.includeAdditions,
    clampFluxRatio: state.clampFluxRatio,
    additionClamp: state.additionClamp,
    clampBoron: state.clampBoron,
  };
}

function snapbackKey(reason: SolveRejection): TranslationKey {
  return `stull.snapback.${reason}`;
}

/**
 * Flux basis of the Stull point: the typed R₂O + RO moles on batchMoles' scale
 * — the same ×100/total normalization batchMoles divides by — so the point
 * reads the same whichever units the rows happen to sum to (with additions in
 * the map they do not sum to 100). Using `unityFormula().fluxMoles` instead
 * would add the promoted "other" oxides and the point would never quite land
 * on the dragged target.
 */
function stullFlux(rows: RecipeRow[], materials: MaterialIndex): number {
  let flux = 0;
  let total = 0;
  for (const row of rows) {
    const material = materials.get(row.materialId);
    if (!material || row.amount === 0) continue;
    flux += row.amount * moleCoefficients(material).flux;
    total += row.amount;
  }
  return total > 0 ? (flux * 100) / total : 0;
}

/**
 * One pass from rows + materials to everything the page shows. The triaxial point
 * uses the whole batch; the Stull point, hull and drag solve follow the UMF
 * switch and the additions clamp — the base alone, or the additions pinned in.
 */
function compute(state: FormState, materials: MaterialIndex, zoom: Domain | null): Computed {
  const mainRows = state.rows.filter((row) => row.kind === 'main');
  const chemRows = chemistryRows(state.rows, state.includeAdditions);
  // The chart's basis is the UMF switch alone: additions count in the displayed
  // point whenever the chemistry says so. The per-component switches only clamp
  // rows inside the drag solve — they must never move the marker.
  const chartRows = state.includeAdditions ? state.rows : mainRows;
  const solveOptions = {
    includeAdditions: state.includeAdditions,
    clampFluxRatio: state.clampFluxRatio,
    additionClamp: state.additionClamp,
    clampBoron: state.clampBoron,
  };

  const massPercent = batchMassPercent(chemRows, materials);
  const moles = batchMoles(chemRows, materials, OXIDE_BY_FORMULA);
  const umf = unityFormula(moles, OXIDE_BY_FORMULA);
  const molePct = molePercent(moles);
  const meltability = meltabilityK(massPercent, OXIDE_BY_FORMULA);

  const values: ResultsValues = {
    umf,
    molePercent: molePct,
    siAlRatio: siAlRatio(moles),
    cte: cte(molePct, OXIDE_BY_FORMULA),
    firing: firingTemperatureK(meltability.k, meltability.approximate),
    costPerKg: costPerKg(state.rows, materials),
    loi: loiPercent(state.rows, materials),
    // The additions clamp holds each addition's own amount — or its share of the
    // flux — so it has no single UMF entry to tint; the boron clamp holds the
    // displayed B₂O₃ and drops out of a batch without it. The R₂O:RO clamp tints
    // its ratio tile instead.
    clamped: state.clampBoron && (moles.get('B2O3') ?? 0) > 0 ? { B2O3: true } : {},
    clampedFluxRatio: state.clampFluxRatio,
  };

  const chartMoles = batchMoles(chartRows, materials, OXIDE_BY_FORMULA);
  const chartFlux = stullFlux(chartRows, materials);
  const point = stullPoint(chartMoles, chartFlux);
  // One console line per recompute when the debug flag is on: the switches the
  // drags will obey, the rows they start from and the point on the map.
  debugLog('state', {
    switches: {
      inUmf: state.includeAdditions,
      additions: state.additionClamp,
      fluxRatio: state.clampFluxRatio,
      boron: state.clampBoron,
    },
    rows: debugRows(state.rows),
    point: point ? `${point.x.toFixed(3)}/${point.y.toFixed(3)}` : 'none',
  });

  const roPresent = presentRoFluxes(moles);
  const roSelected = resolveRoFlux(state.roFlux, moles, roPresent);
  const unity = umf.values;
  const sio2 = unity.get('SiO2') ?? 0;
  const al2o3 = unity.get('Al2O3') ?? 0;
  const ro = roSelected === null ? 0 : unity.get(roSelected) ?? 0;
  const alkali = (unity.get('K2O') ?? 0) + (unity.get('Na2O') ?? 0);
  const b2o3 = unity.get('B2O3') ?? 0;
  const celsius = values.firing.celsius;

  return {
    values,
    stull: buildStullModel({
      lang: state.lang,
      point,
      areas: feasibleAreas(chartRows, materials, solveOptions),
      domain: zoom,
    }),
    roPresent,
    roSelected,
    triaxial:
      roSelected === null
        ? null
        : buildTriaxialModel({
            lang: state.lang,
            roFlux: roSelected,
            unity: sio2 + al2o3 + ro > 0 ? { sio2, al2o3, ro } : null,
            alkaliMoles: alkali,
            vertices: calibrationFor(roSelected),
          }),
    boron: buildBoronModel({ lang: state.lang, b2o3, celsius }),
    b2o3,
    celsius,
  };
}

/** Builds the calculator page into `container`; the returned handle only switches language. */
export function renderCalculatorPage(
  container: HTMLElement,
  lang: Lang,
  localMaterials: Material[] = [],
): CalculatorPage {
  const state = createStore(initialState(lang, [...SYSTEM_MATERIALS, ...localMaterials]));
  const materials = materialIndexOf(state.get());

  const recipeHost = el('div', { class: 'panel panel--recipe' });
  const resultsHost = el('div', { class: 'panel panel--results' });
  const historyHost = el('div', { class: 'panel panel--history' });

  const stullHint = el('p', { class: 'panel-hint' });
  const stullChart = el('div', { class: 'chart chart--stull' });
  const stullNotice = el('p', { class: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });

  const roTools = el('div', {
    class: 'ro-toggle',
    attrs: { role: 'group', 'aria-label': t(lang, 'triaxial.roFlux') },
  });
  const triaxialHint = el('p', { class: 'panel-hint' });
  const triaxialChart = el('div', { class: 'chart chart--triaxial' });
  const triaxialNotice = el('p', { class: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });

  const boronHint = el('p', { class: 'panel-hint' });
  const boronChart = el('div', { class: 'chart chart--boron' });
  const boronStatus = el('p', { class: 'panel-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const boronNotice = el('p', { class: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });

  const transferTitle = el('h2', { class: 'panel-title' });
  const exportButton = el('button', { type: 'button', class: 'button' });
  const importButton = el('button', { type: 'button', class: 'button' });
  const shareButton = el('button', { type: 'button', class: 'button' });
  const transferStatus = el('p', { class: 'panel-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  /** Paste-a-link-or-code import dialog, built once; labels repaint on language
   *  switches, the textarea resets on every open. */
  const importTitle = el('p', { class: 'dialog-title', text: t(lang, 'transfer.import') });
  const importTextarea = el('textarea', {
    class: 'import-textarea',
    attrs: {
      rows: '5',
      placeholder: t(lang, 'transfer.importPlaceholder'),
      'aria-label': t(lang, 'transfer.importPlaceholder'),
    },
  });
  const importError = el('p', { class: 'dialog-status', attrs: { role: 'status' } });
  const importApply = el('button', { type: 'button', class: 'button', text: t(lang, 'transfer.import') });
  const importCancel = el('button', { type: 'button', class: 'button', text: t(lang, 'transfer.importCancel') });
  const importDialog = el('dialog', { class: 'import-dialog' }, [
    importTitle,
    importTextarea,
    importError,
    el('div', { class: 'button-row' }, [importApply, importCancel]),
  ]);

  // The drag solver's switches live with the chart they govern: they decide
  // what the solve — and therefore the dashed hull — is allowed to do. The
  // additions clamp is one switch in three states, its label naming the state.
  const clampSwitch = switchToggle(
    () => state.get().clampFluxRatio,
    t(lang, 'stull.clampFluxRatio'),
    (value) => state.set({ clampFluxRatio: value }),
  );
  const clampAdditionsToggle = cycleToggle(
    ADDITION_CLAMPS,
    () => state.get().additionClamp,
    (value) => t(lang, additionClampKeys[value]),
    (value) => state.set({ additionClamp: value }),
  );
  const clampBoronSwitch = switchToggle(
    () => state.get().clampBoron,
    t(lang, 'stull.clampBoron'),
    (value) => state.set({ clampBoron: value }),
  );
  // One panel, three maps: the tab labels are the charts' names, and each view
  // keeps its own tools, hint and notice. Only the active view is in the
  // document flow, so a drag can never land on a hidden map.
  const tabKeys = ['stull', 'triaxial', 'boron'] as const;
  type ChartTabKey = (typeof tabKeys)[number];
  const tabLabel: Record<ChartTabKey, TranslationKey> = {
    stull: 'stull.title',
    triaxial: 'triaxial.title',
    boron: 'boron.title',
  };
  const tabButtons: Record<ChartTabKey, HTMLButtonElement> = {
    stull: el('button', {
      type: 'button',
      class: 'chart-tab',
      attrs: { role: 'tab', id: 'chart-tab-stull', 'aria-controls': 'chart-view-stull' },
    }),
    triaxial: el('button', {
      type: 'button',
      class: 'chart-tab',
      attrs: { role: 'tab', id: 'chart-tab-triaxial', 'aria-controls': 'chart-view-triaxial' },
    }),
    boron: el('button', {
      type: 'button',
      class: 'chart-tab',
      attrs: { role: 'tab', id: 'chart-tab-boron', 'aria-controls': 'chart-view-boron' },
    }),
  };
  const chartTabs = el(
    'div',
    { class: 'chart-tabs', attrs: { role: 'tablist', 'aria-label': t(lang, 'charts.label') } },
    tabKeys.map((key) => tabButtons[key]),
  );

  const chartViews: Record<ChartTabKey, HTMLElement> = {
    stull: el(
      'div',
      {
        class: 'chart-view',
        attrs: { role: 'tabpanel', id: 'chart-view-stull', 'aria-labelledby': 'chart-tab-stull' },
      },
      [
        el('div', { class: 'panel-head' }, [clampSwitch, clampAdditionsToggle, clampBoronSwitch]),
        stullHint,
        stullChart,
        stullNotice,
      ],
    ),
    triaxial: el(
      'div',
      {
        class: 'chart-view',
        attrs: { role: 'tabpanel', id: 'chart-view-triaxial', 'aria-labelledby': 'chart-tab-triaxial' },
      },
      [
        el('div', { class: 'panel-head' }, [roTools]),
        triaxialHint,
        triaxialNotice,
        triaxialChart,
      ],
    ),
    boron: el(
      'div',
      {
        class: 'chart-view',
        attrs: { role: 'tabpanel', id: 'chart-view-boron', 'aria-labelledby': 'chart-tab-boron' },
      },
      [boronHint, boronChart, boronStatus, boronNotice],
    ),
  };

  const chartPanel = el('div', { class: 'panel panel--charts' }, [
    chartTabs,
    ...tabKeys.map((key) => chartViews[key]),
  ]);

  /** One map at a time. The roving tabindex keeps the strip a single tab stop,
   *  and the arrow keys walk it the way a tablist is expected to. */
  let activeChart: ChartTabKey = 'stull';
  function showChart(key: ChartTabKey): void {
    activeChart = key;
    for (const other of tabKeys) {
      const selected = other === key;
      tabButtons[other].setAttribute('aria-selected', String(selected));
      tabButtons[other].tabIndex = selected ? 0 : -1;
      chartViews[other].hidden = !selected;
    }
  }
  for (const key of tabKeys) {
    tabButtons[key].addEventListener('click', () => showChart(key));
  }
  chartTabs.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? tabKeys.length - 1 : null;
    if (step === 0 && jump === null) return;
    event.preventDefault();
    const index = tabKeys.indexOf(activeChart);
    const next = jump ?? (index + step + tabKeys.length) % tabKeys.length;
    const key = tabKeys[next];
    if (!key) return;
    showChart(key);
    tabButtons[key].focus();
  });
  showChart('stull');

  const transferPanel = el('div', { class: 'panel panel--transfer' }, [
    transferTitle,
    el('div', { class: 'button-row' }, [exportButton, importButton, shareButton]),
    transferStatus,
  ]);

  container.replaceChildren(
    el('div', { class: 'layout' }, [
      el('div', { class: 'column column--recipe' }, [recipeHost, transferPanel]),
      el('div', { class: 'column column--results' }, [resultsHost, historyHost]),
      el('div', { class: 'column column--charts' }, [chartPanel]),
    ]),
  );
  container.append(importDialog);

  let adapter: ChartAdapter | null = null;
  /** Visible Stull window while zoomed; null = the full 0–9 × 0–1 map. */
  let stullZoom: Domain | null = null;
  let computed: Computed = compute(state.get(), materials, stullZoom);

  const results = createResults(resultsHost, {
    lang,
    unitDisplay: state.get().unitDisplay,
    onUnitDisplayChange: (unitDisplay: UnitDisplay) => state.set({ unitDisplay }),
  });

  const history = createChangeHistory(historyHost, {
    lang,
    onRestore: (rows) => {
      // Drop the pending checkpoint so its debounce timer cannot fire after the
      // switch and re-checkpoint the recipe that was just restored.
      clearTimeout(checkpointTimer);
      checkpointTimer = undefined;
      checkpointRows = null;
      state.set({ rows });
      editor.render(rows, state.get().lang);
    },
  });

  const editor = createRecipeEditor(recipeHost, {
    rows: state.get().rows,
    materials,
    lang,
    includeAdditions: state.get().includeAdditions,
    onChange: (rows) => {
      // Structural edits — a row added, removed, or pointed at another material:
      // persisted and recomputed, but no checkpoint. Half-built rows would
      // otherwise fill the history before the amount that makes them a recipe.
      state.set({ rows });
    },
    onAmountChange: (rows) => {
      state.set({ rows });
      scheduleCheckpoint(rows);
    },
    onIncludeAdditionsChange: (include) => {
      // A view preference, not a recipe edit: no checkpoint, no history entry.
      state.set({ includeAdditions: include });
    },
  });

  /** One button per charted RO the recipe actually contains, in chart order; the
 *  active corner is the pressed one. Rebuilt on every refresh, because which
 *  fluxes qualify changes with the recipe. */
function paintRoTools(): void {
    const selected = computed.roSelected;
    // Warm every reachable map so a switch never lands on a cancelled fetch.
    for (const ro of computed.roPresent) preloadBackdrop(ro);
    const buttons = computed.roPresent.map((ro) => {
      const button = el('button', {
        type: 'button',
        class: 'button',
        text: ro,
        attrs: { 'aria-pressed': String(ro === selected) },
      });
      button.addEventListener('click', () => state.set({ roFlux: ro }));
      return button;
    });
    roTools.replaceChildren(...buttons);
    roTools.toggleAttribute('hidden', selected === null);
    setText(
      triaxialNotice,
      selected === null ? t(state.get().lang, 'triaxial.noRoFlux') : '',
    );
  }

  /**
   * The boron map always draws; this reports what the plotted point means, and
   * says why there is none. The marker itself is clamped to the published map's
   * edge when a value falls outside it, so the exact figures are printed here.
   */
  function paintBoron(): void {
    const lang = state.get().lang;
    const { b2o3, celsius } = computed;
    if (b2o3 <= 0) {
      setText(boronStatus, '');
      setText(boronNotice, t(lang, 'boron.noBoron'));
      return;
    }
    if (celsius === null) {
      setText(boronStatus, '');
      setText(boronNotice, t(lang, 'boron.noFiring'));
      return;
    }
    setText(boronNotice, '');
    setText(boronStatus, t(lang, 'boron.readout', { boron: b2o3.toFixed(2), temp: Math.round(celsius) }));
  }

  function refresh(): void {
    computed = compute(state.get(), materials, stullZoom);
    if (!computed.stull.point) {
      setText(stullNotice, t(state.get().lang, 'stull.noPoint'));
    } else {
      clearNotice();
    }
    results.update(computed.values);
    paintRoTools();
    paintBoron();
    adapter?.updateStull(computed.stull);
    adapter?.updateTriaxial(computed.triaxial);
    adapter?.updateBoron(computed.boron);
  }

  function clearNotice(): void {
    setText(stullNotice, '');
  }

  /**
   * Names the materials a solve emptied, in recipe order. Falls back to the raw
   * id if a row ever points at a material the index does not know.
   */
  function emptiedNames(rows: RecipeRow[], emptied: number[]): string[] {
    return emptied.map((index) => {
      const id = rows[index]?.materialId ?? '';
      return materials.get(id)?.name || id;
    });
  }

  /**
   * Refuses a Stull drag: repaints at the committed point — the snap-back — and
   * explains why under the chart. Nothing is written to the store, so the
   * rejected target leaves no trace at all, not even a history entry.
   */
  function rejectStullDrag(notice: string): void {
    debugLog('drag', { chart: 'stull', verdict: notice ? 'refused' : 'cancelled', notice });
    // Rebuild rather than mutate, so the chart model is the one thing that knows
    // what is on screen.
    computed = compute(state.get(), materials, stullZoom);
    setText(stullNotice, notice);
    adapter?.updateStull(computed.stull);
  }

  /** The "this would drop to zero" message for a drag refused at the empties. */
  function emptiedNotice(snapshot: FormState, emptied: number[]): string {
    const names = emptiedNames(snapshot.rows, emptied);
    return t(snapshot.lang, names.length === 1 ? 'stull.emptied' : 'stull.emptiedMany', {
      material: names[0] ?? '',
      materials: names.join(', '),
    });
  }

  /** Writes a solved refit: persisted, checkpointed and recorded — and the
   *  editor repainted, since the amounts are no longer the entered ones. */
  function commitSolved(rows: RecipeRow[]): void {
    state.set({ rows });
    editor.render(state.get().rows, state.get().lang);
    flushCheckpoint();
    history.record(state.get().rows);
  }

  /** A refused triaxial drag: say why, repaint the committed model. */
  function rejectTriaxialDrag(notice: string): void {
    debugLog('drag', { chart: 'triaxial', verdict: notice ? 'refused' : 'cancelled', notice });
    setText(triaxialNotice, notice);
    adapter?.updateTriaxial(computed.triaxial);
  }

  function onStullTarget(target: Pt): void {
    const snapshot = state.get();
    clearNotice();
    const solved = solveForStullTarget(snapshot.rows, materials, target, {
      includeAdditions: snapshot.includeAdditions,
      clampFluxRatio: snapshot.clampFluxRatio,
      additionClamp: snapshot.additionClamp,
      clampBoron: snapshot.clampBoron,
    });

    if (!solved.ok) {
      rejectStullDrag(t(snapshot.lang, snapbackKey(solved.reason)));
      return;
    }

    if (solved.emptied.length > 0) {
      // Reachable, but only by clamping a carrier onto the closed end of its
      // interval — which drops that material out of the base. Refused for the
      // same reason the region leaves it out: the user should not lose a material
      // to a drag they read as a reposition.
      rejectStullDrag(emptiedNotice(snapshot, solved.emptied));
      return;
    }

    commitSolved(solved.rows);
  }

  /** The triaxial map's drag: the point is the (SiO₂, Al₂O₃, RO) split of the
   *  unity formula, so its two coordinates solve exactly like the Stull ones —
   *  over the triangle's own basis rather than the flux, and against whichever
   *  RO corner the map is drawn on. */
  function onTriaxialTarget(target: TriaxialTarget): void {
    const snapshot = state.get();
    setText(triaxialNotice, '');
    const roFlux = computed.roSelected;
    if (roFlux === null) return;
    const solved = solveForTarget(
      snapshot.rows,
      materials,
      { ...triaxialAxes(roFlux), x: target.sio2, y: target.al2o3 },
      {
        includeAdditions: snapshot.includeAdditions,
        clampFluxRatio: snapshot.clampFluxRatio,
        additionClamp: snapshot.additionClamp,
        clampBoron: snapshot.clampBoron,
      },
    );
    if (!solved.ok) {
      rejectTriaxialDrag(t(snapshot.lang, snapbackKey(solved.reason)));
      return;
    }
    if (solved.emptied.length > 0) {
      rejectTriaxialDrag(emptiedNotice(snapshot, solved.emptied));
      return;
    }
    commitSolved(solved.rows);
  }

  const interaction: StullInteraction = {
    onTarget: onStullTarget,
    onCancel: () => {
      rejectStullDrag('');
    },
    onViewport: (next) => {
      // Wheel/pan events arrive at input frequency: rebuild and repaint only
      // the Stull model — the other panels' data has not changed.
      stullZoom = next;
      computed = compute(state.get(), materials, stullZoom);
      adapter?.updateStull(computed.stull);
    },
  };

  const triaxialInteraction: TriaxialInteraction = {
    onTarget: onTriaxialTarget,
    onCancel: () => rejectTriaxialDrag(''),
  };

  exportButton.addEventListener('click', () => exportToFile(persistable(state.get())));

  importButton.addEventListener('click', () => {
    importTextarea.value = '';
    setText(importError, '');
    importDialog.showModal();
  });

  importCancel.addEventListener('click', () => importDialog.close());

  importApply.addEventListener('click', () => {
    const imported = importRecipeText(importTextarea.value);
    if (!imported) {
      setText(importError, t(state.get().lang, 'transfer.importFailed'));
      return;
    }
    importDialog.close();
    setText(transferStatus, '');
    state.set({ rows: imported });
    editor.render(imported, state.get().lang);
    flushCheckpoint();
    history.record(imported);
  });

  shareButton.addEventListener('click', () => {
    const url = shareUrl(state.get().rows);
    const copied = t(state.get().lang, 'transfer.copied');
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setText(transferStatus, url);
      return;
    }
    void clipboard
      .writeText(url)
      .then(() => setText(transferStatus, copied))
      .catch(() => setText(transferStatus, url));
  });

  function paintChrome(next: Lang): void {
    // The tabs are the charts' headings now: one label per map, and no second
    // copy of the name inside the view.
    for (const key of tabKeys) setText(tabButtons[key], t(next, tabLabel[key]));
    chartTabs.setAttribute('aria-label', t(next, 'charts.label'));
    setText(stullHint, t(next, 'stull.hint'));
    clampSwitch.setAttribute('aria-label', t(next, 'stull.clampFluxRatio'));
    const clampLabel = clampSwitch.querySelector('.recipe-toggle-label');
    if (clampLabel) setText(clampLabel, t(next, 'stull.clampFluxRatio'));
    setText(clampAdditionsToggle, t(next, additionClampKeys[state.get().additionClamp]));
    clampBoronSwitch.setAttribute('aria-label', t(next, 'stull.clampBoron'));
    const boronLabel = clampBoronSwitch.querySelector('.recipe-toggle-label');
    if (boronLabel) setText(boronLabel, t(next, 'stull.clampBoron'));
    setText(triaxialHint, t(next, 'triaxial.hint'));
    setText(boronHint, t(next, 'boron.hint'));
    setText(transferTitle, t(next, 'transfer.title'));

    roTools.setAttribute('aria-label', t(next, 'triaxial.roFlux'));

    setText(exportButton, t(next, 'transfer.export'));
    setText(importButton, t(next, 'transfer.import'));
    setText(importTitle, t(next, 'transfer.import'));
    importTextarea.placeholder = t(next, 'transfer.importPlaceholder');
    importTextarea.setAttribute('aria-label', t(next, 'transfer.importPlaceholder'));
    setText(importApply, t(next, 'transfer.import'));
    setText(importCancel, t(next, 'transfer.importCancel'));
    setText(shareButton, t(next, 'transfer.share'));
    shareButton.setAttribute('aria-label', t(next, 'transfer.copyLink'));
  }

  bindStore(state, (current) => {
    saveForm(persistable(current));
    refresh();
  });

  /**
   * Checkpoints the recipe once typing stops. Results recompute on every
   * keystroke, but history should capture whole edits, not each character.
   * `flushCheckpoint` is both the debounce fire and the way external record
   * paths (Stull solve, import) absorb a pending timer before recording, so
   * history never highlights rows that are no longer the displayed recipe.
   */
  let checkpointTimer: number | undefined;
  let checkpointRows: RecipeRow[] | null = null;

  function flushCheckpoint(): void {
    clearTimeout(checkpointTimer);
    const rows = checkpointRows;
    checkpointTimer = undefined;
    checkpointRows = null;
    if (rows) history.record(rows);
  }

  function scheduleCheckpoint(rows: RecipeRow[]): void {
    clearTimeout(checkpointTimer);
    checkpointRows = rows;
    checkpointTimer = setTimeout(flushCheckpoint, CHECKPOINT_DELAY_MS);
  }

  paintChrome(lang);
  history.record(state.get().rows);
  adapter = createD3Adapter();
  adapter.mountStull(stullChart, computed.stull, interaction);
  adapter.mountTriaxial(triaxialChart, computed.triaxial, triaxialInteraction);
  adapter.mountBoron(boronChart, computed.boron);

  return {
    setLang(next: Lang): void {
      clearNotice();
      paintChrome(next);
      results.setDisplay({ lang: next });
      history.setLang(next);
      editor.render(state.get().rows, next);
      state.set({ lang: next });
    },
  };
}