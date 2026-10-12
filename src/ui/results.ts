import type { FiringTemperature, UmfResult } from '../core';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { OxideClass } from '../types';
import type { PersistedForm } from '../state/persistence';
import { el, fmt } from './dom';
import type { Child } from './dom';

export type UnitDisplay = PersistedForm['unitDisplay'];

export type ResultsValues = {
  /** The single unity formula, classified from the oxides table. */
  umf: UmfResult;
  molePercent: Map<string, number>;
  siAlRatio: number | null;
  cte: number | null;
  firing: FiringTemperature;
  costPerKg: number;
  loi: number;
  /** Oxide formulas the enabled clamps are holding: a drag leaves them where
   *  they are. The panel tints these entries, so the switch verdicts read on
   *  the formula itself. */
  clamped: Readonly<Record<string, true>>;
  /** True while the R₂O:RO balance is clamped — that ratio tile is held too. */
  clampedFluxRatio: boolean;
};

export type ResultsOptions = {
  lang: Lang;
  unitDisplay: UnitDisplay;
  onUnitDisplayChange: (display: UnitDisplay) => void;
};

export type ResultsPanel = {
  update: (values: ResultsValues) => void;
  /** Re-paints after the caller changed the language or a mode from outside. */
  setDisplay: (display: Partial<Pick<ResultsOptions, 'lang' | 'unitDisplay'>>) => void;
};

const BRACE_PATH =
  'm9.2356 20.869h-1.2974a2.5948 1.971 0 0 1-2.5948-1.971v-4.9274c0-1.084-1.1676-1.971-2.5948-1.971a2.5948 1.971 0 0 0 2.5948-1.971v-4.9274a2.5948 1.971 0 0 1 2.5948-1.971h1.2974';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Group blocks side by side, exactly as Glazy's umf-table lays them out:
 *  fluxes | R₂O₃ (+B₂O₃) | RO₂ (+SiO₂) | Other, each with its own header. */
const FORMULA_BLOCKS: readonly { header: readonly OxideClass[]; groups: readonly OxideClass[] }[] = [
  { header: ['R2O', 'RO'], groups: ['R2O', 'RO'] },
  { header: ['R2O3'], groups: ['R2O3', 'B2O3'] },
  { header: ['RO2'], groups: ['RO2'] },
  { header: ['Other'], groups: ['Other'] },
];

/** Splits a formula or label into text and subscript digits: Na2O → Na₂O. */
function subscripted(text: string): Child[] {
  const parts: Child[] = [];
  for (const part of text.split(/(\d+)/)) {
    if (part === '') continue;
    parts.push(/^\d+$/.test(part) ? el('sub', { text: part }) : part);
  }
  return parts;
}

/** Trailing zeros trimmed: entries keep three decimals so 0.004 stays visible,
 *  ratio tiles show two like Glazy (0.4 / 2.07 / 5.18). */
function fmtTrim(value: number, digits: number): string {
  return fmt(value, digits).replace(/\.?0+$/, '');
}

/** Glazy's curly brace between two group blocks, drawn as a stretched SVG. */
function braceCell(column: number, mirrored: boolean): HTMLElement {
  const cell = el('div', { class: 'umf-brace', attrs: { style: `grid-area: 2 / ${column}` } });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '2.2 2.6 7.6 18.8');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-width', '1');
  svg.setAttribute('preserveAspectRatio', 'none');
  const group = document.createElementNS(SVG_NS, 'g');
  if (mirrored) group.setAttribute('transform', 'translate(12 0) scale(-1 1)');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  path.setAttribute('d', BRACE_PATH);
  group.append(path);
  svg.append(group);
  cell.append(svg);
  return cell;
}

function ratioTile(label: string, value: string, clamped = false): HTMLElement {
  return el('div', {
    class: clamped ? 'umf-ratio-tile umf-ratio-tile--clamped' : 'umf-ratio-tile',
  }, [
    el('span', { class: 'umf-ratio-label' }, subscripted(label)),
    el('span', { class: 'umf-ratio-value', text: value }),
  ]);
}

export function createResults(container: HTMLElement, options: ResultsOptions): ResultsPanel {
  let lang = options.lang;
  let unitDisplay = options.unitDisplay;
  let values: ResultsValues | null = null;

  const controls = el('div', { class: 'results-controls' });
  const formulaBox = el('div', { class: 'results-formula' });
  const summaryBox = el('dl', { class: 'results-summary' });

  let unitButtons: HTMLButtonElement[] = [];

  function unitLabel(display: UnitDisplay): string {
    return t(lang, display === 'unity' ? 'results.unityFormula' : 'results.molePercent');
  }

  /** Segmented two-button toggle: the label of the active mode is also the
   *  heading it replaces, so the panel needs no separate title. */
  function buildControls(): void {
    const buttons = (['unity', 'molePercent'] as const).map((display) => {
      const button = el('button', {
        type: 'button',
        class: 'button',
        text: unitLabel(display),
        attrs: { 'data-unit': display },
      });
      button.addEventListener('click', () => {
        if (unitDisplay === display) return;
        unitDisplay = display;
        options.onUnitDisplayChange(display);
        paintControls();
        paintValues();
      });
      return button;
    });
    unitButtons = buttons;
    controls.replaceChildren(
      el('div', { class: 'unit-toggle', attrs: { role: 'group', 'aria-label': t(lang, 'results.units') } }, buttons),
    );
  }

  function paintControls(): void {
    for (const button of unitButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.unit === unitDisplay));
    }
  }

  function entryNode(formula: string, value: number, counted: boolean, clamped: boolean): HTMLElement {
    const classes = ['umf-entry'];
    if (!counted) classes.push('umf-entry--uncounted');
    // The tint is the panel's only row highlight: green while a clamp holds the
    // entry, nothing when the value is free to move.
    if (clamped) classes.push('umf-entry--clamped');
    return el('div', { class: classes.join(' ') }, [
      el('span', { class: 'umf-value', text: fmtTrim(value, 3) }),
      el('span', { class: 'umf-oxide' }, subscripted(formula)),
    ]);
  }

  /** R₂O:RO as shares of the typed-flux total (Glazy: "0.2 : 0.8") — identical
   *  whether read from unity or mole values, but classification-dependent. */
  function fluxSplit(umf: UmfResult, source: Map<string, number>): [number, number] | null {
    let r2o = 0;
    let ro = 0;
    for (const group of ['R2O', 'RO'] as const) {
      for (const formula of umf.groups[group]) {
        const value = source.get(formula) ?? 0;
        if (group === 'R2O') r2o += value;
        else ro += value;
      }
    }
    if (r2o + ro <= 0) return null;
    return [r2o / (r2o + ro), ro / (r2o + ro)];
  }

  function tableNode(umf: UmfResult, source: Map<string, number>): HTMLElement {
    const table = el('div', { class: 'umf-table', attrs: { style: '--umf-value-w: 6ch' } });
    let column = 1;
    let placed = 0;
    for (const block of FORMULA_BLOCKS) {
      const formulas = block.groups.flatMap((group) => umf.groups[group]);
      if (formulas.length === 0) continue;
      if (placed > 0) {
        table.append(braceCell(column, placed === 1));
        column += 1;
      }
      const headChildren: Child[] = [];
      for (const cls of block.header) {
        if (cls === 'Other') headChildren.push(t(lang, 'results.group.other'));
        else headChildren.push(el('span', {}, subscripted(cls)));
      }
      const head = el('div', { class: 'umf-group-head', attrs: { style: `grid-area: 1 / ${column}` } }, headChildren);
      const body = el('div', { class: 'umf-block', attrs: { style: `grid-area: 2 / ${column}` } });
      for (const formula of formulas) {
        const value = source.get(formula);
        if (value === undefined) continue;
        // Below-threshold "other" oxides are listed but excluded from the unity sums.
        const counted = !umf.groups.Other.includes(formula) || (umf.isFlux.get(formula) ?? true);
        body.append(entryNode(formula, value, counted, values?.clamped[formula] === true));
      }
      table.append(head, body);
      column += 1;
      placed += 1;
    }
    return table;
  }

  /** The single formula panel: the bordered table and its two ratio tiles. */
  function panelNode(umf: UmfResult, source: Map<string, number>): HTMLElement {
    const children: Child[] = [];
    if (unitDisplay === 'unity' && !umf.unityDefined) {
      children.push(el('p', { class: 'results-undefined', text: t(lang, 'results.unityUndefined') }));
      return el('div', { class: 'umf-panel' }, children);
    }
    children.push(tableNode(umf, source));

    const tiles = el('div', { class: 'umf-ratios' });
    const split = fluxSplit(umf, source);
    if (split) {
      tiles.append(
        ratioTile(
          'R2O:RO',
          `${fmtTrim(split[0], 2)} : ${fmtTrim(split[1], 2)}`,
          values?.clampedFluxRatio === true,
        ),
      );
    }
    const ratio = values?.siAlRatio;
    if (ratio !== null && ratio !== undefined) {
      tiles.append(ratioTile('SiO2:Al2O3', fmtTrim(ratio, 2)));
    }
    if (tiles.childElementCount > 0) children.push(tiles);
    return el('div', { class: 'umf-panel' }, children);
  }

  function paintFormula(): void {
    const unity = unitDisplay === 'unity';
    formulaBox.replaceChildren();
    if (!values) return;
    if (unity && !values.umf.unityDefined) {
      formulaBox.append(
        el('p', { class: 'results-undefined', text: t(lang, 'results.unityUndefined') }),
      );
      return;
    }
    formulaBox.append(
      el('div', { class: 'umf-panels' }, [panelNode(values.umf, unity ? values.umf.values : values.molePercent)]),
    );
  }

  function summaryItem(label: string, value: string): HTMLElement {
    return el('div', { class: 'results-summary-item' }, [
      el('dt', { class: 'results-summary-label', text: label }),
      el('dd', { class: 'results-summary-value', text: value }),
    ]);
  }

  function paintSummary(): void {
    const none = t(lang, 'generic.none');
    const data = values;
    const expansion = data?.cte;
    const celsius = data?.firing.celsius;
    summaryBox.replaceChildren(
      summaryItem(
        t(lang, 'results.cte'),
        expansion === null || expansion === undefined ? none : fmt(expansion, 2),
      ),
      summaryItem(
        t(lang, 'results.firingTemperature'),
        celsius === null || celsius === undefined
          ? none
          : `${data?.firing.approximate ? '~' : ''}${Math.round(celsius)}`,
      ),
      summaryItem(t(lang, 'results.costPerKg'), data ? fmt(data.costPerKg, 2) : none),
      summaryItem(t(lang, 'results.loi'), data ? fmt(data.loi, 2) : none),
    );
  }

  function paintValues(): void {
    paintFormula();
    paintSummary();
  }

  function paintAll(): void {
    buildControls();
    paintControls();
    paintValues();
  }

  function mount(): void {
    container.replaceChildren(controls, formulaBox, summaryBox);
  }

  mount();
  paintAll();

  return {
    update: (next) => {
      values = next;
      paintValues();
    },
    setDisplay: (display) => {
      if (display.lang !== undefined) lang = display.lang;
      if (display.unitDisplay !== undefined) unitDisplay = display.unitDisplay;
      mount();
      paintAll();
    },
  };
}