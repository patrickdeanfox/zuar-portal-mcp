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
- **`init_project_config`** writes `./.zuar-portal/config.json` (plus a `.zuar-portal/.gitignore` that
  ignores `config.json`), then **validates the credentials with a live login**. It **refuses to
  overwrite** an existing config unless `overwrite=true`.
- **`active_config`** reports which config / portal / repo is currently in effect (secrets redacted).
- The **`setup_zuar_project`** MCP prompt walks you through it conversationally. In Claude Code, just
  run **`/portal-setup`**.

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

## Full environment variable reference
| Env var | `.mcpb` field | Default | Purpose |
|---------|---------------|---------|---------|
| `PORTAL_URL` | `portal_url` | — | Portal base URL (required) |
| `PORTAL_API_KEY` | `portal_api_key` | — | API key (required, sensitive) |
| `PORTAL_USER_ID` | `portal_user_id` | — | User UUID (required, sensitive) |
| `PORTAL_READONLY` | `portal_readonly` | `false` | Block all writes |
| `PORTAL_ALLOW_DATA_WRITES` | `portal_allow_data_writes` | `false` | Enable data-domain writes |
| `PORTAL_ALLOW_ADMIN_WRITES` | `portal_allow_admin_writes` | `false` | Enable admin-domain writes |
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

Details + the revert workflow: [07 · Version Control](07-version-control.md).

## Verifying the install
- `get_version` — confirms connectivity and returns portal version/about.
- `get_me` — confirms your credentials resolve to a user.
- `describe_resource` (no args) — lists every resource the server manages.
- `vc_status` `[2.2.0]` — confirms whether version control is enabled and where.

## Updating after code changes
1. `npm run build`
2. Repack the `.mcpb` (if using the bundle)
3. Restart the MCP client

Until restart, the running server uses the previously built code — new tools/rules/VC won't be active.
