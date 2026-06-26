# 09 · Related Skills

The MCP server provides the **tools** (API access, validation, VC). Claude **skills** carry the deep
authoring knowledge and repeatable workflows. They're complementary: the skill knows *how* to write a
great block; the MCP *creates and binds* it. The server also bundles a subset of this knowledge as
`zportal://guide/*` resources so it works even without a skill installed.

> Availability varies by environment — skills are surfaced by the client. Invoke a skill with the Skill
> tool (or `/<name>`). Below is the zPortal-relevant catalog and when to reach for each.

## Core zPortal authoring
| Skill | Use it when… |
|-------|--------------|
| **`zportal`** | Anytime you write code for a zPortal HTML block — the global `zPortal` API, `currentBlock.queryResults`, `ui_queries` binding, filtering, charts, two-field structure. The default companion to this MCP. |
| **`currentblock`** | You're reading block data — `queryResults`, `.columns`/`.data`/`.mappedData`, `getQueryData`, reacting to filter changes. Authoritative on the block data scope. |
| **`clusterize-zportal`** | Building a high-performance virtualized table for thousands of rows (Clusterize.js) — sortable/searchable, synced headers, reactive to filters. |
| **`decompose-html-to-zportal-blocks`** | You have a monolithic HTML/JS/CSS dashboard or prototype and want it split into discrete portal blocks (header, filters, charts, table, modals), with cross-block wiring and theming. |
| **`db-modifications`** | Writing data back from a block — forms, inserts/updates, the `/api/db_modifications` flow (admin-side definition + client-side execution). Pairs with the `run_db_modification` tool. |

## Migration, handoff & readiness
| Skill | Use it when… |
|-------|--------------|
| **`zportal-migration`** | Moving blocks/pages between portal versions or environments. |
| **`zportal-readable-handoff`** | Producing a clean, readable handoff of block code for humans. |
| **`zuar-portal-ready`** | Getting content production-ready for a Zuar Portal. |
| **`tableau-to-zuar`** | Converting a Tableau dashboard (`.twb`/`.twbx`) into a Zuar Portal page + blocks — maps each worksheet→block, dashboard filters→a native filter bar, and zones→the layout grid; v1 binds to **existing** Zuar datasources. Project-local (lives in this repo's `.claude/skills/`); the XML parser is finalized against a real sample workbook. |

## Look & feel
| Skill | Use it when… |
|-------|--------------|
| **`zuar-theme`** | Working with portal theme tokens / theming a portal. |
| **`brand-design-systems`** | You want a page to match a **named brand** (Stripe, Linear, Notion, Apple, …). 74 bundled brand specs. Layer this over the house [design system](06-design-system.md) for a one-off branded surface. |
| **`amcharts5`** | The user explicitly wants amCharts 5 (otherwise prefer ECharts/Chart.js per the charting policy). |
| **`frontend-design`**, **`ui-ux-pro-max`** | General UI polish, layout, color/typography, component design beyond the house defaults. |

> The house **`design.md` design system is not a skill** — it's built into the MCP
> ([06](06-design-system.md)); don't look for a "design-system skill". A portal **theme**
> (`zuar-theme`) is distinct again: theme = runtime color/font tokens; design system = authoring
> guidance that derives from them.

## How skills, the MCP, and bundled guides relate
- **Bundled `zportal://guide/*` resources** (always available via the MCP): `block-structure`,
  `currentblock`, `zportal-api`, `charting`, `conventions` (active rules), `design-system`. These are a
  distilled baseline injected into the authoring prompt.
- **Skills** go deeper and cover workflows the guides don't (decomposition, virtualized tables,
  migration, brand styling).
- **The MCP's `validateBlock`** is the backstop: even if guidance is skipped, structural/safety rules
  (and `no_raw_dollar`) reject broken blocks at write time.

**Rule of thumb:** load `zportal` + `currentblock` for any block work; add `clusterize-zportal` for big
tables, `decompose-html-to-zportal-blocks` for porting a prototype, `db-modifications` for write-back,
and a design skill (`brand-design-systems`/`zuar-theme`) when you want a look beyond `design.md`.
