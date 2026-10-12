import { SYSTEM_MATERIALS } from './data/catalog';
import { detectLang, t } from './i18n';
import type { Lang, TranslationKey } from './i18n';
import { renderCalculatorPage } from './pages/calculator';
import { loadLocalMaterials } from './pages/materials';
import type { Material } from './types';
import { DEFAULT_FORM, loadForm, saveForm } from './state/persistence';
import { el, option } from './ui/dom';

type PageHandle = { setLang: (lang: Lang) => void };

type NavLink = { route: string; key: TranslationKey };

const MATERIALS_ROUTE = '/materials';
const CALIBRATE_ROUTE = '/calibrate';
const NAV_LINKS: NavLink[] = [
  { route: '/', key: 'app.nav.calculator' },
  { route: MATERIALS_ROUTE, key: 'app.nav.materials' },
];

const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', ru: 'Русский' };

function required<T>(node: T | null): T {
  if (!node) throw new Error('glaze-calc: page skeleton is missing');
  return node;
}

const app = required(document.querySelector<HTMLElement>('#app'));
const brand = required(document.querySelector<HTMLElement>('.app-brand'));
const nav = required(document.querySelector<HTMLElement>('.app-nav'));
const langHost = required(document.querySelector<HTMLElement>('.app-lang'));

let lang: Lang = loadForm()?.lang ?? detectLang();
let localMaterials: Material[] = loadLocalMaterials();
let page: PageHandle | null = null;

/** The language lives in the same saved form as the recipe, so it survives a reload. */
function persistLang(next: Lang): void {
  saveForm({ ...(loadForm() ?? DEFAULT_FORM), lang: next });
}

/** The hash carries the route (`#/materials`); the query string stays free for
 *  `?recipe=` share payloads. GitHub Pages resolves `#/materials` like any
 *  static file at the site root, so no rewrite rules are needed and the site
 *  works from any subpath (`user.github.io/<repo>/`). */
function routeFromHash(): string {
  const hash = window.location.hash;
  if (!hash.startsWith('#')) return '/';
  return hash.length > 1 ? hash.slice(1) : '/';
}

function renderHeader(): void {
  const route = routeFromHash();
  document.documentElement.lang = lang;
  document.title = t(lang, 'app.title');
  brand.textContent = t(lang, 'app.title');
  nav.setAttribute('aria-label', t(lang, 'app.title'));
  nav.replaceChildren(
    ...NAV_LINKS.map((link) => {
      const active = link.route === route;
      return el('a', {
        class: active ? 'app-link app-link--active' : 'app-link',
        text: t(lang, link.key),
        attrs: { href: `#${link.route}`, ...(active ? { 'aria-current': 'page' } : {}) },
      });
    }),
  );

  const select = el('select', {
    class: 'control',
    attrs: { 'aria-label': t(lang, 'app.nav.language') },
  });
  for (const candidate of ['en', 'ru'] as Lang[]) {
    select.append(option(candidate, LANGUAGE_NAMES[candidate], candidate === lang));
  }
  select.value = lang;
  select.addEventListener('change', () => switchLang(select.value === 'ru' ? 'ru' : 'en'));
  langHost.replaceChildren(select);

  /** The community projects credited in the page footer. */
  const sources = [
    { host: 'segerlab.ru', href: 'https://segerlab.ru' },
    { host: 'calc.portalkeramiki.ru', href: 'https://calc.portalkeramiki.ru' },
    { host: 'glazy.org', href: 'https://glazy.org' },
  ];
  const footer = required(document.querySelector<HTMLElement>('.app-footer'));
  footer.replaceChildren(
    el('span', { class: 'app-footer-label', text: `${t(lang, 'app.footer')} ` }),
    ...sources.flatMap((source, index) => [
      ...(index > 0 ? [el('span', { text: ', ' })] : []),
      el('a', { text: source.host, attrs: { href: source.href, rel: 'noopener noreferrer' } }),
    ]),
  );
}

function switchLang(next: Lang): void {
  lang = next;
  persistLang(lang);
  renderHeader();
  page?.setLang(lang);
}

function mount(): void {
  const route = routeFromHash();
  app.replaceChildren();

  if (route === MATERIALS_ROUTE) {
    import('./pages/materials')
      .then((module) => {
        page = module.renderMaterialsPage(app, {
          lang,
          materials: [...SYSTEM_MATERIALS, ...localMaterials],
          onChange: (next) => {
            localMaterials = next.filter((material) => material.local);
          },
        });
      })
      .catch(() => {
        app.replaceChildren(
          el('h2', { class: 'panel-title', text: t(lang, 'materials.title') }),
          el('p', { class: 'panel-status', text: t(lang, 'generic.error') }),
        );
      });
    return;
  }

  if (route === CALIBRATE_ROUTE && import.meta.env.DEV) {
    // The calibration utility is a local developer tool: gitignored, so neither
    // the repository nor the public build carries it. The specifier stays
    // runtime-computed so neither tsc nor Vite tries to resolve it where the
    // file does not exist; production falls through to the calculator.
    page = null;
    const specifier = './pages/' + 'calibrate';
    import(/* @vite-ignore */ specifier)
      .then((module: { renderCalibratePage: (host: HTMLElement) => void }) =>
        module.renderCalibratePage(app),
      )
      .catch(() => {
        app.replaceChildren(
          el('h2', { class: 'panel-title', text: 'Calibration' }),
          el('p', { class: 'panel-status', text: t(lang, 'generic.error') }),
        );
      });
    return;
  }

  page = renderCalculatorPage(app, lang, localMaterials);
}

renderHeader();
mount();

// Hash links do not reload the document, so the router does in place what a
// server round-trip used to: repaint the active nav link and mount the route.
// Back/forward through the history stack lands here too.
window.addEventListener('hashchange', () => {
  renderHeader();
  mount();
});