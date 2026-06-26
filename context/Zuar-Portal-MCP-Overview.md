# Zuar Portal MCP — Technical Overview

A [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) that exposes a Zuar Portal's full REST surface as typed tools, so any MCP-capable AI client (Claude Code, Claude Desktop, ChatGPT, etc.) can author and manage the portal in natural language. **v2.3.0 · Node ≥18 · ~3,235 LOC TypeScript · 2 runtime deps** (`@modelcontextprotocol/sdk`, `zod`).

## Architecture

```
AI client ──stdio/JSON-RPC──▶ MCP server ──HTTPS──▶ Zuar Portal
                              (32 tools)            /api/*  (main REST)
                                                    /auth/* (auth/WAF)
```

- **One server, two portal services** behind one base URL: content/data under `/api/*`, identity/security under `/auth/*`. The HTTP client takes a raw path, so a resource descriptor just spells out the full path including its service segment.
- **Auth flow** (`portalClient.ts`): first call does `GET /auth/login?api_key=…&user_id=…` → captures a JWT session cookie; every request forwards that cookie **plus** an `X-Api-Key` header. On a `401` it re-logs in once and retries. Session is module-scoped (one portal per process).
- **Full-replace safety**: portal `PUT`s replace the whole record, so updates **GET-then-merge** the caller's fields over the current record before writing — untouched fields are never nulled.

## Tool surface (32 tools, 4 groups)

| Group | Tools | Notes |
|-------|-------|-------|
| **Blocks** (typed + validated) | `list/get/create/update/delete_block`, `bind_block_query`, `add/remove_block_from_page` | Forced to `type:"html"`; validated before any portal call. `bind_block_query` auto-creates a `SELECT *` query and sets `ui_queries`. Page tools edit `layout.json_data.grid` across lg/md/sm. |
| **Resources** (generic CRUD) | `describe/list/get/create/update/delete_resource` | One tool set over a **declarative registry** of 16 types — layout, datasource, query, db_modification, partial, theme, snippet, translation, dashboard, tag, user, group, permission, access_policy, api_key, credential, system. Adding a resource is a data change, not new code. |
| **Actions** (non-CRUD) | `fetch_sample_rows`, `execute_query`, `run_db_modification`, `change_password`, `get/set_user_groups`, `get/set_user_permissions`, `get/update_me`, `get/update_config`, `get_version`, `get_rules` | Data preview, query execution, gated DB writes, user/security/config ops. |
| **Version control** | `vc_status`, `snapshot_portal`, `vc_log`, `restore_resource` | Git-backed history + revert (below). |

Also exposes **6 MCP resources** (`zportal://guide/*` — block structure, currentBlock, zPortal API, charting, conventions, design-system) and **1 prompt** (`create_zportal_block`).

## Write safety (layered, opt-in)

Every write is tagged with a risk **domain** and gated independently (`config.ts:blockReason`); a blocked write returns an actionable message and **never contacts the portal**.

| Domain | Covers | Default | Enable |
|--------|--------|---------|--------|
| `content` | blocks, layouts, themes, queries, partials, snippets, translations, dashboards, tags | **on** | — |
| `data` | datasources, db_modifications, `run_db_modification` | off | `PORTAL_ALLOW_DATA_WRITES=1` |
| `admin` | users, groups, permissions, policies, api_keys, credentials, system, config, passwords | off | `PORTAL_ALLOW_ADMIN_WRITES=1` |

`PORTAL_READONLY=1` disables all writes. `run_db_modification` additionally requires `confirm:true`. Destructive ops carry `destructiveHint` annotations for the client.

## Block authoring rules (validation)

`rules.ts:validateBlock` inspects a block payload **before** it's sent and splits violations into **errors (hard-reject)** vs **warnings (save + report)**; severities are configurable (`assets/rules.json` or `PORTAL_BLOCK_RULES_FILE`). 17 rules cover structure (no `<style>`/`<doctype>` in the HTML section), safety (no `eval`/`new Function`/`document.write`, no external `<script src>`), the AngularJS literal-`$` `$compile` trap (`no_raw_dollar`, hard error), and authoring conventions (top-level config, DEBUG toggle, `init()`/IIFE, async loaded-callback, `ui_queries` binding, theme variables). Only rules whose input is present are checked, so partial updates aren't penalized.

## Version control (optional)

When `PORTAL_VC_DIR` points at a git repo, every **content** write is mirrored as pretty JSON at `<kind>/<id>.json` and auto-committed — best-effort, so git/FS failures never break the underlying portal write. `restore_resource` reverts a record to the prior commit (or a named hash); `snapshot_portal` seeds full history. Optional push to a remote with config-driven HTTPS-token auth (token applied as a git auth header, redacted from all logs).

## Configuration & build

- **Credentials**: env-first (`PORTAL_URL` / `PORTAL_API_KEY` / `PORTAL_USER_ID`), else a `config.json` `portal` section. Secrets never logged; `PORTAL_DEBUG=1` logs to **stderr only** (stdout is reserved for JSON-RPC framing).
- **Distribution**: a one-click `.mcpb` Desktop bundle (config via install dialog) *and* the clone/`npx` path for any MCP client.
- **Source layout**: `index.ts` (entry) · `server.ts` (tools/resources/prompts) · `portalClient.ts` (auth+request) · `resources.ts` (registry+CRUD) · `rules.ts` (validation) · `portalVc.ts` (git) · `guidance.ts`/`design.ts`/`config.ts`.
