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

## Data access

- Read query data from `currentBlock.queryResults[index]` — `columns` (string array)
  and `data` (object of numeric keys → column-value arrays).
- **Never read `data` directly.** Include a `getQueryData(index)` helper that maps rows
  to `{ column_name: value }` objects, and access values by column name.
- **Deprecated — do not use** (still found in older blocks): `currentBlock.data`,
  `currentBlock.columns`, `zPortal.dataSource`, `fetchResults`. They are superseded by
  `currentBlock.queryResults` + `getQueryData()`.
- Column names are lowercase_with_underscores and must exactly match the query
  aliases. **Column-name mismatch is the most common cause of an empty block.**
- Block JS runs once per query load. With multiple queries, check all required indices
  have loaded (`q && q.data !== undefined`) and `return` early if not — without calling
  the loaded callback.
- No polling or listeners to wait for data (`setInterval`, `DOMContentLoaded`,
  `zPortal.block.on('load', …)`) — data is present when the script runs.

## The loaded callback (enforced: warn)

- Obtain `currentBlock.getOnLoadedCallback()` **early**; call it **exactly once** after
  the UI is fully drawn. Omitting it stalls the page (`loaded_timeout`).
- For async work, call it in a `finally` so it fires even on error.

## Don't author loading states

Portal renders a skeleton loader over every block while its query is in flight. Do not
add spinners, "Loading…" copy, shimmer placeholders, or `@keyframes` for one — they
stack on Portal's loader and look broken. Render an empty container and let Portal's
loader cover it.

## Theme — use variables, never hardcode (enforced: warn)

Consume the active theme via CSS variables so the block honors light/dark and brand
colors. Never hardcode hex/fonts the theme provides.

| Token | Var | Default |
|---|---|---|
| Primary | `--color-primary` | `#FA225B` |
| Danger | `--color-danger` | `#ea0000` |
| Warning | `--color-warning` | `#FDA428` |
| Info | `--color-info` | `#13c7df` |
| Success | `--color-success` | `#1ad465` |
| Text | `--color-text` | `#313131` |
| Block background | `--block-bg-color` | `#FFFFFF` |
| Table header / surface | `--system-gray` | `#F6F6F6` |
| Border | `--color-lightgray` | `#E4E4E4` |
| Font | `--font-stack-primary` | `'Roboto', sans-serif` |

Use `var(--token, fallback)`. If you need a color the theme doesn't expose, derive it
with `color-mix()` from an existing token rather than a fixed hex.

Wrap the block's markup in `<div id="zuar-block-root">…</div>` and scope **all** CSS
selectors under `#zuar-block-root` to avoid collisions with other blocks on the page
(this is the established convention across existing blocks).

## AngularJS $compile footguns

Block HTML runs through AngularJS `$compile`, so interpolation/directives are
evaluated, not rendered literally.

- `{{ … }}` is evaluated. For literal double-braces in visible text use
  `&#123;&#123;` or set text via JS (`element.textContent = …`).
- `$` in strings (currency) can be mangled. Prefer
  `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`, or `&#36;`,
  or set the text via DOM after data loads.
- Same caution for literal `{`, `}`, and `ng-…` / `data-ng-…` attributes.

## Interactivity — sandbox-safe (enforced: warn)

- Inline `on*` handlers (`onclick=`) and external `<script src="…">` are stripped.
  Wire interactions with `addEventListener` / `data-zuar-action` attributes and
  `name=` form inputs.
- Give every clickable element `:hover`, `:focus-visible`, and `:active` states.
- No modals or toasts from inside a block (they break the grid); no continuous idle
  animations.

## External libraries

- amCharts 5: use the global `AMCHARTS_LOADER` two-block pattern.
- Other libs: load dynamically via `document.createElement('script')` with pinned CDN
  versions; never a static `<script src>`. Globals already available: `$`/`jQuery`,
  `moment`, amCharts 4 (`am4core`/`am4charts`/`am4maps`).

## Safety (enforced: error)

- No `eval`, `new Function()`, or `document.write`.
- Don't interpolate untrusted values straight into the DOM.

## Filters

Global filters apply across all active queries: `zPortal.query.setFilter('col',
[value])`, `zPortal.query.removeFilter('col')`, `zPortal.query.clearFilters()`.

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
