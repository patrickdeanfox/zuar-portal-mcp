# 03 · Tools Reference

All 40 tools, grouped by purpose. Each is tagged with its **risk domain** — see
[02 · write-safety domains](02-install-and-config.md#write-safety-domains-important).

**Domain legend:** 🟢 read (always available) · 🔵 content (on by default) · 🟠 data
(`PORTAL_ALLOW_DATA_WRITES=1`) · 🔴 admin (`PORTAL_ALLOW_ADMIN_WRITES=1`). `PORTAL_READONLY=1` blocks
all non-read tools.

> **Tool gating `[2.5.0]`.** Beyond write-safety, an install can drop whole **groups of tools** (or
> individual tools) from the surface entirely — see
> [02 · Tool gating](02-install-and-config.md#tool-gating-capability-scoping). `get_capabilities`
> reports what's enabled and is always available.

> **`confirm:true` on destructive writes `[2.5.0]`.** `delete_block`, `delete_resource`,
> `set_user_groups`, `set_user_permissions`, `set_page_blocks` (only when `replace=true`), and
> `run_db_modification` require an explicit `confirm:true` — a missing/false `confirm` is rejected before
> any write.

> **Error envelope `[2.5.0]`.** A failed call returns a structured envelope in `structuredContent`:
> `{ error, http_status, retriable, is_auth }` alongside the human-readable message — so a caller can
> branch on auth failures vs. retriable transient errors without parsing text.

---

## Connectivity & discovery
| Tool | Dom | Description |
|------|-----|-------------|
| `get_version` | 🟢 | Portal version + about. Confirms connectivity; gate version-specific features (saved queries are 1.18+). No args. |
| `get_me` | 🟢 | The authenticated user's profile (`/auth/me`). No args. |
| `get_config` | 🟢 | The portal config document. No args. |
| `get_rules` | 🟢 | Active authoring rules: per-rule severities + the conventions text. No args. See [05](05-authoring-rules.md). |
| `suggest_name` `[2.7.0]` | 🟢 | `kind`, `scope?`, `subject?`, `qualifier?`, `source?` `[2.8.0]` → a convention display name + slug + facet tags. Resource kinds (datasource/query/page/…) drop the kind word; `source` adds a data-asset facet (sample/live/telemetry/curated/reference). See [17](17-naming-convention.md). |
| `parse_name` `[2.7.0]` | 🟢 | `name` → `{scope, kind, subject, slug, conforms}`. Grade or audit an existing name. See [17](17-naming-convention.md). |
| `describe_resource` | 🟢 | `resource?` → fields, required-to-create, verbs, risk domain for one resource; omit `resource` to list every resource type. Call before create/update_resource. |
| `get_capabilities` `[2.5.0]` | 🟢 | Reports enabled tool groups/tools, write-safety posture, config source, and version-control + audit status. **Always available** — survives tool gating. Secrets redacted. No args. |

---

## Project configuration `[2.4.0]`
Resolve and write the per-project portal/VC config — see
[02 · Per-project configuration](02-install-and-config.md#per-project-configuration-multiple-portals).

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `active_config` | 🟢 | — | Resolved project config path, active portal URL + user, and VC status. **All secrets redacted.** |
| `init_project_config` | 🟢¹ | `portal_url`, `api_key`, `user_id` (required); `vc_dir?`, `vc_push?`, `vc_remote?`, `vc_remote_url?`, `vc_token?`, `vc_username?`; `overwrite?` (default false), `validate?` (default true) | Writes `./.zuar-portal/config.json` + a `.gitignore`, then validates the credentials via a **live login**. Refuses to overwrite an existing config unless `overwrite=true`. **Never echoes secrets.** |
| `setup_portal` | 🟢¹ | all of the above, **all optional**; plus `setup_github?`, `validate_github?` (default true) | **Guided** variant of `init_project_config`. PROMPTS for any missing field via MCP **elicitation** (portal creds, then an optional GitHub VC repo), validates the portal with a live login **and** the GitHub token/repo against the GitHub API, then writes the config. Falls back to an actionable message when the client can't elicit (pass the fields as args). **Never echoes secrets.** |

> ¹ `init_project_config` / `setup_portal` are **local setup** writes — they create a file on disk, not a
> portal change, so they aren't gated by the content/data/admin domains (and run under `PORTAL_READONLY` too).
> Elicitation requires the connected MCP client to advertise the capability; otherwise `setup_portal` degrades
> to argument-only operation.

---

## Generic resources (CRUD over the registry)
Operate over the 17 resource types (layouts, queries, themes, datasources, users, …). Run
`describe_resource` first to learn a resource's fields and domain.

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `list_resource` | 🟢 | `resource`, `query?` (url params, e.g. `{only_names:true}`), `limit?` (max 500), `offset?`, `only_names?` `[2.5.0]` | Discovery — find a UUID before authoring. `limit`/`offset` page the results; `only_names` returns a client-side `{id,name}` projection (**reliable regardless of portal support**). **Back-compat:** with no pagination args the raw portal response is returned unchanged. Large lists may exceed the token limit and dump to a file. |
| `get_resource` | 🟢 | `resource`, `id` | One record by id (or name, for tags). |
| `create_resource` | 🔵/🟠/🔴 | `resource`, `body` | Domain = the resource's domain. Unknown body fields dropped. **Structure + reference checked before write `[2.6.0]`.** |
| `update_resource` | 🔵/🟠/🔴 | `resource`, `id`, `body` | PUT is full-replace; the server fetches + merges your fields over the current record so untouched fields survive. Refuses to demote/remove the last admin or your own account (user resource) `[2.6.0]`. |
| `delete_resource` | 🔵/🟠/🔴 | `resource`, `id`, **`confirm`**, `force?` | Requires `confirm:true` `[2.5.0]`. Refuses to orphan dependents — pass `force:true` to override — and to remove the last admin / your own account `[2.6.0]`. Cannot be undone on the portal (but VC keeps the last committed copy `[2.2.0]`). |
| `validate_portal` | 🟢 | `limit?` | **Read-only integrity sweep `[2.6.0]`** — reports malformed records, dangling references, unscoped mass-write SQL, and **datasource hygiene `[2.8.0]`** (a name leaking a connection-string/password → `secret_in_name`; a datasource reporting a broken connection → `datasource_error`) across the whole portal. Fixes nothing. See [16 · Safety & Integrity Gates](16-safety-and-integrity.md). |

> Content-domain creates/updates/deletes — **and datasources `[2.8.0]`** — are auto-committed to
> version control `[2.2.0]`. Every content write also passes a structural + referential safety gate
> `[2.6.0]` — see [doc 15](15-structural-integrity.md) and [doc 16](16-safety-and-integrity.md).

**Example — create a saved query (SELECT \* over a datasource):**
```json
create_resource { "resource": "query", "body": {
  "name": "Sales — all rows",
  "datasources": [{ "id": "<datasource-uuid>", "alias": "datasource" }],
  "sql_form": { "columns": ["*"] }
}}
```

**Example — a modeled / joined query (the semantic layer):** a query can reference **multiple**
datasources by alias and join them in `raw_sql`. The portal injects each as a CTE, so `raw_sql` must be
a single SELECT with **no leading `WITH`** (use derived subqueries to pre-aggregate). See
[18 · Data Modeling](18-data-modeling.md).
```json
create_resource { "resource": "query", "body": {
  "name": "DW · Sales by Category",
  "datasources": [
    { "id": "<fact_sales_order_line-uuid>", "alias": "sol" },
    { "id": "<dim_product-uuid>", "alias": "p" }
  ],
  "raw_sql": "SELECT p.category, sum(sol.quantity*sol.unit_price) AS net_revenue FROM sol JOIN p ON sol.product_id=p.product_id GROUP BY 1 ORDER BY net_revenue DESC",
  "default_params": []
}}
```

---

## Blocks (typed + validated authoring)
See [04 · Authoring Blocks](04-authoring-blocks.md) for the full model.

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `list_blocks` | 🟢 | `block_ids?`, `only_names?`, `limit?` (max 500), `offset?` `[2.5.0]` | List blocks (optionally filtered / names-only). `limit`/`offset` page the results; `only_names` is a client-side `{id,name}` projection. **Back-compat:** no pagination args → raw portal response unchanged. |
| `get_block` | 🟢 | `block_id` | Full block incl. `json_data.html`, `css`, `ui_queries`. Large blocks dump to a file. |
| `create_block` | 🔵 | `name`, `json_data` (`{html:[…], isolated}`), `css?`, `ui_queries?`, `tags?`, `access?` | Type is always `html`. Runs `validateBlock` — **errors hard-reject**, warns are returned. Auto-committed `[2.2.0]`. |
| `update_block` | 🔵 | `block_id`, plus any of `name/css/json_data/ui_queries/tags/access` | Field-level merge: fields you **omit are preserved**, a field you **pass is replaced wholesale** (not array-merged). So **omit `ui_queries` to keep the binding;** pass `[]` to unbind. Validated + auto-committed `[2.2.0]`. |
| `delete_block` | 🔵 | `block_id`, **`confirm`**, `force?` | Deletes the block object — requires `confirm:true` `[2.5.0]`. Refuses if the block is placed on any page/partial — pass `force:true` to override `[2.6.0]`. VC keeps the last copy `[2.2.0]`. |
| `bind_block_query` | 🔵 | `block_id`, + `query_id` **or** `datasource_id` (+ `sql?`), `page_size?` | One-step binding. With `datasource_id` it auto-creates a `SELECT *` query (use `sql` to customize). `page_size` omitted = **null = all rows** (preferred). The query must have a datasource. |
| `validate_block` `[2.4.0]` | 🟢 | `name?`, `data?`, `css?`, `json_data?`, `ui_queries?` | Runs the **same authoring rules** as create/update_block **without writing**; returns `{ valid, errors, warnings, summary }`. Iterate a block until clean — catches the literal-`$` trap, `{{ }}` interpolation, data polling, and unscoped CSS. |

**Example — create + bind + place a block:**
```
create_block { name, json_data:{html:["<div class='wrapper'>…</div><script>(function(){…})();</script>"], isolated:false}, css:"…" }
bind_block_query { block_id:"<id>", datasource_id:"<ds>" }     # or query_id
add_block_to_page { layout_id:"<page>", block_id:"<id>", position:{left:0,top:0,width:100,height:20} }
```

---

## Pages (block placement on a layout grid)
| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `add_block_to_page` | 🔵 | `layout_id`, `block_id`, `position?`, `height?` | Inserts into `grid.blocks` + `block_layouts.{lg,md,sm}`. `position` is one box `{left,top,width,height}` (units %) applied to all breakpoints, or per-breakpoint `{lg,md,sm}`. Omit to stack full-width. Idempotent. |
| `remove_block_from_page` | 🔵 | `layout_id`, `block_id` | Removes from the grid (block object kept). Idempotent. |
| `set_page_blocks` `[2.4.0]` | 🔵 | `layout_id`, `blocks: [{ block_id, position?, height? }]`, `replace?`, `confirm?` | Places several blocks in **one atomic read-modify-write** — avoids the lost-update race from parallel `add_block_to_page`. `replace=true` rebuilds the page's grid and **requires `confirm:true`** `[2.5.0]`. |

> All three edit the **layout**, so they're auto-committed as a `layout` change `[2.2.0]`.
> ⚠️ Don't call `add_block_to_page` in **parallel** for the same page — each is read-modify-write and
> concurrent calls race. Place sequentially, use `set_page_blocks` for a batch, or build the full
> `grid` once via `update_resource`.

---

## Data exploration & data writes
| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `fetch_sample_rows` | 🟢 | `datasource_id`, `limit?` (default 5, max 50) | Peek real columns + values before authoring. |
| `execute_query` | 🟢 | `query_id`, `params?` ({name:value}), `limit?` `[2.4.0]` | Run a saved query; returns `columns` + positional `data`. Read-only. `limit` truncates the returned rows for cheap exploration — the response is annotated when truncated. |
| `profile_datasource` `[2.4.0]` | 🟢 | `datasource_id`, `sample_size?` (default 500, max 5000), `distinct_cap?` (default 100) | Per-column stats: inferred type, non-null/empty counts, distinct count, sample distinct values (categoricals), min/max (numerics). For designing filters + charts. |
| `run_db_modification` | 🟠 | `name`, `params?` / `params_list?` (bulk), `autocommit?`, `ignore_sql_errors?`, **`confirm`**, `allow_unfiltered?` | Executes a saved INSERT/UPDATE/DELETE. Requires `PORTAL_ALLOW_DATA_WRITES=1` **and** `confirm:true`. Refuses an unscoped mass write (UPDATE/DELETE without WHERE, TRUNCATE, DROP) unless `allow_unfiltered:true` `[2.6.0]`. |

---

## Users, profile & config (admin)
| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `get_user_groups` | 🟢 | `user_id` | A user's groups. |
| `set_user_groups` | 🔴 | `user_id`, `group_ids[]`, **`confirm`** | Full replace of membership — requires `confirm:true` `[2.5.0]`. |
| `get_user_permissions` | 🟢 | `user_id` | A user's permissions. |
| `set_user_permissions` | 🔴 | `user_id`, `permission_ids[]`, **`confirm`** | Full replace — requires `confirm:true` `[2.5.0]`. |
| `update_me` | 🔴 | profile fields | Update the current user's profile. |
| `change_password` | 🔴 | `old_password`, `new_password` | Never logged/echoed. |
| `update_config` | 🔴 | `path`, `value`, `merge?` | Set a config value by path. |

> `create_resource`/`update_resource`/`delete_resource` also cover `user`, `group`, `permission`,
> `access_policy`, `api_key`, `credential`, `system` (all 🔴) and `datasource`, `db_modification`
> (both 🟠).

---

## Version control `[2.2.0]`
Enabled by `PORTAL_VC_DIR`. See [07 · Version Control](07-version-control.md).

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `vc_status` | 🟢 | — | Is VC on, repo path, push config. |
| `snapshot_portal` | 🔵 | `message?` | Export **all content** (blocks + layouts/queries/themes/partials/snippets/translations/dashboards/tags) **and datasources `[2.8.0]`** to the repo and commit. Run once to seed; anytime to checkpoint. (Admin resources — users/groups/credentials — are never snapshotted; they can carry secrets.) |
| `vc_log` | 🟢 | `resource?`, `id?`, `limit?` | Recent commits, optionally for one record. Returns hashes for `restore_resource`. |
| `restore_resource` | 🔵 | `resource` (`block` or a content key), `id`, `ref?` | Revert a record to a prior committed version and write it back. Omit `ref` = undo the last change to that record. The restore is itself committed. |

---

## Prompt
| Name | Args | Purpose |
|------|------|---------|
| `create_zportal_block` | `goal`, `datasource_hint?` | A guided authoring workflow: read the `zportal://guide/*` resources, discover the datasource, then build a correct two-field block. |

## Read-only resources (knowledge, not tools)
The server also exposes `zportal://guide/*` resources the model reads while authoring:
`block-structure`, `currentblock`, `zportal-api`, `charting`, `conventions` (active rules), and
`design-system` `[2.2.0]`. See [08](08-zportal-in-block-api.md) and [06](06-design-system.md).
