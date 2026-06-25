/**
 * test-harness.mjs — temporary live-portal test driver (safe to delete).
 *
 * Spawns the real MCP server (dist/index.js) over stdio and drives it through a
 * real MCP client, exactly like Claude Desktop would. Credentials come from the
 * server's own resolution (config.json at repo root, or PORTAL_* env vars).
 *
 *   node test-harness.mjs read        # read-only smoke test (default)
 *   node test-harness.mjs recon       # inspect an existing HTML block's real payload shape
 *   node test-harness.mjs createkeep  # create a test block and LEAVE it (prints the new id)
 *   node test-harness.mjs crud        # create -> get -> update -> DELETE a test block
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MODE = (process.argv[2] ?? "read").toLowerCase();

function hr(label) {
  console.log("\n" + "─".repeat(70) + "\n" + label);
}

// Pull the text payload out of a tool result and try to JSON-parse it.
function resultText(res) {
  const t = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return t;
}
function resultJson(res) {
  try { return JSON.parse(resultText(res)); } catch { return null; }
}

async function callTool(client, name, args = {}) {
  hr(`▶ ${name}(${JSON.stringify(args)})`);
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = resultText(res);
    if (res.isError) {
      console.log("  ✗ tool reported error:");
      console.log("    " + text.replace(/\n/g, "\n    "));
    } else {
      const trimmed = text.length > 1500 ? text.slice(0, 1500) + "\n    …(truncated)" : text;
      console.log("  ✓ ok:");
      console.log("    " + trimmed.replace(/\n/g, "\n    "));
    }
    return { res, json: resultJson(res), isError: !!res.isError };
  } catch (e) {
    console.log("  ✗ transport/exception:", e.message);
    return { res: null, json: null, isError: true };
  }
}

// Best-effort extraction of a datasource UUID from list_datasources output.
function firstDatasourceId(json) {
  const arr = Array.isArray(json) ? json
    : Array.isArray(json?.datasources) ? json.datasources
    : Array.isArray(json?.results) ? json.results
    : Array.isArray(json?.data) ? json.data
    : [];
  for (const d of arr) {
    const id = d?.id ?? d?.uuid ?? d?.__source__ ?? d?.datasource_id;
    if (typeof id === "string") return { id, name: d?.name ?? d?.title ?? "(unnamed)" };
  }
  return null;
}

// Extract a block id from a create/get result, tolerating a few shapes.
function blockId(json) {
  return json?.id ?? json?.uuid ?? json?.block?.id ?? json?.block?.uuid ?? null;
}

async function runReadSuite(client) {
  await callTool(client, "get_rules");
  await callTool(client, "get_version");
  await callTool(client, "describe_resource");
  const ds = await callTool(client, "list_resource", { resource: "datasource" });
  await callTool(client, "list_blocks", { only_names: true });
  await callTool(client, "list_resource", { resource: "layout" });
  await callTool(client, "list_resource", { resource: "query" });

  const dsHit = firstDatasourceId(ds.json);
  if (dsHit) {
    console.log(`\n(using datasource "${dsHit.name}" -> ${dsHit.id} for fetch_sample_rows)`);
    await callTool(client, "fetch_sample_rows", { datasource_id: dsHit.id, limit: 3 });
  } else {
    hr("▶ fetch_sample_rows — skipped (couldn't auto-detect a datasource id)");
  }
}

// Fetch one existing HTML block and report WHERE its markup actually lives, so we
// know the create payload mirrors the portal's real shape (json_data.html, etc.).
async function reconHtmlBlock(client) {
  hr("RECON — inspecting an existing HTML block's payload shape");
  const list = await client.callTool({ name: "list_blocks", arguments: {} });
  let blocks = resultJson(list);
  blocks = Array.isArray(blocks) ? blocks : blocks?.blocks ?? blocks?.results ?? [];
  const candidate =
    blocks.find((b) => (b?.type === "html") && /html/i.test(b?.name ?? "")) ??
    blocks.find((b) => b?.type === "html") ??
    blocks[0];
  if (!candidate) { console.log("  (no blocks found to inspect)"); return; }
  const id = blockId(candidate) ?? candidate?.id;
  console.log(`  reference block: "${candidate?.name}" (type=${candidate?.type}) -> ${id}`);

  const got = await client.callTool({ name: "get_block", arguments: { block_id: id } });
  const b = resultJson(got);
  if (!b) { console.log("  (could not parse get_block output)"); return; }
  console.log("  top-level keys:", Object.keys(b).join(", "));
  console.log("  type:", JSON.stringify(b.type));
  const jd = b.json_data;
  console.log("  json_data:", jd == null ? "null/absent" : `object, keys = [${Object.keys(jd).join(", ")}]`);
  if (jd && typeof jd === "object") {
    const htmlVal = jd.html;
    console.log("    json_data.html:",
      typeof htmlVal === "string" ? `string, ${htmlVal.length} chars  →  HTML lives here ✓`
      : htmlVal === undefined ? "absent — HTML may live elsewhere ⚠"
      : `type ${typeof htmlVal}`);
    if (htmlVal && typeof htmlVal === "object") {
      console.log("    json_data.html keys:", Object.keys(htmlVal).join(", "));
      const dump = JSON.stringify(htmlVal, null, 2);
      console.log("    json_data.html =\n      " + (dump.length > 1200 ? dump.slice(0,1200)+"\n      …(truncated)" : dump).replace(/\n/g, "\n      "));
    }
    console.log("    json_data.isolated:", JSON.stringify(jd.isolated));
  }
  console.log("  data:", b.data == null ? "null/absent" : `${Array.isArray(b.data) ? "array" : "object"}, keys = [${Object.keys(b.data).join(", ")}]`);
  console.log("  ui_queries:", b.ui_queries == null ? "null/absent" :
    (Array.isArray(b.ui_queries) ? `array[${b.ui_queries.length}]` : `object keys=[${Object.keys(b.ui_queries).join(", ")}]`));
  if (b.ui_queries != null) {
    const uq = JSON.stringify(b.ui_queries, null, 2);
    console.log("    ui_queries =\n      " + (uq.length > 800 ? uq.slice(0,800)+"\n      …(truncated)" : uq).replace(/\n/g, "\n      "));
  }
  console.log("  css:", Array.isArray(b.css) ? `array[${b.css.length}]` : typeof b.css);
}

// Create a clearly-labeled test block. keep=true leaves it (prints the id);
// keep=false does the full create -> get -> update -> delete round-trip.
async function createTestBlock(client, { keep }) {
  const stamp = new Date().toISOString();
  // html as an ARRAY of lines + isolated:false — the proven 1.18+ portal shape.
  const html = [
    '<div id="mcp-test-block">',
    "  <h3>MCP Test Block</h3>",
    "  <p>Created via the Zuar Portal MCP server — safe to delete.</p>",
    '  <p class="stamp"></p>',
    "</div>",
    "<script>",
    "  const CONFIG = { DEBUG: false, STAMP: " + JSON.stringify(stamp) + " };",
    "  function log(...a){ if (CONFIG.DEBUG) console.log('[mcp-test]', ...a); }",
    "  function init(){",
    "    log('init');",
    "    const el = document.querySelector('#mcp-test-block .stamp');",
    "    if (el) el.textContent = 'created ' + CONFIG.STAMP;",
    "  }",
    "  init();",
    "</script>",
  ];
  const css = [
    "#mcp-test-block{padding:16px;border:1px solid var(--border,#ddd);border-radius:8px;" +
      "color:var(--primary,#222);font-family:var(--font-family,sans-serif);}",
    "#mcp-test-block h3{margin:0 0 8px;}",
    "#mcp-test-block .stamp{opacity:.7;font-size:12px;}",
  ];

  const created = await callTool(client, "create_block", {
    name: `MCP Test Block (safe to delete) ${stamp}`,
    json_data: { html, isolated: false },
    css,
  });
  const newId = blockId(created.json);
  if (!newId) {
    hr("Create returned no recognizable id — check the output above for the id field.");
    return;
  }
  console.log(`\n(created block id: ${newId})`);
  await callTool(client, "get_block", { block_id: newId });

  if (keep) {
    hr("✓ CREATE & KEEP complete");
    console.log(`  Block id: ${newId}`);
    console.log(`  Name:     MCP Test Block (safe to delete) ${stamp}`);
    console.log("  Open it in the portal's block library / add it to a page to confirm it renders.");
    console.log(`  To remove it later: node test-harness.mjs delete ${newId}  (or delete it in the UI)`);
  } else {
    await callTool(client, "update_block", { block_id: newId, name: `MCP Test Block (updated) ${stamp}` });
    await callTool(client, "delete_block", { block_id: newId });
    console.log("\n✓ CRUD round-trip complete (block deleted).");
  }
}

async function main() {
  console.log(`Zuar Portal MCP — live test harness (mode: ${MODE})`);

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env },   // forwards PORTAL_* / PORTAL_DEBUG if set
    stderr: "inherit",          // surface the server's stderr (login/debug/errors)
  });

  const client = new Client({ name: "zuar-test-harness", version: "1.0.0" });
  await client.connect(transport);
  console.log("✓ connected to server over stdio");

  // ── Capability discovery ──────────────────────────────────────────────────
  hr("Capabilities");
  const tools = await client.listTools();
  console.log("  tools:    ", tools.tools.map((t) => t.name).join(", "));
  const resources = await client.listResources();
  console.log("  resources:", resources.resources.map((r) => r.uri).join(", "));
  const prompts = await client.listPrompts();
  console.log("  prompts:  ", prompts.prompts.map((p) => p.name).join(", "));

  if (MODE === "read") {
    await runReadSuite(client);
  } else if (MODE === "recon") {
    await reconHtmlBlock(client);
  } else if (MODE === "createkeep") {
    await reconHtmlBlock(client);
    await createTestBlock(client, { keep: true });
  } else if (MODE === "crud") {
    await createTestBlock(client, { keep: false });
  } else if (MODE === "delete") {
    const id = process.argv[3];
    if (!id) console.log("usage: node test-harness.mjs delete <block_id>");
    else await callTool(client, "delete_block", { block_id: id });
  } else {
    console.log(`Unknown mode "${MODE}". Use: read | recon | createkeep | crud`);
  }

  await client.close();
  console.log("\n✓ done — harness closed.");
}

main().catch((e) => {
  console.error("\nFATAL:", e?.stack ?? e);
  process.exit(1);
});
