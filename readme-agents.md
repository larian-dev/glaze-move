# Glaze Move — technical reference

The full technical documentation of the app: formulas, algorithms, chart geometry and
data conventions, written as working documentation for agents and maintainers. The
user-facing overview lives in [`README.md`](README.md).

> **Inspiration and sources:** [segerlab.ru](https://segerlab.ru),
> [calc.portalkeramiki.ru](https://calc.portalkeramiki.ru),
> [glazy.org](https://glazy.org).

A client-side ceramic glaze calculator. **Create a recipe from raw materials and drag the
Stull point** to where you want the glaze to sit — silica against alumina — and the
calculator refits the recipe to land there, reporting the unity (Seger) formula, the
summary values, a triaxial map and a boron map as it goes. Everything runs in the browser:
no backend, no account, no network traffic.

## How it works

- **Recipe** — *Main* rows are the glaze base in parts (*to 100%* on demand); *Additional*
  rows are additions over 100 that never disturb the fitted base. Every row carries a drag
  handle: drag it to reorder the row, or across the sections to move it between Main and
  Additional; Alt + ↑/↓ makes the same moves from the keyboard. A drag or move is a
  structural edit — persisted and recomputed, but not checkpointed.
- **Switches** (*In the UMF* in the Additional header; *Clamp flux ratio*, *Clamp
  additions* and *Clamp boron* in the Stull panel header; all persisted):
  - *In the UMF* — additions join the calculations: unity formula, mole %, Si/Al, CTE,
    firing temperature, triaxial and boron maps **and the Stull point** — or they don't,
    and everything describes the base alone. This switch alone moves the marker.
  - *Clamp additions* — on (default), every addition is pinned: a drag holds its dominant
    oxide at the unity value it has while its parts follow the base, instead of its recipe
    percentage being held; off, the solver may pick additions as carriers and rewrite their
    amounts while refitting. Either way the switch never moves the displayed point by
    itself — it only decides what a drag may touch.
  - *Clamp flux ratio* — a drag that would move the R₂O:RO balance is refused with a
    notice instead of drifting it quietly.
  - *Clamp boron* — a drag holds the batch's unity B₂O₃ where it is, so the boron map's
    marker stays put while the Stull point moves. The hold costs the fit one mover; a
    recipe that cannot afford one is refused, and a batch without B₂O₃ clamps nothing.
  - Cost and LOI ignore all switches; flipping a switch writes no history. The results
    panel tints the values the enabled clamps are holding — the additions' dominant
    oxides, B₂O₃, and the R₂O:RO tile — so the formula itself shows what a drag will
    leave alone; entries no clamp holds stay plain.
- **Stull map** — the interactive map: drag the point (mouse/touch, or arrow keys) to a
  SiO₂/Al₂O₃ target; the solver refits the free carriers, holds each clamped addition's
  dominant oxide, and writes the batch back with the base at exactly 100.00. The dashed
  outline is traced from the solve grid: inside it a drag lands, the hatched band just
  outside it marks targets that would empty a component, and beyond that nothing is
  reachable — the last two snap back with a notice. Scroll zooms 1–8×, shift-drags to pan.
  Regions, labels and the Q-line come from the legacy chart
  (`resources/js/stull-chart-d3.js`, archived locally, not part of the repo),
  grid every 0.6 SiO₂ × 0.1 Al₂O₃.
- **Triaxial and boron maps** — published reference rasters behind the recipe's RO-flux
  corner and its B₂O₃ / firing-temperature position. The boron y-axis is cone-stepped, not
  linear °C: its only source labels are six Orton cones Δ06–Δ10
  (`resources/chart1/chart/drawings/drawing1.xml`, archived locally, not part of
  the repo). The triaxial map zooms 1–8× under the
  wheel — shift-drag to pan, double-click to step in, + / − / 0 on the focused map —
  magnifying the raster and the calibrated triangle together, clipped to the frame;
  strokes, the point marker and the margin readouts keep their size, and a plain drag
  still moves the point, read through the live zoom.
- **History, transfer, materials** — session checkpoints with restore, taken when an amount
  changes or the point is dragged (adding, re-pointing or removing a row does not); JSON
  export for the recipe and for the local materials (plain files, no encoding); recipe
  import through a paste dialog that reads a share link or a bare payload; share links
  (rows only, base64url); a companion page for local materials. The triaxial calibration
  utility (`src/pages/calibrate.ts`) is a gitignored local developer tool: routed only in
  dev builds, absent from the repository and the public bundle.

## Formulas

Notation: `amountᵢ` = parts of material *i*, `m(O)` = mass % of oxide *O*, `n(O)` = moles of
*O* per 100 g of batch, `x(O)` = mole % of *O*, `F` = flux moles, `X`/`Y` = the dragged
SiO₂ / Al₂O₃ target.

### Normalize to 100%

```
amountᵢ' = amountᵢ · 100 / Σ amount        // main rows only
```

Used by *to 100%*: the base lands on exactly 100 and every addition keeps the value it was
entered with — additions read as percentages over the base, so scaling them by the same
factor would rewrite each entered percentage. The base's own ratios survive the rescale;
when the additions are in the UMF their share of the batch does move, and the whole-batch
figures (unity formula, mole %, the Stull point) move with it.

### Batch composition, moles, mole %

Each material's own profile is used exactly as published: `profileᵢ(O)` is the oxide's
mass % of the raw material as its analysis states it, and the LOI / unlisted remainder
contributes no oxides — 100 g of a whiting publishing CaO 56.1 brings 56.1 g CaO, not 100.
Renormalizing a material's list to 100 would inflate every LOI-bearing material and shift
the whole unity formula.

```
wᵢ  = amountᵢ / Σ amount
m(O) = Σᵢ wᵢ · profileᵢ(O)
n(O) = m(O) / MW(O)              // unknown oxide or MW ≤ 0: skipped
x(O) = 100 · n(O) / Σ n
```

`m` sums to the batch's oxide share of its own mass — below 100 whenever the materials
carry LOI. Everything downstream reads it as a ratio, so the scale never matters.

### Flux membership and the unity formula

```
flux(O) ⇔ type ∈ {R₂O, RO}  ∨  (type = Other ∧ n_typed > 0 ∧ n(O) / n_typed ≥ 0.1)
k      = 1 / (Σ R₂O + Σ RO)
UMF(O) = n(O) · k                // group subtotals (R₂O, RO, R₂O₃, RO₂, B₂O₃) scale alike
```

The `Other` threshold 0.1 is a tunable stub; the `n_typed > 0` guard keeps an "other"
oxide in a fluxless glaze from being admitted at an infinite ratio. No flux at all → the
unity formula is undefined and the UI says so.

### Si/Al ratio

```
Si/Al = n(SiO₂) / n(Al₂O₃)      // "—" when either is ≤ 0
```

### Stull point

```
X = n(SiO₂) / F        // x-axis, 0 … 9
Y = n(Al₂O₃) / F        // y-axis, 0 … 1
```

The chart covers the base plus every addition whose *In the UMF* and *In the drag solve*
switches admit it (their flux counts into `F`). No flux → no point.

### Drag inverse — the carrier solve

Per-part coefficients `qᵢ(O) = profileᵢ(O) / 100 / MW(O)`. Three rows become the
**carriers**: the most concentrated SiO₂ source, the most concentrated Al₂O₃ source of the
rest (must contain Al₂O₃) and — when one exists — a third row with leverage over the
R₂O:RO balance (a flux-free row such as quartz scores zero and is never chosen). The first
two seats go by per-part concentration, not total carry: a drag needs decoupled control,
and only a pure source moves one axis without dragging the others along — a large dilute
row out-carries the pure one by sheer amount, freezes it, and leaves the fit steering x by
destroying flux, which collapses the reachable set to a strip.
One usable displayed row always stays frozen: with every row inside the fit the equations turn
homogeneous, the free parameter scales the batch instead of steering the ratio, and a clamp
has nothing left to spend. The pool the carriers may be picked from is every main
row plus — while *Clamp additions* is off — the additions; every other displayed row freezes
into the constants `F` (flux), `S₀` (SiO₂), `A₀` (Al₂O₃) at its entered amount. A row whose
chemistry copies one already seated is skipped — a duplicate column cannot be solved for and
would only make the fit singular — and the movers never eat the whole recipe.

A **clamped** addition is neither a carrier nor a constant: its amount joins the unknowns,
with one **pin** row per addition — `c_o · amount = k · F`, where `o` is the addition's
dominant oxide by mass share, `c_o` that oxide's moles per part, and
`k = amount₀ · c_o / F₀` the unity value it entered with. A drag then moves that addition's
parts to hold the figure, instead of holding its share of the recipe.

*Clamp boron* adds one **hold** row of the same shape over the whole displayed chemistry —
`Σᵢ amountᵢ · c(B₂O₃)ᵢ = k · F` with `k` the batch's current unity B₂O₃. It weighs on
amounts that are unknowns already, so it buys no unknown to pay for itself: the fit seats
one mover for it, and a recipe with no mover to spare is refused as over-constrained. When
the sole B₂O₃ source is an addition clamped on its dominant B₂O₃, the hold would repeat
that pin verbatim — it drops out, and the pin does the holding. A batch without B₂O₃ has
nothing to hold.

With `cᵢ = (cᵢs, cᵢa, cᵢf)` per unknown amount `xᵢ`, the target is:

```
S₀ + Σᵢ xᵢ·cᵢs = X · (F + Σᵢ xᵢ·cᵢf)
A₀ + Σᵢ xᵢ·cᵢa = Y · (F + Σᵢ xᵢ·cᵢf)

A = [ c₁s − X·c₁f   c₂s − X·c₂f   c₃s − X·c₃f ]     r = [ X·F − S₀ ]
    [ c₁a − Y·c₁f   c₂a − Y·c₂f   c₃a − Y·c₃f ]         [ Y·F − A₀ ]
```

There is one column per carrier — three, or two when the recipe has no third — plus one per
pinned addition, which also adds its own pin row. The system is solved by elimination: `r`
rows over `r + 1` unknowns leave the one-parameter family `x(t) = p + t·q`, `p` a particular
solution and `q` the null direction, so every `t` lands exactly on the target. Along the
line the R₂O:RO ratio is a Möbius function of `t`, and the `t` that restores the starting
ratio is closed-form:

```
t = (baseRatio·D₀ − N₀) / (N₁ − baseRatio·D₁)
```

clamped into `[lo, hi]`, the interval where every amount stays non-negative. When as many
rows as unknowns are present — two carriers, or a pin closing the last degree of freedom —
the system is solved outright, with no `t` to spend and the ratio whatever the fit makes of
it. A homogeneous system whose direction carries only one sign is the ray `{t·q}`: any
multiple with non-negative amounts does.
With *Clamp flux ratio*, a `t` whose balance differs from the start is refused outright.

Rejected — point snaps back, recipe untouched: fewer than two rows; no flux; no Al₂O₃
carrier; a fit whose rows are singular against their own scale, or a ray no non-negative
multiple reaches; an empty
`t`-interval or an all-zero solution; a final flux total at nothing; more clamps than the
rows can pay movers for; a row driven to zero (named in the notice); or, flux-clamped, a
moving ratio. On success the displayed batch — base
and additions alike — is written back scaled so the base totals exactly 100.00, in whole
cents with the rounding residual on the largest main row. Every ratio survives that
scaling, so the point lands on the target, each pin keeps its unity value, and the R₂O:RO
balance is the one the fit chose. A row outside the displayed chemistry (an addition the
UMF switch excludes) is left untouched. Everything then recomputes. Arrow keys nudge by
0.25 SiO₂ / 0.05 Al₂O₃ through the same solve. The two drawn zones are traced from the
0.2 × 0.05 grid of sampled cell centres — cells the solve fits with nothing emptied form
the dashed outline, cells it fits only by emptying a row form the hatched band — so a
region that is thin, curved or non-convex draws as itself rather than as a hull around it.

### Thermal expansion (Appen)

```
α·10⁷ = Σ cᵢ · xᵢ          // cᵢ stored as α·10⁷/100, summed per oxide, mole-% weighted
```

Four oxides use composition-dependent rules (`A` = SiO₂ mole %, `A_R2O` = Li₂O+Na₂O+K₂O
mole %):

| Oxide | c (α·10⁷/100) |
| --- | --- |
| SiO₂ | `0.38` for A ≤ 67, else `0.38 − 0.01·(A − 67)` |
| TiO₂ | `0.30 − 0.015·(A − 50)` |
| B₂O₃ | `0.125·(4 − φ) − 0.5`, flat `−0.5` for φ > 4 |
| PbO | `1.15 + 0.05·A_R2O` |

```
φ = n(Li₂O + Na₂O + K₂O + BaO + CaO) / n(B₂O₃)    // 4 with no B₂O₃; MgO, ZnO, PbO, SrO excluded
```

No SiO₂ → no estimate; any other oxide without a coefficient contributes 0.

### Melatability and firing temperature

```
K = Σ (aᵢ · mᵢ) / Σ (bⱼ · mⱼ)        // over the batch mass % m, published profiles
```

Numerator `a`: every oxide except the refractory set and Al₂O₃ (B₂O₃ 1.25, ZnO/BaO 1.0,
CaO/MgO/MnO/PbO 0.8, Cr₂O₃ 0.6, …). Denominator `b`: SiO₂ 1.0, P₂O₅ 1.9, SnO₂ 1.67 — plus
Al₂O₃, conditional: refractory (`b = 1.2`) above 3 mass %, flux (`a = 0.3`) at or below. A
stored coefficient of **0 means "no data"**: K is computed from the remaining oxides and the
temperature flagged `~`; an empty numerator or denominator yields no estimate.

| K | 2.0 | 1.9 | 1.8 | 1.7 | 1.6 | 1.5 | 1.4 | 1.3 | 1.2 | 1.1 | 1.0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| °C | 750 | 751 | 753 | 754 | 755 | 756 | 758 | 759 | 765 | 771 | 778 |

| K | 0.9 | 0.8 | 0.7 | 0.6 | 0.5 | 0.4 | 0.3 | 0.2 | 0.1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| °C | 800 | 829 | 861 | 905 | 1025 | 1100 | 1200 | 1300 | 1450 |

Linear interpolation between rows, clamped outside: K ≥ 2 → 750 °C, K ≤ 0.1 → 1450 °C.

### Cost and loss on ignition

```
cost = Σ (amountᵢ / T) · priceᵢ
LOI  = Σ (amountᵢ / T) · loiᵢ            // T = Σ amountᵢ, over all rows
```

Both are 0 for an empty batch and correct when the amounts do not sum to 100. A material
with no LOI entered contributes the share its oxides leave of its own 100% — contents and
LOI read as a whole on the material page, where *To 100%* scales them together; negative
values (gain on ignition) are valid. LOI is a report value only — it never adjusts the
composition.

### Triaxial map coordinates

The plotted point is the unity SiO₂ : Al₂O₃ : RO of the batch (main + additional, unless
*In the UMF* excludes them), normalized so the three components sum to 1. The RO corner is
the selected flux oxide — the most abundant charted one preselected, only oxides the recipe
contains offered.

## Getting started

```bash
bun install
bun run dev        # local dev server
bun run build      # production build
bun run test       # unit tests
bun run type-check # static type check
```

The app is a static site with hash-based routing (`#/`, `#/materials`, `#/calibrate`) and
relative asset paths, so it hosts from any subpath without rewrite rules — GitHub Pages
included. The `deploy` workflow (`.github/workflows/deploy.yml`) builds `dist/` and
publishes it on every push to `main`; enable it once under Settings → Pages → Source:
*GitHub Actions*. Share links carry the recipe in the query string (`…/?recipe=…#/`),
which Pages resolves like any static file.

The app shell is `index.html` + `src/main.ts`: the header carries the route links, a link
to the repository, and the *Pricing* easter egg — a nav entry that is not a route; it opens
an overlay playing `src/assets/pricing.mp4` once, in place (`src/ui/pricing.ts`).

## Accuracy & data

Oxide and material data (`src/data/*.json`) is the single source of truth; expansion
and meltability coefficients come from the standard ceramic references and are applied
through data, not code constants. The runtime chart images are the WebP files in
`src/assets/`, converted from the originals in `resources/` — a local reference archive
(legacy chart script, Excel `.crtx` exports, saved pages) that is not part of the repo.
Values are computed, not tabulated — expect small
differences from published tables that round, treat the firing temperature as an estimate,
and review prices, densities and LOI before trusting the cost line.