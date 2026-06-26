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

## 9. Responsive & breakpoints
A block sizes to **its own grid cell**, not the viewport — two blocks sit side by side at the same
"viewport width." So size against the block's container, not the window:
- Prefer width-based rules on `.wrapper` and **CSS container queries** (`.wrapper { container-type: inline-size }`
  then `@container (max-width: 640px) { … }`). Use viewport `@media` only for genuinely page-wide chrome.
- Avoid `vw`/`vh` for sizing inside a block (they track the window, not the cell) — use `%`, `fr`, `minmax()`,
  and `clamp()` so the block reflows within whatever column the grid gives it.
- The portal grid itself has breakpoints **lg / md / sm**; your block ships placement for each
  (`set_page_blocks`/`add_block_to_page` handle the math), but the block's *internal* layout must still
  reflow on its own.

**Collapse ladders (house defaults):**
- KPI band: `repeat(auto-fit, minmax(180px, 1fr))` — naturally 6-up → 3-up → 2-up → 1-up as the cell narrows.
  If you pin column counts, step 6 → 3 (≤1100px) → 2 (≤640px) → 1 (≤380px).
- Chart pair: two charts share a row, then stack (`grid-template-columns: 1fr 1fr` → `1fr` ≤720px). Keep
  `min-height:200px` so a chart never collapses to nothing.
- Data table: never shrink columns to unreadable — wrap in an overflow box
  (`overflow-x:auto; -webkit-overflow-scrolling:touch`) and keep the sticky header.
- Filter bar: wrap controls (`flex-wrap:wrap; gap:10px`); the title block stays on its own line on small cells.
- Touch: interactive targets ≥ **44×44px**; spacing ≥ 8px between tap targets.

## 10. Accessibility checklist (every block)
- **Color:** text/background contrast ≥ 4.5:1 (≥ 3:1 for ≥ 18px bold). Never encode meaning by color alone —
  pair status color with a label, icon, or shape.
- **Focus:** every interactive element shows a visible `:focus-visible` ring (`outline:2px solid var(--color-primary); outline-offset:2px`). Never `outline:none` without a replacement.
- **Semantics:** real `<button>`/`<a href>` for actions/links (cards that navigate use a real `<a href="/p/<slug>">`); `<th scope>` on table headers; one logical heading order.
- **Names:** icon-only controls get `aria-label`; custom widgets get the right `role` + `aria-*`; decorative SVGs `aria-hidden="true"`.
- **Keyboard:** everything clickable is reachable and operable by keyboard (Tab/Enter/Space); no keyboard traps.
- **Motion:** honor `@media (prefers-reduced-motion: reduce)` — drop non-essential transitions/animations.
- **Live data:** when filters update content, move focus or use `aria-live="polite"` on the region that changes so it's announced.

## 11. Token quick-reference (consume with a fallback)
Always `var(--token, fallback)`; a theme switch then restyles everything. Most-used set:

| Purpose | Token | Sensible fallback |
|---|---|---|
| Accent | `--color-primary` | `#009fe4` |
| Body text | `--color-text` | `#1f2937` |
| Page background | `--body-bg-color` | `#f2f2f5` |
| Block surface | `--block-bg-color` | `#ffffff` |
| Muted text | `--color-gray-500` | `#6b7280` |
| Hairline | `--color-gray-200` | `rgba(0,0,0,.07)` |
| Success / Warning / Danger | `--color-success` / `--color-info`/`#f6a609` / `--color-danger` | `#1ebba6` / `#f6a609` / `#ef5777` |
| Font family | `--font-stack-primary` | `system-ui, -apple-system, sans-serif` |
| Heading font | `--font-stack-heading` | `var(--font-stack-primary)` |

Need a shade the theme doesn't expose? Derive it: `color-mix(in srgb, var(--color-primary) 12%, transparent)`.
Define block-local tokens in a `.wrapper`-scoped (not global `:root`) block so they don't collide with other blocks.

## 12. Component recipes (copy-paste skeletons — scope under `.wrapper`)
Minimal, theme-token starting points. Money is always `toLocaleString('en-US',{style:'currency',currency:'USD'})` — never a literal `$`.

**KPI card grid**
```css
.wrapper .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; }
.wrapper .kpi { background:var(--block-bg-color,#fff); border:1px solid var(--color-gray-200,rgba(0,0,0,.07));
  border-radius:12px; padding:16px; box-shadow:0 1px 3px rgba(16,24,40,.06); }
.wrapper .kpi .label { font:700 11px/1.2 var(--font-stack-primary,system-ui); letter-spacing:.13em;
  text-transform:uppercase; color:var(--color-primary,#009fe4); }
.wrapper .kpi .value { font:800 26px/1.1 var(--font-stack-primary,system-ui); letter-spacing:-.01em;
  font-variant-numeric:tabular-nums; color:var(--color-text,#1f2937); margin-top:6px; }
.wrapper .kpi .ctx { font:600 11px/1.3 var(--font-stack-primary,system-ui); color:var(--color-gray-500,#6b7280); margin-top:4px; }
```

**Chart card**
```css
.wrapper .chart-card { display:flex; flex-direction:column; background:var(--block-bg-color,#fff);
  border:1px solid var(--color-gray-200,rgba(0,0,0,.07)); border-radius:12px; padding:14px 16px; }
.wrapper .chart-card h3 { font:800 14px/1.2 var(--font-stack-primary,system-ui); color:var(--color-text,#1f2937); margin:0; }
.wrapper .chart-card .sub { font:500 11px/1.3 var(--font-stack-primary,system-ui); color:var(--color-gray-500,#6b7280); margin:2px 0 10px; }
.wrapper .chart-card .canvas { flex:1; min-height:200px; }
```

**Data table** (sticky header, hairline rows, right-aligned numbers, horizontal scroll)
```css
.wrapper .tbl-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px; border:1px solid var(--color-gray-200,rgba(0,0,0,.07)); }
.wrapper table { width:100%; border-collapse:collapse; font:500 13px/1.4 var(--font-stack-primary,system-ui); }
.wrapper thead th { position:sticky; top:0; background:#f8fafc; text-align:left; font:700 11px/1.2 var(--font-stack-primary,system-ui);
  letter-spacing:.04em; text-transform:uppercase; color:var(--color-gray-500,#6b7280); padding:10px 12px; }
.wrapper tbody td { padding:10px 12px; border-top:1px solid var(--color-gray-200,rgba(0,0,0,.06)); color:var(--color-text,#1f2937); }
.wrapper td.num { text-align:right; font-variant-numeric:tabular-nums; }
.wrapper tbody tr:hover td { background:#f1f5f9; }
```

**Filter bar**
```css
.wrapper .filterbar { display:flex; flex-wrap:wrap; align-items:center; gap:12px; background:var(--block-bg-color,#fff);
  border:1px solid var(--color-gray-200,rgba(0,0,0,.07)); border-radius:12px; padding:12px 14px; }
.wrapper .filterbar .title { font:800 16px/1.2 var(--font-stack-primary,system-ui); color:var(--color-text,#1f2937); margin-right:auto; }
.wrapper .filterbar select { font:600 13px/1 var(--font-stack-primary,system-ui); padding:8px 10px; border-radius:8px;
  border:1px solid var(--color-gray-200,rgba(0,0,0,.12)); background:#fff; color:var(--color-text,#1f2937); }
.wrapper .filterbar .clear { border:1px solid var(--color-primary,#009fe4); color:var(--color-primary,#009fe4); background:transparent;
  border-radius:8px; padding:8px 12px; cursor:pointer; }
.wrapper .filterbar .clear:hover { background:var(--color-primary,#009fe4); color:#fff; }
.wrapper .filterbar select:focus-visible, .wrapper .filterbar .clear:focus-visible { outline:2px solid var(--color-primary,#009fe4); outline-offset:2px; }
```
Wire the selects to native filters: `sel.addEventListener('change', () => zPortal.dataSource.setFilters('col', sel.value ? [sel.value] : []))`; Clear → `zPortal.dataSource.clearFilters()`.

**Modal** — don't hand-roll; use the sanctioned API:
```js
zPortal.modal.show({ title, body, confirmButton:'OK', dismissButton:'Cancel', size:'md' })
  .then(() => {/* confirmed */}).catch(() => {/* dismissed */});
```
