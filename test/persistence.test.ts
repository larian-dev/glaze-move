import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeRow } from '../src/types';
import {
  decodeRows,
  encodeRows,
  importRecipeText,
  loadForm,
  rowsFromLocation,
  saveForm,
  shareUrl,
} from '../src/state/persistence';
import type { PersistedForm } from '../src/state/persistence';

const rows: RecipeRow[] = [
  { materialId: 'custer-feldspar', amount: 40, kind: 'main' },
  { materialId: 'Глина краснол earthen', amount: 12.5, kind: 'main' },
  { materialId: 'Fe2O3', amount: 3, kind: 'additional' },
];

describe('share-link rows', () => {
  it('round-trips rows, including Cyrillic text', () => {
    expect(decodeRows(encodeRows(rows))).toEqual(rows);
  });

  it('encodes to a URL-safe alphabet without padding', () => {
    const encoded = encodeRows(rows);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(new URLSearchParams(`recipe=${encoded}`).get('recipe')).toBe(encoded);
  });

  it('rejects garbage', () => {
    expect(decodeRows('not base64!!!')).toBeNull();
    expect(decodeRows(encodeRowsRaw('{"not":"rows"}'))).toBeNull();
    expect(decodeRows(encodeRowsRaw('[1,2,3]'))).toBeNull();
    expect(decodeRows(encodeRowsRaw('[{"materialId":"a","amount":"40","kind":"main"}]'))).toBeNull();
    expect(decodeRows(encodeRowsRaw('[{"materialId":"a","amount":1,"kind":"base"}]'))).toBeNull();
    expect(decodeRows(encodeRowsRaw('[]'))).toEqual([]);
  });

  it('round-trips through a ?recipe= query parameter', () => {
    const url = shareUrl(rows);
    const search = url.slice(url.indexOf('?'));
    expect(rowsFromLocation(search)).toEqual(rows);
    expect(rowsFromLocation('?other=1')).toBeNull();
  });

  it('clamps negative amounts to zero instead of dropping the row', () => {
    const encoded = encodeRowsRaw(
      JSON.stringify([{ materialId: 'a', amount: -10, kind: 'additional' }]),
    );
    expect(decodeRows(encoded)).toEqual([{ materialId: 'a', amount: 0, kind: 'additional' }]);
    expect(rowsFromLocation(`?recipe=${encoded}`)).toEqual([
      { materialId: 'a', amount: 0, kind: 'additional' },
    ]);
  });

  it('drops the per-row drag-solve flags from a share payload', () => {
    // Older share links carried the per-row switches; the clamp is one switch
    // for all additions now, so the flags come out of decoded rows.
    const encoded = encodeRowsRaw(
      JSON.stringify([
        { materialId: 'a', amount: 40, kind: 'additional', inSolve: false, holdOxide: 'SiO2' },
      ]),
    );
    expect(decodeRows(encoded)).toEqual([{ materialId: 'a', amount: 40, kind: 'additional' }]);
  });
});

/** Minimal Storage stand-in — the node test environment has no localStorage. */
class FakeStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

const FORM_KEY = 'glaze-calc.form';

describe('stored form', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new FakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a saved form through localStorage', () => {
    const form: PersistedForm = {
      rows,
      unitDisplay: 'molePercent',
      lang: 'ru',
      roFlux: 'MgO',
      includeAdditions: false,
      clampFluxRatio: true,
      clampAdditions: false,
      clampBoron: true,
    };
    saveForm(form);
    expect(loadForm()).toEqual(form);
  });

  it('falls back to defaults when the stored payload is malformed', () => {
    localStorage.setItem(FORM_KEY, '{not json');
    expect(loadForm()).toBeNull();

    localStorage.setItem(FORM_KEY, JSON.stringify([1, 2, 3]));
    expect(loadForm()).toBeNull();

    localStorage.setItem(
      FORM_KEY,
      JSON.stringify({ rows: [{ materialId: 'a', amount: '40', kind: 'main' }] }),
    );
    expect(loadForm()).toBeNull();
  });

  it('fills fields the stored payload does not mention with defaults', () => {
    localStorage.setItem(FORM_KEY, JSON.stringify({ rows: [] }));
    expect(loadForm()).toEqual({
      rows: [],
      unitDisplay: 'unity',
      lang: 'en',
      roFlux: 'CaO',
      includeAdditions: true,
      clampFluxRatio: false,
      clampAdditions: true,
      clampBoron: false,
    });
  });

  it('carries a legacy global drag-solve flag onto the additions clamp', () => {
    // Forms written before the per-component switches stored one global flag:
    // `solveWithAdditions: false` means the additions sat out the solve — the
    // verdict the additions clamp expresses now.
    localStorage.setItem(
      FORM_KEY,
      JSON.stringify({
        rows: [
          { materialId: 'a', amount: 40, kind: 'main' },
          { materialId: 'b', amount: 3, kind: 'additional' },
        ],
        roFlux: 'CaO',
        solveWithAdditions: false,
      }),
    );
    const loaded = loadForm();
    expect(loaded?.clampAdditions).toBe(false);
    expect(loaded?.clampFluxRatio).toBe(false);
    // Per-row flags are gone: the clamp is one switch for all additions.
    expect(loaded?.rows).toEqual([
      { materialId: 'a', amount: 40, kind: 'main' },
      { materialId: 'b', amount: 3, kind: 'additional' },
    ]);

    // An absent key keeps the default: additions stay clamped.
    localStorage.setItem(
      FORM_KEY,
      JSON.stringify({ rows: [{ materialId: 'b', amount: 3, kind: 'additional' }] }),
    );
    expect(loadForm()?.clampAdditions).toBe(true);
  });

  it('keeps counting additions for a stored form written before the toggle', () => {
    // No `includeAdditions` key at all: the pre-toggle behaviour was to include
    // them, so an older session must not silently flip to the base alone.
    localStorage.setItem(FORM_KEY, JSON.stringify({ rows: [], roFlux: 'CaO' }));
    expect(loadForm()?.includeAdditions).toBe(true);
  });

  it('ignores a non-boolean includeAdditions', () => {
    localStorage.setItem(FORM_KEY, JSON.stringify({ rows: [], includeAdditions: 'no' }));
    expect(loadForm()?.includeAdditions).toBe(true);
  });

  it('drops the removed hold fields from an older stored form', () => {
    localStorage.setItem(
      FORM_KEY,
      JSON.stringify({
        rows: [{ materialId: 'a', amount: 40, kind: 'additional', holdOxide: 'B2O3' }],
        heldOxides: ['SiO2', 'SiO2', '', 7, 'CaO'],
      }),
    );
    const loaded = loadForm();
    expect(loaded?.rows).toEqual([{ materialId: 'a', amount: 40, kind: 'additional' }]);
    expect(loaded?.clampAdditions).toBe(true);
  });

  it('clamps negative amounts read from localStorage', () => {
    localStorage.setItem(
      FORM_KEY,
      JSON.stringify({
        rows: [{ materialId: 'a', amount: -2.5, kind: 'additional' }],
        unitDisplay: 'unity',
        lang: 'en',
        roFlux: 'CaO',
      }),
    );
    expect(loadForm()?.rows).toEqual([{ materialId: 'a', amount: 0, kind: 'additional' }]);
  });
});

describe('recipe import from pasted text', () => {
  it('accepts the full share link it exports', () => {
    expect(importRecipeText(shareUrl(rows))).toEqual(rows);
  });

  it('reads the recipe parameter out of a link with other parameters and a hash', () => {
    const payload = encodeRows(rows);
    expect(importRecipeText(`https://host/glaze/?a=1&recipe=${payload}#/materials`)).toEqual(rows);
  });

  it('accepts a bare payload and tolerates pasted whitespace', () => {
    const payload = encodeRows(rows);
    expect(importRecipeText(payload)).toEqual(rows);
    const split = Math.floor(payload.length / 2);
    expect(importRecipeText(`${payload.slice(0, split)}\n ${payload.slice(split)}`)).toEqual(rows);
  });

  it('clamps negative amounts from a pasted payload', () => {
    const encoded = encodeRowsRaw(JSON.stringify([{ materialId: 'a', amount: -5, kind: 'main' }]));
    expect(importRecipeText(encoded)).toEqual([{ materialId: 'a', amount: 0, kind: 'main' }]);
  });

  it('rejects empty text, garbage and links without a recipe', () => {
    expect(importRecipeText('')).toBeNull();
    expect(importRecipeText('not a recipe')).toBeNull();
    expect(importRecipeText('https://example.com/')).toBeNull();
  });
});

function encodeRowsRaw(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
