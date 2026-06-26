# 08 · zPortal In-Block API

The runtime API available **inside** a block's `<script>`. (How to author/bind the block is
[04](04-authoring-blocks.md).) The server also ships this as the `zportal://guide/zportal-api`,
`zportal://guide/currentblock`, and `zportal://guide/charting` resources.

> **Version baseline:** the live portal is **zPortal 1.19**; the in-block data contract is the stable
> **"v1.18+"** shape (the two terms refer to the same current behavior). Newly deprecated calls are
> flagged inline.

## `currentBlock` — your block's context (synchronous)
| Member | What it is |
|--------|-----------|
| `queryResults[n]` | Bound query results: `.columns` (names), `.data` (positional rows), `.mappedData` (row objects). `[n]` ↔ `ui_queries[n]`. |
| `currentUser` | The viewing user. |
| `config` | Portal/site config (replaces deprecated `siteConfig`). |
| `theme`, `layout`, `pages`, `system` | Theme tokens, this layout, page list, system info. |
| `getOnLoadedCallback()` | Call once after render in async blocks (in a `finally`) or the page loader can hang. |
| `getOnAnimatedCallback()` | For export-after-animation. |

A global `datasources` array is also injected.

**Getting the datasource id (`DS_ID`) inside a block** — needed for `dataSource.on`/`fetchResults`:
```js
const DS_ID = currentBlock.queryResults?.[0]?.__source__ || (zPortal.dataSource.get() || [])[0]?.id;
```
`.mappedData` is populated by 1.18+/1.19 portals; on older builds use `.columns`+`.data` (the
`getQueryData` helper in [04](04-authoring-blocks.md) handles both, including in `fetchResults` output).

## `zPortal.dataSource` — native, cross-block filters
Setting a filter re-queries the datasource and refreshes **every** block bound to it.
```js
zPortal.dataSource.setFilters('region', ['West', 'East']);   // set + refresh; [] clears that column
zPortal.dataSource.setRangeFilters('amount', { min: 0, max: 1000 });
zPortal.dataSource.clearFilters();                            // clears ALL filters (always global)
zPortal.dataSource.get().forEach(ds => /* ds.id, ds.name, ds.isActive */);
zPortal.dataSource.on('load', dsId, handler);                // react to reload; .off(dsId, handler)
const res = await zPortal.dataSource.fetchResults({          // ad-hoc fetch (e.g. cross-datasource)
  dataSourceId, filters: {}, queries: [{ columns: ['*'], limit: '0' }]
});                                                          // res.results[0].data / .columns
```
Quirks: `clearFilters()` is always global (use `setFilters(col, [])` to clear one column); `.off()`
needs the **same function reference**; inactive datasources ignore refresh.

> **v1.19 note:** `zPortal.dataSource.on('load', …)` still works but logs a deprecation warning
> (the newer surface is `zPortal.query`). It remains the documented, working pattern for now.

## `zPortal.block` — visibility & cross-block reads
```js
zPortal.block.show('content-1-<UUID>');
zPortal.block.hide('content-1-<UUID>');
zPortal.block.getData('content-1-<UUID>');           // row arrays from another block
zPortal.block.once('load', 'content-1-<UUID>', () => {});
```

## `zPortal.modal` — use instead of hand-rolled modals
```js
zPortal.modal.show({ title:'Confirm', body:'Sure?', confirmButton:'OK', dismissButton:'Cancel', size:'md' })
  .then(() => {/* confirmed */}).catch(() => {/* dismissed */});
```

## `zPortal.user` / `zPortal.page` / `zPortal.resources`
```js
zPortal.user?.fullname; zPortal.user?.is_admin; zPortal.user?.groups; zPortal.user.logout();
zPortal.page?.name; zPortal.page?.id;
zPortal.resources.load('https://cdn…/lib.js');       // promise; portal dedupes + tracks (use this, not <script src>)
```

## Cross-page navigation (drill-down)
Navigate to another page by slug — works without JS via a real link, which is the robust pattern for
exec→detail drill cards:
```html
<a href="/p/industry-showcase-2?region=West">Open dashboard →</a>
```
The target page can read `window.location.search` on load and apply `setFilters` to open pre-filtered.

## Charting (policy + safe loading)
Pick by complexity; **do not default to amCharts**:
- **ECharts 5** — complex/interactive (drill, dataZoom, many series).
- **Chart.js / vanilla SVG/canvas** — simple (single bar/line/pie, sparkline, gauge).
- **amCharts 5** — only when explicitly requested.

Load via `zPortal.resources.load` and dispose on re-render (the script re-runs each reload):
```js
// AMD-safe ECharts load: the portal has Monaco's global `define` (AMD); null it during load.
function loadScript(src){ const d=window.define; window.define=undefined;
  return Promise.resolve(zPortal.resources.load(src)).finally(()=>{ window.define=d; }); }
// ECharts: echarts.getInstanceByDom(el)?.dispose() before echarts.init(el)
// Chart.js: keep the Chart in a var and .destroy() before re-create
// amCharts: stash root and .dispose() before am5.Root.new(...); load core index.js THEN modules (never AMCHARTS_LOADER)
```
On a multi-block page, load a heavy chart lib in **one** block (concurrent loads can corrupt
`window.define`). Always call `getOnLoadedCallback()` once after the chart renders.

## Native (config-driven) block types
`html` is the freeform escape hatch; the portal also has config-driven native types whose behavior
lives in `json_data` (not freeform HTML): `data-table`, `amchart*`, filter controls (`multiselect`,
`selectFilter`, `date-time`, `cascading-filter-group`, `clear-filters-button`, `parameterControl`),
`text-area`/`markdown`, `navigation`, `user-menu`, `logo`, `tableau-dashboard`, `applied-filters`,
`chatbot`. This MCP's typed tools author **`html`** blocks; native types are created via
`create_resource`/the portal UI. See `zportal://guide/zportal-api` for each type's shape.
