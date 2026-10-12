import type { RecipeRow } from '../types';
import type { Lang } from '../i18n';
import { isLang } from '../i18n';

export type PersistedForm = {
  rows: RecipeRow[];
  unitDisplay: 'unity' | 'molePercent';
  lang: Lang;
  roFlux: string;
  /** Whether `additional` rows join the chemistry (UMF, mole %, CTE, firing) or
   *  are treated as bench additions on top of the finished base. */
  includeAdditions: boolean;
  /** Refuse any drag solve that would move the R₂O:RO ratio off its start. */
  clampFluxRatio: boolean;
  /** Clamp every addition in the drag solve: each keeps its dominant oxide's
   *  unity value while its parts follow the base. Off, the solver may rewrite
   *  addition amounts as carriers. */
  clampAdditions: boolean;
  /** Hold the batch's unity B₂O₃ through a drag, so the boron map's marker
   *  stays put while the Stull point moves. */
  clampBoron: boolean;
};

const STORAGE_KEY = 'glaze-calc.form';
export const SHARE_PARAM = 'recipe';

export const DEFAULT_FORM: PersistedForm = {
  rows: [],
  unitDisplay: 'unity',
  lang: 'en',
  roFlux: 'CaO',
  includeAdditions: true,
  clampFluxRatio: false,
  clampAdditions: true,
  clampBoron: false,
};

export function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** UTF-8 → base64url (URL-safe alphabet, padding stripped). */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → UTF-8. Throws on malformed input; callers treat that as invalid. */
export function fromBase64Url(text: string): string {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function isRow(value: unknown): value is RecipeRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.materialId === 'string' &&
    typeof row.amount === 'number' &&
    Number.isFinite(row.amount) &&
    (row.kind === 'main' || row.kind === 'additional')
  );
}

export function encodeRows(rows: RecipeRow[]): string {
  return toBase64Url(JSON.stringify(rows));
}

/** The row fields this app owns, from a validated row object. Negative amounts
 *  are clamped to 0 instead of dropping the row. Per-row drag-solve flags from
 *  older versions are dropped — the clamp is one switch for all additions now. */
function toRow(row: RecipeRow): RecipeRow {
  return {
    materialId: row.materialId,
    amount: Math.max(0, row.amount),
    kind: row.kind,
  };
}

/** Returns `null` for anything that is not a valid row array — garbage in, nothing out. */
export function decodeRows(text: string): RecipeRow[] | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(text));
    if (!Array.isArray(parsed) || !parsed.every(isRow)) return null;
    return parsed.map((row) => toRow(row));
  } catch {
    return null;
  }
}

export function shareUrl(rows: RecipeRow[]): string {
  const loc = typeof window === 'undefined' ? undefined : window.location;
  const base = loc ? (loc.href.split('?')[0] ?? '').split('#')[0] ?? '' : '';
  // The route lives in the hash and is appended after the query, so a payload
  // shared from `#/materials` reopens that route. GitHub Pages resolves
  // `?recipe=` like any static file, so the query needs no rewrite rules.
  return `${base}?${SHARE_PARAM}=${encodeRows(rows)}${loc?.hash ?? ''}`;
}

/** Reads the `?recipe=` payload from a search string; `null` when absent or invalid. */
export function rowsFromLocation(search: string): RecipeRow[] | null {
  let param: string | null;
  try {
    param = new URLSearchParams(search).get(SHARE_PARAM);
  } catch {
    return null;
  }
  if (!param) return null;
  return decodeRows(param);
}

function isUnitDisplay(value: unknown): value is PersistedForm['unitDisplay'] {
  return value === 'unity' || value === 'molePercent';
}

function parseForm(value: unknown): PersistedForm | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.rows) || !raw.rows.every(isRow)) return null;
  // A form from before the per-component switches carried one global drag-solve
  // flag — the same verdict the additions clamp expresses now, so it carries
  // over. Per-row flags are dropped: the clamp is one switch for all additions.
  const legacyExcluded = raw.solveWithAdditions === false;
  const rows = (raw.rows as RecipeRow[]).map((row) => toRow(row));
  return {
    rows,
    unitDisplay: isUnitDisplay(raw.unitDisplay) ? raw.unitDisplay : DEFAULT_FORM.unitDisplay,
    lang: isLang(raw.lang) ? raw.lang : DEFAULT_FORM.lang,
    roFlux: typeof raw.roFlux === 'string' && raw.roFlux ? raw.roFlux : DEFAULT_FORM.roFlux,
    // Absent or non-boolean means an older stored form, which predates the
    // switch; those keep the behaviour they had, as they always did.
    includeAdditions:
      typeof raw.includeAdditions === 'boolean' ? raw.includeAdditions : DEFAULT_FORM.includeAdditions,
    clampFluxRatio:
      typeof raw.clampFluxRatio === 'boolean' ? raw.clampFluxRatio : DEFAULT_FORM.clampFluxRatio,
    // The stored switch wins; the legacy global flag only speaks when the new
    // key is absent, which is exactly the forms it was written for.
    clampAdditions:
      typeof raw.clampAdditions === 'boolean'
        ? raw.clampAdditions
        : legacyExcluded
          ? false
          : DEFAULT_FORM.clampAdditions,
    clampBoron: typeof raw.clampBoron === 'boolean' ? raw.clampBoron : DEFAULT_FORM.clampBoron,
  };
}

export function loadForm(): PersistedForm | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseForm(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveForm(form: PersistedForm): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(form));
  } catch {
    // private browsing / quota — autosave is best-effort
  }
}

/** Triggers a JSON download of the recipe rows. No-op without a DOM. */
export function exportToFile(form: PersistedForm): void {
  if (typeof document === 'undefined') return;
  const payload: Record<string, unknown> = {
    app: 'glaze-calc',
    version: 1,
    rows: form.rows,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'glaze-recipe.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** Reads a pasted share link or bare recipe payload. A link contributes its
 *  `?recipe=` parameter (hash and unrelated parameters ignored); anything else
 *  is decoded as a payload, with pasted whitespace stripped. */
export function importRecipeText(text: string): RecipeRow[] | null {
  const value = text.trim();
  if (!value) return null;
  if (value.includes('?')) {
    const query = value.slice(value.indexOf('?')).split('#')[0];
    const param = new URLSearchParams(query).get(SHARE_PARAM);
    if (param) {
      const rows = decodeRows(param.replace(/\s+/g, ''));
      if (rows) return rows;
    }
  }
  return decodeRows(value.replace(/\s+/g, ''));
}
