import { t } from '../i18n';
import type { Lang, TranslationKey } from '../i18n';
import type { MaterialIndex, RecipeRow } from '../types';
import { renormalizeRecipe } from '../core/normalize';
import { el, fmt, option, switchToggle } from './dom';

type RowKind = RecipeRow['kind'];

/** The two lists in visual order — the flat order a keyboard move steps through. */
const ROW_KINDS: readonly RowKind[] = ['main', 'additional'];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The handle's grip: a 2×3 dot grid drawn as SVG, never a glyph a font may lack. */
function gripIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 14');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const cy of [2, 7, 12]) {
    for (const cx of [2.5, 5.5]) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', '1.1');
      dot.setAttribute('fill', 'currentColor');
      svg.append(dot);
    }
  }
  return svg;
}

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
  /** The row a live pointer drag is carrying; null between drags. */
  let dragging: HTMLElement | null = null;
  /** The grip's row lookups: a drop reads the order back out of the DOM. */
  const rowByNode = new WeakMap<HTMLElement, RecipeRow>();
  const nodeByRow = new WeakMap<RecipeRow, HTMLElement>();
  /** Stable list containers: the drag hits these and reorders their children. */
  const lists: Record<RowKind, HTMLElement> = {
    main: el('div', { class: 'recipe-list' }),
    additional: el('div', { class: 'recipe-list' }),
  };

  // The drag listens on the container: its pointer capture survives the row
  // being re-parented under it, and its listeners see the moves wherever in the
  // panel they land. Both no-op when no drag is running.
  container.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const { list, before } = dropTarget(event.clientY, dragging);
    if (dragging.parentElement === list && dragging.nextElementSibling === before) return;
    list.querySelector('.recipe-empty')?.remove();
    list.insertBefore(dragging, before);
  });
  container.addEventListener('pointerup', () => endDrag(true));
  container.addEventListener('pointercancel', () => endDrag(false));

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
    const node = el('div', { class: 'recipe-row' }, [
      dragHandle(row),
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
    rowByNode.set(node, row);
    nodeByRow.set(row, node);
    return node;
  }

  /** A live drag's landing spot: the first list the pointer is still above and
   *  the first row in it the pointer has passed the midline of. */
  function dropTarget(y: number, dragged: HTMLElement): { list: HTMLElement; before: HTMLElement | null } {
    for (const kind of ROW_KINDS) {
      const list = lists[kind];
      if (y >= list.getBoundingClientRect().bottom) continue;
      const before =
        [...list.querySelectorAll<HTMLElement>('.recipe-row')].find((row) => {
          if (row === dragged) return false;
          const box = row.getBoundingClientRect();
          return y < box.top + box.height / 2;
        }) ?? null;
      return { list, before };
    }
    // Below both lists: the row is dropped at the end of the lower one.
    return { list: lists.additional, before: null };
  }

  /** The drag handle: drag the row to reorder it, or to move it across the
   *  Main/Additional boundary; Alt + ↑/↓ makes the same moves from the
   *  keyboard. */
  function dragHandle(row: RecipeRow): HTMLElement {
    const name = options.materials.get(row.materialId)?.name ?? '';
    const handle = el('button', {
      type: 'button',
      class: 'recipe-handle',
      attrs: {
        'aria-label': name ? t(lang, 'recipe.moveRow', { material: name }) : t(lang, 'recipe.move'),
        title: t(lang, 'recipe.moveHint'),
      },
    });
    handle.append(gripIcon());
    const own = (): HTMLElement | null => handle.closest<HTMLElement>('.recipe-row');

    handle.addEventListener('pointerdown', (event) => {
      const node = own();
      if (event.button !== 0 || dragging || !node) return;
      // No text selection while dragging; focus is kept so the keyboard can
      // carry on from the handle the drag started on.
      event.preventDefault();
      handle.focus();
      // Capture on the container, never on the handle: re-parenting the row in
      // the DOM would release a capture the handle itself holds, and the rest
      // of the drag would fall through to whatever is under the pointer.
      container.setPointerCapture(event.pointerId);
      dragging = node;
      node.classList.add('recipe-row--dragging');
      container.classList.add('recipe-dragging');
    });

    handle.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      moveRow(row, event.key === 'ArrowUp' ? -1 : 1);
    });

    return handle;
  }

  /** Ends a pointer drag: `commit` reads the DOM order back into the recipe; an
   *  aborted drag repaints the stored one. */
  function endDrag(commit: boolean): void {
    const node = dragging;
    dragging = null;
    container.classList.remove('recipe-dragging');
    if (!node) return;
    node.classList.remove('recipe-row--dragging');
    if (!commit) {
      render(rows, lang);
      return;
    }

    const ordered: RecipeRow[] = [];
    for (const kind of ROW_KINDS) {
      for (const element of lists[kind].querySelectorAll<HTMLElement>('.recipe-row')) {
        const row = rowByNode.get(element);
        if (row) ordered.push({ ...row, kind });
      }
    }
    const moved =
      ordered.length === rows.length &&
      ordered.some((row, index) => {
        const current = rows[index];
        return (
          !current ||
          current.materialId !== row.materialId ||
          current.kind !== row.kind ||
          current.amount !== row.amount
        );
      });
    if (!moved) {
      // A click on the handle: nothing to persist, the row is where it was.
      paintEmptiness();
      return;
    }
    rows = ordered;
    render(rows, lang);
    emit();
  }

  /** Alt + ↑/↓: one slot through the flat order of the two lists — a swap
   *  inside a section, or across the boundary, where the row flips its kind and
   *  lands at the near edge of the other list. */
  function moveRow(row: RecipeRow, delta: -1 | 1): void {
    const node = nodeByRow.get(row);
    const flat = [
      ...rows.filter((r) => r.kind === 'main'),
      ...rows.filter((r) => r.kind === 'additional'),
    ];
    const index = flat.indexOf(row);
    if (!node || index < 0) return;
    const neighbour = flat[index + delta];

    if (neighbour && neighbour.kind === row.kind) {
      const neighbourNode = nodeByRow.get(neighbour);
      if (!neighbourNode) return;
      flat[index] = neighbour;
      flat[index + delta] = row;
      if (delta < 0) neighbourNode.before(node);
      else neighbourNode.after(node);
    } else if (
      (delta === 1 && row.kind === 'main') ||
      (delta === -1 && row.kind === 'additional')
    ) {
      // Over the boundary; also the only way into a section that is empty.
      row.kind = delta === 1 ? 'additional' : 'main';
      const list = lists[row.kind];
      list.querySelector('.recipe-empty')?.remove();
      if (delta === 1) list.insertBefore(node, list.querySelector('.recipe-row'));
      else list.append(node);
    } else {
      // Already the first row of Main or the last row of Additional.
      return;
    }

    rows = flat;
    paintEmptiness();
    emit();
  }

  /** Keeps each list's "No rows yet" line truthful after a keyboard move. */
  function paintEmptiness(): void {
    for (const kind of ROW_KINDS) {
      const list = lists[kind];
      const message = list.querySelector('.recipe-empty');
      if (list.querySelector('.recipe-row')) message?.remove();
      else if (!message) list.append(el('p', { class: 'recipe-empty', text: t(lang, 'recipe.empty') }));
    }
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
    const list = lists[kind];
    // The visible column captions live once per list, above the rows; the rows
    // carry theirs for screen readers only. Both sections share the grid, so
    // the Main and Additional columns line up; the outer cells back the drag
    // handle and the remove button, which carry no caption of their own.
    list.replaceChildren(
      el('div', { class: 'recipe-list-head' }, [
        el('span', { class: 'recipe-caption' }),
        el('span', { class: 'recipe-caption', text: t(lang, 'recipe.material') }),
        el('span', { class: 'recipe-caption', text: t(lang, 'recipe.amount') }),
        el('span', { class: 'recipe-caption' }),
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
      // The base renormalizes to 100; the additions keep the percentages they
      // were entered with, so an «8» addition stays 8 after the button.
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
    // A rebuild replaces the very nodes a drag was carrying.
    dragging = null;
    container.classList.remove('recipe-dragging');
    container.replaceChildren(
      listSection('main', 'recipe.mainComponents'),
      listSection('additional', 'recipe.additionalComponents'),
    );
  }

  render(options.rows, options.lang);

  return { render };
}