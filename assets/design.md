# zPortal House Design System

The visual contract for every block this MCP authors. Goal: cohesive, **executive-grade**
surfaces that look designed, not generated. Read this alongside the authoring conventions
before building or restyling a block. (Edit this file — or point `PORTAL_DESIGN_FILE` at your
own — to change the house style globally. For one-off restyles, use a design skill.)

## 1. Principles
- One accent per surface; let whitespace and type hierarchy do the work.
- Every number is the hero — large, tabular, with a quiet label and an optional context line.
- Inherit the portal theme (so a theme switch restyles everything); only add house polish on top.
- Calm, not flashy: soft shadows, hairline borders, restrained motion.

## 2. Color
- **Always derive from theme tokens**, with a fallback: `var(--color-primary, #009fe4)`,
  `var(--color-text, #1f2937)`, `var(--body-bg-color, #f2f2f5)`. Never hardcode a brand hex
  without a `var(--token, …)` wrapper.
- **Surfaces:** cards are `#fff` on the page background; border `1px solid rgba(0,0,0,.07)`;
  muted text `#6b7280`; faint hairlines `rgba(0,0,0,.06)`.
- **Categorical chart palette** (use in this order): `var(--color-primary)`, `#1ebba6`,
  `#f6a609`, `#7c5cff`, `#ef5777`, `#34c759`, `#00b8d9`.
- **Semantic / thresholds:** success `#1ebba6`, warning `#f6a609`, danger `#ef5777`. Use for
  rate bars (e.g. on-time, uptime, readmission) graded good→amber→bad.
- **Per-section accent (optional):** a dashboard family may give each page its own accent by
  overriding `--accent` on the block wrapper, but keep text/surface neutrals constant.

## 3. Typography
- Family: `var(--font-stack-primary, system-ui, -apple-system, sans-serif)`.
- Scale (size / weight): KPI value **26 / 800** (`letter-spacing:-.01em`), section/hero title
  **22–30 / 800**, card title **14 / 800**, body **13 / 500**, eyebrow **11 / 700** UPPERCASE
  `letter-spacing:.12–.14em` in the accent color, caption/label **10.5–11 / 600** muted.
- Numbers (KPIs, table figures): `font-variant-numeric: tabular-nums` so columns align.
- Never pure black — use `var(--color-text)` (~#1f2937).

## 4. Spacing, shape, elevation
- Rhythm on a 4px grid; default gap **14px**, card padding **14–18px**.
- Card radius **12px** (hero/banner 14px); inputs/buttons radius **8px**.
- Elevation: resting `0 1px 3px rgba(16,24,40,.06)`; hover `0 8px 20px rgba(16,24,40,.12)`.
- Density: airy. Don't pack KPI cards edge to edge; let labels breathe.

## 5. Component patterns
- **KPI card:** accent dot + uppercase label on top, big tabular value, optional muted
  context line ("$4,050 / patient"). 6-up grid that collapses 3-up (≤1100px) then 2-up (≤640px).
- **Chart card:** card title + small muted sub (units) header row, then a flex-1 canvas
  (`min-height:200px`). Two charts share a row and stack on small screens.
- **Filter bar:** white bar, left = eyebrow + page title, right = labeled `<select>`s + a
  ghost "Clear" button (accent outline, fills on hover). Drives native datasource filters.
- **Data table:** sticky header (`#f8fafc`, uppercase 11px), zebra-free hairline rows,
  hover `#f1f5f9`, right-aligned numeric columns, sort arrows + a search box in the header.
- **Nav / drill card:** accent left-border, hover lift, an "Open →" affordance; navigate with
  a real `<a href="/p/<slug>">` (cross-page drill) so it works without JS.
- **Hero band:** primary→darker gradient (`linear-gradient(135deg, var(--color-primary), …)`),
  white text, translucent stat tiles. Use sparingly (exec/landing surfaces).

## 6. Charts
- Library by complexity: **ECharts 5** for complex/interactive, **Chart.js/vanilla** for
  simple; amCharts only on explicit request. One chart-loading block per page (avoid the
  multi-block `window.define` race); dispose instances on re-render; attach a ResizeObserver.
- Styling: thin axes (`axisLine` opacity ~.2, `axisTick:false`), faint splitLines (opacity ~.08),
  10–11px labels in `--color-text`, rounded bar caps (`borderRadius:[0,4,4,0]`), right-positioned
  value labels, sorted bars. Honest scales; no 3D, no rainbow, no chartjunk.
- Format values: counts `toLocaleString()`; money `toLocaleString('en-US',{style:'currency',
  currency:'USD'})` (NEVER a literal `$` — it breaks the block, see conventions); percents 1 dp + `%`.

## 7. Accessibility & interaction
- Clickables get hover, `:focus-visible` ring, and active states; cards that navigate use real
  links; icon-only controls get `aria-label`.
- Respect `prefers-reduced-motion`; keep transitions ~.12–.2s ease.

## 8. Do / Don't
- DO: theme tokens, tabular numerals, one accent, soft elevation, generous padding, sorted charts.
- DON'T: pure-black text, hardcoded brand hex without `var()`, harsh 1px black borders, cramped
  grids, rainbow series, gratuitous animation, a literal `$` in source.
