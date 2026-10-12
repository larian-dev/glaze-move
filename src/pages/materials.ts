import { t } from '../i18n';
import type { Lang, TranslationKey } from '../i18n';
import type { Material, MaterialType, Region } from '../types';
import { OXIDES, SYSTEM_MATERIALS } from '../data/catalog';
import { effectiveLoi, to100 } from '../core/normalize';
import { loadForm, saveForm, storage } from '../state/persistence';
import { el, fmt, option, setText } from '../ui/dom';
import { createMaterialJson } from '../ui/material-json';
import type { MaterialJsonView } from '../ui/material-json';

export const LOCAL_MATERIALS_KEY = 'glaze-calc.materials';

export type MaterialsPageDeps = {
  lang: Lang;
  /** Full working set: bundled system materials plus the caller's local ones.
   *  Defaults to the bundled catalog merged with the persisted local materials. */
  materials?: Material[];
  /** Reports the whole set back to the app; local entries are persisted by this page. */
  onChange?: (materials: Material[]) => void;
};

export type MaterialsPageHandle = {
  setLang: (lang: Lang) => void;
};

const REGIONS: readonly Region[] = ['world', 'EU', 'US', 'Russia'];
const TYPES: readonly MaterialType[] = ['feldspar', 'frit', 'colorant', 'clay', 'other'];

/** Display/entry order of the oxide grid: verbatim `oxides.json` order. */
const OXIDE_ORDER: Record<string, number> = Object.fromEntries(
  OXIDES.map((o, index) => [o.formula, index]),
);

function isMaterial(value: unknown): value is Material {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return false;
  if (!num(raw.density) || !num(raw.price) || !num(raw.loi)) return false;
  if (!REGIONS.includes(raw.region as Region)) return false;
  if (!TYPES.includes(raw.type as MaterialType)) return false;
  if (!Array.isArray(raw.components)) return false;
  return raw.components.every(
    (c: unknown) =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as { oxide?: unknown }).oxide === 'string' &&
      num((c as { amount?: unknown }).amount),
  );
}

/** Reads persisted local materials; anything malformed is dropped. */
export function loadLocalMaterials(): Material[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(LOCAL_MATERIALS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMaterial).map((m) => ({ ...m, local: true }));
  } catch {
    return [];
  }
}

/** Persists the local subset of the working set. */
export function saveLocalMaterials(materials: Material[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      LOCAL_MATERIALS_KEY,
      JSON.stringify(materials.filter((m) => m.local).map((m) => ({ ...m, local: true }))),
    );
  } catch {
    // private browsing / quota — persistence is best-effort
  }
}

export function clearLocalMaterials(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(LOCAL_MATERIALS_KEY);
  } catch {
    // ignore
  }
}

/** Recipe rows reference materials by id, so a rename has to follow them into
 *  the stored form — an orphaned id resolves to nothing and the recipe would
 *  silently lose that material's chemistry. */
function rekeyRows(from: string, to: string): void {
  const form = loadForm();
  if (!form) return;
  let changed = false;
  const rows = form.rows.map((row) => {
    if (row.materialId !== from) return row;
    changed = true;
    return { ...row, materialId: to };
  });
  if (changed) saveForm({ ...form, rows });
}

function cloneMaterial(material: Material): Material {
  return { ...material, components: material.components.map((c) => ({ ...c })) };
}

function cloneMaterials(materials: Material[]): Material[] {
  return materials.map(cloneMaterial);
}

/** Ids that never collide with the bundled `'1'`, `'2'`, … identifiers. */
function nextId(taken: readonly string[]): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`local-${n}`)) n += 1;
  return `local-${n}`;
}

function blankMaterial(id: string): Material {
  return {
    id,
    name: '',
    density: 0,
    region: 'world',
    price: 0,
    loi: 0,
    type: 'other',
    components: [],
    local: true,
  };
}

export function renderMaterialsPage(
  container: HTMLElement,
  deps: MaterialsPageDeps,
): MaterialsPageHandle {
  let lang = deps.lang;
  let materials = cloneMaterials(
    deps.materials ?? [...SYSTEM_MATERIALS, ...loadLocalMaterials()],
  );
  let selectedId: string | null = null;
  let json: MaterialJsonView | null = null;

  function selected(): Material | null {
    return materials.find((m) => m.id === selectedId) ?? null;
  }

  function commit(next: Material[], persist = true): void {
    materials = cloneMaterials(next);
    if (persist) saveLocalMaterials(materials);
    deps.onChange?.(cloneMaterials(materials));
    render();
  }

  /** Persists and reports without re-rendering — used by the live-edit fields. */
  function flush(): void {
    saveLocalMaterials(materials);
    deps.onChange?.(cloneMaterials(materials));
    json?.update();
  }

  function field(labelKey: TranslationKey, control: HTMLElement): HTMLElement {
    return el('label', { class: 'materials-field' }, [
      el('span', { class: 'materials-caption', text: t(lang, labelKey) }),
      control,
    ]);
  }

  function textInput(
    id: string,
    value: string,
    onInput: (value: string) => void,
  ): HTMLInputElement {
    const input = el('input', { type: 'text', value, attrs: { id, name: id } });
    input.addEventListener('input', () => {
      onInput(input.value);
      flush();
    });
    return input;
  }

  /** Id field that refuses an empty id or one owned by a different material —
   *  either would shadow another entry in the material index and break recipe rows. */
  function idInput(material: Material | null): HTMLInputElement {
    const input = el('input', {
      type: 'text',
      value: material?.id ?? '',
      attrs: { id: 'materials-id', name: 'materials-id' },
    });
    input.addEventListener('input', () => {
      if (!material) return;
      const value = input.value;
      const owner = materials.find((m) => m.id === value);
      if (value === '' || (owner !== undefined && owner !== material)) {
        input.value = material.id;
        return;
      }
      const previous = material.id;
      material.id = value;
      for (const m of materials) if (m.id === previous) m.id = value;
      selectedId = value;
      rekeyRows(previous, value);
      flush();
    });
    return input;
  }

  function numberInput(
    id: string,
    value: number,
    onInput: (value: number) => void,
    allowNegative = false,
  ): HTMLInputElement {
    const input = el('input', {
      type: 'number',
      value: fmt(value, 2),
      // Negative LOI is gain on ignition — a real datasheet entry — so only the
      // oxide cells carry the min="0" guard.
      attrs: { id, name: id, ...(allowNegative ? {} : { min: '0' }), step: '0.01' },
    });
    let accepted = value;
    input.addEventListener('input', () => {
      const parsed = input.valueAsNumber;
      if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0)) return;
      accepted = parsed;
      onInput(parsed);
      flush();
    });
    // A rejected or half-typed value must not outlive the field: blur shows
    // the last accepted amount again.
    input.addEventListener('blur', () => {
      if (input.valueAsNumber !== accepted) input.value = fmt(accepted, 2);
    });
    return input;
  }

  function selectInput(
    id: string,
    values: readonly string[],
    current: string,
    label: (value: string) => string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const select = el('select', { attrs: { id, name: id } });
    for (const value of values) select.append(option(value, label(value)));
    select.value = current;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  /** The oxide's entry in the material: inserted on first non-zero use, dropped
   *  when its amount returns to zero, and the array is kept in catalog order,
   *  so the exported JSON reads like the grid. */
  function setComponent(material: Material, oxide: string, amount: number): void {
    const index = material.components.findIndex((c) => c.oxide === oxide);
    if (index >= 0) {
      if (amount === 0) material.components.splice(index, 1);
      else material.components[index]!.amount = amount;
    } else if (amount !== 0) {
      material.components.push({ oxide, amount });
    }
    material.components.sort(
      (a, b) =>
        (OXIDE_ORDER[a.oxide] ?? OXIDES.length) - (OXIDE_ORDER[b.oxide] ?? OXIDES.length),
    );
  }

  /**
   * Every catalog oxide as one label:input cell, in `oxides.json` order — an
   * empty material reads all zeros, a filled one needs no add/remove dance.
   * LOI closes the grid: it is part of what the material weighs up to 100, so
   * *To 100%* scales it with the oxides. Components the catalog does not know
   * keep their amounts at the end, so nothing silently disappears. Labels are
   * the plain formulas; `onEdit` repaints the legend's live total.
   */
  function componentGrid(material: Material, onEdit: () => void): HTMLElement {
    const grid = el('div', { class: 'materials-components' });
    const cell = (label: string, input: HTMLInputElement): HTMLElement =>
      el('label', { class: 'materials-component' }, [
        el('span', { class: 'materials-caption', text: label }),
        input,
      ]);

    for (const oxide of OXIDES) {
      grid.append(
        cell(
          oxide.formula,
          numberInput(
            `materials-oxide-${oxide.formula}`,
            material.components.find((c) => c.oxide === oxide.formula)?.amount ?? 0,
            (value) => {
              setComponent(material, oxide.formula, value);
              onEdit();
            },
          ),
        ),
      );
    }
    for (const extra of material.components.filter(
      (c) => !OXIDES.some((o) => o.formula === c.oxide),
    )) {
      grid.append(
        cell(
          extra.oxide,
          numberInput(`materials-oxide-${extra.oxide}`, extra.amount, (value) => {
            setComponent(material, extra.oxide, value);
            onEdit();
          }),
        ),
      );
    }
    grid.append(
      cell(
        t(lang, 'materials.loi'),
        numberInput(
          'materials-loi',
          material.loi,
          (value) => {
            material.loi = value;
            onEdit();
          },
          true,
        ),
      ),
    );
    return grid;
  }

  function detail(material: Material | null): HTMLElement {
    const editable = material?.local === true;
    const update = (): void => commit(materials, editable);

    const grid = el('div', { class: 'materials-grid' }, [
      field('materials.id', idInput(material)),
      field(
        'materials.name',
        textInput('materials-name', material?.name ?? '', (value) => {
          if (!material) return;
          material.name = value;
        }),
      ),
      field(
        'materials.type',
        selectInput(
          'materials-type',
          TYPES,
          material?.type ?? 'other',
          (value) => t(lang, `materials.type.${value}` as TranslationKey),
          (value) => {
            if (!material) return;
            material.type = value as MaterialType;
            update();
          },
        ),
      ),
      field(
        'materials.region',
        selectInput(
          'materials-region',
          REGIONS,
          material?.region ?? 'world',
          (value) => t(lang, `materials.region.${value}` as TranslationKey),
          (value) => {
            if (!material) return;
            material.region = value as Region;
            update();
          },
        ),
      ),
      field(
        'materials.density',
        numberInput('materials-density', material?.density ?? 0, (value) => {
          if (!material) return;
          material.density = value;
        }),
      ),
      field(
        'materials.price',
        numberInput('materials-price', material?.price ?? 0, (value) => {
          if (!material) return;
          material.price = value;
        }),
      ),
    ]);

    const totalReadout = el('span', { class: 'materials-legend-total' });
    /** The legend's live line: the oxides' current percentage and the
     *  material's effective LOI — the rest of the 100% when none was entered. */
    const paintTotals = (): void => {
      if (!material) return;
      const total = material.components.reduce((sum, c) => sum + c.amount, 0);
      setText(
        totalReadout,
        t(lang, 'materials.totalLine', {
          total: fmt(total, 2),
          loi: fmt(effectiveLoi(material), 2),
        }),
      );
    };

    const components = el('fieldset', { class: 'materials-fieldset' }, [
      el('legend', { class: 'materials-legend' }, [
        el('span', { text: t(lang, 'materials.components') }),
        totalReadout,
      ]),
      material ? componentGrid(material, paintTotals) : null,
    ]);

    if (editable && material) {
      const normalize = el('button', {
        type: 'button',
        class: 'materials-to100',
        text: t(lang, 'materials.to100'),
      });
      normalize.addEventListener('click', () => {
        // LOI is part of what the material weighs up: the scale targets 100
        // over oxides and LOI together. With LOI implied, that leaves the
        // oxide amounts untouched and only materializes the remainder.
        const scaled = to100([...material.components.map((c) => c.amount), effectiveLoi(material)]);
        material.components.forEach((c, i) => {
          c.amount = scaled[i] ?? 0;
        });
        material.loi = scaled[material.components.length] ?? 0;
        update();
      });
      components.append(el('div', { class: 'materials-component-actions' }, [normalize]));
    }
    paintTotals();

    const form = el('form', { class: 'materials-form' }, [grid, components]);
    form.addEventListener('submit', (event) => event.preventDefault());
    if (!editable) {
      for (const control of Array.from(form.querySelectorAll('input, select'))) {
        control.setAttribute('disabled', '');
      }
    }

    const jsonHost = el('div', { class: 'materials-json' });
    json = createMaterialJson(jsonHost, { lang, getMaterial: () => selected() });

    const actions: HTMLElement[] = [];
    if (material) {
      const duplicate = el('button', {
        type: 'button',
        class: 'materials-duplicate',
        text: t(lang, 'materials.duplicate'),
      });
      duplicate.addEventListener('click', () => duplicateMaterial(material));
      actions.push(duplicate);

      if (editable) {
        const remove = el('button', {
          type: 'button',
          class: 'materials-delete',
          text: t(lang, 'materials.delete'),
        });
        remove.addEventListener('click', () => deleteMaterial(material));
        actions.push(remove);
      }
    }

    return el('section', { class: 'materials-detail' }, [
      el('h2', { class: 'materials-title', text: t(lang, 'materials.title') }),
      form,
      jsonHost,
      el('div', { class: 'materials-actions' }, actions),
    ]);
  }

  /** Clones any material into a new local one and opens the copy for editing.
   *  Shared by the detail panel and every row's duplicate button. */
  function duplicateMaterial(material: Material): void {
    const id = nextId(materials.map((m) => m.id));
    const copy = { ...cloneMaterial(material), id, name: `${material.name} (2)`, local: true };
    selectedId = id;
    commit([...materials, copy]);
  }

  /** Deletes a local material after confirmation. Recipe rows that referenced
   *  it keep their id and resolve to nothing, like any orphaned row. */
  function deleteMaterial(material: Material): void {
    const label = material.name || material.id;
    if (!window.confirm(t(lang, 'materials.deleteConfirm', { name: label }))) return;
    if (selectedId === material.id) selectedId = null;
    commit(materials.filter((m) => m.id !== material.id));
  }

  function listSection(items: Material[], titleKey: TranslationKey): HTMLElement {
    const list = el('div', { class: 'materials-list' });
    for (const material of items) {
      const active = material.id === selectedId;
      const name = material.name || material.id;
      const open = el('button', {
        type: 'button',
        class: active ? 'materials-item materials-item--active' : 'materials-item',
        text: name,
        attrs: { 'aria-current': active ? 'true' : 'false' },
      });
      open.addEventListener('click', () => {
        selectedId = material.id;
        render();
      });
      const duplicate = el('button', {
        type: 'button',
        class: 'materials-item-duplicate',
        text: t(lang, 'materials.duplicate'),
        attrs: { 'aria-label': t(lang, 'materials.duplicateNamed', { name }) },
      });
      duplicate.addEventListener('click', () => duplicateMaterial(material));
      const row = el('div', { class: 'materials-item-row' }, [open, duplicate]);
      if (material.local) {
        const remove = el('button', {
          type: 'button',
          class: 'materials-item-delete',
          text: '×',
          attrs: { 'aria-label': t(lang, 'materials.deleteNamed', { name }) },
        });
        remove.addEventListener('click', () => deleteMaterial(material));
        row.append(remove);
      }
      list.append(row);
    }
    return el('section', { class: 'materials-section' }, [
      el('h3', { class: 'materials-section-title', text: t(lang, titleKey) }),
      list,
    ]);
  }

  /** Toolbar feedback for the file import; render() re-creates the span, so the
   *  reference is refreshed there and flash writes after the re-render. */
  let toolbarStatus: HTMLSpanElement | null = null;
  let statusTimer: number | undefined;
  function flashStatus(message: string): void {
    if (!toolbarStatus) return;
    toolbarStatus.textContent = message;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (toolbarStatus) toolbarStatus.textContent = '';
    }, 3000);
  }

  function render(): void {
    const local = materials.filter((m) => m.local);
    const system = materials.filter((m) => !m.local);

    const create = el('button', {
      type: 'button',
      class: 'materials-create',
      text: t(lang, 'materials.new'),
    });
    create.addEventListener('click', () => {
      const material = blankMaterial(nextId(materials.map((m) => m.id)));
      selectedId = material.id;
      commit([...materials, material]);
    });

    const clear = el('button', {
      type: 'button',
      class: 'materials-clear',
      text: t(lang, 'materials.clearLocal'),
      disabled: local.length === 0,
    });
    clear.addEventListener('click', () => {
      if (!window.confirm(t(lang, 'materials.clearLocalConfirm'))) return;
      selectedId = null;
      clearLocalMaterials();
      commit([...system], false);
    });

    const exportButton = el('button', {
      type: 'button',
      class: 'materials-export',
      text: t(lang, 'materials.export'),
      disabled: local.length === 0,
    });
    exportButton.addEventListener('click', () => {
      // Plain JSON of the local materials — no encoding; the file is what the
      // import reads back.
      const blob = new Blob([JSON.stringify(local, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'glaze-materials.json';
      link.click();
      URL.revokeObjectURL(url);
    });

    const importButton = el('button', {
      type: 'button',
      class: 'materials-import',
      text: t(lang, 'materials.import'),
    });
    importButton.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        void file.text().then((text) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            flashStatus(t(lang, 'materials.importFailed'));
            return;
          }
          if (!Array.isArray(parsed)) {
            flashStatus(t(lang, 'materials.importFailed'));
            return;
          }
          // Merge by id: same-id locals are replaced, new ids appended, and
          // anything colliding with a system material is skipped — a local
          // entry must never shadow the bundled catalog in the index.
          const systemIds = new Set(system.map((m) => m.id));
          const locals = new Map(local.map((m) => [m.id, m]));
          let imported = 0;
          let skipped = 0;
          for (const entry of parsed) {
            if (!isMaterial(entry) || systemIds.has(entry.id)) {
              skipped++;
              continue;
            }
            locals.set(entry.id, { ...entry, local: true });
            imported++;
          }
          if (imported === 0 && skipped === 0) {
            flashStatus(t(lang, 'materials.importFailed'));
            return;
          }
          commit([...system, ...locals.values()]);
          flashStatus(t(lang, 'materials.imported', { count: imported, skipped }));
        });
      });
      input.click();
    });

    const status = el('span', { class: 'materials-status', attrs: { role: 'status' } });
    toolbarStatus = status;

    container.replaceChildren(
      el('div', { class: 'materials-toolbar' }, [create, clear, exportButton, importButton, status]),
      el('div', { class: 'materials-lists' }, [
        listSection(system, 'materials.system'),
        listSection(local, 'materials.local'),
      ]),
      detail(selected()),
    );
  }

  const handle: MaterialsPageHandle = {
    setLang: (next) => {
      lang = next;
      render();
    },
  };
  render();
  return handle;
}