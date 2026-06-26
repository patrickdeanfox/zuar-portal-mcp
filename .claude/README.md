# Zuar Portal — Claude Code agent ecosystem

This `.claude/` directory turns the Zuar Portal MCP server into a **team of specialists**
you drive from Claude Code. The MCP server gives Claude the *tools* (create blocks, bind
queries, profile data, version control…); these agents, commands, skills and workflows give
it the *expertise and process* to use them well — grounded in `assets/conventions.md` (the
enforced authoring rules) and `assets/design.md` (the house visual system).

> Works when this repo is your Claude Code working directory. Per-project portal credentials
> live in `./.zuar-portal/config.json` (run `/portal-setup` or the `setup_zuar_project` prompt).

## The block pipeline

Blocks are never created raw. They flow through quality gates, each a specialist agent:

```
spec → builder → stylist → responsive → debugger → adversary → advisor → ship
        (build)  (polish)  (mobile)    (fix bugs)  (break it)  (align)
```

- **portal-block-builder** — discovers data, verifies columns, authors the two-field block, binds, validates, creates. Correct + real-data.
- **portal-block-stylist** — applies `assets/design.md`: hierarchy, color, type, spacing, elevation, great UI/UX.
- **portal-responsive-specialist** — breakpoints, fluid grids, mobile/touch, no overflow.
- **portal-block-debugger** — hunts and fixes the runtime footguns (`$` trap, AMD/`window.define` race, `queryResults` shape, dropped `:root` tokens, missing loaded-callback, re-render leaks).
- **portal-block-adversary** — read-only red team: tries to break the block, find silent-data traps and edge cases. Gate, not author.
- **portal-block-advisor** — read-only: does this serve the business question / the user / the data? UX and substance.

## Domain specialists

- **portal-data-expert** — profiles datasources & queries, recommends viz + aggregations, validates bindings, designs filters. The data brain behind every block.
- **portal-theme-designer** — portal-wide theming: tokens, light/dark, brand alignment, applying a theme across blocks.
- **portal-bulk-operator** — safe bulk changes across many blocks/pages (snapshot-first, dry-run, atomic `set_page_blocks`).
- **portal-onboarding** — the alignment Q&A: learns the user, their business, their portal and their data, then writes the project config + a brief the other agents read.

## Slash commands (`commands/`)

| Command | What it runs |
|---|---|
| `/portal-setup` | First-time per-project setup + alignment Q&A → `.zuar-portal/config.json` + project brief. |
| `/portal-build` | The full build→style→responsive→debug→adversary→advisor pipeline for one block. |
| `/portal-theme` | Theme the portal (or a block family) via the theme-designer. |
| `/portal-bulk` | A guarded bulk change across many blocks/pages. |
| `/portal-audit` | Audit existing blocks for bugs, a11y, responsiveness, and design fit. |
| `/portal-align` | Run the alignment Q&A on its own (business / portal / data discovery). |

## Skills (`skills/`)

Thin, repo-specific process knowledge that **points at** the rich global skills
(`zportal`, `currentblock`, `decompose-html-to-zportal-blocks`, `db-modifications`) rather
than duplicating them: `portal-block-pipeline`, `portal-responsive`, `portal-bulk-ops`.

## Workflows (`workflows/`)

Deterministic multi-agent orchestration scripts for the `Workflow` tool:
- `portal-block-pipeline.js` — fan a spec through the gated pipeline, looping while the adversary finds blocking issues.
- `portal-audit.js` — fan auditors across every block and synthesize a ranked report.

## Design & safety notes
- Source of truth is always the live portal + `assets/conventions.md` + `assets/design.md` — agents read them, they don't guess.
- Writes are mirrored to the version-control repo when configured (`vc_status`), so any change is revertible (`restore_resource`).
- Data (SQL) and admin (users/security) writes stay opt-in (`PORTAL_ALLOW_DATA_WRITES` / `PORTAL_ALLOW_ADMIN_WRITES`); content/block writes are on by default.
