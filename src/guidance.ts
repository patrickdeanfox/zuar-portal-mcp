/**
 * guidance.ts
 *
 * Bundled zPortal block-authoring conventions, exposed as MCP resources so any
 * client's model produces correct blocks without a separate skill install.
 * Content is general API/convention knowledge, distilled for block creation.
 */

export interface Guide {
  uri: string;
  name: string;
  title: string;
  description: string;
  text: string;
}

const BLOCK_STRUCTURE = `# zPortal HTML Block Structure

An HTML block has TWO separate fields. Never merge them into one HTML document.

## 1. HTML + JS field
Only what would go between <body> tags. No <html>, <head>, <body>, or <!DOCTYPE>.
Wrap markup in a single \`.wrapper\` container and scope CSS under it — other blocks share
the page DOM, so unscoped selectors and global ids collide.

\`\`\`html
<div class="wrapper">
  <div id="chart"></div>
  <script>
    // inline JS here (wrap in an IIFE so nothing leaks to window)
  </script>
</div>
\`\`\`

## 2. CSS field (separate)
Raw CSS rules only. No <style> tags. Scope everything under \`.wrapper\`.

\`\`\`css
.wrapper { display: flex; height: 100%; }
.wrapper #chart { width: 100%; height: 400px; }
\`\`\`

When a page hosts several similar blocks, also suffix ids/classes/JS vars with a
block-specific number (#chartdiv1, .wrapper1, CONFIG_1) to avoid collisions.

## API mapping
When calling create_block / update_block:
- For html blocks the HTML+JS content lives in \`json_data.html\`, and \`css\` (a string the
  server normalizes — may be stored as a line array) carries the CSS.
- A block binds to data via \`ui_queries\` (the portal has no \`data\` field):
  \`[{ "enabled": true, "page_size": null, "query_id": "<query-uuid>",
  "filter_strategy": { "type": "blacklist", "value": [] } }]\`. Each query_id -> a saved
  \`query\` resource holding the datasource + SQL; \`queryResults[n]\` maps to \`ui_queries[n]\`.
  A query with no datasource is rejected ("a query must have a datasource"). Empty
  \`ui_queries\` = no bound query. On update_block, keep the existing ui_queries or the
  binding is wiped — and verify the query's real columns (execute_query/fetch_sample_rows)
  match the block's column constants, or it silently renders fallback/empty data.
- Always set type to "html" (this server enforces it).

## Theme variables (use instead of hardcoded colors)
--color-primary, --color-text, --color-link, --body-bg-color, --header-bg-color, --sidebar-bg-color, --color-success, --color-danger. Layout: --header-height, --footer-height, --sidebar-left-width.
Example: \`color: var(--color-primary); background: var(--body-bg-color);\`
`;

const CURRENTBLOCK = `# Reading data in an HTML block: currentBlock (v1.18+)

\`currentBlock\` is auto-injected and valid synchronously at load. Read query data from
\`currentBlock.queryResults\` — an array with one entry per query configured on the block.
Confirmed v1.18 shape (build 2026-06): \`.columns\` is a plain array of column-name strings,
and \`.data\` is an array of **positional row arrays** (\`[[v0, v1, ...], ...]\`, values keep
native types; \`.data\` may be a Proxy — treat as a normal array). Map rows to objects by
name with a small helper (it also tolerates older column-keyed/descriptor shapes):

\`\`\`js
function getQueryData(index = 0) {
  const r = currentBlock.queryResults?.[index];
  if (!r) return [];
  if (Array.isArray(r.mappedData)) return r.mappedData;   // v1.18/1.19: rows already as objects
  if (!r.data) return [];
  const names = (r.columns || []).map(c => (typeof c === 'object' ? c.name : c));
  if (Array.isArray(r.data)) {
    // v1.18: positional row arrays -> objects keyed by column name
    return r.data.map(row =>
      Array.isArray(row) ? Object.fromEntries(names.map((n, i) => [n, row[i]])) : row
    );
  }
  // guard: column-oriented { col_name: [v0, v1, ...] }
  const len = names.length ? (r.data[names[0]]?.length ?? 0) : 0;
  return Array.from({ length: len }, (_, i) =>
    Object.fromEntries(names.map(n => [n, r.data[n]?.[i]]))
  );
}

const rows = getQueryData(0);            // [{ col: val, ... }, ...]
const singleValue = rows[0]?.some_column;
\`\`\`

Column aliases must exactly match the query — a name mismatch is the #1 cause of an empty
block. Deprecated v1.18 aliases (still work): \`currentBlock.data\` / \`currentBlock.columns\`
= \`queryResults[0]\`; \`siteConfig\` -> use \`currentBlock.config\`.

## Other injected context
\`currentBlock.currentUser\`, \`.config\`, \`.theme\`, \`.layout\`, \`.pages\`, \`.system\`,
\`.getOnLoadedCallback()\`, \`.getOnAnimatedCallback()\`, plus a global \`datasources\` array.

## React to filter changes
\`\`\`js
const dsId = currentBlock.queryResults?.[0]?.__source__ || datasources?.[0]?.id;
function onLoad() { render(getQueryData(0)); }
zPortal.dataSource.on('load', dsId, onLoad);   // keep the ref; .off(dsId, onLoad) to detach
\`\`\`

## Scaffold convention (wrap in an IIFE)
\`\`\`js
(function () {
  const CONFIG = { verboseLogging: false };
  const log = (...a) => { if (CONFIG.verboseLogging) console.log('[block]', ...a); };
  function getQueryData(i){ /* see above */ }
  function render(rows){ /* build DOM/chart; dispose prior render first */ }
  function init(){ render(getQueryData(0)); }   // chart: AMCHARTS_LOADER.load().then(() => render(getQueryData(0)))
  init();
})();
\`\`\`

For async blocks (library load, fetch, deferred render) resolve
\`currentBlock.getOnLoadedCallback()\` once after render (in a \`finally\`) or the page loader
can hang. Synchronous blocks don't need it.
`;

const CHARTING = `# Charting libraries in zPortal blocks

Choose the library by complexity — do NOT default to amCharts:
- Complex / interactive (drill-down, dataZoom, many series, mixed types, large data): ECharts 5.
- Simple (a single bar/line/pie, a sparkline, a gauge): Chart.js, or hand-rolled SVG / canvas / vanilla JS.
- amCharts 5: ONLY when the user explicitly asks for amCharts.

## Loading — always \`zPortal.resources.load(url)\` (it dedupes + tracks); never a static \`<script src>\`
ECharts and Chart.js are single UMD files — one load, then build. Obtain
\`currentBlock.getOnLoadedCallback()\` early and call it once after the chart renders (in a \`finally\`).
\`\`\`js
zPortal.resources.load('https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js')
  .then(() => { const c = echarts.init(el); c.setOption(option); });   // window.echarts is ready
\`\`\`

## Re-render cleanup (the block script re-runs on every reload — dispose first or instances leak)
- ECharts: \`echarts.getInstanceByDom(el)?.dispose()\` before \`echarts.init(el)\`.
- Chart.js: keep the Chart in a variable and \`.destroy()\` it before re-creating.
- amCharts: stash the root and \`.dispose()\` it before \`am5.Root.new(...)\`.

## amCharts (only on explicit request) — do NOT use a global AMCHARTS_LOADER two-block pattern
amCharts 5 has a load-ORDER dependency: the core \`index.js\` must finish before the module files
(\`xy.js\`, \`percent.js\`, \`themes/Animated.js\`) — they extend \`am5\`. Load in 2 dependency-ordered
steps with \`zPortal.resources.load\`: core first, then the modules + theme in parallel.
\`\`\`js
const BASE = 'https://cdn.amcharts.com/lib/5/';
zPortal.resources.load(BASE + 'index.js')                  // step 1: core, defines am5
  .then(() => Promise.all([                                // step 2: modules + theme, after core
    zPortal.resources.load(BASE + 'xy.js'),
    zPortal.resources.load(BASE + 'themes/Animated.js'),
  ]))
  .then(() => {
    const el = document.getElementById('chartdiv');
    if (el._am5Root) el._am5Root.dispose();                // dispose before recreate
    const root = am5.Root.new(el); el._am5Root = root;
    root.setThemes([am5themes_Animated.new(root)]);
    // build from getQueryData(0); am5.addLicense('AM5C-...') if licensed
  });
\`\`\`
Module map (load in step 2 alongside the chart type you need): xy.js (line/column/bar/scatter),
percent.js (pie/donut), radar.js (radar/gauge), flow.js (sankey), hierarchy.js (treemap),
map.js (+ geodata), stock.js. Always amCharts 5 (\`am5.*\`), never amCharts 4.
`;

const ZPORTAL_API = `# zPortal API & interactivity (v1.18+)

\`zPortal\` is the global portal API available inside every block.

## Filters (drive the page's datasources)
\`\`\`js
zPortal.dataSource.setFilters('state', ['CA', 'TX']);   // set + refresh; [] clears that col
zPortal.dataSource.setRangeFilters('date', { min: '2023-01-01', max: '2023-12-31' });
zPortal.dataSource.clearFilters();                       // clears ALL filters (always global)
zPortal.dataSource.get().forEach(ds => console.log(ds.name, ds.id));
zPortal.dataSource.on('load', dsId, handler);            // react to reload; .off(dsId, handler)
zPortal.dataSource.fetchResults({ dataSourceId, filters: {}, queries: [{ columns: ['*'], limit: '0' }] })
  .then(res => { const rows = res.results?.[0]?.data; });
\`\`\`
Quirks: \`clearFilters()\` is always global (no per-datasource clear — use \`setFilters(col, [])\`);
\`.off()\` needs the SAME function reference; inactive datasources (\`isActive:false\`) ignore refresh.

## Block visibility & cross-block reads
\`\`\`js
zPortal.block.show('content-1-<UUID>');
zPortal.block.hide('content-1-<UUID>');
zPortal.block.getData('content-1-<UUID>');   // returns row arrays [[v1,v2],...] (index access)
zPortal.block.once('load', 'content-1-<UUID>', () => {});
\`\`\`

## Modals (use these — don't hand-roll DOM modals)
\`\`\`js
zPortal.modal.show({ title: 'Confirm', body: 'Sure?', confirmButton: 'OK', dismissButton: 'Cancel', size: 'md' })
  .then(() => { /* confirmed */ }).catch(() => { /* dismissed */ });
\`\`\`

## User / page / resources
\`\`\`js
zPortal.user?.fullname; zPortal.user?.is_admin; zPortal.user?.groups; zPortal.user.logout();
zPortal.page?.name; zPortal.page?.id;
zPortal.resources.load('https://cdn.../lib.js');   // promise; portal dedupes/tracks it
\`\`\`

## Native block types (config-driven; \`html\` is the freeform escape hatch)
Prefer an \`html\` block unless a native type fits exactly. Each native type's behavior lives
in \`json_data\` (not freeform html). Shapes confirmed in the live v1.18 corpus:
- \`data-table\`: \`json_data\` is \`{}\` — it renders entirely from its bound \`ui_queries\` (columns
  come from the query). The most common native type.
- \`amchart\`: \`{ chartBackend, chartResources:[urls], chartType, configType, chartConfig, chartScript }\`
  — \`chartScript\` builds on \`currentBlock.container\` from the query data.
- \`amchart-bar\` / \`amchart-pie\` / \`amchart-timeseries\`: \`{ chartType, chartConfig }\` (declarative;
  chartConfig has xAxes/yAxes/series whose \`dataFields\` map to query column names).
- Filter controls — all share a \`filter\` field (the datasource column they filter) plus
  \`optionValues\`/\`optionLabels\` (columns) and a \`preset\`:
  \`multiselect\` \`{ inputLabel, filter, optionValues, optionLabels, defaults, allowNull }\`;
  \`selectFilter\` \`{ inputLabel, filter, optionValues, optionLabels, allowNull, default, defaultLabel }\`;
  \`date-time\` \`{ inputLabel, filter, default, preset, defaultDateTime, rightAlignDropdown }\`;
  \`cascading-filter-group\` \`{ dataSourceId, autoSelectFirstValue, filters:[{ type, column, label, order, direction, preset }] }\`;
  \`parameterControl\` \`{ label, controlType, dataType, parameterName, preset, default }\` (drives a query param, not a filter);
  \`clear-filters-button\` \`{ buttonText, showIcon }\`.
- \`text-area\`: \`{ delta }\` (Quill rich-text delta). \`markdown\`: \`{ markdown:[lines] }\`.
- \`chatbot\`: LLM block \`{ llmConnectionId, systemPrompt:{ base_prompt, persona }, guardrails, uiConfig, debug }\`.
- \`navigation\` \`{ search, layout, menuTree }\`, \`user-menu\` \`{ showUsername, showIcon, icon }\`,
  \`logo\` \`{ themeId, showNoLogoError }\`, \`page-share\` \`{}\`, plus \`tableau-dashboard\`, \`applied-filters\`.
`;

const VISUAL_VERIFICATION = `# Visual verification with Claude for Chrome

The other guides describe a block from its CODE. This one is about SEEING it. With the Claude
for Chrome extension connected, you can open the portal in the user's browser, screenshot a
rendered block, and read its console/network — catching defects code review can't: a block that
validates and binds correctly but renders BLANK, throws a runtime console error, overflows its
grid cell, or silently shows the hardcoded SAMPLE fallback instead of live data. Use it for
visual debugging and as the final visual gate (final approval).

## When it applies
- The preference is on: \`active_config\` reports \`config.browser.claudeInChrome: true\`.
- The Chrome tools are actually connected (the \`mcp__claude-in-chrome__*\` tools resolve).
- The block is on a VIEWABLE page (placed on a layout). A block on no page has no URL to open —
  note that and fall back to code-only.

If any of these is false, SKIP visual verification, say so explicitly, and review the code. Never
block solely because you couldn't see it — this is a best-effort gate.

## Sign-in caveat (important)
The MCP authenticates to the portal with an API KEY; the browser needs a logged-in COOKIE session.
You cannot log the user in. To view private pages the user must already be signed into their portal
in Chrome. If navigation lands on a login screen, stop and tell them.

## Load the tools first (one call)
The Chrome tools are deferred — load the set you need in a SINGLE ToolSearch \`select:\` call, never
one at a time:
\`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_console_messages\`
Add \`read_network_requests\` (failed data calls), \`javascript_tool\` (inspect currentBlock /
queryResults live), \`resize_window\` (breakpoints), or \`gif_creator\` (record an approval) as needed.

## Workflow
1. \`tabs_context_mcp\` FIRST — if the portal is already open in a tab, reuse it; never reuse a tab id
   from a previous session.
2. Resolve the URL: portal base from \`active_config\` (\`portalUrl\`), page slug from the layout/page
   record. Portal pages route as \`<base>/p/<slug>\`. When unsure of the slug, open the portal home and
   navigate via its own nav.
3. \`navigate\` to the page; let it load.
4. \`computer\` screenshot — look at the block's grid cell.
5. \`read_console_messages\` (filter with a pattern if noisy) for runtime errors.
6. \`read_network_requests\` if data looks empty/wrong — did the query call 4xx/5xx or return 0 rows?
7. \`resize_window\` to a phone width (e.g. 390px) and re-screenshot for the responsive pass.

## The visual checklist
- RENDERS — not a blank cell, not a spinner stuck forever.
- LIVE data — the numbers match the bound query, NOT the hardcoded sample/fallback (cross-check one
  value against \`execute_query\`). This is the #1 silent failure.
- Console CLEAN — no uncaught errors, no \`$compile\`/SyntaxError, no failed library load.
- No OVERFLOW/clipping in the grid cell; text truncates, charts fit, nothing spills.
- Matches INTENT — right chart for the data, legible at the audience's altitude, theme tokens applied.

## Cautions
- Do NOT trigger \`alert\`/\`confirm\`/\`prompt\` or other modal dialogs — they freeze the extension. Use
  \`console.log\` + \`read_console_messages\` instead.
- Browsing/screenshotting is READ-ONLY on the portal — safe even for read-only agents.
- If a tool errors or no browser is connected after a try or two, stop, fall back to code-only, and
  report that visual verification was skipped (with the reason).
`;

export const GUIDES: Guide[] = [
  {
    uri: "zportal://guide/block-structure",
    name: "block-structure",
    title: "zPortal block structure",
    description: "Two-field HTML/CSS structure and theme variables for an HTML block.",
    text: BLOCK_STRUCTURE,
  },
  {
    uri: "zportal://guide/zportal-api",
    name: "zportal-api",
    title: "zPortal API, filters, modals & block types",
    description: "Filters, modals, cross-block visibility, resources.load, user/page APIs, and native block types.",
    text: ZPORTAL_API,
  },
  {
    uri: "zportal://guide/currentblock",
    name: "currentblock",
    title: "Reading data with currentBlock",
    description: "How to read query results inside a block and react to filters.",
    text: CURRENTBLOCK,
  },
  {
    uri: "zportal://guide/charting",
    name: "charting",
    title: "Charting libraries (ECharts / Chart.js / amCharts)",
    description: "Which charting library to use by complexity, and how to load each via zPortal.resources.load (incl. the amCharts 2-step core-then-modules load — no AMCHARTS_LOADER).",
    text: CHARTING,
  },
  {
    uri: "zportal://guide/visual-verification",
    name: "visual-verification",
    title: "Visual verification with Claude for Chrome",
    description: "How agents SEE a rendered block (screenshot, console, network) for visual debugging and the final visual gate — when it applies, the sign-in caveat, the workflow, and graceful code-only fallback.",
    text: VISUAL_VERIFICATION,
  },
];
