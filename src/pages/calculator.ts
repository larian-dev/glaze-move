import { createD3Adapter } from '../charts/adapter-d3';
import type { ChartAdapter, StullInteraction } from '../charts/adapter';
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
  stullPoint,
  unityFormula,
} from '../core';
import type { SolveRejection } from '../core';
import { OXIDE_BY_FORMULA, SYSTEM_MATERIALS, materialIndex } from '../data/catalog';
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
import { switchToggle } from '../ui/dom';

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
 * kaolin, chalk. Applied only when nothing is stored and no share link is present.
 */
const DEFAULT_RECIPE: RecipeRow[] = [
  { materialId: '2', amount: 40, kind: 'main' },
  { materialId: '1', amount: 30, kind: 'main' },
  { materialId: '4', amount: 20, kind: 'main' },
  { materialId: '3', amount: 10, kind: 'main' },
];

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
    clampAdditions: stored?.clampAdditions ?? DEFAULT_FORM.clampAdditions,
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
    clampAdditions: state.clampAdditions,
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
 * switch and each addition's own drag-solve switch — the base alone, or the
 * selected additions frozen in.
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
    clampAdditions: state.clampAdditions,
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
  };

  const chartMoles = batchMoles(chartRows, materials, OXIDE_BY_FORMULA);
  const chartFlux = stullFlux(chartRows, materials);

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
      point: stullPoint(chartMoles, chartFlux),
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

  const stullTitle = el('h2', { class: 'panel-title' });
  const stullHint = el('p', { class: 'panel-hint' });
  const stullChart = el('div', { class: 'chart chart--stull' });
  const stullNotice = el('p', { class: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });

  const triaxialTitle = el('h2', { class: 'panel-title' });
  const roTools = el('div', {
    class: 'ro-toggle',
    attrs: { role: 'group', 'aria-label': t(lang, 'triaxial.roFlux') },
  });
  const triaxialHint = el('p', { class: 'panel-hint' });
  const triaxialChart = el('div', { class: 'chart chart--triaxial' });
  const triaxialNotice = el('p', { class: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });

  const boronTitle = el('h2', { class: 'panel-title' });
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

  // The drag solver's two switches live with the chart they govern: they decide
  // what the solve — and therefore the dashed hull — is allowed to do.
  const clampSwitch = switchToggle(
    () => state.get().clampFluxRatio,
    t(lang, 'stull.clampFluxRatio'),
    (value) => state.set({ clampFluxRatio: value }),
  );
  const clampAdditionsSwitch = switchToggle(
    () => state.get().clampAdditions,
    t(lang, 'stull.clampAdditions'),
    (value) => state.set({ clampAdditions: value }),
  );
  const clampBoronSwitch = switchToggle(
    () => state.get().clampBoron,
    t(lang, 'stull.clampBoron'),
    (value) => state.set({ clampBoron: value }),
  );
  const stullPanel = el('div', { class: 'panel panel--stull' }, [
    el('div', { class: 'panel-head' }, [stullTitle, clampSwitch, clampAdditionsSwitch, clampBoronSwitch]),
    stullHint,
    stullChart,
    stullNotice,
  ]);

  const triaxialPanel = el('div', { class: 'panel panel--triaxial' }, [
    el('div', { class: 'panel-head' }, [triaxialTitle, roTools]),
    triaxialHint,
    triaxialNotice,
    triaxialChart,
  ]);

  const boronPanel = el('div', { class: 'panel panel--boron' }, [
    el('div', { class: 'panel-head' }, [boronTitle]),
    boronChart,
    boronStatus,
    boronNotice,
  ]);

  const transferPanel = el('div', { class: 'panel panel--transfer' }, [
    transferTitle,
    el('div', { class: 'button-row' }, [exportButton, importButton, shareButton]),
    transferStatus,
  ]);

  container.replaceChildren(
    el('div', { class: 'layout' }, [
      el('div', { class: 'column column--recipe' }, [recipeHost, transferPanel]),
      el('div', { class: 'column column--results' }, [resultsHost, historyHost]),
      el('div', { class: 'column column--charts' }, [stullPanel, triaxialPanel, boronPanel]),
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
    // Rebuild rather than mutate, so the chart model is the one thing that knows
    // what is on screen.
    computed = compute(state.get(), materials, stullZoom);
    setText(stullNotice, notice);
    adapter?.updateStull(computed.stull);
  }

  function onStullTarget(target: Pt): void {
    const snapshot = state.get();
    clearNotice();
    const solved = solveForStullTarget(snapshot.rows, materials, target, {
      includeAdditions: snapshot.includeAdditions,
      clampFluxRatio: snapshot.clampFluxRatio,
      clampAdditions: snapshot.clampAdditions,
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
      const names = emptiedNames(snapshot.rows, solved.emptied);
      const one = names.length === 1;
      rejectStullDrag(
        t(snapshot.lang, one ? 'stull.emptied' : 'stull.emptiedMany', {
          material: names[0] ?? '',
          materials: names.join(', '),
        }),
      );
      return;
    }

    state.set({ rows: solved.rows });
    editor.render(state.get().rows, snapshot.lang);
    flushCheckpoint();
    history.record(state.get().rows);
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
    setText(stullTitle, t(next, 'stull.title'));
    setText(stullHint, t(next, 'stull.hint'));
    clampSwitch.setAttribute('aria-label', t(next, 'stull.clampFluxRatio'));
    const clampLabel = clampSwitch.querySelector('.recipe-toggle-label');
    if (clampLabel) setText(clampLabel, t(next, 'stull.clampFluxRatio'));
    clampAdditionsSwitch.setAttribute('aria-label', t(next, 'stull.clampAdditions'));
    const additionsLabel = clampAdditionsSwitch.querySelector('.recipe-toggle-label');
    if (additionsLabel) setText(additionsLabel, t(next, 'stull.clampAdditions'));
    clampBoronSwitch.setAttribute('aria-label', t(next, 'stull.clampBoron'));
    const boronLabel = clampBoronSwitch.querySelector('.recipe-toggle-label');
    if (boronLabel) setText(boronLabel, t(next, 'stull.clampBoron'));
    setText(triaxialTitle, t(next, 'triaxial.title'));
    setText(triaxialHint, t(next, 'triaxial.hint'));
    setText(boronTitle, t(next, 'boron.title'));
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
  adapter.mountTriaxial(triaxialChart, computed.triaxial);
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