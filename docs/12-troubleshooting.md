# 12 · Troubleshooting

Symptom → cause → fix for the failure modes that actually come up.

## Block renders completely blank; console shows `Failed to execute 'appendChild' … Unexpected identifier`
**Cause:** a literal **`$`** in the block source (e.g. `'$'+value` for currency). AngularJS `$compile`
rewrites it via `String.replace` special patterns (`$'`, `$&`, `$$`, `$n`) → SyntaxError → the whole
block dies.
**Fix:** don't emit a literal `$` **adjacent to a quote/backtick/`&`/`$`/digit** (template-literal
`${…}` and jQuery `$(` are safe). Use `value.toLocaleString('en-US',{style:'currency',currency:'USD'})`,
`String.fromCharCode(36)` in JS, or `&#36;` in HTML. In the **v2.2.0 build** the **`no_raw_dollar`**
rule rejects this at author time. See [05](05-authoring-rules.md). Note other syntax errors — including
unescaped `{{ }}` (see below) — can blank a block with a similar `SyntaxError`.

## Block renders but shows no data (empty table / "—" KPIs / blank chart)
**Likely causes:**
- **Column-name mismatch** — block constants don't match the query's real aliases. Verify with
  `execute_query` / `fetch_sample_rows` and match exactly.
- **No binding** — `ui_queries` empty or the query has no datasource. The `require_query_binding`
  warning flags this. Use `bind_block_query`.
- **`page_size` cap** — a small `page_size` truncates rows; use `null` for all rows.
- **Reading the wrong shape** — use the `getQueryData` helper (`mappedData` || map `columns`+`data`);
  don't hardcode indices.

## Binding disappeared after `update_block`
**Cause:** `update_block` is full-replace; passing a new `ui_queries` (or `[]`) overwrites/clears it.
**Fix:** **omit `ui_queries`** to preserve the existing binding; only pass it to intentionally rebind.

## Literal `{{ }}` behaving oddly / disappearing
**Cause:** `{{` is evaluated by `$compile`. **Fix:** escape as `&#123;&#123;` or set the text via JS
(`el.textContent = …`). Flagged by `angular_interpolation`.

## Chart doesn't render / disappears on a multi-block page
**Causes & fixes:**
- **AMD trap** — the portal has a global AMD `define` (Monaco); UMD chart libs register with it instead
  of `window`. Null `window.define` during `zPortal.resources.load`, restore it after (see
  [08](08-zportal-in-block-api.md)).
- **`<script src>`** — stripped by the portal. Load via `zPortal.resources.load(url)`.
- **Instances leak** on reload — dispose first (`echarts.getInstanceByDom(el)?.dispose()` /
  `chart.destroy()` / am5 `root.dispose()`).
- **Concurrent loads** — load a heavy lib in **one** block per page; several racing loads can corrupt
  `window.define`.
- **Async without callback** — call `currentBlock.getOnLoadedCallback()` once after render.

## `create_block`/`update_block` rejected with `[rule_id] …`
An **error**-severity rule fired (`no_css_in_html`, `no_unsafe_js`, `no_raw_dollar`, …). The message
says what and how to fix. To inspect/adjust severities: `get_rules`, or edit `assets/rules.json` /
`PORTAL_BLOCK_RULES_FILE`. See [05](05-authoring-rules.md).

## "a query must have a datasource"
**Cause:** binding to a query with no datasource attached. **Fix:** attach a datasource to the query,
or use `bind_block_query` with a `datasource_id` (it auto-creates a `SELECT *` query that has one).

## A write tool returns "… writes are disabled. Set PORTAL_ALLOW_…"
The tool's **risk domain** isn't enabled. Set `PORTAL_ALLOW_DATA_WRITES=1` (data) or
`PORTAL_ALLOW_ADMIN_WRITES=1` (admin), or unset `PORTAL_READONLY`. `run_db_modification` also needs
`confirm:true`. See [02](02-install-and-config.md).

## `list_resource` / `get_block` errored about exceeding the token limit
Large payloads are saved to a file instead of returned inline. Options: pass `{ only_names: true }` to
`list_resource`; `jq` the saved file for the fields you need; or hand it to a sub-agent to summarize.

## Native filters don't propagate across blocks
- Each data block needs `filter_strategy:{type:"blacklist",value:[]}` (listen to all) and to bind the
  relevant datasource.
- Subscribe with `zPortal.dataSource.on('load', dsId, render)` and re-read `queryResults` in `render`.
- `zPortal.dataSource.on` is **deprecated in v1.19** (still works; warns) — newer surface is
  `zPortal.query`.

## Version control isn't committing `[2.2.0]`
- `PORTAL_VC_DIR` not set → VC is off (`vc_status` confirms).
- The v2.2.0 build isn't live → `npm run build`, repack `.mcpb`, **restart** the MCP.
- `git` not on PATH, or the dir isn't writable → check `PORTAL_DEBUG=1` stderr logs (`vc: …`).
- Only **content** writes are tracked — data/admin changes (datasources, users) are intentionally not.
- Portal-UI edits aren't seen until the next MCP write to that record or a `snapshot_portal`.

## Restored version won't apply
`restore_resource` writes back through the validated update path — a restored **block** must still pass
`validateBlock`. If an old version violates a now-`error` rule, fix it before/while restoring.

## Changes don't take effect after editing server code
Rebuild + restart: `npm run build`, repack the `.mcpb`, restart the client. The running process uses the
previously built `dist/` until restart.
