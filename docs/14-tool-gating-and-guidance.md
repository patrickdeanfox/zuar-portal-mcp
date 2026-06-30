# 14 · Tool Gating & Guidance `[2.5.0]`

The enterprise surface controls added in **v2.5.0**: scope the tool surface down to what a deployment
should expose, guide whoever (or whatever) drives the server toward the right next step, and keep an
opt-in metadata audit trail of every write. Nothing here changes what a *call* does — it changes which
calls exist, how they're explained, and what gets recorded.

> All of v2.5.0 only takes effect once the **v2.5.0 build is running** (`npm run build` + `.mcpb`
> repack + MCP restart). The tool surface is **frozen at startup** — see
> [02 · Updating after code changes](02-install-and-config.md#updating-after-code-changes).

## Why

The defaults assume a builder driving a portal they own. Enterprise deployments often want the opposite:
**least privilege** (an analyst-facing server that can build blocks but can never touch users or portal
config) and **guided usage** (so an operator — or an agent — orients before acting instead of guessing
at 44 tools). v2.5.0 adds three independent levers for that:

- **Tool gating** — freeze the tool surface to a chosen subset of capability groups.
- **Guided usage** — server `instructions`, a `get_capabilities` tool, and a `zuar_portal_quickstart`
  prompt that route to the right tool/agent.
- **Audit log** — an append-only, metadata-only record of every write.

These compose with the existing **write-safety domains** (content/data/admin — see
[02 · Write-safety domains](02-install-and-config.md#write-safety-domains-important)): gating decides
which tools *exist*, write safety decides which writes *go through*.

## Tool gating (capability scoping)

Every tool belongs to exactly one **group**. An operator can disable whole groups (or single tools) so
they're never registered — they don't appear in the tool list, can't be called, and `get_capabilities`
reports them as off.

### The groups

| Group | Tools | Notes |
|-------|-------|-------|
| `discovery` | `get_version`, `get_rules`, `describe_resource`, `get_me`, `suggest_name`, `parse_name` | Read-only introspection + the naming grammar. |
| `blocks` | `list_blocks`, `get_block`, `validate_block`, `create_block`, `update_block`, `delete_block`, `bind_block_query`, `add_block_to_page`, `remove_block_from_page`, `set_page_blocks` | Typed HTML authoring + page placement. |
| `resources` | `list_resource`, `get_resource`, `create_resource`, `update_resource`, `delete_resource`, `validate_portal` | Generic CRUD over every other resource + the read-only integrity sweep. |
| `data` | `fetch_sample_rows`, `profile_datasource`, `execute_query`, `run_db_modification` | SQL / datasources / db modifications. |
| `users` | `get_user_groups`, `set_user_groups`, `get_user_permissions`, `set_user_permissions`, `change_password`, `update_me` | Users / groups / permissions / passwords. |
| `config` | `get_config`, `update_config` | The portal configuration document. |
| `vc` | `vc_status`, `snapshot_portal`, `vc_log`, `restore_resource` | Git version control of content. |
| `setup` | `active_config`, `init_project_config`, `setup_portal` | Per-project credential bootstrap (`setup_portal` is the elicitation-guided variant). |
| `design` | `design_intake` | Guided theming — elicit design prefs, synthesize + create a `theme`. |

**`get_capabilities` and `get_metrics` are always-on** (their own `meta` group) and **`active_config`
stays available** even when the `setup` group is gated off — so an operator can always *see* the posture,
read the metrics, and *fix* the configuration. (You can still kill any of them by naming it explicitly in
a denylist — see below.)

### Denylist vs allowlist

| Mode | Default for | Behavior |
|------|-------------|----------|
| **denylist** | default | Everything is on **except** the groups/tools you list. |
| **allowlist** | inferred when you list anything to *enable* | **Only** the groups/tools you list are on; everything else is off. |

The mode is inferred — listing names to enable flips the server to allowlist; listing only names to
disable stays denylist — but you can pin it explicitly with `PORTAL_TOOLS_MODE` /
`tools.mode`. **A `disable` entry always wins**, in either mode: a denied group/tool is off even if an
allowlist also lists it.

### How to configure it

**Environment variables:**

| Env var | Effect |
|---------|--------|
| `PORTAL_DISABLE_TOOLS` | Comma/space-separated group **or** tool names to turn **off** (denylist). |
| `PORTAL_ENABLE_TOOLS` | Names to turn **on** — setting it flips the server to **allowlist** (everything else off). |
| `PORTAL_TOOLS_MODE` | Pin the mode explicitly: `allowlist` or `denylist`. |

Names may be **groups** (`users`) or **individual tools** (`set_user_groups`), are case-insensitive,
and split on commas or whitespace.

**Project config** — the same controls live in the `tools` section of `./.zuar-portal/config.json`
(see [02 · Per-project configuration](02-install-and-config.md#per-project-configuration-multiple-portals)):

```json
{
  "portal": { "url": "https://team-a.zuarbase.net", "apiKey": "…", "userId": "…" },
  "tools":  { "disable": ["users", "config"], "enable": [], "mode": "denylist" }
}
```

### Precedence (project wins)

Resolution is **project > env > bundle**, but with one deliberate twist for safety:

- **A project `tools.enable`/`tools.disable` is authoritative and is *not* unioned with env.** When the
  project file sets either list, env is ignored for that list. This means **env can never *expand* a
  project allowlist** — an operator can't re-grant a surface a project deliberately locked off. Env
  composes with the bundle layer only when the project file is *silent* on tools.
- **Deny always wins** — a name in any active `disable` list is off regardless of mode or any enable.
- **The surface is frozen at startup.** Tools are registered once when the server boots;
  `get_capabilities` reports that frozen snapshot (so it can never claim a tool exists that wasn't
  registered). Changing gating config — even via `init_project_config` mid-session — has no effect
  until you **restart** the server.

### Examples

```bash
# Hide user/permission and portal-config tools (everything else stays on) — denylist.
PORTAL_DISABLE_TOOLS=users,config

# A build-only surface: only block authoring, generic resources, and data exploration.
# Setting PORTAL_ENABLE_TOOLS flips to allowlist, so users/config/vc/setup are all off.
PORTAL_ENABLE_TOOLS=blocks,resources,data
```

In the first case the server still exposes blocks, resources, data, vc, discovery, and setup; in the
second only `blocks`, `resources`, `data` (plus the always-on `get_capabilities` / `active_config`).
Call **`get_capabilities`** after a restart to confirm the surface came up as intended.

## Guided usage

Three layers help whoever drives the server orient before acting — no skill setup required.

- **Server `instructions`** — surfaced to the client at `initialize`. They state where to start
  (`active_config` → `get_capabilities` → `get_version`), the two-field block rules and the `$` trap,
  and the write-safety posture. A capable client shows or follows them automatically.
- **`get_capabilities`** — the orient-before-acting tool. It reports, with all secrets redacted: which
  tool **groups and tools** are enabled vs disabled, the **gating mode + source**, the **write-safety
  posture** (read-only / content / data / admin), **version-control status**, whether **audit logging**
  is on, and the **active config + portal**. It's always available, so it works even on a heavily gated
  surface.
- **`zuar_portal_quickstart`** (prompt) — confirms the posture (calls `active_config` +
  `get_capabilities`), summarizes it in a line or two, then routes to the right next step: the
  `create_zportal_block` prompt or Claude Code's `/portal-build` pipeline for authoring,
  `list_resource`/`profile_datasource`/`execute_query` for data exploration, `/portal-theme`,
  `/portal-bulk`, `/portal-audit`, or `/portal-align`. Takes an optional `goal`.

**Init/setup** flows through the `setup` group: **`active_config`** (which portal am I on?) →
**`init_project_config`** (write + validate this folder's config) → the **`setup_zuar_project`** prompt
for the conversational walk-through. From Claude Code, the [agent ecosystem](../.claude/README.md) wraps
all of this — `/portal-setup`, the specialist subagents, and gated workflows; see
[13 · Agents & Workflows](13-agents-and-workflows.md).

## Audit log

An **opt-in, append-only** record of every write the server performs — complementary to, not a
replacement for, the [version-control mirror](07-version-control.md).

- **Enable it** with **`PORTAL_AUDIT_LOG`** (a file path) or an `audit` path/section in
  `./.zuar-portal/config.json` (`"audit": "/path/to/audit.jsonl"`). Unset = disabled (a true no-op).
- **Format:** one JSON object per line (**JSONL**), appended — never rewritten.
- **Metadata only:** each line is `{ ts, domain, op, kind, id }` — a timestamp, the risk domain
  (`content`/`data`/`admin`), the operation (`create`/`update`/`delete`/…), the resource kind, and the
  record id. **No payload bodies, no SQL, no secrets** ever touch the file.
- **Scope:** unlike the VC mirror (content only), the audit log covers **content, data, *and* admin**
  writes — so user-membership replacements, db modifications, and config changes are recorded too.
- **Safe targets only:** it **refuses a pseudo/non-regular path** (`/dev/*`, `/proc/*`, `/sys/*`, or an
  existing directory/fifo/socket) — appending JSONL there would corrupt the MCP stdio JSON-RPC framing.
  A not-yet-existent regular path is fine (it's created on first write). Append failures are swallowed,
  so a bad path can never break a portal write.
- **Reported, not leaked:** `get_capabilities` reports `audit: { enabled, path }` with only the
  **basename** of the path (the absolute path is harvestable infra detail).

| | Version control (`vc`) | Audit log |
|---|---|---|
| Stores | full record JSON | metadata only |
| Domains | content only | content + data + admin |
| Rollback | yes (`restore_resource`) | no (record only) |
| Enable | `PORTAL_VC_DIR` | `PORTAL_AUDIT_LOG` |

Use the VC mirror to **revert** content; use the audit log to **answer "who changed what, when"** across
every domain. See [07 · Version Control](07-version-control.md).

## Live resource templates

Three resource templates let a user **@-mention a real portal record as context** instead of spending a
tool call to fetch it:

| Template | Returns | Gated by |
|----------|---------|----------|
| `zportal://block/{id}` | A live block (HTML/CSS + binding) as JSON | `blocks` group (via `get_block`) |
| `zportal://layout/{id}` | A live page/layout (grid + placement) as JSON | `resources` group (via `get_resource`) |
| `zportal://datasource/{id}` | A live datasource (columns + config) as JSON | `data` group (via `fetch_sample_rows`) |

Each template is **gated by the same group as its read tool**, so the read surface stays consistent: if
you disable the `blocks` group, `zportal://block/{id}` disappears alongside `get_block` — otherwise
disabling blocks would remove the tool but still leak block content through an @-mention. (These are
distinct from the static `zportal://guide/*` authoring-guidance resources, which are always present.)

## Confirmation gating

Independently of write-safety domains, the **destructive** tools require an explicit `confirm: true`
argument — a guard against an accidental or hallucinated call wiping content:

| Tool | What `confirm:true` guards |
|------|----------------------------|
| `delete_block` | Deleting a block by UUID. |
| `delete_resource` | Deleting any generic record. |
| `set_user_groups` | **Replacing** a user's entire group membership. |
| `set_user_permissions` | **Replacing** a user's entire permission set. |
| `set_page_blocks` (when `replace: true`) | Rebuilding a page — `replace` clears its existing blocks first. |
| `run_db_modification` | Executing a saved DB write. |

Without `confirm: true` these return an actionable refusal and send nothing to the portal. Deletes and
user/membership mutations are also marked **destructive** to MCP clients (which may surface their own
confirmation UI). This stacks on top of domain gating: `run_db_modification` and the `set_user_*` tools
still need their domain flag (`PORTAL_ALLOW_DATA_WRITES` / `PORTAL_ALLOW_ADMIN_WRITES`) *and* `confirm`.
