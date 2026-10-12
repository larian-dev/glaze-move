import type { RecipeRow } from './types';

/** Console diagnostics for the drag solve and the zone scan, off unless asked
 *  for: add `?debug=1` to the URL, or set `localStorage['glaze-calc.debug']` to
 *  `'1'`. They exist so a reported oddity — a drag that refused, a region that
 *  changed shape — can be read off the console instead of re-derived with a
 *  throwaway probe. The flag is read on every call: toggling it costs one
 *  storage read, and a debug switch that needs a reload is a debug switch that
 *  wastes the round it was meant to save. */
const DEBUG_KEY = 'glaze-calc.debug';

function debugEnabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1') return true;
  } catch {
    // private browsing: no storage to read, the URL can still ask for it
  }
  try {
    if (typeof location !== 'undefined' && location.search) {
      return new URLSearchParams(location.search).get('debug') === '1';
    }
  } catch {
    // an unreadable location leaves the flag off
  }
  return false;
}

/** One console line when the debug flag is on; nothing otherwise. */
export function debugLog(scope: string, ...values: unknown[]): void {
  if (!debugEnabled()) return;
  console.log(`[glaze-calc ${scope}]`, ...values);
}

/** A recipe as one console line: `m1:24.44 a37:26.57` — kind initial, id, amount. */
export function debugRows(rows: RecipeRow[]): string {
  return rows.map((row) => `${row.kind === 'main' ? 'm' : 'a'}${row.materialId}:${row.amount}`).join(' ');
}
