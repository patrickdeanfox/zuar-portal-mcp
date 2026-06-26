# 10 · Recipes

End-to-end use cases as tool sequences. They assume content writes are on (default) and pair well with
the [`zportal` skill](09-related-skills.md). Most reference the [authoring flow](04-authoring-blocks.md).

## 1. Explore a new datasource
Goal: understand a datasource before building.
```
list_resource { resource: "datasource" }            # find the UUID
fetch_sample_rows { datasource_id, limit: 20 }        # real columns + values
# or, for a saved query:
list_resource { resource: "query" }
execute_query { query_id }                            # columns + rows; add params for parameterized queries
```
Tip: note distinct values of categorical columns (for filters) and ranges of numerics (for KPIs/charts).

## 2. Build a single dashboard page (KPIs + chart + table)
Goal: one page, several blocks, all bound to one query so they filter together.
```
create_resource { resource:"query", body:{ name, datasources:[{id:<ds>, alias:"datasource"}], sql_form:{columns:["*"]} } }   # -> query_id
create_block  { name:"KPIs",  json_data:{html:[…],isolated:false}, css:…, ui_queries:[{enabled:true,page_size:null,query_id:<q>,filter_strategy:{type:"blacklist",value:[]}}] }
create_block  { name:"Chart", json_data:{…}, css:…, ui_queries:[…same query…] }
create_block  { name:"Table", json_data:{…}, css:…, ui_queries:[…same query…] }
# place them (sequentially, or build the grid once):
update_resource { resource:"layout", id:<page>, body:{ json_data:{ …grid with blocks + block_layouts(lg/md/sm)… } } }
```
Compute KPIs/aggregations in block JS from `queryResults`, or in the query SQL for large data.

## 3. Cross-filtered multi-block page (native filters)
Goal: a dedicated **filter-bar** that refilters every other block. (Recipe 2 already binds blocks to one
query so they *can* filter together; this adds the interactive control + explicit re-render.)
- The filter bar is an authored **`html`** block (the typed tools make `html` blocks) — or use a native
  filter control (`selectFilter`/`multiselect`/`cascading-filter-group`) via `create_resource`. See [08].
- Bind every data block to the **same** query with `filter_strategy:{type:"blacklist",value:[]}`.
- Filter-bar block, on control change: `zPortal.dataSource.setFilters('region', [value])` (`[]` clears
  one column). A "Clear" button clears each column.
- Each data block derives its datasource id and re-renders on reload:
  ```js
  const DS_ID = currentBlock.queryResults?.[0]?.__source__ || (zPortal.dataSource.get()||[])[0]?.id;
  zPortal.dataSource.on('load', DS_ID, render);   // supported in 1.19 (logs a deprecation); re-read queryResults in render
  ```
Build `<select>` options from the first (unfiltered) load. See [08](08-zportal-in-block-api.md).

## 4. Executive hub + cross-page drill-down
Goal: a landing page whose cards open per-topic detail pages.
- Build the detail pages first (recipe 2/3), note their slugs (`industry-showcase-2`, …).
- The hub is a static block with `<a href="/p/<slug>">` cards (no JS needed → robust).
- To open a detail page **pre-filtered**, link `/p/<slug>?dim=value` and have the target page read
  `window.location.search` and `setFilters` on load.
- Use `&#36;` for any `$` in static card text (the `$compile` trap applies to markup too).

## 5. Restyle a page (house style or a brand)
- Default look: the [`design.md` system](06-design-system.md) is auto-applied to new blocks.
- One-off brand look: invoke the **`brand-design-systems`** skill ("make it look like Stripe"), then
  `update_block` each block's `css`/markup. **Omit `ui_queries` on `update_block`** or you'll wipe the
  data binding (see [04](04-authoring-blocks.md)). Keep colors on `var(--token, …)` so the theme wins.
- Global change: edit `assets/design.md` (or `PORTAL_DESIGN_FILE`), rebuild + restart. Note this only
  affects **newly authored/updated** blocks — existing blocks must be re-authored to restyle.

## 6. Write data back from a block (forms)
Goal: a block that inserts/updates a database.
```
# Admin-side (once): define a db_modification (saved parameterized SQL) — needs PORTAL_ALLOW_DATA_WRITES
create_resource { resource:"db_modification", body:{ … } }
# From a block: POST /api/db_modifications/run (see the db-modifications skill), or via the tool:
run_db_modification { name:"<mod>", params:{…}, confirm:true }     # params_list:[…] for bulk
```
Use the **`db-modifications`** skill for the in-block fetch pattern, transactions, and error handling.

## 7. Revert a bad change `[2.2.0]`
```
vc_log { resource:"block", id:<id> }                 # find the good commit
restore_resource { resource:"block", id:<id> }       # undo last change (omit ref)
# or: restore_resource { resource:"block", id:<id>, ref:"<hash>" }
```
Requires `PORTAL_VC_DIR` set and a prior `snapshot_portal`. See [07](07-version-control.md).

## 8. Seed / checkpoint the whole portal `[2.2.0]`
```
vc_status                                             # confirm VC is on
snapshot_portal { message:"baseline" }               # export all content + commit
# before a risky batch:
snapshot_portal { message:"before redesign" }
```

## 9. Bulk / templated authoring
Build one block well, confirm it renders, then replicate with per-target parameters (datasource id,
column names, labels, accent). Place each with `add_block_to_page` (sequentially) or assemble each
page's grid via `update_resource`. For many pages, drive it with a [loop](11-loops-and-automation.md).
