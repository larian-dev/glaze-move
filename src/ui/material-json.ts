import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { Material } from '../types';
import { el } from './dom';

export type MaterialJsonOptions = {
  lang: Lang;
  /** Read on every update, so the view follows the material being edited. */
  getMaterial: () => Material | null;
};

export type MaterialJsonView = {
  /** Re-reads the material and refreshes the output. */
  update: () => void;
};

function serialize(material: Material | null): string {
  return material ? JSON.stringify(material, null, 2) : '';
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Live JSON of a material in `Material` shape, plus a copy-to-clipboard button. */
export function createMaterialJson(
  container: HTMLElement,
  options: MaterialJsonOptions,
): MaterialJsonView {
  const lang = options.lang;
  let copied = false;
  let timer: number | undefined;

  const output = el('textarea', {
    class: 'materials-json-output',
    attrs: { readonly: 'readonly', rows: '18', spellcheck: 'false' },
  });
  const status = el('p', {
    class: 'materials-json-status',
    attrs: { role: 'status' },
  });
  const copy = el('button', {
    type: 'button',
    class: 'materials-json-copy',
    text: t(lang, 'materials.copyJson'),
  });

  function paintLabels(): void {
    copy.textContent = t(lang, 'materials.copyJson');
    output.setAttribute('aria-label', t(lang, 'materials.json'));
    status.textContent = copied ? t(lang, 'materials.jsonCopied') : '';
  }

  copy.addEventListener('click', () => {
    const text = serialize(options.getMaterial());
    if (!text) return;
    void writeClipboard(text).then((ok) => {
      copied = ok;
      paintLabels();
      clearTimeout(timer);
      timer = setTimeout(() => {
        copied = false;
        paintLabels();
      }, 2000);
    });
  });

  container.replaceChildren(
    el('h3', { class: 'materials-json-title', text: t(lang, 'materials.json') }),
    copy,
    output,
    status,
  );
  paintLabels();

  const view: MaterialJsonView = {
    update: () => {
      const text = serialize(options.getMaterial());
      if (output.value !== text) output.value = text;
    },
  };
  view.update();
  return view;
}