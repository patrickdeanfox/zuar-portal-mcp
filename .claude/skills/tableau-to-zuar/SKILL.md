---
name: tableau-to-zuar
description: Convert a Tableau dashboard file (.twb or .twbx) into a Zuar Portal page + blocks. Use when the user wants to migrate/port a Tableau workbook or dashboard to Zuar Portal (zPortal) — "convert this .twb/.twbx", "turn my Tableau dashboard into portal blocks", "migrate Tableau to Zuar". Parses the workbook XML, scopes to one dashboard, maps each worksheet (chart) + the dashboard's filters + zone layout to zPortal artifacts, and emits them through the zuar-portal MCP tools. v1 binds each block to an EXISTING Zuar datasource/query (it does NOT recreate Tableau connections).
---

# Tableau → Zuar Portal converter (v1)

Convert **one Tableau dashboard** into **one Zuar Portal page** with one block per worksheet, the
dashboard's filters as a native filter bar, and the dashboard's zones as the page grid. Emit happens
through the `zuar-portal` MCP tools; see that server's `docs/` for every tool.

## v1 scope & decisions (locked)
- **Input:** `.twbx` (a zip — extract the inner `.twb`) or a plain `.twb` (XML).
- **Data = map to existing.** Each worksheet's block binds to a **datasource/query that already exists
  in the Zuar portal**. This skill does NOT recreate Tableau connections, SQL, or calculated fields.
  You provide (or confirm) a worksheet → Zuar-data mapping.
- **One dashboard → one page.** Pick a single dashboard from the workbook.
- **Marks supported well:** bar, line, area, pie/donut, scatter, text-table, KPI/single-value,
  heatmap. **Flagged (not auto-converted):** maps, dual-axis, LOD/table-calcs, reference lines,
  trend models — report them; don't fake them.

## Prerequisites
- The `zuar-portal` MCP is connected and **content writes are on** (default). Binding to existing
  datasources needs them to already exist in the portal.
- **Strongly recommended:** version control on (`PORTAL_VC_DIR` set) so you can `snapshot_portal`
  before emitting and `restore_resource`/`git reset` if a run goes wrong. See the MCP's
  `docs/07-version-control.md`.
- Read `reference.md` (this folder) for the normalized model, the TWB extraction map, the chart emit
  templates, and the zone→grid math.

## Pipeline
```
.twbx ──unzip──► .twb (XML) ──parse──► workbook model ──scope──► one dashboard
   ──resolve data mapping──► ──emit──► Zuar page (layout) + blocks (charts) + filter bar
```

### 1. Unpack & parse
- `.twbx`: `unzip -o "<file>.twbx" '*.twb' -d <tmp>` (it's a zip; the `.twb` is the workbook XML;
  ignore the bundled extracts — v1 doesn't read data).
- Parse the `.twb` into the **normalized workbook model** (see `reference.md` → "Normalized model"
  and "TWB extraction map"). Capture: datasources (name + fields), worksheets (name, mark type,
  shelf dims/measures, encodings, worksheet-level filters), and dashboards (name + zones with
  x/y/w/h + the worksheet each zone hosts + dashboard-level filters).

### 2. Scope to one dashboard
- List the dashboards; ask the user which one (or take the named arg). Keep only that dashboard's
  zones, the worksheets they reference, and the dashboard's filters.

### 3. Resolve the data mapping (the human-in-the-loop step)
For each worksheet, produce a row: `worksheet → { zuar: datasource_id|query_id, columns }`.
- Use `list_resource resource=datasource` / `resource=query` and `fetch_sample_rows` / `execute_query`
  to see what's available and its real column names.
- Match the worksheet's dims/measures (from the model) to **actual Zuar query columns** — names rarely
  match Tableau's, so confirm with the user. Present the proposed mapping as a table and let them edit.
- Prefer **one shared query per page** when worksheets share a source, so the page filters together.

### 4. Emit (through the MCP) — snapshot first
1. `snapshot_portal { message: "before tableau import: <dashboard>" }` (if VC on).
2. Create or reuse the page: `create_resource resource=layout` (or target an existing empty page).
3. Per worksheet → one **HTML block**: author an ECharts block using the mapping's columns and the
   matching emit template (`reference.md` → "Chart emit templates"). Follow the MCP's authoring rules
   (two-field structure, IIFE, `getQueryData`, theme tokens, **never a literal `$`**) and the house
   `design.md` system. `create_block` then `bind_block_query { query_id | datasource_id }`.
4. Dashboard filters → one **filter-bar block** calling `zPortal.dataSource.setFilters(col, [val])`
   (categorical) / `setRangeFilters` (range/date), bound `filter_strategy:{type:"blacklist",value:[]}`.
5. Place everything: convert each zone's x/y/w/h to grid % and write the full
   `json_data.grid` (`blocks` + `block_layouts.{lg,md,sm}`) in ONE `update_resource resource=layout`
   call (don't call `add_block_to_page` in parallel — it races). See `reference.md` → "Zone → grid".

### 5. Verify & report
- Confirm via `get_block` / `execute_query` that bound queries return rows; open the page.
- Report a **fidelity summary**: what converted cleanly, what was approximated, and what was skipped
  (maps/LOD/etc.) with the worksheet names — so nothing silently disappears.

## Tableau → Zuar object mapping
| Tableau | Zuar artifact | MCP tool |
|---|---|---|
| Worksheet (viz) | HTML block (ECharts) | `create_block` + `bind_block_query` |
| Dashboard + zones | layout (page) grid | `update_resource resource=layout` |
| Quick filters | filter-bar block (`setFilters`) | `create_block` |
| Data source | (v1) an **existing** Zuar datasource/query you map to | `list_resource` / `bind_block_query` |
| Calculated field / LOD | not translated in v1 — must already exist in the Zuar query | — |

## Hard rules when emitting
- Obey `validateBlock` — it hard-rejects broken blocks (incl. the `$`/`no_raw_dollar` trap). Format
  currency with `toLocaleString('en-US',{style:'currency',currency:'USD'})` or `&#36;`, never a literal `$`.
- Aim for **semantic** parity (same numbers, cuts, filters), not pixel-perfect — then let `design.md`
  give it a clean, consistent look rather than cloning Tableau's chrome.
- Keep it **revertible**: snapshot before, and tell the user the `restore_resource` escape hatch.

## See also
- `reference.md` — normalized model, TWB extraction map, chart emit templates, zone→grid math.
- The `zuar-portal` MCP `docs/`: `03-tools-reference`, `04-authoring-blocks`, `08-zportal-in-block-api`,
  `06-design-system`, `07-version-control`.
