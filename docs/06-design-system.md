# 06 · Design System `[2.2.0]`

A single house **design system** so blocks look cohesive and polished instead of generic — covering
palette, typography, spacing/elevation, component patterns, and chart styling.

## How it works
- The system lives in **`assets/design.md`** (editable Markdown).
- `src/design.ts` resolves it (first hit wins): **`PORTAL_DESIGN_FILE`** env path → bundled
  `assets/design.md` → a concise built-in fallback.
- It's exposed as the read-only resource **`zportal://guide/design-system`** and **referenced in the
  `create_zportal_block` prompt** (steps 1 and 4), so new/edited blocks inherit it automatically.

> It's **guidance**, not a hard rule (unlike `validateBlock`). The only design constraint that's
> machine-enforced is `enforce_theme_vars` (warn) — use `var(--token, fallback)` instead of hardcoded
> hex. (Safety/structure rules like `no_raw_dollar` still apply, but they aren't *design* constraints.)
> Everything else is applied because the model reads the design system while authoring.

## What it specifies
The bundled `assets/design.md` covers:
- **Principles** — one accent per surface; the number is the hero; inherit the theme; calm over flashy.
- **Color** — derive from theme tokens (`var(--color-primary, …)`, `--color-text`, `--body-bg-color`);
  a fixed categorical chart palette; semantic success/warn/danger for threshold bars.
- **Typography** — a concrete size/weight scale (KPI value 26/800, card title 14/800, eyebrow 11/700
  uppercase, body 13/500, muted caption); tabular numerals for figures.
- **Spacing/shape/elevation** — 4px rhythm, 12px card radius, hairline borders, soft shadows.
- **Component patterns** — KPI card, chart card, filter bar, data table, nav/drill card, hero band.
- **Charts** — ECharts/Chart.js policy, thin axes, sorted bars, currency formatting (no literal `$`).
- **Accessibility** — hover/`focus-visible`/active states, real links for navigation, reduced-motion.
- **Do / Don't** — a quick checklist.

## Customizing the house style
> **Forward-only:** the design system guides blocks **as they're authored** — editing it does **not**
> retroactively restyle existing blocks. Re-author or `update_block` a block to pick up changes.
1. Edit `assets/design.md` (or point `PORTAL_DESIGN_FILE` at your own copy), then rebuild + restart
   (`npm run build` + `.mcpb` repack — see [02 · Updating](02-install-and-config.md#updating-after-code-changes)).
2. Keep deriving from theme tokens so a portal **theme** switch restyles everything for free.
3. Re-read it anytime via the `zportal://guide/design-system` resource.

## Design system vs. design *skills*
- **`design.md` (this)** = the persistent, portal-wide house style applied to every block.
- **Design skills** = ad-hoc restyling for a one-off. Relevant skills:
  - **`brand-design-systems`** — apply a named brand's exact look ("make it look like Stripe/Linear/
    Notion"). 74 bundled brand specs. Use when you want a specific brand aesthetic for a page.
  - **`frontend-design`**, **`ui-ux-pro-max`**, **`zuar-theme`** — general UI polish / portal theming.

> **Theme ≠ design system.** A portal **theme** is switchable runtime color/font **tokens** (e.g. via
> the `zuar-theme` skill); this **design system** is authoring **guidance** that *derives from* those
> tokens. Switching the theme recolors everything; the design system governs structure, typography, and
> components.

Typical pattern: let `design.md` set the consistent baseline, then invoke a design skill when you want
a particular page or family to deviate (e.g. a branded landing page). See
[09 · Related Skills](09-related-skills.md).

## Tips
- The design system pairs with the [authoring rules](05-authoring-rules.md): `enforce_theme_vars` keeps
  colors tokenized; `no_raw_dollar` keeps currency formatting safe — both reinforce the design specs.
- For a per-industry/section accent, override an `--accent` custom property on the block wrapper while
  keeping the neutral text/surface tokens constant.
