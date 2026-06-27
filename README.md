# Zuar Portal Blocks — MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets **Claude operate your Zuar Portal (zPortal)** for you. Claude can author HTML blocks, manage pages, data sources, queries, db modifications, partials, themes and users, preview real data, and run queries — through the Portal REST + auth APIs, with bundled authoring guidance so the blocks it produces follow zPortal conventions.

> **⬇️ Quick install (Claude Desktop):** download **`zuar-portal-mcp.mcpb`** from the [latest release](https://github.com/patrickdeanfox/zuar-portal-mcp/releases/latest) and double-click it, or drag it onto Claude Desktop. You'll be asked for three portal values (below) and that's it — no terminal, no config files.

**Block writes are validated.** HTML blocks go through dedicated, validated tools (`create_block`/`update_block`). Every other resource is reached through generic resource tools. **Writes are gated by risk domain** — content edits are on by default; data (SQL) and admin (users/security) writes are opt-in (see [Write safety](#write-safety)).

> **📚 Full documentation:** the complete guide lives in **[`docs/`](docs/README.md)** — overview, install & config, a reference for all 38 tools, block authoring, the authoring rules, the design system, version control, the in-block `zPortal` API, recipes, loops/automation & data exploration, the [Claude Code agent ecosystem](docs/13-agents-and-workflows.md), [tool gating & guidance](docs/14-tool-gating-and-guidance.md), and troubleshooting.

> **🏢 Multi-portal & multi-repo (v2.4.0):** one install can drive a **different portal + git repo per folder** via a per-project `./.zuar-portal/config.json`. And when you work in this repo from **Claude Code**, you get a whole **team of specialist agents** (build / style / debug / responsive / theme / bulk / data-expert / advisory) plus slash commands and gated workflows. See [Per-project configuration](#per-project-configuration-multiple-portals) and [Driving it from Claude Code](#driving-it-from-claude-code-the-agent-ecosystem).

> **🔒 Enterprise: tool gating, guidance & audit (v2.5.0):** scope the tool surface to least privilege — disable whole capability groups (e.g. user/permission tools) with `PORTAL_DISABLE_TOOLS=users,config`, or stand up a build-only allowlist with `PORTAL_ENABLE_TOOLS=blocks,resources,data`. **Guided usage** comes from the always-on **`get_capabilities`** tool (orient before acting), server `instructions` surfaced at startup, and the **`zuar_portal_quickstart`** prompt (confirm posture → route to the right tool/agent). And an **opt-in audit log** (`PORTAL_AUDIT_LOG`) appends metadata-only JSONL for every content/data/admin write. Full guide: [docs/14 · Tool Gating & Guidance](docs/14-tool-gating-and-guidance.md).

---

## Contents

- [What Claude can do with it](#what-claude-can-do-with-it)
- [Requirements](#requirements)
- [Getting your portal credentials](#getting-your-portal-credentials)
- [Install — Claude Desktop (one-click bundle)](#install--claude-desktop-one-click-bundle)
- [Install — Claude Code & other MCP clients](#install--claude-code--other-mcp-clients)
- [Per-project configuration (multiple portals)](#per-project-configuration-multiple-portals)
- [Driving it from Claude Code (the agent ecosystem)](#driving-it-from-claude-code-the-agent-ecosystem)
- [Getting started](#getting-started)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Building the .mcpb bundle](#building-the-mcpb-bundle)
- [Security](#security)
- [License](#license)

---

## What Claude can do with it

### Block tools (typed + validated)

| Tool | What it does |
|------|--------------|
| `list_blocks` | List blocks on the portal (optionally by ID, or names only). |
| `get_block` | Fetch one block by UUID, including its HTML/CSS and query config. |
| `create_block` | Create an HTML block (validated against authoring rules). |
| `update_block` | Update an HTML block — merged over the current block so untouched fields survive. |
| `delete_block` | Delete a block by UUID. |
| `validate_block` | Run the authoring rules against a block payload **without writing** — iterate until clean. |
| `bind_block_query` | Bind a block to a datasource/query (auto-creates the query); sets `ui_queries`. |
| `add_block_to_page` | Place a block on a page (layout grid). |
| `set_page_blocks` | Place **many** blocks on a page in one atomic write (no lost-update race). |
| `remove_block_from_page` | Take a block off a page without deleting the block. |

### Generic resource tools

One set of tools operates every other resource. Pass `resource` plus a `body`/`id`. Call `describe_resource` to see each resource's fields, required-to-create fields, supported verbs, and risk domain.

| Tool | What it does |
|------|--------------|
| `describe_resource` | List resources, or describe one (fields, verbs, domain). |
| `list_resource` | List records — e.g. `resource: "datasource"` for discovery. |
| `get_resource` | Get one record by id. |
| `create_resource` | Create a record (write-gated by domain). |
| `update_resource` | Update a record (merged over current; write-gated). |
| `delete_resource` | Delete a record (write-gated). |

**Covered resources:** `layout` (pages), `datasource`, `query`, `db_modification`, `partial`, `theme`, `snippet`, `translation`, `dashboard`, `tag`, `user`, `group`, `permission`, `access_policy`, `api_key`, `credential`, `system`.

### Action tools

| Tool | What it does | Domain |
|------|--------------|--------|
| `fetch_sample_rows` | Preview rows from a datasource to wire blocks to real columns. | read |
| `profile_datasource` | Per-column stats (type, distinct values, min/max) to design filters + charts. | read |
| `execute_query` | Run a saved query by id and return results (optional row `limit`). | read |
| `run_db_modification` | Run a saved DB write by name. Needs `confirm: true`. | data |
| `change_password` | Change the current user's password. | admin |
| `get_user_groups` / `set_user_groups` | Read / replace a user's group membership. | read / admin |
| `get_user_permissions` / `set_user_permissions` | Read / replace a user's permissions. | read / admin |
| `get_me` / `update_me` | Read / update the current user's profile. | read / admin |
| `get_config` / `update_config` | Read / set portal config by path. | read / admin |
| `get_version` | Portal version + about (capability check). | read |
| `get_rules` | Show active block-authoring rules. | read |
| `get_capabilities` | Report the current posture — enabled/disabled tool groups, write-safety, VC + audit status, active portal (always available). | read |
| `active_config` | Report which project config / portal / VC repo is in effect (secrets redacted). | read |
| `init_project_config` | Write this folder's `./.zuar-portal/config.json` for a specific portal (+ optional VC) and validate it. | setup |

**Resources** — authoring guidance Claude reads before building, so blocks follow zPortal conventions even if you've never set up a zPortal skill:

- `zportal://guide/block-structure` — the two-field HTML/CSS structure and theme variables
- `zportal://guide/currentblock` — reading query data inside a block and reacting to filters
- `zportal://guide/amcharts-loader` — the amCharts 5 two-block loader pattern

**Prompts** — `zuar_portal_quickstart` (get oriented: confirm posture, then route to the right next step), `create_zportal_block` (a guided "discover data → build → create" workflow) and `setup_zuar_project` (walks you through connecting this folder to a portal) — invoke any from your MCP client.

---

## Requirements

- A **Zuar Portal** you can reach over HTTPS, with an account that has permission to manage blocks (admin recommended).
- **Claude Desktop** (for the one-click `.mcpb`) — Node.js ships with it, so there's nothing else to install.
- For the developer / `npx` path instead: **Node.js 18+**.

---

## Getting your portal credentials

You need three values. All three are entered once, during install.

### 1. Portal URL

The base URL of your portal, with no trailing path — for example:

```
https://your-portal.zuarbase.net
```

### 2. Portal API Key

1. Sign in to your portal as an admin.
2. Go to **Admin → Auth → API Keys**.
3. Create a new API key (or copy an existing one).
4. Copy the key string.

The API key inherits the permissions of the user it's associated with, so make sure that user can create, edit, and delete blocks.

### 3. Portal User ID

1. Go to **Admin → Users**.
2. Click your user.
3. Copy the **UUID** from the page URL (the long `xxxxxxxx-xxxx-...` segment).

> Keep the API Key and User ID private. In the Claude Desktop bundle they're stored as **sensitive** fields (masked and stored securely). They never leave the machine running the server.

---

## Install — Claude Desktop (one-click bundle)

1. Download **`zuar-portal-mcp.mcpb`** from the [latest release](https://github.com/patrickdeanfox/zuar-portal-mcp/releases/latest).
2. Double-click the file, or drag it onto the Claude Desktop window. An install dialog appears.
3. Fill in the three fields when prompted:
   - **Portal URL** — e.g. `https://your-portal.zuarbase.net`
   - **Portal API Key** — from Admin → Auth → API Keys
   - **Portal User ID** — your user UUID
4. Confirm. The tools, resources, and prompt are now available to Claude.

To update later, download the newer `.mcpb` from the releases page and install it over the old one.

---

## Install — Claude Code & other MCP clients

This server speaks MCP over **stdio**, so any MCP-capable client can use it. Provide the three values as environment variables.

### From a local clone (works today)

```bash
git clone https://github.com/patrickdeanfox/zuar-portal-mcp.git
cd zuar-portal-mcp
npm install
npm run build      # compiles TypeScript -> dist/
```

Then register it in your client's MCP config (e.g. `claude_desktop_config.json`, or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "zuar-portal-blocks": {
      "command": "node",
      "args": ["/absolute/path/to/zuar-portal-mcp/dist/index.js"],
      "env": {
        "PORTAL_URL": "https://your-portal.zuarbase.net",
        "PORTAL_API_KEY": "your-portal-api-key",
        "PORTAL_USER_ID": "your-portal-user-uuid"
      }
    }
  }
}
```

### Via npx (once published to npm)

```json
{
  "mcpServers": {
    "zuar-portal-blocks": {
      "command": "npx",
      "args": ["-y", "zuar-portal-mcp-server"],
      "env": {
        "PORTAL_URL": "https://your-portal.zuarbase.net",
        "PORTAL_API_KEY": "your-portal-api-key",
        "PORTAL_USER_ID": "your-portal-user-uuid"
      }
    }
  }
}
```

---

## Per-project configuration (multiple portals)

One MCP install can drive **a different portal — and a different git state-repo — in every folder**.
When the server starts, it resolves credentials in layers, highest priority first:

1. **Project config** — the nearest `./.zuar-portal/config.json`, found by walking up from the working
   directory. This is what lets one install serve many portals.
2. **Environment** — the `PORTAL_*` env vars (how Claude Desktop / MCPB inject a single global portal).
   Empty values are ignored, so a blank Desktop field never shadows a project value.
3. **Bundle config** — a `config.json` beside the bundle (dev fallback).

Each field resolves independently, so a project file can override just the portal while inheriting the
rest from the environment. The file uses the same schema for both the portal and its version-control repo:

```json
{
  "portal": { "url": "https://team-a.zuarbase.net", "apiKey": "…", "userId": "…" },
  "vc":     { "dir": "/path/to/team-a-state", "push": true,
              "remote_url": "https://github.com/you/team-a-portal-state.git", "token": "…" }
}
```

**Set it up without hand-editing JSON:** ask Claude to run **`init_project_config`** (or the
**`setup_zuar_project`** prompt, or `/portal-setup` in Claude Code). It writes the file + a `.gitignore`,
validates the credentials with a live login, and refuses to clobber an existing config. **`active_config`**
shows which portal/repo is currently in effect (secrets redacted). `./.zuar-portal/` is gitignored, so
credentials never get committed.

---

## Driving it from Claude Code (the agent ecosystem)

When this repo is your Claude Code working directory, the MCP tools come with a **team of specialists**
in [`.claude/`](.claude/README.md) — see [docs/13 · Agents & Workflows](docs/13-agents-and-workflows.md).

- **The block pipeline:** blocks are never shipped raw. A spec flows through
  **build → style → responsive → debug → adversary → advisor** — each a focused subagent, with the
  read-only *adversary* gating the result (and looping back to the debugger while it finds blocking issues).
- **Specialists:** a **data-expert** (profiles datasources, designs chart-ready queries), a
  **theme-designer**, a **bulk-operator** (snapshot-first, atomic, revertible), and an **onboarding** agent
  that runs an alignment Q&A and writes a project brief.
- **Slash commands:** `/portal-setup`, `/portal-build`, `/portal-theme`, `/portal-bulk`, `/portal-audit`,
  `/portal-align`.
- **Workflows:** deterministic multi-agent scripts — `portal-block-pipeline.js` (gated build) and
  `portal-audit.js` (fan auditors across every block → ranked report).

Everything is grounded in `assets/conventions.md` (the enforced authoring rules) and `assets/design.md`
(the house visual system), and every write mirrors to the VC repo so it can be reverted.

---

## Getting started

Once installed, just talk to Claude. A good first session looks like this:

1. **Confirm the connection**

   > "List the datasources on my portal."

   Claude calls `list_resource` with `resource: "datasource"` and shows what's available. If you get a credentials error, re-check the three values (see [Troubleshooting](#troubleshooting)).

2. **Look at real data**

   > "Show me a few sample rows from the Sales datasource."

   Claude calls `fetch_sample_rows` so it can see the actual column names before building anything.

3. **Create a block**

   > "Create an HTML stat-card block called 'Total Orders' that shows the order count from the Sales datasource."

   Claude reads the `zportal://guide/*` resources, builds the two-field block, and calls `create_block`. It reports the new block's UUID.

4. **Iterate**

   > "Make the number bigger and use the portal's primary color."
   > "Now turn it into a bar chart of orders by state."

   Claude calls `update_block`. For charts it follows the amCharts loader pattern from the bundled guidance.

**Tip:** invoke the **`create_zportal_block`** prompt for a structured, end-to-end flow — give it a goal (and optionally a datasource name) and it walks discovery → build → create for you.

After Claude creates a block, add it to a page in the zPortal page editor as usual. (This server manages blocks, not page layout.)

---

## How it works

- On first request the server logs in to your portal (`GET /auth/login?api_key=…&user_id=…`) to get a JWT session cookie, and also sends the API key as an `X-Api-Key` header on every call.
- If the session expires, it re-logs in automatically and retries once.
- Content reads/writes go through the main REST API under `/api/*`; users, groups, permissions, API keys and password changes go through the auth service under `/auth/*`. The same configured base URL serves both.
- Generic writes follow a full-replace pattern safely: `update_resource` fetches the current record and merges your fields over it, so untouched fields aren't nulled.
- `create_block` and `update_block` always set `type: "html"` and reject any other type **before** contacting the portal.

---

## Write safety

Every write is tagged with a **risk domain**, and each domain is gated independently:

| Domain | Covers | Default | Enable with |
|--------|--------|---------|-------------|
| `content` | blocks, layouts, partials, themes, queries, snippets, translations, dashboards, tags | **on** | (on unless read-only) |
| `data` | datasources, db_modifications, `run_db_modification` | **off** | `PORTAL_ALLOW_DATA_WRITES=1` |
| `admin` | users, groups, permissions, access policies, API keys, credentials, system, config, passwords | **off** | `PORTAL_ALLOW_ADMIN_WRITES=1` |

- **`PORTAL_READONLY=1`** disables *every* write regardless of domain — reads and discovery still work.
- A blocked write returns a clear message naming the flag to set; nothing is sent to the portal.
- `run_db_modification` additionally requires `confirm: true` on every call.
- Deletes and password/user mutations are marked **destructive** to MCP clients.

In the Claude Desktop bundle these are toggles in the install dialog (Read-only mode, Allow data writes, Allow admin writes). For other clients, set them as env vars.

---

## Resilience, observability & hardening

Production-grade behaviour for a local, single-user server. Everything below has safe defaults and needs no configuration.

**Resilience** — the portal HTTP client (the single path every tool calls through):

| Behaviour | Default | Tune with |
|-----------|---------|-----------|
| Per-attempt timeout | 30 s | `PORTAL_TIMEOUT_MS` |
| Retries on transient failure (network, 408/425/429/5xx) with exponential backoff + jitter, honouring `Retry-After` | 2 | `PORTAL_MAX_RETRIES`, `PORTAL_BACKOFF_BASE_MS`, `PORTAL_BACKOFF_MAX_MS` |
| Circuit breaker — fail fast while the upstream is clearly down | opens after 5 consecutive failures, 15 s cooldown | `PORTAL_BREAKER_THRESHOLD`, `PORTAL_BREAKER_COOLDOWN_MS` |
| Max request body size | 5 MB | `PORTAL_MAX_BODY_BYTES` |
| Max tool input size (rejected at the MCP boundary, before any handler) | 2 MB | `PORTAL_MAX_INPUT_BYTES` |

Retry safety: `GET` retries on any transient signal; writes (`POST`/`PUT`/`DELETE`) retry only on a pre-response network error or an explicit `429`/`503` — never on an ambiguous `502`/`504` that may already have applied.

**Observability** — every tool call gets a request id, latency, and an error tally:

- **`get_metrics`** (always-on) reports per-tool call count, error rate, latency (avg/max/last), uptime, and the upstream breaker state. Metadata only — no payloads or secrets. Resets on restart.
- `get_capabilities` also reports the upstream breaker state.
- Set **`PORTAL_LOG_FORMAT=json`** for structured (one-JSON-line-per-event) logs to **stderr**; otherwise readable logs appear under `PORTAL_DEBUG=1`.

**Output secret redaction** — secret-bearing fields (`password`, `secret`, `token`, `api_key`, `private_key`, `credentials`, …) are masked as `[redacted]` on resource **read** responses, so hashes/tokens/connection secrets never flow into the model's context. Identifier fields (`*_id`) are never masked, and create/update responses are returned intact so a freshly generated secret can be seen once. Disable with **`PORTAL_REDACT_SECRETS=0`** (e.g. to retrieve a stored key).

The portal base URL is validated as a well-formed `http(s)` origin at startup.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "Missing portal credentials: …" | One of `PORTAL_URL` / `PORTAL_API_KEY` / `PORTAL_USER_ID` is blank. Re-enter it in the bundle's settings (or your client's `env`). |
| "Portal login failed: HTTP 401/403" | Wrong API key or user ID, or the user lacks permission. Regenerate the key and confirm the user can manage blocks. |
| `list_resource` (resource: query) says the endpoint isn't available | Your portal predates the saved-queries API (1.18+). Use `list_resource` with `resource: "datasource"` instead — this is expected, not an error. |
| Tools don't appear in Claude | Reinstall the `.mcpb`, or restart Claude Desktop. For the clone path, make sure `npm run build` succeeded and the `args` path points at `dist/index.js`. |
| Want to see what it's doing | Set `PORTAL_DEBUG=1` in the server's environment (or `PORTAL_LOG_FORMAT=json` for structured logs). Logs go to **stderr** only. |
| "circuit breaker is open" errors | The portal upstream failed repeatedly and the breaker is failing fast; it auto-recovers after a short cooldown. Check the portal is reachable; `get_metrics` shows the breaker state. |
| A stored secret comes back as `[redacted]` | Output redaction masks secret fields on reads. Set `PORTAL_REDACT_SECRETS=0` for that session to retrieve it. |

---

## Development

```bash
npm install
npm run build                 # tsc -> dist/
PORTAL_DEBUG=1 npm start       # run locally on stdio (debug logs to stderr)

npm test                       # build + run the test suite (no portal/network needed)

# Interactive testing with the MCP Inspector:
npx @modelcontextprotocol/inspector node dist/index.js
```

### Tests

`npm test` compiles the suite to `dist-test/` and runs it with the Node test
runner. The tests need no portal credentials and make no network calls:

- `test/rules.test.ts` — unit tests for the block authoring validator
  (`validateBlock`): each footgun rule (`no_unsafe_js`, `no_raw_dollar`,
  `enforce_theme_vars`, …) and the partial-update behaviour.
- `test/config.test.ts` — the write-safety posture (`blockReason`) and the
  tool-gating policy (allowlist/denylist, deny-wins, tool-vs-group).
- `test/contract.test.ts` — end-to-end MCP contract tests: a real client driving
  the real server over an in-process transport (initialize, `tools/list`,
  input-schema rejection, the validation pipeline, and gating).

Project layout:

```
src/                 # MCP server source (compiled to dist/)
  index.ts           #   stdio entrypoint
  server.ts          #   tools, resources, prompts
  portalClient.ts    #   auth + request (login, X-Api-Key, 401 retry)
  config.ts          #   layered credential resolution (project > env > bundle)
  resources.ts       #   generic resource registry
  rules.ts           #   block authoring rules + validation
  design.ts          #   design-system resource
  portalVc.ts        #   git version control of content writes
  guidance.ts        #   bundled authoring guidance (the zportal://guide resources)
assets/              # runtime-loaded: conventions.md, design.md, rules.json
manifest.json        # MCPB bundle manifest (Claude Desktop install + config prompts)
.claude/             # Claude Code agent ecosystem (agents, commands, skills, workflows)
docs/                # user documentation
reference/           # API swagger + block-example corpus (not shipped in the .mcpb)
context/             # development notes, overview, deck (not shipped)
```

For local development you can drop a project config at `./.zuar-portal/config.json` (or run
`init_project_config`) with a `portal` section — and optionally a `vc` section — instead of using env vars:

```json
{ "portal": { "url": "https://your-portal.zuarbase.net", "apiKey": "…", "userId": "…" } }
```

`./.zuar-portal/` and any `config.json` are gitignored — never commit them.

---

## Building the .mcpb bundle

```bash
npm install -g @anthropic-ai/mcpb   # or use: npx @anthropic-ai/mcpb <cmd>
npm install
npm run build
npm prune --omit=dev                # production node_modules only
mcpb validate manifest.json
mcpb pack                           # -> zuar-portal-mcp.mcpb
```

`.mcpbignore` excludes `src/`, dev files, any local `config.json` / `.zuar-portal/`, and the non-runtime `reference/`, `context/` and `.claude/` directories from the bundle. Attach the resulting `.mcpb` to a GitHub Release so non-developers can one-click install it.

---

## Security

- Credentials are **never logged**. Debug output (gated by `PORTAL_DEBUG=1`) goes to stderr only, so it never corrupts the MCP stdio stream.
- The API Key and User ID are declared **sensitive** in the bundle manifest — masked in the UI and stored securely by Claude Desktop.
- The server talks only to the Portal URL you configure.
- `create_block` / `update_block` are restricted to `type: "html"` and reject other types before any portal call.
- Secret-bearing fields are **redacted** from resource read responses; tool inputs and request bodies are **size-capped**; the portal URL is validated.

See [`SECURITY.md`](SECURITY.md) for the full posture: the per-tool-group data-touch matrix, credential handling, network egress, and data retention.

---

## License

MIT. See [`LICENSE`](LICENSE).
