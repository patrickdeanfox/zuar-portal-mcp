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
- The block's saved \`data\` field is its query binding, not the CSS:
  \`{ "__source__": "<datasource-uuid>", "columns": [SQL exprs w/ aliases], "group_by",
  "limit", "enabled" }\`. Empty \`__source__\`/\`enabled:false\` = no bound query.
- Always set type to "html" (this server enforces it).

## Theme variables (use instead of hardcoded colors)
--color-primary, --color-text, --color-link, --body-bg-color, --header-bg-color, --sidebar-bg-color, --color-success, --color-danger. Layout: --header-height, --footer-height, --sidebar-left-width.
Example: \`color: var(--color-primary); background: var(--body-bg-color);\`
`;

const CURRENTBLOCK = `# Reading data in an HTML block: currentBlock (v1.18+)

\`currentBlock\` is auto-injected and valid synchronously at load. Read query data from
\`currentBlock.queryResults\` — an array with one entry per query configured on the block.
Each entry has \`.columns\` and \`.data\` (keyed by column name). Use a small helper that
tolerates both column-oriented and row-oriented \`.data\`:

\`\`\`js
function getQueryData(index = 0) {
  const r = currentBlock.queryResults?.[index];
  if (!r || !r.data) return [];
  const names = (r.columns || []).map(c => (typeof c === 'object' ? c.name : c));
  if (!Array.isArray(r.data)) {
    // column-oriented: { col_name: [v0, v1, ...] }
    const len = names.length ? (r.data[names[0]]?.length ?? 0) : 0;
    return Array.from({ length: len }, (_, i) =>
      Object.fromEntries(names.map(n => [n, r.data[n]?.[i]]))
    );
  }
  // row-oriented fallback: [[v0, v1], ...] or [{...}, ...]
  return r.data.map(row =>
    Array.isArray(row) ? Object.fromEntries(names.map((n, i) => [n, row[i]])) : row
  );
}

const rows = getQueryData(0);            // [{ col: val, ... }, ...]
const singleValue = rows[0]?.some_column;
\`\`\`

Column aliases must exactly match the query — a name mismatch is the #1 cause of an empty
block. Deprecated v1.18 aliases (still work, v1.17 shape): \`currentBlock.data\` /
\`currentBlock.columns\` = \`queryResults[0]\`; \`siteConfig\` -> use \`currentBlock.config\`.

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

const AMCHARTS_LOADER = `# amCharts 5 in zPortal blocks (two-block pattern)

Always amCharts 5 (\`am5.*\`), never amCharts 4. Scripts load via a single global
loader block placed once on the page; chart blocks never load scripts directly.

## Global loader block (add once per page)
\`\`\`html
<script>
window.AMCHARTS_LOADER = (function () {
  const CONFIG = {
    cdnBase: 'https://cdn.amcharts.com/lib/5/',
    scripts: ['index.js','xy.js','percent.js','radar.js','flow.js','hierarchy.js','map.js','stock.js','themes/Animated.js']
  };
  let promise = null;
  function loadScript(src){ return new Promise((res, rej) => {
    if (document.querySelector('script[src="'+src+'"]')) return res(src);
    const s = document.createElement('script'); s.src = src;
    s.onload = () => res(src); s.onerror = () => rej(new Error('Failed: '+src));
    document.head.appendChild(s);
  }); }
  async function loadAll(){ for (const f of CONFIG.scripts) await loadScript(CONFIG.cdnBase + f); return true; }
  return { load(){ if (promise) return promise; if (window.am5 && window.am5xy) return Promise.resolve(true); promise = loadAll(); return promise; } };
})();
</script>
\`\`\`

## Chart block (wraps all chart code)
The block script re-runs on every filter/query reload — dispose the prior root first or
am5 roots leak.
\`\`\`html
<div id="chartdiv"></div>
<script>
(function () {
  window.AMCHARTS_LOADER.load().then(function () {
    const el = document.getElementById("chartdiv");
    if (el._am5Root) { el._am5Root.dispose(); }          // cleanup before recreate
    const root = am5.Root.new(el);
    el._am5Root = root;
    root.setThemes([am5themes_Animated.new(root)]);
    // build chart from getQueryData(0)...
    // if licensed: am5.addLicense('AM5C-...');
  });
})();
</script>
\`\`\`

## Module map by chart type
- xy / line / column / bar: xy.js
- pie / donut: percent.js
- radar / gauge: radar.js
- sankey: flow.js
- treemap: hierarchy.js
- map: map.js (+ geodata)
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

## Native block types (config-driven; \`html\` is used ~99.9% of the time)
Built-in types you'll encounter or read: \`data-table\`, \`amchart\` (json_data:
\`{ chartBackend, chartResources:[urls], chartType, configType, chartConfig, chartScript }\`
where \`chartScript\` builds the chart on \`currentBlock.container\` from \`currentBlock.data\`),
\`multiselect\` / \`date-time\` / \`clear-filters-button\` (filter controls — their \`filter\`
field is the column passed to \`setFilters\`), \`tableau-dashboard\`, \`user-menu\`,
\`navigation\`, \`logo\`. Prefer an \`html\` block unless a native type fits exactly.
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
    uri: "zportal://guide/amcharts-loader",
    name: "amcharts-loader",
    title: "amCharts 5 two-block loader pattern",
    description: "Global AMCHARTS_LOADER block plus per-chart usage and module map.",
    text: AMCHARTS_LOADER,
  },
];
