---
name: portal-responsive
description: Trigger when making a Zuar Portal block responsive / mobile-friendly, fixing overflow or layout breakage at small sizes, or applying breakpoint behavior to a block. Repo recipes on top of the house design system; pairs with the portal-responsive-specialist agent.
---

# Portal responsive (repo recipes)

Make a block behave at every width **without breaking its data or design**. The collapse
recipes are spec, not taste — they live in **`assets/design.md`** (read it; don't work from
memory). This skill is the thin orchestration; the responsive *agent* that applies it is
**`portal-responsive-specialist`** (`.claude/agents/`). The block-authoring rules that still
bind while you add breakpoints are in **`assets/conventions.md`** (CSS in the `css` field,
every selector scoped under `.wrapper`, theme tokens via `var(--token, fallback)`, **no loading
states**), and the block data/structure model is the global **`zportal`** skill.

## The grid reality — work width-first, not viewport-first

A block lives **inside the portal layout grid** (which has its own `lg` / `md` / `sm`
breakpoints) and is sized to **its own container's width**, often far narrower than the viewport
(a KPI block in a 4-column cell is ~25% of the page). So a `@media (max-width:…)` viewport query
fires at the *wrong* time — the screen can be wide while the block is narrow.

- **Prefer CSS container queries** (`@container`) keyed on the block's own width. Set
  `container-type: inline-size` on the block's own `.wrapper` (or an inner shell — never a global
  selector), then size children with `@container` rules / `cqi` units.
- **Otherwise use width-scoped rules under `.wrapper`.** If you fall back to `@media`, treat the
  breakpoint as "the block is probably this wide," not "the screen is." The `design.md` numbers
  (**1100px**, **640px**) are block-content widths to collapse at.
- **Keep everything scoped under `.wrapper`** so breakpoint CSS can't leak to sibling blocks.

## The collapse recipes (match `assets/design.md` exactly)

- **KPI grid:** `repeat(6, 1fr)` → **3-up ≤1100px** → **2-up ≤640px**. Keep the 14px gap; let
  cards reflow — don't shrink type below the scale.
- **Chart cards:** a side-by-side pair **stacks to one column** when narrow. Preserve each
  canvas `min-height` (~200px) so charts don't collapse to zero height. (Chart *redraw* on resize
  is a ResizeObserver concern for the builder/debugger — you provide the box, not the JS.)
- **Tables:** wrap in `overflow-x:auto` so wide tables **scroll horizontally** instead of clipping
  or forcing a page-wide block; keep the sticky header working and numeric columns right-aligned.
- **Touch / a11y:** interactive targets ≥ **44px**; keep `:focus-visible` rings; keep hover
  affordances, just make them tap-friendly.
- **Overflow / clipping:** no horizontal page scroll caused by the block; long labels wrap or
  truncate with ellipsis (`min-width:0` on flex/grid children that hold ellipsis text); nothing
  escapes the card radius.
- **Motion:** respect `prefers-reduced-motion`; keep transitions ~.12–.2s ease.

## Hard constraints

- **Don't touch** the `<script>` logic, the element ids the script targets, or the data binding.
  You shape the boxes; the JS fills them.
- **No loading states** (Portal renders its own skeleton loader) and **no literal `$`** next to a
  quote / backtick / `&` / digit in any markup or CSS content you add.
- On every `update_block`, **re-send the existing `ui_queries`** (get it from `get_block` first) —
  omitting it wipes the binding and the block goes blank. Run `validate_block` before writing.
