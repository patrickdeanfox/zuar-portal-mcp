# 03 · Tools Reference

All 37 tools, grouped by purpose. Each is tagged with its **risk domain** — see
[02 · write-safety domains](02-install-and-config.md#write-safety-domains-important).

**Domain legend:** 🟢 read (always available) · 🔵 content (on by default) · 🟠 data
(`PORTAL_ALLOW_DATA_WRITES=1`) · 🔴 admin (`PORTAL_ALLOW_ADMIN_WRITES=1`). `PORTAL_READONLY=1` blocks
all non-read tools.

---

## Connectivity & discovery
| Tool | Dom | Description |
|------|-----|-------------|
| `get_version` | 🟢 | Portal version + about. Confirms connectivity; gate version-specific features (saved queries are 1.18+). No args. |
| `get_me` | 🟢 | The authenticated user's profile (`/auth/me`). No args. |
| `get_config` | 🟢 | The portal config document. No args. |
| `get_rules` | 🟢 | Active authoring rules: per-rule severities + the conventions text. No args. See [05](05-authoring-rules.md). |
| `describe_resource` | 🟢 | `resource?` → fields, required-to-create, verbs, risk domain for one resource; omit `resource` to list every resource type. Call before create/update_resource. |

---

## Project configuration `[2.4.0]`
Resolve and write the per-project portal/VC config — see
[02 · Per-project configuration](02-install-and-config.md#per-project-configuration-multiple-portals).

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `active_config` | 🟢 | — | Resolved project config path, active portal URL + user, and VC status. **All secrets redacted.** |
| `init_project_config` | 🟢¹ | `portal_url`, `api_key`, `user_id` (required); `vc_dir?`, `vc_push?`, `vc_remote?`, `vc_remote_url?`, `vc_token?`, `vc_username?`; `overwrite?` (default false), `validate?` (default true) | Writes `./.zuar-portal/config.json` + a `.gitignore`, then validates the credentials via a **live login**. Refuses to overwrite an existing config unless `overwrite=true`. **Never echoes secrets.** |

> ¹ `init_project_config` is a **local setup** write — it creates a file on disk, not a portal change,
> so it isn't gated by the content/data/admin domains (and runs under `PORTAL_READONLY` too).

---

## Generic resources (CRUD over the registry)
Operate over the 17 resource types (layouts, queries, themes, datasources, users, …). Run
`describe_resource` first to learn a resource's fields and domain.

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `list_resource` | 🟢 | `resource`, `query?` (url params, e.g. `{only_names:true}`) | Discovery — find a UUID before authoring. Large lists may exceed the token limit and dump to a file. |
| `get_resource` | 🟢 | `resource`, `id` | One record by id (or name, for tags). |
| `create_resource` | 🔵/🟠/🔴 | `resource`, `body` | Domain = the resource's domain. Unknown body fields dropped. |
| `update_resource` | 🔵/🟠/🔴 | `resource`, `id`, `body` | PUT is full-replace; the server fetches + merges your fields over the current record so untouched fields survive. |
| `delete_resource` | 🔵/🟠/🔴 | `resource`, `id` | Cannot be undone on the portal (but VC keeps the last committed copy `[2.2.0]`). |

> Content-domain creates/updates/deletes are auto-committed to version control `[2.2.0]`.

**Example — create a saved query (SELECT \* over a datasource):**
```json
create_resource { "resource": "query", "body": {
  "name": "Sales — all rows",
  "datasources": [{ "id": "<datasource-uuid>", "alias": "datasource" }],
  "sql_form": { "columns": ["*"] }
}}
```

---

## Blocks (typed + validated authoring)
See [04 · Authoring Blocks](04-authoring-blocks.md) for the full model.

| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `list_blocks` | 🟢 | `block_ids?`, `only_names?` | List blocks (optionally filtered / names-only). |
| `get_block` | 🟢 | `block_id` | Full block incl. `json_data.html`, `css`, `ui_queries`. Large blocks dump to a file. |
| `create_block` | 🔵 | `name`, `json_data` (`{html:[…], isolated}`), `css?`, `ui_queries?`, `tags?`, `access?` | Type is always `html`. Runs `validateBlock` — **errors hard-reject**, warns are returned. Auto-committed `[2.2.0]`. |
| `update_block` | 🔵 | `block_id`, plus any of `name/css/json_data/ui_queries/tags/access` | Field-level merge: fields you **omit are preserved**, a field you **pass is replaced wholesale** (not array-merged). So **omit `ui_queries` to keep the binding;** pass `[]` to unbind. Validated + auto-committed `[2.2.0]`. |
| `delete_block` | 🔵 | `block_id` | Deletes the block object. VC keeps the last copy `[2.2.0]`. |
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
| `set_page_blocks` `[2.4.0]` | 🔵 | `layout_id`, `blocks: [{ block_id, position?, height? }]`, `replace?` | Places several blocks in **one atomic read-modify-write** — avoids the lost-update race from parallel `add_block_to_page`. `replace=true` rebuilds the page's grid. |

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
| `run_db_modification` | 🟠 | `name`, `params?` / `params_list?` (bulk), `autocommit?`, `ignore_sql_errors?`, **`confirm`** | Executes a saved INSERT/UPDATE/DELETE. Requires `PORTAL_ALLOW_DATA_WRITES=1` **and** `confirm:true`. |

---

## Users, profile & config (admin)
| Tool | Dom | Params | Notes |
|------|-----|--------|-------|
| `get_user_groups` | 🟢 | `user_id` | A user's groups. |
| `set_user_groups` | 🔴 | `user_id`, `group_ids[]` | Full replace of membership. |
| `get_user_permissions` | 🟢 | `user_id` | A user's permissions. |
| `set_user_permissions` | 🔴 | `user_id`, `permission_ids[]` | Full replace. |
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
| `snapshot_portal` | 🔵 | `message?` | Export **all content** (blocks + layouts/queries/themes/partials/snippets/translations/dashboards/tags) to the repo and commit. Run once to seed; anytime to checkpoint. |
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
