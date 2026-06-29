# Zuar Portal MCP — Documentation

The **zuar-portal-mcp** server lets Claude operate a [Zuar Portal](https://www.zuar.com/) (zPortal)
end to end: author HTML blocks, build pages, manage datasources/queries/themes/users, explore data,
and (new in 2.2.0) keep a git-versioned, revertible history of every content change — all through
natural language.

> **Versions:** these docs describe the MCP server at **v2.6.0** (current on `main`), targeting a
> **Zuar Portal 1.19** instance (the in-block data API is the stable "v1.18+" shape). Feature flags
> like **`[2.2.0]`** / **`[2.5.0]`** mark the release a surface landed in. New tools/rules/version-control
> take effect in your **running** server only after `npm run build` + `.mcpb` repack + MCP restart.

## Start here
- **New to the server?** → [01 · Overview](01-overview.md)
- **Setting it up?** → [02 · Install & Configuration](02-install-and-config.md)
- **Want the full tool list?** → [03 · Tools Reference](03-tools-reference.md)
- **Driving it from Claude Code?** → [13 · Agents & Workflows](13-agents-and-workflows.md)

## Documentation map

| # | Doc | Read it when you want to… |
|---|-----|---------------------------|
| 01 | [Overview](01-overview.md) | Understand what the server is and how it's structured |
| 02 | [Install & Configuration](02-install-and-config.md) | Install it, set per-project (multi-portal) credentials, and tune the write-safety, tool-gating, audit, VC + design env vars |
| 03 | [Tools Reference](03-tools-reference.md) | Look up any of the 40 tools — params, risk domain, examples |
| 04 | [Authoring Blocks](04-authoring-blocks.md) | Build HTML blocks: data binding, `queryResults`, the safe build flow |
| 05 | [Authoring Rules](05-authoring-rules.md) | Know what `create_block`/`update_block` enforce, and configure it |
| 06 | [Design System](06-design-system.md) | Give every block one house look via `design.md` (+ design skills) |
| 07 | [Version Control](07-version-control.md) | Track + revert portal changes with git **`[2.2.0]`** |
| 08 | [zPortal In-Block API](08-zportal-in-block-api.md) | Use `zPortal`/`currentBlock` inside a block (filters, charts, modals) |
| 09 | [Related Skills](09-related-skills.md) | Pick the right Claude skill for a zPortal task |
| 10 | [Recipes](10-recipes.md) | Follow end-to-end use cases (dashboards, drill-down, write-back) |
| 11 | [Loops & Automation](11-loops-and-automation.md) | Use loops/schedules for automation + data exploration |
| 12 | [Troubleshooting](12-troubleshooting.md) | Fix blank blocks, empty data, wiped bindings, token dumps |
| 13 | [Agents & Workflows](13-agents-and-workflows.md) | Drive portal work with Claude Code subagents, slash commands, and gated workflows |
| 14 | [Tool Gating & Guidance](14-tool-gating-and-guidance.md) | Capability scoping (enable/disable tool groups), guided usage, audit log |
| 15 | [Structural Integrity Gate](15-structural-integrity.md) | Understand the hard write-gate that stops the server writing a portal-breaking record (the "all pages vanished" class of bug) |
| 16 | [Safety & Integrity Gates](16-safety-and-integrity.md) | The full safety surface — referential integrity, pre-delete impact, mass-write SQL guard, admin lockout, and the read-only `validate_portal` sweep |

## The one-minute mental model
- **Blocks** are HTML/JS/CSS surfaces. They **bind to data** through a saved **query** (which wraps a
  **datasource**) via the block's `ui_queries`. Inside a block, data arrives synchronously on
  `currentBlock.queryResults[n]`.
- **Pages** (called **layouts**) place blocks on a responsive grid (`lg`/`md`/`sm`).
- **Filters** are native and cross-block: `zPortal.dataSource.setFilters(col, [val])` re-queries every
  bound block on the page.
- **Write safety** is layered: *content* writes (blocks/pages/queries/themes) are on by default;
  *data* (SQL) and *admin* (users/security) writes are opt-in env flags.
- **Authoring rules** validate every block before it's saved; **`design.md`** guides its look;
  **version control** commits every content change so you can revert.

## Quick links into the source
- Tools + safety wiring: `src/server.ts`
- Generic resource registry: `src/resources.ts`
- Structural write-gate (portal-breaking-shape guard): `src/structure.ts` → [15 · Structural Integrity Gate](15-structural-integrity.md)
- Cross-record + operation safety (refs, dependents, SQL, admin): `src/safety.ts` → [16 · Safety & Integrity Gates](16-safety-and-integrity.md)
- Authoring rules + conventions: `src/rules.ts`, `assets/rules.json`, `assets/conventions.md`
- Design system: `src/design.ts`, `assets/design.md`
- Version control: `src/portalVc.ts`
- In-block guidance resources: `src/guidance.ts`
- HTTP client + auth: `src/portalClient.ts`
- Credentials + safety config: `src/config.ts`
