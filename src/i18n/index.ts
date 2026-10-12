export type Lang = 'en' | 'ru';

export const LANGS: Lang[] = ['en', 'ru'];

export const DEFAULT_LANG: Lang = 'en';

const en = {
  'app.title': 'Glaze Move',
  'app.nav.calculator': 'Calculator',
  'app.nav.materials': 'Material database',
  'app.nav.pricing': 'Pricing',
  'app.nav.calibrate': 'Calibration',
  'app.nav.language': 'Language',
  'app.footer': 'Ideas stolen from:',

  'recipe.mainComponents': 'Main',
  'recipe.additionalComponents': 'Additional',
  'recipe.includeAdditions': 'In the UMF',
  'stull.clampFluxRatio': 'Clamp R2O:RO',
  'stull.clampAdditions': 'Clamp additions',
  'stull.clampBoron': 'Clamp boron',
  'recipe.material': 'Material',
  'recipe.materialPlaceholder': 'Choose a material',
  'recipe.amount': 'Amount',
  'recipe.to100': 'To 100%',
  'recipe.addRow': 'Add row',
  'recipe.remove': 'Remove',
  'recipe.removeRow': 'Remove row {material}',
  'recipe.move': 'Move',
  'recipe.moveRow': 'Move row {material}',
  'recipe.moveHint': 'Drag to reorder or move between sections; Alt + ↑/↓ moves one slot',
  'recipe.total': 'Total: {value}',
  'recipe.clear': 'Clear all',
  'recipe.empty': 'No rows yet',

  'results.units': 'Units',
  'results.unityFormula': 'UMF',
  'results.molePercent': 'Mole %',
  'results.cte': 'CTE',
  'results.firingTemperature': 'Firing temperature',
  'results.costPerKg': 'Cost per kg',
  'results.loi': 'LOI',
  'results.unityUndefined': 'The unity formula is undefined — the recipe has no flux.',
  'results.group.other': 'Other',

  'charts.label': 'Charts',

  'stull.title': 'Stull map',
  'stull.axisX': 'SiO₂ (0–9)',
  'stull.axisY': 'Al₂O₃ (0–1)',
  'stull.aria': 'Stull chart of the base glaze. Drag the point or use the arrow keys to move it.',
  'stull.hint':
    'Drag the point, or focus the map and use the arrow keys — Ctrl snaps to the 0.1 × 0.01 grid. Scroll to zoom, shift-drag to pan. Escape cancels. Inside the dashed outline a drag lands; the hatched band outside it marks targets that would empty a component.',
  'stull.noPoint': 'No flux — the recipe has no point on the map.',
  'stull.emptied': '{material} would drop to zero there and leave the base, so the drag was refused.',
  'stull.emptiedMany': 'These would drop to zero there and leave the base, so the drag was refused: {materials}.',
  'stull.snapback.too-few-rows': 'Too few rows to refit the base.',
  'stull.snapback.no-flux': 'The recipe has no flux.',
  'stull.snapback.no-alumina-carrier': 'No material supplies alumina.',
  'stull.snapback.singular': 'The current materials cannot reach this point.',
  'stull.snapback.negative-amount': 'The target would need a negative amount.',
  'stull.snapback.no-flux-total': 'The refit would leave no flux.',
  'stull.snapback.flux-ratio': 'The R₂O:RO ratio cannot be held at this target.',
  'stull.snapback.over-constrained': 'Too many values are clamped for this target — release one.',

  'triaxial.title': 'Triaxial map',
  'triaxial.roFlux': 'RO flux',
  'triaxial.noRoFlux': 'No RO flux in this recipe — add CaO, MgO or another RO to place the point.',
  'triaxial.aria': 'Triaxial chart of the full batch against the selected RO flux.',
  'triaxial.hint':
    'Drag the point, or focus the map and use the arrow keys — Ctrl snaps to the 0.01 grid. Scroll to zoom, shift-drag to pan. Escape cancels.',

  'boron.title': 'Boron map',
  'boron.axisX': 'B₂O₃ (0–0.5)',
  'boron.axisY': 'Firing temperature (°C)',
  'boron.aria': 'Boron chart: unity B₂O₃ of the batch against the calculated firing temperature.',
  'boron.hint':
    'The map reads the batch: unity B₂O₃ against the calculated firing temperature. Nothing here is draggable — add or drop a boron source to move the point.',
  'boron.readout': 'B₂O₃ {boron} · {temp} °C',
  'boron.noBoron': 'No B₂O₃ in this recipe — add a frit or a boron frit to place the point.',
  'boron.noFiring': 'No firing temperature to plot — the recipe has no meltability estimate.',

  'history.title': 'Change history',
  'history.restore': 'Restore',
  'history.clear': 'Clear',
  'history.empty': 'Nothing to restore yet.',
  'history.entry': '{time} · {rows} rows',

  'transfer.title': 'Transfer',
  'transfer.export': 'Export',
  'transfer.import': 'Import',
  'transfer.importPlaceholder': 'Paste a share link or recipe code',
  'transfer.importCancel': 'Cancel',
  'transfer.share': 'Share',
  'transfer.copyLink': 'Copy link',
  'transfer.copied': 'Link copied',
  'transfer.importFailed': 'The link does not contain a valid recipe.',

  'materials.title': 'Material database',
  'materials.system': 'System materials',
  'materials.local': 'Local materials',
  'materials.new': 'New material',
  'materials.edit': 'Edit',
  'materials.duplicate': 'Duplicate',
  'materials.duplicateNamed': 'Duplicate {name}',
  'materials.delete': 'Delete',
  'materials.deleteNamed': 'Delete {name}',
  'materials.save': 'Save',
  'materials.cancel': 'Cancel',
  'materials.clearLocal': 'Clear local materials',
  'materials.clearLocalConfirm': 'Delete all local materials? This cannot be undone.',
  'materials.deleteConfirm': 'Delete {name}?',
  'materials.id': 'Id',
  'materials.name': 'Name',
  'materials.density': 'Density',
  'materials.region': 'Region',
  'materials.region.world': 'World',
  'materials.region.EU': 'Europe',
  'materials.region.US': 'USA',
  'materials.region.Russia': 'Russia',
  'materials.price': 'Price',
  'materials.loi': 'LOI',
  'materials.type': 'Type',
  'materials.type.feldspar': 'Feldspar',
  'materials.type.frit': 'Frit',
  'materials.type.colorant': 'Colorant',
  'materials.type.clay': 'Clay',
  'materials.type.other': 'Other',
  'materials.components': 'Oxide components',
  'materials.totalLine': 'Total: {total} · LOI: {loi}',
  'materials.to100': 'To 100%',
  'materials.export': 'Export',
  'materials.import': 'Import',
  'materials.imported': 'Imported {count}, skipped {skipped}.',
  'materials.importFailed': 'The file does not contain valid materials.',
  'materials.json': 'JSON',
  'materials.copyJson': 'Copy JSON',
  'materials.jsonCopied': 'JSON copied',

  'generic.error': 'Something went wrong.',
  'generic.none': '—',
} as const;

const ru: Record<keyof typeof en, string> = {
  'app.title': 'Глазурный Двигатель',
  'app.nav.calculator': 'Калькулятор',
  'app.nav.materials': 'База материалов',
  'app.nav.pricing': 'Тарифы',
  'app.nav.calibrate': 'Калибровка картинок',
  'app.nav.language': 'Язык',
  'app.footer': 'Откуда все украдено:',

  'recipe.mainComponents': 'Основа',
  'recipe.additionalComponents': 'Добавки',
  'recipe.includeAdditions': 'В расчёты',
  'stull.clampFluxRatio': 'Фиксировать R2O:RO',
  'stull.clampAdditions': 'Фиксировать добавки',
  'stull.clampBoron': 'Фиксировать бор',
  'recipe.material': 'Материал',
  'recipe.materialPlaceholder': 'Выберите материал',
  'recipe.amount': 'Количество',
  'recipe.to100': 'К 100%',
  'recipe.addRow': 'Добавить',
  'recipe.remove': 'Удалить',
  'recipe.removeRow': 'Удалить «{material}»',
  'recipe.move': 'Переместить',
  'recipe.moveRow': 'Переместить «{material}»',
  'recipe.moveHint': 'Перетащите, чтобы изменить порядок или сменить раздел; Alt + ↑/↓ — на шаг',
  'recipe.total': 'Итого: {value}',
  'recipe.clear': 'Очистить всё',
  'recipe.empty': 'Ничего пока нет',

  'results.units': 'Единицы',
  'results.unityFormula': 'Формула Зегера',
  'results.molePercent': 'Мол. %',
  'results.cte': 'КТР',
  'results.firingTemperature': 'Температура',
  'results.costPerKg': 'Цена за кг',
  'results.loi': 'ППП',
  'results.unityUndefined': 'Формула Зегера не определена — в рецепте нет флюсов.',
  'results.group.other': 'Прочие',

  'charts.label': 'Диаграммы',

  'stull.title': 'График Сталла',
  'stull.axisX': 'SiO₂ (0–9)',
  'stull.axisY': 'Al₂O₃ (0–1)',
  'stull.aria': 'График Сталла для базовой глазури. Перетащите точку или перемещайте её стрелками.',
  'stull.hint':
    'Перетащите точку или установьте фокус на диаграмме и используйте стрелки — Ctrl притягивает к сетке 0,1 × 0,01. Колесо — масштаб, Shift-перетаскивание — панорама. Escape — отмена. Внутри штрихового контура перенос проходит; штриховка снаружи — цели, которые обнулили бы компонент.',
  'stull.noPoint': 'Нет флюсов — рецепт не даёт точки на диаграмме.',
  'stull.emptied': '«{material}» ушёл бы в ноль и вышел бы из основы — перенос отменён.',
  'stull.emptiedMany': 'Эти ушли бы в ноль и вышли бы из основы — перенос отменён: {materials}.',
  'stull.snapback.too-few-rows': 'Слишком мало строк, чтобы пересчитать основу.',
  'stull.snapback.no-flux': 'В рецепте нет флюсов.',
  'stull.snapback.no-alumina-carrier': 'Ни один материал не содержит глинозём.',
  'stull.snapback.singular': 'Текущими материалами эту точку достичь нельзя.',
  'stull.snapback.negative-amount': 'Для этой цели потребовалось бы отрицательное количество.',
  'stull.snapback.no-flux-total': 'После пересчёта в рецепте не осталось бы флюсов.',
  'stull.snapback.flux-ratio': 'На этой цели невозможно удержать соотношение R₂O:RO.',
  'stull.snapback.over-constrained': 'Для этой цели зафиксировано слишком много значений — отпустите одно.',

  'triaxial.title': 'Троичная диаграмма',
  'triaxial.roFlux': 'Флюс RO',
  'triaxial.noRoFlux': 'В рецепте нет флюса RO — добавьте CaO, MgO или другой RO, чтобы поставить точку.',
  'triaxial.aria': 'Троичная диаграмма полного состава по выбранному флюсу RO.',
  'triaxial.hint':
    'Перетащите точку или установьте фокус на диаграмме и используйте стрелки — Ctrl притягивает к сетке 0,01. Колесо — масштаб, Shift-перетаскивание — панорама. Escape — отмена.',

  'boron.title': 'График по бору',
  'boron.axisX': 'B₂O₃ (0–0,5)',
  'boron.axisY': 'Температура обжига (°C)',
  'boron.aria': 'График по бору: B₂O₃ в Зегере против расчётной температуры обжига.',
  'boron.hint':
    'Карта читает рецепт: B₂O₃ в Зегере против расчётной температуры обжига. Перетаскивать здесь нечего — чтобы сдвинуть точку, добавьте или уберите источник бора.',
  'boron.readout': 'B₂O₃ {boron} · {temp} °C',
  'boron.noBoron': 'В рецепте нет B₂O₃ — добавьте фритту, чтобы поставить точку.',
  'boron.noFiring': 'Нет температуры обжига — для рецепта нет оценки расплавляемости.',

  'history.title': 'История изменений',
  'history.restore': 'Восстановить',
  'history.clear': 'Очистить',
  'history.empty': 'Восстанавливать пока нечего.',
  'history.entry': '{time} · строк: {rows}',

  'transfer.title': 'Передача данных',
  'transfer.export': 'Экспорт',
  'transfer.import': 'Импорт',
  'transfer.importPlaceholder': 'Вставьте ссылку или код рецепта',
  'transfer.importCancel': 'Отмена',
  'transfer.share': 'Поделиться',
  'transfer.copyLink': 'Копировать ссылку',
  'transfer.copied': 'Ссылка скопирована',
  'transfer.importFailed': 'Ссылка не содержит корректного рецепта.',

  'materials.title': 'База материалов',
  'materials.system': 'Системные материалы',
  'materials.local': 'Свои материалы',
  'materials.new': 'Новый материал',
  'materials.edit': 'Изменить',
  'materials.duplicate': 'Дублировать',
  'materials.duplicateNamed': 'Дублировать «{name}»',
  'materials.delete': 'Удалить',
  'materials.deleteNamed': 'Удалить «{name}»',
  'materials.save': 'Сохранить',
  'materials.cancel': 'Отмена',
  'materials.clearLocal': 'Очистить свои материалы',
  'materials.clearLocalConfirm': 'Удалить все свои материалы? Действие необратимо.',
  'materials.deleteConfirm': 'Удалить «{name}»?',
  'materials.id': 'Идентификатор',
  'materials.name': 'Название',
  'materials.density': 'Плотность',
  'materials.region': 'Регион',
  'materials.region.world': 'Мир',
  'materials.region.EU': 'Европа',
  'materials.region.US': 'США',
  'materials.region.Russia': 'Россия',
  'materials.price': 'Цена',
  'materials.loi': 'ППП',
  'materials.type': 'Тип',
  'materials.type.feldspar': 'Полевой шпат',
  'materials.type.frit': 'Фритта',
  'materials.type.colorant': 'Краситель',
  'materials.type.clay': 'Глина',
  'materials.type.other': 'Прочее',
  'materials.components': 'Оксидный состав',
  'materials.totalLine': 'Итого: {total} · ППП: {loi}',
  'materials.to100': 'К 100%',
  'materials.export': 'Экспорт',
  'materials.import': 'Импорт',
  'materials.imported': 'Импортировано: {count}, пропущено: {skipped}.',
  'materials.importFailed': 'В файле нет корректных материалов.',
  'materials.json': 'JSON',
  'materials.copyJson': 'Копировать JSON',
  'materials.jsonCopied': 'JSON скопирован',

  'generic.error': 'Что-то пошло не так.',
  'generic.none': '—',
};

export type TranslationKey = keyof typeof en;

export const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, ru };

export type TranslationParams = Record<string, string | number>;

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translates `key`, replacing `{placeholder}` tokens from `params`. */
export function t(lang: Lang, key: TranslationKey, params?: TranslationParams): string {
  const dict = DICTIONARIES[lang];
  const template = dict[key] ?? DICTIONARIES[DEFAULT_LANG][key] ?? key;
  return interpolate(template, params);
}

/** Picks the localized part of the `oxides.json` `"Natrium|Sodium"` convention:
 *  index 0 is ru, index 1 is en, a single value serves both languages. */
export function oxideDisplayName(lang: Lang, displayName: string): string {
  const parts = displayName.split('|');
  const primary = parts[0] ?? '';
  if (parts.length === 1) return primary;
  const index = lang === 'ru' ? 0 : 1;
  return parts[index] ?? primary;
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as string[]).includes(value);
}

/** Browser language when it is supported, `en` otherwise. */
export function detectLang(): Lang {
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
  const candidates = [nav?.language, ...(nav?.languages ?? [])];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const base = candidate.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}
