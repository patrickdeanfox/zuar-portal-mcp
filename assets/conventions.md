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
  configured on the block, each with `.columns` (descriptor array) and `.data`.
  `queryResults[0].data.colName` returns a flat column array; rows can also be read as
  key-value objects.
- Include a `getQueryData(index)` helper that maps rows to `{ column_name: value }`
  objects, and access values by column name.
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
- Block JS runs once per query load. With multiple queries, check all required indices
  have loaded (`q && q.data !== undefined`) and `return` early if not — without calling
  the loaded callback.
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

Layout dims also exist: `--header-height` (70px), `--footer-height` (68px),
`--sidebar-left-width` (250px). Use `var(--token, fallback)`. If you need a color the
theme doesn't expose, derive it with `color-mix()` from an existing token rather than a
fixed hex. Blocks may also define their own local design tokens in a `:root {}` /
wrapper-scoped block at the top of the CSS and consume them via `var(--…)`.

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

## External libraries

- amCharts 5 (`am5.*`): use the global `AMCHARTS_LOADER` two-block pattern; wrap all
  chart code in `AMCHARTS_LOADER.load().then(...)`. Call `am5.addLicense(...)` if licensed.
- Other libs: load with `zPortal.resources.load(url)` — returns a promise; the portal
  dedupes and tracks it — e.g.
  `Promise.all(urls.map(u => zPortal.resources.load(u))).then(...)`. Or
  `document.createElement('script')` with pinned CDN versions. Never a static `<script
  src>`. Globals already available: `$`/`jQuery`, `moment`.

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

## Block data binding

A block binds to its data through the `data` field saved on the block (not the runtime
`currentBlock.data`): a query spec `{ "__source__": "<datasource-uuid>", "columns":
[...SQL exprs with aliases...], "group_by", "limit", "distinct", "enabled" }`. An empty
`__source__`/`enabled: false` means the block has no bound query (presentational or
library-loader block). Discover the datasource UUID and column aliases with
`list_resource`/`fetch_sample_rows` before authoring against them.

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
- **Zuar-fit:** no `<html>/<head>/<body>/<style>` in the fields; no direct amCharts
  `<script>` injection; CSS scoped to the block root; async paths call the
  `getOnLoadedCallback` resolver.
- **Safety:** no `eval`/`new Function()`/`document.write`; no untrusted DOM
  interpolation; externals loaded dynamically.
