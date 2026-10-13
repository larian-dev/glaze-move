import { encode } from 'uqr';
import type { QrCodeGenerateResult } from 'uqr';
import { weighingSheet } from '../core';
import type { WeighLine } from '../core';
import { t } from '../i18n';
import type { Lang, TranslationKey } from '../i18n';
import type { MaterialIndex, RecipeRow } from '../types';
import { el, setText } from './dom';
import type { Child } from './dom';

export type PrintPanelOptions = {
  lang: Lang;
  materials: MaterialIndex;
  /** The recipe to print, read when the button is pressed. */
  getRows: () => RecipeRow[];
  /** The link the sheet's QR code opens: the recipe's share URL. */
  getUrl: () => string;
};

export type PrintPanel = {
  /** Re-labels the panel after a language switch. */
  setLang: (lang: Lang) => void;
};

/** The batch weight the field starts with; the user types theirs over it. */
const DEFAULT_BATCH_WEIGHT = 100;

/** Quiet zone around the QR matrix, in modules — the 4 the spec asks for. */
const QR_QUIET_ZONE = 4;

/** Error correction for the sheet's QR: M first, L when the payload needs the
 *  extra room, and no code at all beyond what L holds. */
const QR_ECC = ['M', 'L'] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A number as a person writes it on a weighing sheet: no trailing zeros. */
function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/**
 * The recipe's QR code as a crisp inline SVG — one path of module squares over
 * the quiet zone, so the printer rasterises edges rather than a bitmap. `null`
 * when the link is longer than every supported error-correction level holds.
 */
function qrSvg(url: string, label: string): SVGSVGElement | null {
  let code: QrCodeGenerateResult | null = null;
  for (const ecc of QR_ECC) {
    try {
      code = encode(url, { ecc, border: QR_QUIET_ZONE });
      break;
    } catch {
      // Longer than this level holds; the next one has more room.
    }
  }
  if (!code) return null;

  const size = code.size;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  let path = '';
  for (let y = 0; y < size; y += 1) {
    const row = code.data[y];
    if (!row) continue;
    for (let x = 0; x < size; x += 1) {
      if (row[x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  const mark = document.createElementNS(SVG_NS, 'path');
  mark.setAttribute('fill', '#000000');
  mark.setAttribute('d', path);
  svg.append(mark);
  return svg;
}

/** The sheet's table: captioned columns, one titled block per section, and one
 *  numbered line per material, largest amount first. */
function sheetTable(main: WeighLine[], additional: WeighLine[], lang: Lang): HTMLElement {
  const head = el('tr', {}, [
    el('th', { class: 'print-num', text: t(lang, 'print.number') }),
    el('th', { class: 'print-name', text: t(lang, 'recipe.material') }),
    el('th', { class: 'print-amount', text: t(lang, 'recipe.amount') }),
    el('th', { class: 'print-weight', text: t(lang, 'print.weight') }),
    el('th', { class: 'print-tick', text: t(lang, 'print.check') }),
  ]);

  const columns = el('colgroup', {}, [
    el('col', { class: 'print-col-num' }),
    el('col', { class: 'print-col-name' }),
    el('col', { class: 'print-col-amount' }),
    el('col', { class: 'print-col-weight' }),
    el('col', { class: 'print-col-tick' }),
  ]);

  const body = el('tbody');
  let index = 0;
  const sections: [TranslationKey, WeighLine[]][] = [
    ['recipe.mainComponents', main],
    ['recipe.additionalComponents', additional],
  ];
  for (const [titleKey, lines] of sections) {
    if (lines.length === 0) continue;
    body.append(
      el('tr', { class: 'print-group' }, [
        el('th', { class: 'print-group-title', attrs: { colspan: '5' }, text: t(lang, titleKey) }),
      ]),
    );
    for (const line of lines) {
      index += 1;
      body.append(
        el('tr', {}, [
          el('td', { class: 'print-num', text: String(index) }),
          el('td', { class: 'print-name', text: line.name }),
          el('td', { class: 'print-amount', text: trim(line.amount, 2) }),
          el('td', {
            class: 'print-weight',
            text: line.weight === null ? t(lang, 'generic.none') : trim(line.weight, 1),
          }),
          // The pen box: the tick, or the weight actually put on the scale,
          // goes in here by hand.
          el('td', { class: 'print-tick' }, [el('span', { class: 'print-tick-box' })]),
        ]),
      );
    }
  }
  return el('table', { class: 'print-table' }, [columns, el('thead', {}, [head]), body]);
}

/**
 * The panel above the history: a batch weight field and the button that prints
 * the weighing sheet. The sheet itself is built on demand, lives in `<body>`
 * only for as long as the print dialog reads it, and prints in place of the app
 * — see the print rules in `style.css`.
 */
export function createPrintPanel(container: HTMLElement, options: PrintPanelOptions): PrintPanel {
  let lang = options.lang;

  const sheet = el('div', { class: 'print-sheet' });
  const caption = el('span', { class: 'print-caption', text: t(lang, 'print.batchWeight') });
  const input = el('input', {
    type: 'number',
    class: 'print-weight-input',
    value: String(DEFAULT_BATCH_WEIGHT),
    attrs: { min: '0', step: 'any', inputmode: 'decimal' },
  });
  const button = el('button', { type: 'button', class: 'button print-button', text: t(lang, 'print.button') });
  const status = el('p', { class: 'print-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  /** Fills the sheet from the current recipe; false when no QR could be built. */
  function buildSheet(batchWeight: number): boolean {
    const { main, additional } = weighingSheet(options.getRows(), options.materials, batchWeight);
    const label = t(lang, 'print.scan');
    const qr = qrSvg(options.getUrl(), label);
    const head: Child[] = [
      el('div', { class: 'print-meta' }, [
        el('h1', { class: 'print-heading', text: t(lang, 'print.heading') }),
        el('p', {
          class: 'print-batch',
          text: t(lang, 'print.batch', { weight: trim(batchWeight, 1) }),
        }),
      ]),
    ];
    if (qr) {
      head.unshift(
        el('div', { class: 'print-qr' }, [qr, el('p', { class: 'print-scan', text: label })]),
      );
    }
    sheet.replaceChildren(el('div', { class: 'print-head' }, head), sheetTable(main, additional, lang));
    return qr !== null;
  }

  function print(): void {
    const batchWeight = input.valueAsNumber;
    if (!Number.isFinite(batchWeight) || batchWeight <= 0) {
      setText(status, t(lang, 'print.needWeight'));
      return;
    }
    setText(status, buildSheet(batchWeight) ? '' : t(lang, 'print.qrTooLong'));
    if (!sheet.isConnected) document.body.append(sheet);
    // The sheet and the class that reveals it leave with the dialog, so a
    // later Ctrl+P of the app itself never picks up a stale recipe.
    document.body.classList.add('printing');
    window.addEventListener(
      'afterprint',
      () => {
        sheet.remove();
        document.body.classList.remove('printing');
      },
      { once: true },
    );
    window.print();
  }

  button.addEventListener('click', print);

  container.replaceChildren(
    el('div', { class: 'print-controls' }, [
      el('label', { class: 'print-weight' }, [caption, input]),
      button,
    ]),
    status,
  );

  return {
    setLang(next: Lang): void {
      lang = next;
      setText(caption, t(lang, 'print.batchWeight'));
      setText(button, t(lang, 'print.button'));
    },
  };
}
