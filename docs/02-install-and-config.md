# 02 · Install & Configuration

## Requirements
- Node.js ≥ 18
- A Zuar Portal URL, an API key, and your user UUID
- (Optional, for version control) `git` on PATH

## Install

### A. As a bundled extension (Claude Desktop / `.mcpb`)
The repo ships a packed `zuar-portal-mcp.mcpb`. Install it in Claude Desktop (Settings → Extensions →
install from file) and fill in the **user config** fields (URL, API key, user ID, and the optional
toggles below). The manifest maps those fields to the env vars the server reads.

> After changing server code you must **rebuild and repack** for the bundle to update:
> `npm install && npm run build`, repack the `.mcpb`, then restart the client. The running process
> keeps the old build until restart.

### B. From source (Claude Code / any stdio MCP client)
```bash
npm install
npm run build      # tsc -> dist/
```
Point your client at `node /abs/path/zuar-portal-mcp/dist/index.js`. Provide credentials via env vars
(below) or a `config.json` next to the bundle. **Non-credential settings (safety, version control,
design) are env-only** — set them in your MCP client's server `env` map; `config.json` only carries the
three credentials. Example client server config:

```jsonc
{ "command": "node", "args": ["/abs/path/zuar-portal-mcp/dist/index.js"],
  "env": {
    "PORTAL_URL": "https://your-portal.zuarbase.net",
    "PORTAL_API_KEY": "…", "PORTAL_USER_ID": "…",
    "PORTAL_ALLOW_DATA_WRITES": "1",
    "PORTAL_VC_DIR": "/home/you/zuar-portal-state"
  } }
```

## Per-project configuration (multiple portals)
**New in v2.4.0.** One MCP install can now drive a **different portal + git repo per folder** — instead
of one global portal baked into your client's env, each project directory carries its own credentials
and its own version-control state.

**Resolution order (layered, highest first, applied per field):**
1. The nearest **`./.zuar-portal/config.json`** — found by walking **up** from the working directory.
2. **Environment vars / Claude Desktop `user_config`** — the global portal (see [Credentials](#credentials-required)).
3. A **bundle-adjacent `config.json`** (beside `dist/`) — the dev fallback.

Layering is **per field**, so env now *fills* fields a project file omits rather than always winning.
Empty env strings are treated as **unset** — a blank Desktop field won't shadow a project value.

**The file** `./.zuar-portal/config.json` uses the **same schema as before** — a `portal` section and an
optional `vc` (version-control) section — so each folder gets its own portal **and** its own state repo:
```json
{
  "portal": { "url": "https://your-portal.zuarbase.net", "apiKey": "<api-key>", "userId": "<user-uuid>" },
  "vc": { "dir": "/path/to/state-repo", "push": false, "remote": "origin",
          "remote_url": "https://github.com/you/portal-state.git", "token": "<PAT>", "username": "x-access-token" }
}
```

**Guided setup** — you don't have to hand-write the file:
- **`setup_portal`** `[2.8.0]` is the **interactive** path. Call it with **no arguments** and — when your
  MCP client supports **elicitation** — it **prompts you field-by-field**: portal URL → API key → user ID,
  then asks whether you want GitHub version control and (if yes) collects the repo URL, PAT, and local
  mirror path. It then validates **both** the portal (live login) **and** the GitHub token/repo (against
  the GitHub API), and writes the same `./.zuar-portal/config.json`. Any field you pass as an argument
  skips its prompt. If the client can't elicit, it falls back with a clear message — pass the fields as
  arguments instead (or use `init_project_config`). **Secrets are never echoed or logged.**
- **`init_project_config`** is the **arguments-only** path: pass `portal_url` / `api_key` / `user_id`
  (plus optional `vc_*`) up front. It writes `./.zuar-portal/config.json` (plus a `.zuar-portal/.gitignore`
  that ignores `config.json`), then **validates the credentials with a live login**. Both tools **refuse
  to overwrite** an existing config unless `overwrite=true`.
- **`active_config`** reports which config / portal / repo is currently in effect (secrets redacted).
- The **`setup_zuar_project`** MCP prompt walks you through it conversationally (it now routes to
  `setup_portal`). In Claude Code, just run **`/portal-setup`**.

> **Elicitation support.** The interactive prompts only appear if the connected client advertises the
> `elicitation` capability; `setup_portal` detects this and degrades to argument-only operation otherwise.
> The MCP spec discourages eliciting secrets, so this is a deliberate local-only convenience: the file is
> gitignored, values are never logged, and validation results carry only the GitHub login / repo / push
> permission — never the token.

**Security.** `.zuar-portal/` and `config.json` are gitignored at the repo root; secrets are never
logged or echoed.

## Credentials (required)
| Env var | Maps from (.mcpb) | What it is |
|---------|-------------------|------------|
| `PORTAL_URL` | `portal_url` | Base URL, e.g. `https://your-portal.zuarbase.net` (trailing slash trimmed) |
| `PORTAL_API_KEY` | `portal_api_key` | zPortal **Admin → Auth → API Keys** |
| `PORTAL_USER_ID` | `portal_user_id` | Your user UUID (**Admin → Users**, copy from the URL) |

These env vars (and Claude Desktop / MCPB `user_config`) are how a client injects a **single global
portal**. With per-project config they're now the **middle** layer: env **fills** fields a project file
omits rather than always winning, and a blank env field is ignored — see
[Per-project configuration](#per-project-configuration-multiple-portals).

`config.json` fallback (dev): a file beside `dist/` (or one level up) with
`{ "portal": { "url": "...", "apiKey": "...", "userId": "..." } }` — the **lowest-priority** layer,
overridden by both env and a per-project `./.zuar-portal/config.json`. Secrets are never logged.

## Write-safety domains (important)
Every write tool is tagged with a **risk domain**. Domains gate independently, so you can allow
low-risk content edits while keeping SQL and security writes off. Default posture: **content ON, data
OFF, admin OFF.**

| Domain | Default | Enable with | Covers |
|--------|---------|-------------|--------|
| `content` | **on** | (always on unless read-only) | blocks, layouts/pages, queries, themes, partials, snippets, translations, dashboards, tags |
| `data` | off | `PORTAL_ALLOW_DATA_WRITES=1` | datasources (SQL), db_modifications, `run_db_modification` |
| `admin` | off | `PORTAL_ALLOW_ADMIN_WRITES=1` | users, groups, permissions, access policies, api keys, credentials, config, password |
| (all) | — | `PORTAL_READONLY=1` | blocks **every** write regardless of domain |

A blocked write returns an actionable message naming the exact flag to set — it never silently no-ops.
Truthy values: `1`, `true`, `yes`, `on`.

## Tool gating (capability scoping) `[2.5.0]`
Write-safety gates the **execution** of a write. Tool gating goes further: one install can drop whole
**groups of tools** (or individual tools) from the MCP surface **entirely** — least-privilege scoping, so
a given deployment only advertises the capabilities you intend it to have. A gated-off tool isn't
blocked at call time; it never registers. The tool surface is **fixed at server startup** — changing
gating needs a **restart**. `get_capabilities` is **always available** and reports which groups/tools
are enabled, the posture, and audit status.

**The 8 groups:**

| Group | Tools |
|-------|-------|
| `discovery` | `get_version`, `get_rules`, `describe_resource`, `get_me` |
| `blocks` | `list_blocks`, `get_block`, `validate_block`, `create_block`, `update_block`, `delete_block`, `bind_block_query`, `add_block_to_page`, `remove_block_from_page`, `set_page_blocks` |
| `resources` | `list_resource`, `get_resource`, `create_resource`, `update_resource`, `delete_resource` |
| `data` | `fetch_sample_rows`, `profile_datasource`, `execute_query`, `run_db_modification` |
| `users` | `get_user_groups`, `set_user_groups`, `get_user_permissions`, `set_user_permissions`, `change_password`, `update_me` |
| `config` | `get_config`, `update_config` |
| `vc` | `vc_status`, `snapshot_portal`, `vc_log`, `restore_resource` |
| `setup` | `active_config`, `init_project_config`, `setup_portal` |

> `get_capabilities` sits outside the groups and is **always available** — it can't be gated off by group.

**Modes & configuration:**
- **Denylist (default).** `PORTAL_DISABLE_TOOLS=users,config` turns those groups **off**; everything else
  stays on. Names may be **group** names or individual **tool** names. This is the motivating example —
  "turn off the user/permissions tools."
- **Allowlist.** Setting `PORTAL_ENABLE_TOOLS=blocks,resources,data` (or `PORTAL_TOOLS_MODE=allowlist`)
  flips the surface to **default-off**: only the listed groups/tools register — plus the always-available
  `get_capabilities` and `active_config`, so the config stays fixable.
- **Project config.** `./.zuar-portal/config.json` carries a `tools` section, same precedence as the rest
  of the file: `{ "disable": ["users","config"], "enable": [...], "mode": "allowlist" }`.
- **`deny` always wins.** An explicit tool-**name** deny even removes the always-on introspection tools.

**Project wins over env.** A project `tools` allowlist is **authoritative** — env can **not expand** it.
Env composes only when the project file is **silent** on gating.

**MCPB / Claude Desktop bundle:** the user_config fields **Disable tool groups** / **Allowlist tool
groups** / **Tool gating mode**.

## Audit log `[2.5.0]`
**Opt-in.** Set `PORTAL_AUDIT_LOG=/path/to/audit.jsonl` (or a project-config `audit` — a string path, or
`{ "log": "/path/to/audit.jsonl" }`). The server then keeps an **append-only JSONL** trail: one line per
**write** across **content / data / admin**, **metadata only** — `{ ts, domain, op, kind, id }` —
**never payloads or secrets**. Content writes are captured at the version-control chokepoint; data and
admin writes at their handlers.

Pseudo / non-regular paths (`/dev`, `/proc`, `/sys`, device files) are **refused** — writing into them
could corrupt the stdio JSON-RPC stream. The audit log **complements** the git VC mirror (which adds
rollback for content): it's the flat who-did-what record across all three domains. **MCPB field:**
**Audit log file**.

## Full environment variable reference
| Env var | `.mcpb` field | Default | Purpose |
|---------|---------------|---------|---------|
| `PORTAL_URL` | `portal_url` | — | Portal base URL (required) |
| `PORTAL_API_KEY` | `portal_api_key` | — | API key (required, sensitive) |
| `PORTAL_USER_ID` | `portal_user_id` | — | User UUID (required, sensitive) |
| `PORTAL_READONLY` | `portal_readonly` | `false` | Block all writes |
| `PORTAL_ALLOW_DATA_WRITES` | `portal_allow_data_writes` | `false` | Enable data-domain writes |
| `PORTAL_ALLOW_ADMIN_WRITES` | `portal_allow_admin_writes` | `false` | Enable admin-domain writes |
| `PORTAL_DISABLE_TOOLS` `[2.5.0]` | `portal_disable_tools` | (none) | Denylist of tool **groups**/names to drop from the surface (e.g. `users,config`) |
| `PORTAL_ENABLE_TOOLS` `[2.5.0]` | `portal_enable_tools` | (none) | Allowlist of groups/names — sets **default-off**; only these register |
| `PORTAL_TOOLS_MODE` `[2.5.0]` | `portal_tools_mode` | `denylist` | `allowlist` flips to default-off without naming an enable set |
| `PORTAL_AUDIT_LOG` `[2.5.0]` | `portal_audit_log` | (unset = off) | Append-only JSONL audit-trail path (one line per write, metadata only) |
| `PORTAL_VC_DIR` `[2.2.0]` | `portal_vc_dir` | (unset = VC off) | Git repo path; enables auto-commit version control |
| `PORTAL_VC_PUSH` `[2.2.0]` | `portal_vc_push` | `false` | `git push` after each commit |
| `PORTAL_VC_REMOTE` `[2.2.0]` | `portal_vc_remote` | `origin` | Remote to push to |
| `PORTAL_VC_REMOTE_URL` `[2.3.0]` | `portal_vc_remote_url` | — | State-repo remote URL; the server configures the remote automatically |
| `PORTAL_VC_TOKEN` `[2.3.0]` | `portal_vc_token` | — | PAT for HTTPS push auth (repo scope); applied as a git auth header, never logged |
| `PORTAL_VC_USERNAME` `[2.3.0]` | `portal_vc_username` | `x-access-token` | Basic-auth username paired with the token |
| `PORTAL_DESIGN_FILE` `[2.2.0]` | `portal_design_file` | (bundled `assets/design.md`) | Override the house design system |
| `PORTAL_BLOCK_RULES_FILE` | — | (bundled `assets/rules.json`) | Override authoring rules + conventions |
| `PORTAL_DEBUG` | — | `0` | Verbose stderr logging — enables on `1` only (never logs secrets) |

> `—` in the **.mcpb field** column = env-only (not surfaced as a bundle setting).
> `PORTAL_VC_DIR`, `PORTAL_DESIGN_FILE`, and `PORTAL_BLOCK_RULES_FILE` are **paths** — their presence
> enables the feature (not booleans).

## Enabling version control `[2.2.0]`
> Requires the **v2.2.0 build to be running** (see [Updating after code changes](#updating-after-code-changes)).
> On an older running build, setting these vars has no effect.
1. Pick/clone a git repo for portal state, e.g. `~/zuar-portal-state`.
2. Point the server at it — **either** env `PORTAL_VC_DIR=~/zuar-portal-state`, **or** (run-from-source)
   a `vc` section in `config.json`: `{ "vc": { "dir": "~/zuar-portal-state", "push": false, "remote":
   "origin" } }`. The server runs `git init` if it isn't a repo yet; env vars override `config.json`.
3. (GitHub) `gh repo create zuar-portal-state --private`, add it as `origin`, set `PORTAL_VC_PUSH=1`.
4. Restart the MCP, then run **`snapshot_portal`** once to seed the baseline.

**Fresh machine, no git setup `[2.3.0]`:** instead of configuring `gh`/SSH/credential helpers, put the
remote + a token in the `vc` section and the server wires up the authenticated remote itself:
```json
"vc": { "dir": "/abs/path/zuar-portal-state", "push": true,
        "remote": "origin", "remote_url": "https://github.com/you/zuar-portal-state.git",
        "token": "<PAT with repo scope>" }
```
The token is applied as a git auth header in the repo's local config, **never logged**; `config.json`
is gitignored. If `token` is omitted, the server uses the machine's existing git auth.

> **Tip `[2.8.0]`:** `setup_portal` writes this `vc` section for you and **validates the GitHub token + repo
> against the GitHub API before the first push** — so a bad PAT or wrong repo URL fails fast at setup
> instead of silently at commit time.

Details + the revert workflow: [07 · Version Control](07-version-control.md).

## Verifying the install
- `setup_portal` `[2.8.0]` — guided first-time setup; validates portal + GitHub creds as it writes the config.
- `get_version` — confirms connectivity and returns portal version/about.
- `get_me` — confirms your credentials resolve to a user.
- `describe_resource` (no args) — lists every resource the server manages.
- `vc_status` `[2.2.0]` — confirms whether version control is enabled and where.

## Updating after code changes
1. `npm run build`
2. Repack the `.mcpb` (if using the bundle)
3. Restart the MCP client

Until restart, the running server uses the previously built code — new tools/rules/VC won't be active.
