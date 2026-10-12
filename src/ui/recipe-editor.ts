import { t } from '../i18n';
import type { Lang, TranslationKey } from '../i18n';
import type { MaterialIndex, RecipeRow } from '../types';
import { renormalizeRecipe } from '../core/normalize';
import { el, fmt, option, switchToggle } from './dom';

type RowKind = RecipeRow['kind'];

export type RecipeEditorOptions = {
  rows: RecipeRow[];
  materials: MaterialIndex;
  lang: Lang;
  /** Whether `additional` rows currently join the chemistry. */
  includeAdditions: boolean;
  /** Structural edits — a row added, removed, re-pointed at another material, or
   *  the recipe cleared: persisted and recomputed, but not checkpointed. */
  onChange: (rows: RecipeRow[]) => void;
  /** An edit that moved an amount — typing one, or *to 100%*: checkpointed. */
  onAmountChange: (rows: RecipeRow[]) => void;
  onIncludeAdditionsChange: (include: boolean) => void;
};

export type RecipeEditor = {
  /** Rebuilds the whole editor from the caller's state; also used for language switches. */
  render: (rows: RecipeRow[], lang: Lang) => void;
};

/** Independent copy of the rows, so caller and editor never share row objects. */
export function cloneRows(rows: RecipeRow[]): RecipeRow[] {
  return rows.map((row) => ({ ...row }));
}

/** Two lists of rows over the caller's rows; the editor holds a private copy and reports edits. */
export function createRecipeEditor(
  container: HTMLElement,
  options: RecipeEditorOptions,
): RecipeEditor {
  let lang = options.lang;
  let rows: RecipeRow[] = cloneRows(options.rows);
  // The switches live here, so the editor keeps the flags; the caller owns the store.
  let includeAdditions = options.includeAdditions;
  let total: HTMLElement | null = null;

  const emit = (): void => options.onChange(cloneRows(rows));

  /** The one structural edit that is worth a history entry: an amount moved. */
  const emitAmounts = (): void => options.onAmountChange(cloneRows(rows));

  const totalText = (): string =>
    t(lang, 'recipe.total', {
      value: fmt(
        rows.reduce((sum, row) => (row.kind === 'main' ? sum + row.amount : sum), 0),
        2,
      ),
    });

  function removeLabel(row: RecipeRow): string {
    const name = options.materials.get(row.materialId)?.name ?? '';
    return name ? t(lang, 'recipe.removeRow', { material: name }) : t(lang, 'recipe.remove');
  }

  function materialSelect(row: RecipeRow, button: HTMLElement): HTMLSelectElement {
    const select = el('select', { attrs: { 'aria-label': t(lang, 'recipe.material') } });
    const sorted = [...options.materials.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (row.materialId && !options.materials.has(row.materialId)) {
      select.append(option(row.materialId, row.materialId, true));
    } else {
      select.append(option('', t(lang, 'recipe.materialPlaceholder'), row.materialId === ''));
    }
    for (const material of sorted) select.append(option(material.id, material.name));
    select.value = row.materialId;
    select.addEventListener('change', () => {
      row.materialId = select.value;
      button.setAttribute('aria-label', removeLabel(row));
      emit();
    });
    return select;
  }

  function amountInput(row: RecipeRow): HTMLInputElement {
    const input = el('input', {
      type: 'number',
      value: fmt(row.amount, 2),
      attrs: { min: '0', step: '0.01' },
    });
    input.addEventListener('input', () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      if (value < 0) {
        // Below-zero amounts never reach the state; flag the field instead.
        input.setAttribute('aria-invalid', 'true');
        input.reportValidity();
        return;
      }
      input.removeAttribute('aria-invalid');
      row.amount = value;
      if (total) total.textContent = totalText();
      emitAmounts();
    });
    // A rejected or half-typed value must not outlive the field: blur shows
    // the stored amount again.
    input.addEventListener('blur', () => {
      input.removeAttribute('aria-invalid');
      if (input.valueAsNumber !== row.amount) input.value = fmt(row.amount, 2);
    });
    return input;
  }

  function rowNode(row: RecipeRow): HTMLElement {
    const button = el('button', {
      type: 'button',
      class: 'recipe-remove',
      text: '×',
      attrs: { 'aria-label': removeLabel(row) },
    });
    button.addEventListener('click', () => {
      const index = rows.indexOf(row);
      if (index < 0) return;
      rows.splice(index, 1);
      render(rows, lang);
      emit();
    });
    const select = materialSelect(row, button);
    return el('div', { class: 'recipe-row' }, [
      el('label', { class: 'recipe-field recipe-field--material' }, [
        el('span', { class: 'recipe-caption', text: t(lang, 'recipe.material') }),
        select,
      ]),
      el('label', { class: 'recipe-field recipe-field--amount' }, [
        el('span', { class: 'recipe-caption', text: t(lang, 'recipe.amount') }),
        amountInput(row),
      ]),
      button,
    ]);
  }

  /** The Additional section's header switch: does chemistry count additions? */
  function additionalToggles(): HTMLElement {
    return switchToggle(
      () => includeAdditions,
      t(lang, 'recipe.includeAdditions'),
      (value) => {
        includeAdditions = value;
        options.onIncludeAdditionsChange(value);
      },
    );
  }

  function listSection(kind: RowKind, titleKey: TranslationKey): HTMLElement {
    const own = rows.filter((row) => row.kind === kind);
    const list = el('div', { class: 'recipe-list' });
    // The visible column captions live once per list, above the rows; the rows
    // carry theirs for screen readers only. Both sections share the grid, so
    // the Main and Additional columns line up.
    list.append(
      el('div', { class: 'recipe-list-head' }, [
        el('span', { class: 'recipe-caption', text: t(lang, 'recipe.material') }),
        el('span', { class: 'recipe-caption', text: t(lang, 'recipe.amount') }),
      ]),
    );
    if (own.length === 0) {
      list.append(el('p', { class: 'recipe-empty', text: t(lang, 'recipe.empty') }));
    } else {
      for (const row of own) list.append(rowNode(row));
    }

    const add = el('button', {
      type: 'button',
      class: 'recipe-add',
      text: t(lang, 'recipe.addRow'),
    });
    add.addEventListener('click', () => {
      rows.push({ materialId: '', amount: 0, kind });
      render(rows, lang);
      emit();
    });

    const head = el('div', { class: 'recipe-section-head' }, [
      el('h3', { class: 'recipe-section-title', text: t(lang, titleKey) }),
      kind === 'main' ? actionBar() : additionalToggles(),
    ]);

    const sectionNode = el('section', { class: `recipe-section recipe-section--${kind}` }, [
      head,
      list,
      add,
    ]);

    if (kind === 'main') {
      total = el('p', { class: 'recipe-total', text: totalText() });
      sectionNode.append(total);
    }
    return sectionNode;
  }

  function actionBar(): HTMLElement {
    const normalize = el('button', {
      type: 'button',
      class: 'recipe-to100',
      text: t(lang, 'recipe.to100'),
    });
    normalize.addEventListener('click', () => {
      // The base renormalizes to 100 and the additions travel at the same
      // factor, so the batch proportions — and with them the unity formula —
      // never move.
      const scaled = renormalizeRecipe(rows);
      if (!scaled) return;
      rows = scaled;
      render(rows, lang);
      emitAmounts();
    });

    const clear = el('button', {
      type: 'button',
      class: 'recipe-clear',
      text: t(lang, 'recipe.clear'),
    });
    clear.addEventListener('click', () => {
      rows = [];
      render(rows, lang);
      emit();
    });

    return el('div', { class: 'recipe-actions' }, [normalize, clear]);
  }

  function render(nextRows: RecipeRow[], nextLang: Lang): void {
    lang = nextLang;
    rows = cloneRows(nextRows);
    total = null;
    container.replaceChildren(
      listSection('main', 'recipe.mainComponents'),
      listSection('additional', 'recipe.additionalComponents'),
    );
  }

  render(options.rows, options.lang);

  return { render };
}