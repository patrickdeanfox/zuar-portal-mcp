# zPortal HTML block authoring conventions

Operate as a senior front-end engineer fluent in Zuar Portal, HTML, CSS, and JS.
Produce a finished, themed surface — not a block viewed in isolation. These rules are
surfaced to the model before authoring and are checked on `create_block` /
`update_block`. Severities live in `rules.json`.

## Section separation (enforced)

- HTML and JS go in the **HTML section** (the block's `json_data.html`).
- CSS goes in the **CSS section** (the block's `css` field).
- Never put `<style>` or `<link rel="stylesheet">` in the HTML section.
- Never put HTML/JS markup in the CSS section.
- Never include `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` — fields hold
  body-level markup only.

## Top-level config (enforced: warn)

Open every block's `<script>` with a config section that declares all constants and
toggles before any logic runs:

- a `DEBUG` flag (default `false`),
- the logger (see below),
- `QUERY_INDEX` — descriptive names mapped to query indices, and column-name
  constants that exactly match the query aliases,
- element ids / selectors,
- every numeric threshold.

Hoist all magic numbers and strings here and reference them by name. This is the one
place a human edits to retune the block.

## DEBUG-gated logging (enforced: warn)

Gate all console output behind the `DEBUG` flag through one logger helper, with
`warn`/`error` variants:

```js
const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log('[Block Name]', ...args); };
```

Log the meaningful checkpoints: row count from `currentBlock.queryResults`, data shape
after each transform, filter-change events, and every caught error (name what
happened, never just "here").

## Bottom-level init() (enforced: warn)

Put a single `init()` at the bottom as the only orchestrator and the only call at end
of script (`init();`). It reads the data, calls the build/render helpers in order, and
wires any listeners. Keep helpers above it pure; side effects live in `init()` and the
IO helpers it calls.

## Data access (v1.18+)

- Read query data from `currentBlock.queryResults[index]` — one entry per query
  configured on the block. Confirmed v1.18 shape (build 2026-06): `.columns` is a plain
  array of column-name strings (`['region', 'branch', ...]`) and `.data` is an array of
  **positional row arrays** (`[['Northeast', 'Boston Main', 142, ...], ...]`). Values keep
  native types (numbers stay numbers). `.data` may be a Proxy — treat it as a normal array.
- Don't hardcode positional indices. Include a `getQueryData(index)` helper that maps each
  row to a `{ column_name: value }` object using `.columns`, then access values by name:
  `const records = q.data.map(r => Object.fromEntries(q.columns.map((c, i) => [c, r[i]])));`
- **Deprecated in v1.18 — aliases, don't author with them:** `currentBlock.data` and
  `currentBlock.columns` (aliases for `queryResults[0].data`/`.columns`), and
  `currentBlock.siteConfig` (use `currentBlock.config`). These still work but are the
  v1.17 shape.
- **NOT deprecated (current v1.18 APIs):** `zPortal.dataSource.setFilters/clearFilters`
  (filtering), `zPortal.dataSource.fetchResults({...})` (ad-hoc fetch),
  `zPortal.dataSource.on('load', dsId, handler)` (react to reloads). See the Filters and
  External-APIs sections.
- Column names are lowercase_with_underscores and must exactly match the query
  aliases. **Column-name mismatch is the most common cause of an empty block.**
- Block JS runs once per query load. A block can bind **many** queries (the v1.18 corpus
  has blocks with 12–13), each at its own `queryResults[index]` matching `ui_queries[index]`
  order. With multiple queries, check all required indices have loaded
  (`q && q.data !== undefined`) and `return` early if not — without calling the loaded callback.
- Data is present synchronously when the script runs — **don't poll for initial data**
  (`setInterval`, `DOMContentLoaded`). To react to filter changes, subscribe with
  `zPortal.dataSource.on('load', dsId, handler)` (store the handler in a variable so you
  can `.off()` it — anonymous functions can't unsubscribe).
- Richer block context is also injected: `currentBlock.currentUser`, `.config`,
  `.theme`, `.layout`, `.pages`, `.system`, and a global `datasources` array.

## The loaded callback (enforced: warn — async blocks only)

- If your block does **async work** (library loading via AMCHARTS_LOADER or
  `zPortal.resources.load`, `fetch`, promises, `setTimeout`-deferred render), obtain
  `currentBlock.getOnLoadedCallback()` **early** and call it **exactly once** after the
  UI is drawn — in a `finally` so it fires even on error. Omitting it can stall the page
  (`loaded_timeout`). A purely synchronous block does not need it.
- For page/PDF exports, also resolve `currentBlock.getOnAnimatedCallback()` after
  animations finish so the export captures the final frame.

## Don't author loading states

Portal renders a skeleton loader over every block while its query is in flight. Do not
add spinners, "Loading…" copy, shimmer placeholders, or `@keyframes` for one — they
stack on Portal's loader and look broken. Render an empty container and let Portal's
loader cover it.

## Theme — use variables, never hardcode (enforced: warn)

Consume the active theme via CSS variables so the block honors light/dark and brand
colors. Never hardcode hex/fonts the theme provides. (Exact values are theme-dependent;
the variable **names** below are the portal's documented set — light/dark shown.)

| Token | Var | Light | Dark |
|---|---|---|---|
| Primary | `--color-primary` | `#119DA4` | `#0C7489` |
| Text | `--color-text` | `#040404` | `#DCDEE5` |
| Link | `--color-link` | `#040404` | `#DCDEE5` |
| Success | `--color-success` | `#93C54B` | `#93C54B` |
| Danger | `--color-danger` | `#d9534f` | `#d9534f` |
| Body background | `--body-bg-color` | `#fafdff` | `#22252f` |
| Header background | `--header-bg-color` | `#fff` | `#2D313E` |
| Sidebar background | `--sidebar-bg-color` | `#e6edf2` | `#2D313E` |

More portal-provided tokens, confirmed in the live v1.18 corpus (use with a fallback —
exact values are theme-dependent): colors `--color-secondary`, `--color-info`,
`--color-primary-dark`, `--color-darkgray`, `--color-lightgray`, `--color-white`,
`--color-link-visited`, and a neutral scale `--color-gray-50 … --color-gray-900`;
backgrounds `--block-bg-color` (the block's own surface), `--footer-bg-color`; typography
`--font-stack-primary`, `--font-stack-heading`, `--font-family`, plus size/weight scales
`--font-size-xs|sm|base|lg|xl|2xl` and `--font-weight-normal|medium|semibold|bold`.

Layout dims also exist: `--header-height` (70px), `--footer-height` (68px),
`--sidebar-left-width` (250px). Use `var(--token, fallback)`. If you need a color the
theme doesn't expose, derive it with `color-mix()` from an existing token rather than a
fixed hex. Blocks may also define their own local design tokens in a `:root {}` /
wrapper-scoped block at the top of the CSS and consume them via `var(--…)` — the corpus is
full of block-scoped families like `--zuar-*`, `--rpt-*`, `--zlc-*`.

## Scope CSS to the block (avoid cross-block collisions)

Other blocks share the page DOM, so unscoped selectors and global ids/vars collide.
Two established conventions, used together:

- Wrap the block's markup in a single container with a **`wrapper`** class
  (`<div class="wrapper">…</div>`) and scope selectors under `.wrapper`. The portal also
  exposes per-type wrapper classes (e.g. `.p-block-navigation`).
- When a page hosts several similar blocks, **suffix ids/classes/JS vars** with a
  block-specific number (`#chartdiv1`, `.dashboard-container1`, `CONFIG_1`) and wrap the
  script in an IIFE so nothing leaks to `window`.

## AngularJS $compile footguns

Block HTML runs through AngularJS `$compile`, so interpolation/directives are
evaluated, not rendered literally.

- `{{ … }}` is evaluated. For literal double-braces in visible text use
  `&#123;&#123;` or set text via JS (`element.textContent = …`).
- `$` in strings (currency) can be mangled. Format with `value.toLocaleString('en-US',
  { style: 'currency', currency: 'USD' })` (the common pattern in real blocks) or
  `Intl.NumberFormat(...)`, use `&#36;`, or set the text via DOM after data loads.
- Same caution for literal `{`, `}`, and `ng-…` / `data-ng-…` attributes.

## Interactivity — sandbox-safe (enforced: warn)

- Prefer `addEventListener` (and `name=` form inputs) over inline `on*` handlers for
  maintainability and CSP-safety. Inline handlers that call a global function do work in
  the portal, but keep logic out of markup.
- External `<script src="…">` is stripped — load libraries via `zPortal.resources.load`,
  the global `AMCHARTS_LOADER`, or `document.createElement('script')`.
- Give every clickable element `:hover`, `:focus-visible`, and `:active` states, and use
  ARIA (`role`, `aria-*`) on custom interactive controls.
- **Don't hand-roll DOM modals/toasts** (they break the grid) — use the sanctioned
  `zPortal.modal.show({ title, body, confirmButton, dismissButton, size })`, which
  returns a promise (`.then` confirm / `.catch` dismiss). Avoid continuous idle
  animations.
- Toggle other blocks with `zPortal.block.show(iid)` / `zPortal.block.hide(iid)` (iid is
  `content-1-<UUID>`); read another block's rows with `zPortal.block.getData(iid)`
  (returns row arrays — index access).

## External libraries & charting

- **Charting library by complexity (don't default to amCharts):** **ECharts 5** for complex /
  interactive charts (drill-down, dataZoom, many series, mixed types, large data); **Chart.js or
  vanilla JS** (SVG/canvas) for simple charts (a single bar/line/pie, sparkline, gauge); **amCharts 5
  only when the user explicitly asks for it.**
- **Load every library with `zPortal.resources.load(url)`** — returns a promise; the portal dedupes
  and tracks it. Never a static `<script src>` (it's stripped). ECharts/Chart.js are single files —
  one `load(url).then(...)`. `createElement('script')` also works but prefer `resources.load`.
- **amCharts (only on request) — do NOT use the `AMCHARTS_LOADER` two-block pattern.** amCharts 5 has
  a load-order dependency: the core `index.js` must finish before the modules (`xy.js`, `percent.js`,
  `themes/Animated.js`) — they extend `am5`. Load in **2 dependency-ordered steps** with
  `zPortal.resources.load`: `load(BASE+'index.js').then(() => Promise.all([load(BASE+'xy.js'),
  load(BASE+'themes/Animated.js')])).then(buildChart)`. Call `am5.addLicense(...)` if licensed.
- Dispose on reload (script re-runs): ECharts `echarts.getInstanceByDom(el)?.dispose()`; Chart.js
  keep the instance and `.destroy()`; amCharts stash the root and `.dispose()`. See
  `zportal://guide/charting`. Globals already available: `$`/`jQuery`, `moment`.

## Re-render cleanup

A block's script **re-runs on every query/filter reload**. Dispose the prior render
before rebuilding, or roots/listeners leak:

- Charts: stash the root (`currentBlock.container._am5Root` for native chart blocks, or
  your own variable) and call `.dispose()` at the top of render before `am5.Root.new(...)`.
- DOM: clear the container (`el.innerHTML = ''`) before re-rendering.
- Listeners: keep `zPortal.dataSource.on(...)` handlers in variables and `.off()` them.

## Safety (enforced: error)

- No `eval`, `new Function()`, or `document.write`.
- Don't interpolate untrusted values straight into the DOM.

## Filters

Drive filters through the datasource API (filters apply across active queries):

- `zPortal.dataSource.setFilters('col', ['CA', 'TX'])` — set + refresh; pass `[]` to
  clear that one column.
- `zPortal.dataSource.setRangeFilters('date', { min, max })` — range filter.
- `zPortal.dataSource.clearFilters()` — clears **all** filters everywhere (always global;
  there is no per-datasource clear — use `setFilters(col, [])` instead).
- Inspect with `zPortal.dataSource.get()`. Inactive datasources (`isActive: false`)
  ignore refreshes.

## Block data binding (ui_queries → a saved query → a datasource)

A block does **not** carry its query inline. The block's writable binding field is
`ui_queries` — the portal `BlockRequest` schema has **no `data`/`__source__` field**
(any `data` you pass is ignored by this portal version):

```json
"ui_queries": [
  { "enabled": true, "page_size": 50, "query_id": "<query-uuid>",
    "filter_strategy": { "type": "blacklist", "value": [] } }
]
```

Each entry's `query_id` points to a saved **`query` resource**, which is what holds the
datasource(s) and the SQL (`raw_sql` or `sql_form`). A working data block is a chain:
**block.ui_queries[n].query_id → query → datasource**, and `currentBlock.queryResults[n]`
corresponds to `ui_queries[n]`. An empty `ui_queries` (`[]`) is a presentational /
library-loader block with no data.

- **A query must have a datasource.** Binding a `query_id` whose query has no datasource
  attached fails with *"a query must have a datasource"*. Point the query at a datasource
  first — `get_resource resource="query" id="<uuid>"` shows its `datasources` and the
  real output `columns`.
- **Preserve the binding on every edit.** `ui_queries` is a first-class field; an
  `update_block` that omits it replaces the block without its binding and the block goes
  blank. Re-send the existing `ui_queries` whenever you edit an already-bound block.
- **Verify the real columns before you bind, then match them exactly.** Inspect the bound
  query with `execute_query`, or the datasource with `fetch_sample_rows`, and set the
  block's column-name constants to those exact aliases. Column-name mismatch is the #1
  cause of an empty block — and if the block has hardcoded sample/fallback rows, a
  mismatch silently renders the **sample data instead**, so it *looks* like it works while
  showing nothing live. After binding, confirm live rows actually flow (not the fallback).
- **Aggregate in the query, not the block.** A raw event/log datasource (one row per
  event) won't expose the shaped columns a chart expects (e.g. `page_url`, `page_views`).
  Put the `GROUP BY … COUNT(*)`/`SUM(…)` in the query's SQL so it returns chart-ready
  columns; don't rely on the block JS to aggregate raw rows.
- **`page_size` default = `null` (all rows). Prefer it.** `ui_queries[n].page_size` caps how
  many rows reach `queryResults[n]`; `null` (or `0`) means **no limit — return everything**.
  Default to `null` so the block sees the full dataset; only set a number when capping
  genuinely makes sense (a deliberately small "top N" preview, or a known-huge table you page
  through). The portal-UI default of `50` silently truncates a block that filters/aggregates
  client-side — a silent-data trap like column mismatch. In the real v1.18 corpus, bound
  queries split between `page_size: null` and large caps (100000+) for exactly this reason.
  (`filter_strategy.type` is `blacklist` by default; `whitelist` also exists.)

## Code style — write for humans

- `const` by default, `let` only when reassigned, never `var`; strict equality
  (`===`); `async/await` over `.then()` chains, each wrapped in `try/catch`.
- One statement per line, 4-space indent, blank lines between functions; never minify.
- Descriptive names (`monthlyRevenueByRegion`, `renderRevenueChart`) — not `x`,
  `data`, `tmp`. Booleans read as predicates (`isLoading`). Pure helpers above
  side-effecting code.

## QA self-review before shipping a block

- **Correctness:** keys read off `currentBlock.queryResults[n]` match the query column
  aliases; empty/null-row paths handled; `init()` runs exactly once.
- **Binding:** the block has a `ui_queries` entry whose `query_id` resolves to a query
  with a datasource; column constants match that query's real columns (verified via
  `execute_query`/`fetch_sample_rows`); live rows render, not the fallback; and any
  `update_block` re-sends the existing `ui_queries` so the binding survives.
- **Zuar-fit:** no `<html>/<head>/<body>/<style>` in the fields; no direct amCharts
  `<script>` injection; CSS scoped to the block root; async paths call the
  `getOnLoadedCallback` resolver.
- **Safety:** no `eval`/`new Function()`/`document.write`; no untrusted DOM
  interpolation; externals loaded dynamically.
