import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { RecipeRow } from '../types';
import { el } from './dom';
import { cloneRows } from './recipe-editor';

export type HistoryEntry = {
  rows: RecipeRow[];
  time: Date;
};

export type ChangeHistoryOptions = {
  lang: Lang;
  onRestore: (rows: RecipeRow[]) => void;
};

export type ChangeHistory = {
  /** Checkpoints the recipe; a state equal to the newest (or active) entry is skipped. */
  record: (rows: RecipeRow[]) => void;
  setLang: (lang: Lang) => void;
};

/** Order-sensitive serialization used to compare two recipes. */
function signature(rows: RecipeRow[]): string {
  return rows.map((row) => `${row.kind}|${row.materialId}|${row.amount}`).join('\n');
}

/** In-memory checkpoints, newest last in this array and newest first on screen. */
export function createChangeHistory(
  container: HTMLElement,
  options: ChangeHistoryOptions,
): ChangeHistory {
  let lang = options.lang;
  const entries: HistoryEntry[] = [];
  let activeIndex: number | null = null;

  const push = (rows: RecipeRow[]): number => {
    entries.push({ rows: cloneRows(rows), time: new Date() });
    return entries.length - 1;
  };

  const matches = (index: number, rows: RecipeRow[]): boolean => {
    const entry = entries[index];
    return entry !== undefined && signature(entry.rows) === signature(rows);
  };

  function entryNode(entry: HistoryEntry, index: number): HTMLElement {
    const active = index === activeIndex;
    const label = t(lang, 'history.entry', {
      time: entry.time.toLocaleTimeString(lang, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      rows: entry.rows.length,
    });
    const button = el('button', {
      type: 'button',
      class: active ? 'history-entry history-entry--active' : 'history-entry',
      text: label,
      attrs: {
        'aria-label': `${t(lang, 'history.restore')} · ${label}`,
        ...(active ? { 'aria-current': 'true' } : {}),
      },
    });
    button.addEventListener('click', () => restore(index));
    return el('li', { class: 'history-item' }, [button]);
  }

  function paint(): void {
    const children: HTMLElement[] = [
      el('h2', { class: 'history-title', text: t(lang, 'history.title') }),
    ];

    if (entries.length === 0) {
      children.push(el('p', { class: 'history-empty', text: t(lang, 'history.empty') }));
    } else {
      const list = el('ul', { class: 'history-list' });
      // Newest first: a checkpoint arrives at the head of the list, which is the
      // end the reader is already looking at.
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry) list.append(entryNode(entry, index));
      }
      children.push(list);

      const clear = el('button', {
        type: 'button',
        class: 'history-clear',
        text: t(lang, 'history.clear'),
      });
      clear.addEventListener('click', () => {
        entries.length = 0;
        activeIndex = null;
        paint();
      });
      children.push(clear);
    }

    container.replaceChildren(...children);
  }

  /** Restores an entry and highlights it. The list itself never grows here — the
   *  state being replaced is simply gone, not checkpointed first. */
  function restore(index: number): void {
    const entry = entries[index];
    if (!entry) return;
    activeIndex = index;
    options.onRestore(cloneRows(entry.rows));
    paint();
  }

  return {
    record: (rows) => {
      const last = entries.length - 1;
      if (matches(last, rows)) {
        activeIndex = last;
      } else if (matches(activeIndex ?? -1, rows)) {
        return;
      } else {
        activeIndex = push(rows);
      }
      paint();
    },
    setLang: (next) => {
      lang = next;
      paint();
    },
  };
}