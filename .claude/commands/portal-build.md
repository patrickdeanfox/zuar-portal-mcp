---
model: sonnet
effort: medium
description: Build a portal block end-to-end through the quality pipeline.
argument-hint: <what the block should show/do>
---

Build one portal block end-to-end. Spec: **$ARGUMENTS**

**Pre-flight.** Confirm a portal is connected: call `active_config`. If nothing is active, stop and tell the user to run `/portal-setup` first. Note `config.browser.claudeInChrome` — when it's on (and the block lands on a page), the pipeline can **visually verify** the block (see step 6).

**One-shot option.** If the user just wants it done hands-off, offer the automated Workflow `.claude/workflows/portal-block-pipeline.js` — it fans the spec through the same gated pipeline below (looping while the adversary finds blocking issues) without step-by-step narration. Pass the **`page_id`** (so the block is placed and the Visual gate has a URL), and — when `config.browser.claudeInChrome` is on — **`portal_url`** (the base from `active_config`) so the Visual gate can resolve the page without a round-trip. Pass a **`tier`** in the workflow `args` to dial cost vs. quality, inferred from how the user framed the ask:
- `tier:'fast'` — a quick / rough / throwaway block ("just sketch", "rough draft", "while iterating"). Cheapest: sonnet/haiku at low effort.
- `tier:'standard'` (default) — a normal build. Balanced: sonnet builders, opus judgment gates.
- `tier:'max'` — a production / executive / "make it great" build. Opus builders + deepest-effort gates.

When in doubt use `standard`; only go `max` if the user signals it matters. (Running the pipeline **manually** below uses each agent's own default model — the `standard` blend.) Otherwise run the pipeline manually:

**The pipeline** (each stage via the Task tool; pass each stage's output — the `block_id` and its notes — to the next; blocks are never shipped raw):

1. **portal-block-builder** — discovers data, verifies real columns, authors the two-field block, binds via `ui_queries`, validates, creates. Returns the `block_id`.
2. **portal-block-stylist** — applies `assets/design.md` (hierarchy, color, type, spacing, elevation). CSS + structure only; never touches JS logic or the binding.
3. **portal-responsive-specialist** — breakpoints, fluid grids, touch targets, no overflow.
4. **portal-block-debugger** — fixes runtime footguns (the `$` trap, AMD/`window.define` race, `queryResults` shape, dropped `:root` tokens, missing loaded-callback, re-render leaks).
5. **portal-block-adversary** — read-only gate; red-teams the block for silent-data traps and edge cases. **If it returns blocking findings, loop back to the debugger** with those findings, then re-run the adversary. Cap at ~2 rounds; if still blocked, surface the remaining findings to the user.
6. **Visual gate** (best-effort) — when `config.browser.claudeInChrome` is on, the block is placed on a page, and the Claude for Chrome tools are connected: have the **portal-block-adversary** (it has browser eyes) open the live page, screenshot the block, and read the console — confirm it RENDERS with LIVE data (not the sample fallback), a clean console, and no overflow. A blocking visual failure loops back to the **portal-block-debugger** (cap ~2 rounds). If the extension isn't present or the block isn't on a page, **skip with a note** — never block on it. See `zportal://guide/visual-verification`.
7. **portal-block-advisor** — read-only; does it serve the business question, the user, and the data?

**Footgun to enforce across stages:** any agent doing an `update_block` on an already-bound block MUST re-send the existing `ui_queries`, or the binding is wiped and the block goes blank.

**Finish.** Report: the `block_id` and name, what was built (datasource/query + columns bound), and the advisor's recommendations / any open questions.
