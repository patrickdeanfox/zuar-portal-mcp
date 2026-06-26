# 01 · Overview

## What it is
`zuar-portal-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a
Zuar Portal's REST surface to an MCP client (Claude Desktop, Claude Code, etc.). It turns "build me a
sales dashboard" into the right sequence of authenticated API calls — discovering datasources, writing
a saved query, authoring a validated HTML block, binding it, and placing it on a page — while keeping
guardrails around what can be written and a revertible history of what changed.

## Architecture at a glance

```
MCP client (Claude)
      │  JSON-RPC over stdio
      ▼
src/index.ts ──► buildServer()  (src/server.ts)
      │
      ├─ Block tools        (typed + validated authoring)        ── validateBlock (src/rules.ts)
      ├─ Resource tools      (generic CRUD over a registry)       ── src/resources.ts
      ├─ Action tools        (query/exec/users/config/version)
      ├─ Version-control tools  [2.2.0]                           ── src/portalVc.ts
      ├─ Resources           (zportal://guide/* authoring guides) ── src/guidance.ts + design.ts + rules.ts
      └─ Prompt              (create_zportal_block guided flow)
      │
      ▼
src/portalClient.ts  ──►  Zuar Portal HTTP API   (/api + /auth)
```

Every write also passes through two cross-cutting layers:
- **Write safety** (`src/config.ts`): each tool is tagged `content` / `data` / `admin`; a domain must
  be enabled before its writes are allowed. See [02 · Install & Configuration](02-install-and-config.md).
- **Version control** `[2.2.0]` (`src/portalVc.ts`): each successful **content** write is mirrored to a
  git repo and committed. See [07 · Version Control](07-version-control.md).

## The tool groups
| Group | Source | Purpose |
|-------|--------|---------|
| Block tools | `server.ts` | Author/validate HTML blocks, bind data, place on pages |
| Resource tools | `server.ts` + `resources.ts` | Generic list/get/create/update/delete over 17 resource types |
| Action tools | `server.ts` | Non-CRUD ops: run queries, sample rows, db writes, users, config, version |
| Version-control tools `[2.2.0]` | `server.ts` + `portalVc.ts` | Snapshot, history, restore/revert |
| Resources (read-only guides) | `guidance.ts`, `rules.ts`, `design.ts` | `zportal://guide/*` knowledge injected into authoring |
| Prompt | `server.ts` | `create_zportal_block` — a guided authoring workflow |

Full list with parameters: [03 · Tools Reference](03-tools-reference.md).

## How a request flows
1. The client calls a tool (e.g. `create_block`).
2. The handler checks the **write domain** (`blockReason`) — blocked tools return an actionable message
   naming the env flag to set.
3. Block writes run **`validateBlock`** — `error`-severity violations hard-reject before any API call;
   `warn`s are returned alongside the result.
4. `portalClient.request()` performs the authenticated HTTP call:
   - On first use it logs in (`GET /auth/login?api_key=…&user_id=…`) and caches the session cookie.
   - Every request sends the cookie **and** an `X-Api-Key` header.
   - On `401` it re-logs-in once and retries.
5. On success of a **content** write, the result is mirrored to the git VC repo and committed `[2.2.0]`.

## Two portal services, one base URL
The portal exposes the **main API under `/api`** (blocks, layouts, datasources, queries,
db_modifications, partials, themes, dashboards, tags, system) and the **auth service under `/auth`**
(users, groups, permissions, api_keys, credentials, me, password). A resource descriptor in
`resources.ts` spells out the full path including the service segment, so adding a resource is a data
change, not new tool code.

## Resource types (the generic registry)
The generic resource tools operate over these keys, each tagged with a write domain:

- **content** (writes ON by default): `layout` (pages), `query`, `theme`, `partial`, `snippet`,
  `translation`, `dashboard`, `tag`
- **data** (needs `PORTAL_ALLOW_DATA_WRITES`): `datasource`, `db_modification`
- **admin** (needs `PORTAL_ALLOW_ADMIN_WRITES`): `user`, `group`, `permission`, `access_policy`,
  `api_key`, `credential`, `system`

> **Blocks are intentionally NOT in this registry** — they get typed, validated tools of their own
> (`create_block`, etc.) so authoring can be guarded by `validateBlock`.

Run `describe_resource` (no args) to list every resource, or with a `resource` to see its fields,
verbs, and risk domain.

## Where to go next
- Install & configure: [02](02-install-and-config.md)
- Author your first block: [04 · Authoring Blocks](04-authoring-blocks.md)
- Understand the in-block runtime: [08 · zPortal In-Block API](08-zportal-in-block-api.md)
