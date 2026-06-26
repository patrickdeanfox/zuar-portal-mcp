---
name: portal-block-pipeline
description: Trigger when building or reviewing a Zuar Portal block through the quality pipeline (build → style → responsive → debug → adversary → advisor), when the user runs /portal-build, or when deciding which block-specialist agent to use. This is the repo's orchestration layer on top of the global zportal/currentblock skills.
---

# Portal block pipeline (repo orchestration)

Blocks are **never created raw**. A spec flows through gated specialist stages, each one
an agent in `.claude/agents/`. This skill is the thin orchestration map; the *how* of
block authoring lives in the global skills — load **`zportal`** (zPortal API + the two-field
block structure), **`currentblock`** (`currentBlock.queryResults` data access), and
**`decompose-html-to-zportal-blocks`** (splitting a monolith into blocks) — and the enforced
rules in **`assets/conventions.md`** + house style in **`assets/design.md`**. Do not work from
memory; read those.

## The gated pipeline

```
spec → builder → stylist → responsive → debugger → adversary → advisor → ship
        (build)  (polish)  (mobile)    (fix bugs)  (break it)  (align)
```

Run it via the **`/portal-build`** command (`.claude/commands/portal-build.md`) for one block,
or the **`.claude/workflows/portal-block-pipeline.js`** workflow for a hands-off run that loops
automatically. Drive each stage with the Task tool and **pass the previous stage's output
(the `block_id` + its notes) into the next** — stages share state through that handoff, not
through re-discovery.

## Stage roles + output contract

| Stage | Agent | Does | Hands off |
|---|---|---|---|
| Build | `portal-block-builder` | discovers data, verifies real columns, authors the two fields, binds via `ui_queries`, validates, creates | `block_id`, bound `query_id`/datasource, exact column aliases, fallbacks/async paths, open questions |
| Style | `portal-block-stylist` | applies `assets/design.md` — hierarchy, color, type, spacing, elevation. CSS + structure **only**; never touches JS logic or the binding | restyled `block_id`, design decisions |
| Responsive | `portal-responsive-specialist` | breakpoints, fluid grids, ≥44px touch targets, no overflow (see the `portal-responsive` skill) | breakpoints handled, residual width risks |
| Debug | `portal-block-debugger` | fixes runtime footguns: the `$` trap, AMD/`window.define` race, `queryResults` shape, dropped `:root` tokens, missing loaded-callback, re-render leaks | fixes applied, anything still suspect |
| Adversary | `portal-block-adversary` | **read-only gate** — red-teams for silent-data traps + edge cases, with evidence | findings list (severity + `blocking`) and a **`ship` / `needs-fixes`** verdict |
| Advisor | `portal-block-advisor` | **read-only** — does it serve the business question, the user, the data? | substance/UX recommendations |

Every stage **grounds itself first** in `assets/conventions.md` + `assets/design.md` and confirms
the live portal version with `get_version` (currently v1.19; data read synchronously from
`currentBlock.queryResults[n]`).

## How `validate_block` gates each authoring step

Any stage that **mutates** the block (builder, stylist, responsive, debugger) must call
**`validate_block`** on its `json_data` + `css` **before** `create_block`/`update_block`. Fix
every **error** and structural warning; don't write until it's clean. `validate_block` is the
enforced floor (it catches `no_raw_dollar`, unscoped CSS, section-separation, safety) — the
adversary catches what it can't.

**The cross-stage footgun:** an `update_block` on an already-bound block MUST re-send the
existing `ui_queries`, or the binding is wiped and the block goes blank. Stylist, responsive,
and debugger all `get_block` first and re-send `ui_queries` verbatim.

## When to loop

The **adversary** is the decision point. If it returns any `blocking:true` finding, its verdict
is `needs-fixes` → **loop back to the debugger** with those findings, then re-run the adversary.
Cap at ~2 rounds; if still blocked, surface the remaining findings to the user rather than
shipping. A clean adversary pass (`ship`) advances to the advisor, then ship.

## Choosing an agent directly (not the whole pipeline)

- New block from a spec, or empty/wrong data → **builder**.
- Looks plain / off-brand → **stylist**.
- Breaks, overflows, or clips on small screens → **responsive-specialist** (+ the `portal-responsive` skill).
- Blank/garbled at runtime, charts vanish, block fails to inject → **debugger**.
- "Is this correct / will it lie on real data?" before shipping → **adversary** (read-only).
- "Does this answer the question?" → **advisor** (read-only).
- Portal-wide theming/tokens → **portal-theme-designer** (see `theme-factory` / `zuar-theme`).

Splitting a monolithic HTML dashboard into many blocks is a *pre*-pipeline step — use the global
**`decompose-html-to-zportal-blocks`** skill, then run each resulting block through this pipeline.
