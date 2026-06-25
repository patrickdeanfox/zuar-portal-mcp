# Zuar Portal MCP — Coverage Analysis & Development Plan

> **Status (v2.0.0): Phases 0–4 implemented.** Foundations (`src/config.ts` safety model, `src/resources.ts` registry + generic CRUD), generic + action tools (`src/server.ts`), and docs/manifest are done. All ten named areas plus Phase-4 extras are reachable. **Remaining before release:** live verification against a real portal (the §8 round-trips), and the two §2 confirmations (auth mount point, PUT-is-replace per resource). The plan below is retained as the design record.



_Analysis date: 2026-06-25. Sources: `portal_swagger_docs.json` (main REST API, Swagger 2.0, "ZUAR Embedded Analytics"), `portal_swagger_auth_docs.json` (auth service, OpenAPI 3.1, "ZUAR WAF — Authentication"), and `src/*.ts`._

## 1. Executive summary

The server today is a **blocks-only tool**. It has full CRUD for HTML blocks plus read-only discovery for datasources, queries, and layouts. Of the ten resource areas you named — blocks, pages/layouts, users, passwords, data sources, queries, db modifications, partials, themes — only **blocks** is fully covered. Two are partial (layouts, datasources/queries) and five are absent (users, passwords, db_modifications, partials, themes).

The good news: the HTTP client is already capable of reaching every endpoint with no rearchitecture. `request(method, path, body)` takes a raw path against the configured base URL, so `/api/*` and `/auth/*` both work today (login already uses `/auth/login`). The work is **additive tool surface + safety controls + a few generalized helpers**, not a rewrite.

Confidence: **high** on the coverage matrix and endpoint paths (read directly from the two swagger files). **Medium** on exact request-body shapes for write endpoints — Swagger 2.0 `$ref` schemas are clear, but several bodies are loosely typed (`json_data: ?`), so live verification against your portal is required before shipping write tools.

## 2. Two services, two base paths (critical)

| Service | Base | Spec | Resources |
|---|---|---|---|
| Main REST API | `{PORTAL_URL}/api` | Swagger 2.0 | blocks, layouts, datasources, queries, db_modifications, partials, themes, credentials, tags, snippets, translations, dashboards, config, content-packs, system |
| Auth (WAF) | `{PORTAL_URL}/auth` | OpenAPI 3.1 | users, passwd, reset/forgot-password, groups, permissions, api_keys, access_policies, asset_manager, subscriptions, me |

The auth swagger lists paths **without** the `/auth` prefix (e.g. `/users`, `/passwd`), but `rest-api.md` and the working `/auth/login` confirm the real prefix is `/auth`. **Action item / open question:** confirm the live mount point for each auth resource before building (`/auth/users` vs `/api/users` — main swagger has no `users` path, so `/auth/users` is the strong assumption).

## 3. Coverage matrix — the ten requested areas

Legend: ✅ full · ⚠️ partial · ❌ missing

| Area | Endpoints (verbs) | Current tools | Status |
|---|---|---|---|
| **Blocks** | `/api/blocks` (GET, POST) · `/api/blocks/{id}` (GET, PUT, DELETE) | list_blocks, get_block, create_block, update_block, delete_block | ✅ |
| **Pages / Layouts** | `/api/layouts` (GET, POST) · `/api/layouts/{id}` (GET, PUT, DELETE) | list_layouts, get_layout | ⚠️ no create/update/delete |
| **Data sources** | `/api/datasources` (GET, POST) · `/{id}` (GET, PUT, DELETE) · `/{id}/data` (GET, POST) | list_datasources, fetch_sample_rows | ⚠️ no get/create/update/delete |
| **Queries** | `/api/queries` (GET, POST) · `/{id}` (GET, PUT, DELETE) · `/{id}/execute` · `/execute` · `/execute-datasources` · `/parse-params` | list_queries | ⚠️ list only |
| **DB modifications** | `/api/db_modifications` (GET, POST) · `/run` (POST) · `/{id_or_name}` (GET) · `/{id}` (PUT, DELETE) | — | ❌ |
| **Partials** | `/api/partials` (GET, POST) · `/{id}` (GET, PUT, DELETE) | — | ❌ |
| **Themes** | `/api/themes` (GET, POST) · `/{id}` (GET, PUT, DELETE) | — | ❌ |
| **Users** | `/auth/users` (GET, POST) · `/{id}` (GET, PUT, DELETE) · `/{id}/groups` · `/{id}/permissions` | — | ❌ |
| **Passwords** | `/auth/passwd` (POST) · `/auth/reset-password` (GET, POST) · `/auth/forgot-password` (GET, POST) | — | ❌ |

Note: `manifest.json` and `README.md` advertise 8 tools but `server.ts` actually registers 11 (adds `list_layouts`, `get_layout`, `get_rules`). The manifest/README are stale and must be regenerated whenever the tool surface changes — fold this into the build step.

## 4. Write-body schemas (from swagger, for tool input design)

These drive the input schemas of the new write tools. `?` = loosely typed in spec; verify live.

- **Block** `POST /api/blocks` → `name*`, `type*`, `css`, `json_data`, `ui_queries[]`, `tags`, `access` _(server forces `type=html`)_
- **Layout** `POST /api/layouts` → `name*`, `user_id`, `order`, `icon`, `json_data` (holds `grid`), `tags`, `access`
- **Datasource** `POST /api/datasources` → `name*`, `sql`, `json_data`, `tags`, `default_params[]`, `database_connection`
- **Query** `POST /api/queries` → `name`, `datasources[]`, `default_params[]`, `raw_sql`, `sql_form`
- **DB modification** `POST /api/db_modifications` → `name*`, `sql*`, `credentials_id`, `default_params`, `access`
- **Partial** `POST /api/partials` → `name*`, `json_data`
- **Theme** `POST /api/themes` → `name*`, `user_id`, `json_data`, `access`
- **User** `POST /auth/users` (`CreateUserRequest`) → `username*`, `fullname*`, `password*`, `email`, `admin`, `source`
- **User update** `PUT /auth/users/{id}` (`UpdateUserRequest`) → all optional: `username`, `fullname`, `password`, `email`, `admin`
- **Change password** `POST /auth/passwd` (`ChangePasswordRequest`) → `old_password*`, `new_password*`

## 5. Architectural gaps to address before scaling tools

1. **PUT is full-replace.** `update_block` already works around this by fetching the existing record and merging provided fields over it. Layouts, datasources, queries, themes, and partials almost certainly behave the same way. **Generalize the fetch-merge-PUT into one reusable helper** (`mergeUpdate(resourcePath, id, patch, requiredFields)`) instead of copy-pasting the block logic per resource. _Verify per-endpoint that PUT is replace, not patch._
2. **No write safety model.** Block writes are low-risk; user/password/db_modification/datasource writes are not. Add:
   - A global `PORTAL_READONLY=1` env flag that disables all write tools.
   - Optional per-domain enable flags (e.g. `PORTAL_ALLOW_USER_WRITES`, `PORTAL_ALLOW_DB_MODS`) defaulting to **off** for the dangerous domains.
   - Accurate `destructiveHint: true` on every delete and on password/user mutations.
   - A confirm/dry-run gate for `run_db_modification` (it executes arbitrary SQL) and for SQL-bearing creates.
3. **Validation is block-specific.** `rules.ts`/`validateBlock` only understands blocks. Add light, per-resource guards (require `sql` on db_modifications, `name` on most creates, surface but don't block on SQL writes). Keep the rules engine extensible rather than special-casing in each tool.
4. **Tool-count explosion.** Ten resources × ~5 verbs ≈ 50 tools. Decide the surface strategy now (see §7, open decision). Recommend typed convenience tools for the common verbs (list/get/create/update/delete) per resource, plus a small number of action tools (execute_query, run_db_modification), rather than one generic passthrough.
5. **Capability/version gating.** `list_queries` already handles the pre-1.18 404 gracefully. Generalize this: probe `/api/version` + `/api/about` (and `/auth/about`) once, cache it, and let tools degrade cleanly on portals that lack an endpoint.
6. **Manifest/README drift.** Auto-generate the `tools` array in `manifest.json` and the README table from a single source of truth so they can't go stale again.

## 6. Proposed tool surface (priority = the ten named areas)

Naming follows the existing convention (`list_/get_/create_/update_/delete_<resource>`).

**Layouts (pages)** — add `create_layout`, `update_layout`, `delete_layout` (list/get exist). Guard: layout `json_data.grid` references block IDs; update must merge, not clobber.

**Datasources** — add `get_datasource`, `create_datasource`, `update_datasource`, `delete_datasource`. Keep `fetch_sample_rows`. Creates carry SQL → treat as elevated.

**Queries** — add `get_query`, `create_query`, `update_query`, `delete_query`, `execute_query` (`POST /{id}/execute` and ad-hoc `/execute`). This is the 1.18+ path that supersedes raw datasource reads.

**DB modifications** — add `list_db_modifications`, `get_db_modification`, `create_db_modification`, `update_db_modification`, `delete_db_modification`, `run_db_modification`. `run` is the highest-risk tool in the whole server — gate behind explicit enable + confirm.

**Partials** — add `list_partials`, `get_partial`, `create_partial`, `update_partial`, `delete_partial`.

**Themes** — add `list_themes`, `get_theme`, `create_theme`, `update_theme`, `delete_theme`.

**Users** — add `list_users`, `get_user`, `create_user`, `update_user`, `delete_user`, plus `set_user_groups` / `set_user_permissions` (`/users/{id}/groups`, `/users/{id}/permissions`). Elevated; off by default.

**Passwords** — add `change_password` (`/auth/passwd`), and optionally `request_password_reset` / `forgot_password`. Never log credentials; mark sensitive.

## 7. Phased roadmap

**Phase 0 — Foundations (do first, unblocks everything).**
Generalize `mergeUpdate` helper; add the read-only/write-enable safety flags and `destructiveHint` plumbing; add version/capability probe; make manifest+README generated. Verify the `/auth/*` mount point live. Verify PUT-is-replace on one non-block resource.

**Phase 1 — Read-everything.**
Add `get_*`/`list_*` for datasources, queries, db_modifications, partials, themes, users (no writes). Low risk, immediately useful, validates auth-service paths and response shapes.

**Phase 2 — Safe content writes.**
create/update/delete for layouts, partials, themes, queries. These are content objects analogous to blocks. Reuse the block merge + validation patterns.

**Phase 3 — Elevated writes (gated).**
datasources (SQL), db_modifications + run, users, passwords. Each behind an explicit enable flag and confirm/dry-run. Heaviest test + review burden.

**Phase 4 — "Fully featured" extras (the "etc").**
credentials, tags, snippets, translations, dashboards, config, content-packs, groups/permissions/access_policies/api_keys, asset_manager, system. Prioritize by your actual workflows.

## 8. Verification & testing plan

- Extend `test-harness.mjs` with a live smoke test per new tool against a scratch portal: create → get → update → delete round-trips, asserting field round-trips and that merge-update doesn't null untouched fields.
- For `run_db_modification`, test with a no-op/SELECT and confirm the confirm-gate blocks accidental execution.
- Negative tests: read-only mode rejects every write; disabled-domain flag rejects that domain's writes; pre-1.18 portal degrades gracefully.
- Regenerate and diff `manifest.json` to catch surface drift in CI.

## 9. Open decisions (need your input)

1. **Tool granularity:** ~50 typed tools (recommended, best model ergonomics) vs. fewer generic resource tools (`portal_read`/`portal_write` with a `resource` arg). Tradeoff: discoverability/safety vs. tool-list size.
2. **Scope of v2:** ship all ten named areas, or stop after content objects (layouts/partials/themes/queries/datasources) and defer users/passwords/db_mods to a separately-gated release?
3. **Default safety posture:** ship dangerous-domain writes **off by default** (recommended) and require opt-in env flags?
4. **Server identity:** keep "Blocks"-named single server, or rebrand to "Zuar Portal" and split into block/admin servers so admin/credential tools can be installed separately?

---

### Appendix — full main-API endpoint inventory (for Phase 4 scoping)
`/about` · `/version` · `/config` · `/blocks` · `/layouts` · `/datasources` (+`/data`) · `/queries` (+`/execute`, `/execute-datasources`, `/parse-params`, `/{id}/execute`) · `/db_modifications` (+`/run`) · `/partials` · `/themes` · `/credentials` (+`/credentials_types`) · `/dashboards` · `/snippets` · `/tags` · `/translations` · `/system` · `/content-packs` (+builder/entities/packs/sync/import/preview) · `/events` · `/thoughtspot_ts`

### Appendix — full auth-service endpoint inventory
`/login` · `/logout` · `/me` · `/users` (+`/groups`,`/permissions`) · `/passwd` · `/reset-password` · `/forgot-password` · `/groups` (+`/permissions`) · `/permissions` · `/access_policies` · `/api_keys` · `/asset_manager` (files/ls/copy/move/search) · `/subscriptions` · `/subscriptions_ng` · `/scim/v2/{Users,Groups,Schemas}` · `/saml/{sso,slo}` · `/openidc/{authorize,redirect}` · `/tableau/*` · `/aad_token` · `/signed` · `/vaulted`
