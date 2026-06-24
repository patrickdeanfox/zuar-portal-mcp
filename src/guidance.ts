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

\`\`\`html
<div id="wrapper">
  <div id="chart"></div>
  <script>
    // inline JS here
  </script>
</div>
\`\`\`

## 2. CSS field (separate)
Raw CSS rules only. No <style> tags.

\`\`\`css
#wrapper { display: flex; height: 100%; }
#chart  { width: 100%; height: 400px; }
\`\`\`

## API mapping
When calling create_block / update_block:
- The HTML+JS string goes in the block's "data" or json_data per your portal version; for html blocks the editor content is the HTML+JS, and "css" carries the CSS.
- Always set type to "html" (this server enforces it).

## Theme variables (use instead of hardcoded colors)
--color-primary, --color-text, --body-bg-color, --header-bg-color, --sidebar-bg-color, --color-success, --color-danger.
Example: \`color: var(--color-primary); background: var(--body-bg-color);\`
`;

const CURRENTBLOCK = `# Reading data in an HTML block: currentBlock

\`currentBlock\` is auto-injected. Shape:

\`\`\`js
{
  data: {
    columns: [{ name: 'col1', type: 'text' }, ...],
    data: [[v1, v2, ...], ...]   // ROW ARRAYS, not objects
  },
  query: { __source__: '<DATASOURCE_UUID>', columns: [...], limit: 500, where: '', group_by: '', order_by: '', distinct: false }
}
\`\`\`

## Common patterns
\`\`\`js
const cols = currentBlock?.data?.columns?.map(c => c.name) || [];
const rows = currentBlock?.data?.data || [];
const records = rows.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
const dsId = currentBlock?.query?.__source__;
const singleValue = currentBlock?.data?.data?.[0]?.[0];
\`\`\`

\`currentBlock\` is valid synchronously at load. To react to filter changes,
listen with \`zPortal.dataSource.on('load', dsId, handler)\` and re-fetch.

## Scaffold convention
\`\`\`js
const CONFIG = { verboseLogging: false };
function log(...a){ if (CONFIG.verboseLogging) console.log('[block]', ...a); }
function readData(){ /* ... */ }
function render(){ /* ... */ }
function init(){ render(); }   // chart blocks: AMCHARTS_LOADER.load().then(render)
init();
\`\`\`
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
\`\`\`html
<div id="chartdiv"></div>
<script>
  window.AMCHARTS_LOADER.load().then(function () {
    const root = am5.Root.new("chartdiv");
    root.setThemes([am5themes_Animated.new(root)]);
    // build chart from currentBlock data...
  });
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

export const GUIDES: Guide[] = [
  {
    uri: "zportal://guide/block-structure",
    name: "block-structure",
    title: "zPortal block structure",
    description: "Two-field HTML/CSS structure and theme variables for an HTML block.",
    text: BLOCK_STRUCTURE,
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
