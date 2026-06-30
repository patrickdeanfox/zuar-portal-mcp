# Security & Governance

This document describes the security posture of the Zuar Portal MCP server: its
deployment model, what each tool can touch, how credentials and data are handled,
and the controls available to operators.

## Deployment model

This is a **local, single-user, stdio MCP server**. It runs as a child process of
an MCP client (Claude Desktop, Claude Code, etc.) on the operator's own machine,
under the operator's own portal credentials. It is **not** a hosted, multi-tenant
service — there is no inbound network listener, no cross-user state, and no shared
credential store. One process talks to exactly one portal.

Threat model in scope: protecting the operator's credentials and the model's
context from accidental secret exposure, bounding untrusted tool inputs, and
degrading gracefully when the portal is unreachable. Out of scope (by deployment
choice): OAuth, tenant isolation, and remote-transport hardening.

## What each tool group can touch

Every tool belongs to a capability **group** and every write to a risk **domain**.
Groups can be disabled wholesale (`PORTAL_DISABLE_TOOLS`) or restricted to an
allowlist (`PORTAL_ENABLE_TOOLS`); write domains are gated independently.

| Group | Tools (representative) | Reads | Writes | Write domain | Default write |
|-------|------------------------|-------|--------|--------------|---------------|
| `discovery` | get_version, get_rules, describe_resource, get_me | metadata | — | — | n/a |
| `blocks` | list/get/create/update/delete_block, bind_block_query, page placement | blocks, layouts | blocks, page grids | `content` | **on** |
| `resources` | list/get/create/update/delete_resource | layouts, themes, partials, queries, datasources, users, groups, permissions, api_keys, credentials, … | same (per resource) | `content` / `data` / `admin` | per domain |
| `data` | fetch_sample_rows, profile_datasource, execute_query, run_db_modification | query results, datasource samples | runs SQL / db modifications | `data` | **off** |
| `users` | get/set_user_groups, get/set_user_permissions, change_password, update_me | user/group/permission membership | user membership, passwords | `admin` | **off** |
| `config` | get/update_config | portal config document | portal config | `admin` | **off** |
| `vc` | vc_status, snapshot_portal, vc_log, restore_resource | local git mirror of content | local git repo (+ optional push) | `content` | **on** |
| `setup` | active_config, init_project_config | resolved config (redacted) | local `.zuar-portal/config.json` | local file | n/a |
| `meta` | get_capabilities, get_metrics | server posture & metrics | — | — | n/a |

Write domains and their gates:

- `content` — blocks, layouts, partials, themes, queries, snippets, tags, dashboards. **On** unless `PORTAL_READONLY=1`.
- `data` — datasources, db_modifications, `run_db_modification`. **Off**; enable with `PORTAL_ALLOW_DATA_WRITES=1`.
- `admin` — users, groups, permissions, access policies, api_keys, credentials, system, config, passwords. **Off**; enable with `PORTAL_ALLOW_ADMIN_WRITES=1`.

`PORTAL_READONLY=1` disables every write regardless of domain. `run_db_modification`
additionally requires `confirm: true` on each call.

## Credential handling

- Credentials resolve from a per-project `.zuar-portal/config.json`, `PORTAL_*` env
  vars, or a bundle `config.json` — in that order. The project config file is
  gitignored and excluded from the `.mcpb` bundle.
- The API key and user id are declared **sensitive** in the manifest (masked in the
  Claude Desktop UI, stored securely by the client).
- Credentials are **never logged**. All logging goes to stderr (stdout is reserved
  for MCP JSON-RPC framing). `active_config` / `get_capabilities` report config with
  all secrets redacted.
- The portal base URL is validated as a well-formed `http(s)` origin before use.
- **Guided setup (`setup_portal`).** When the client supports it, this tool **elicits**
  the portal credentials and an optional GitHub PAT interactively. The MCP spec
  discourages eliciting secrets; this is a deliberate, scoped exception for a
  **local, single-operator** server: the values are written only to the gitignored
  `config.json`, are never logged, and are never echoed back. Validation results
  surface only non-secret facts (signed-in user; GitHub login / repo / push
  permission) — never the token itself. On clients without elicitation the tool
  degrades to argument-only operation.

## Network egress

The server makes outbound HTTPS calls to the configured portal URL (`/auth/*` and
`/api/*`). The **one** exception is `setup_portal`'s opt-in GitHub validation: when
you provide a GitHub repo URL **and** a token, it calls that host's GitHub API
(`api.github.com`, or `<host>/api/v3` for GitHub Enterprise) to verify the token and
repo — `GET /user` and `GET /repos/{owner}/{repo}`, token in the `Authorization`
header only. Skip it with `validate_github=false`. The server opens no inbound
listener and contacts no other third party.

## Input & output hardening

- **Input** — every tool input is schema-validated (Zod). Oversized inputs are
  rejected at the MCP boundary before any handler runs (`PORTAL_MAX_INPUT_BYTES`,
  default 2 MB), and oversized request bodies are rejected before the wire
  (`PORTAL_MAX_BODY_BYTES`, default 5 MB). All tool args are treated as untrusted.
- **Output** — secret-bearing fields (`password`, `secret`, `token`, `api_key`,
  `private_key`, `credentials`, …) are masked as `[redacted]` on resource **read**
  responses, so hashes/tokens/connection secrets never enter the model's context.
  Identifier fields (`*_id`) are never masked; create/update responses are left
  intact so a freshly generated secret can be retrieved once. Disable with
  `PORTAL_REDACT_SECRETS=0`.

## Resilience

The portal HTTP client applies per-attempt timeouts, bounded exponential-backoff
retries (idempotent verbs freely; writes only on a pre-response network error or an
explicit `429`/`503`), and a circuit breaker that fails fast while the upstream is
down. See the README "Resilience, observability & hardening" section for the knobs.

## Data retention

| Data | Where | Retention |
|------|-------|-----------|
| Tool-call metrics (counts, latency — no payloads) | in-memory | Cleared on process restart |
| Structured / debug logs | stderr | Wherever the client/operator directs stderr; off unless `PORTAL_DEBUG=1` or `PORTAL_LOG_FORMAT=json` |
| Audit log (metadata only — op/kind/id/domain, no payloads/secrets) | local file | Append-only; **opt-in** via `PORTAL_AUDIT_LOG`; operator-managed |
| Version-control mirror of content writes | local git repo (optional remote) | **opt-in** via `PORTAL_VC_DIR`; operator-managed |
| Portal data | the portal | Governed by the portal, not this server |

This server stores no portal data of its own beyond the opt-in local audit/VC
artifacts above; data residency for portal content is governed by your portal.

## Reporting

Report security issues privately to the maintainer rather than opening a public
issue.
