# Glaze Move

Glaze calculator with the ability to drag resulting glaze on the Stull chart. You can hold the additions as entered, or pin the flux ratio and boron for the solver to preserve their UMF values. Automatically draws possible drag area on the chart.  
Глазурный калькулятор с возможностью таскать точки на графике Сталла. Можно удерживать добавки на введённом количестве, а пропорции флюсов и количество бора закрепить, чтобы солвер сохранял их юнити значения при перетаскивании. Зона для возможного перетаскивания отрисовывается автоматически.

Inspired by and built on the published work of [calc.portalkeramiki.ru](https://calc.portalkeramiki.ru), [glazy.org](https://glazy.org),[ceramicmaterialsworkshop.com](https://ceramicmaterialsworkshop.com), and [segerlab.ru](https://segerlab.ru).

**English** · [Русский](#глазурный-двигатель)

## What you get

- **Recipe editor** — *Main* rows form the glaze base (normalize to 100% on demand);
  *Additional* rows are bench additions over 100 that never disturb the fitted base. Drag a
  row's handle to reorder it or move it between the two sections (Alt + ↑/↓ from the
  keyboard).
- **Unity formula & summary** — the Seger formula grouped per oxide, mole %, the
  SiO₂:Al₂O₃ ratio, thermal expansion (CTE), an estimated firing temperature, cost per kg
  and loss on ignition.
- **Stull map** — drag the point (mouse, touch or arrow keys) to a SiO₂/Al₂O₃ target. The
  target recipe is the starting glaze with the new Si/Al values; every other UMF value
  must stay within the tolerance field (0.01 by default, editable in the Stull header).
  The solver refits the recipe and writes the base back at exactly 100%. The dashed
  outline shows where a drag lands. A component may drop to zero; it stays in the recipe,
  and the app suggests a material to add to the base when that happens.
- **Triaxial and boron maps** — the recipe plotted on published reference diagrams; the
  triaxial map zooms 1–8× under the wheel (shift-drag pans, ± / 0 from the keyboard); the
  boron map's vertical axis is cone-stepped (Orton cones Δ06–Δ10), not linear °C.
- **Drag clamps** — the *Additions* switch cycles two ways: **unity** holds each
  addition's share of the flux — its contribution to the unity formula — within the UMF
  tolerance, so its amount follows the batch; **free** leaves the additions to the solver.
  The UMF panel tints the oxides the additions bring while the switch holds them by unity.
  Untouched values stay plain.
- **History & transfer** — session checkpoints with one-click restore, JSON export, and
  share links that encode the recipe right in the URL — importing accepts a pasted link
  or code.
- **Weighing sheet** — type a batch weight and print the recipe as a checklist: components
  largest first with the additions kept apart, each line's grams for the batch, an empty
  box to tick, and a QR code that reopens the recipe.
- **Material database** — the bundled catalog plus your own local materials (kept in
  browser storage), with a live JSON view and plain-JSON export/import of your local
  entries.
- **English and Russian** throughout.

## Running it

```bash
bun install
bun run dev        # local dev server
bun run build      # type check + production build into dist/
bun run test       # unit tests
```

The build output is a static site — host `dist/` anywhere. GitHub Pages works out of the
box: the bundled workflow builds and publishes on every push to `main`; enable it once
under *Settings → Pages → Source: GitHub Actions*. Routes are hash-based (`#/
materials`, `#/calibrate`), so no server rewrite rules are needed at any subpath.

## Data

Oxide and material data lives in `src/data/*.json` and is the single source of truth for
classification and analyses — review prices, densities and LOI before trusting the cost
line. Materials you add yourself are stored in your browser only.

## Documentation

- [`readme-agents.md`](readme-agents.md) — the full technical reference: every formula,
  the drag solver, the reachable-zone algorithm, chart geometry and data conventions.
  Written as working documentation for agents and maintainers.
- [`AGENTS.md`](AGENTS.md) — working notes for agents working in this repository.


---

# Глазурный Двигатель

[English](#glaze-move) · **Русский**

## Что вы получаете

- **Редактор рецепта** — строки «Основные» образуют базу глазури (к 100% по запросу);
  строки «Дополнительные» — добавки сверх 100, которые не трогают подобранную базу.
  Строку можно перетащить за ручку, меняя порядок или раздел (Alt + ↑/↓ — с клавиатуры).
- **Единственная формула и сводка** — формула Зегера по группам оксидов, моль. %,
  отношение SiO₂:Al₂O₃, термическое расширение (КТР), расчётная температура обжига (по Аппену),
  цена за кг и потери при прокаливании (ППП).
- **Диаграмма Сталла** — перетащите точку (мышью, касанием или стрелками) к цели по
  SiO₂/Al₂O₃. Решатель пересчитает рецепт и запишет базу ровно на 100%. Пунктирный
  контур показывает, куда перенос проходит; компонент может уйти в ноль и остаётся в
  рецепте.
- **Троичная диаграмма и диаграмма бора** — рецепт на опубликованных справочных
  диаграммах; троичная диаграмма масштабируется колесом 1–8× (Shift-перетаскивание —
  панорама, ± / 0 — с клавиатуры); вертикальная ось диаграммы бора идёт по конусам
  (ортоновские конусы Δ06–Δ10), а не по линейным °C.
- **Фиксаторы при перетаскивании** — переключатель «Добавки» проходит два состояния:
  «формула Зегера» удерживает долю флюса каждой добавки — её вклад в формулу — в пределах
  допуска UMF, так что её количество следует за шихтой; «свободно» отдаёт добавки
  решателю. Значения, удерживаемые фиксатором, подсвечены зелёным в таблице формулы.
- **История и обмен данными** — контрольные точки сессии с восстановлением в один
  клик, экспорт JSON и ссылки, кодирующие рецепт прямо в URL; импорт принимает
  вставленную ссылку или код.
- **Печатный лист отвеса** — введите вес замеса и распечатайте рецепт как чек-лист:
  компоненты по убыванию количества, отдельно добавки, у каждой строки — граммы на
  замес, пустая клетка для отметки и QR-код, открывающий рецепт.
- **База материалов** — встроенный каталог плюс свои материалы (хранятся в браузере)
  с живым просмотром JSON и экспортом/импортом своих записей обычными JSON-файлами.
- **Английский и русский** языки во всём интерфейсе.

## Запуск

```bash
bun install
bun run dev        # локальный сервер разработки
bun run build      # проверка типов + производственная сборка в dist/
bun run test       # юнит-тесты
```

Результат сборки — статический сайт: `dist/` можно разместить где угодно. GitHub Pages
работает из коробки: встроенный workflow собирает и публикует сайт при каждом пуше в
`main`; один раз включите *Settings → Pages → Source: GitHub Actions*. Маршруты
построены на хэше (`#/materials`, `#/calibrate`), поэтому правила перезаписи не нужны
на любом подпути.

## Данные

Данные оксидов и материалов лежат в `src/data/*.json` и являются единственным
источником истины для классификации и расчётов — проверьте цены, плотности и ППП,
прежде чем доверять строке стоимости. Добавленные вами материалы хранятся только
в вашем браузере.

## Документация

- [`readme-agents.md`](readme-agents.md) — полный технический справочник: все формулы,
  решатель перетаскивания, алгоритм достижимой зоны, геометрия диаграмм и соглашения
  по данным. Написан как рабочая документация для агентов и сопровождающих.
- [`AGENTS.md`](AGENTS.md) — рабочие заметки для агентов, работающих в этом
  репозитории.