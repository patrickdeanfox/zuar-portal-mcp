# zPortal block authoring conventions

These rules are surfaced to the model before it authors a block and are checked
on `create_block` / `update_block`. Severities live in `rules.json`.

## Section separation (enforced)

- HTML and JS go in the **HTML section only** (the block's `json_data.html`).
- CSS goes in the **CSS section only** (the block's `css` field).
- Never put `<style>` or `<link rel="stylesheet">` in the HTML section.
- Never put HTML tags or `<script>` in the CSS section.

## Theme

- Use the active portal theme via CSS variables (`var(--...)`).
- Do not hardcode colors or fonts the theme already provides.

## JS structure

- Always begin with a **top-level CONFIG block**: consts, feature toggles, and a
  `DEBUG` flag. Hoist magic numbers/strings here.
- Always gate console output behind the `DEBUG` flag. Logging is verbose when on,
  silent when off.
- Always end with a single **bottom-level `init()`** that controls order of
  operations and handles race conditions (e.g. waits for data/loaders before
  rendering). Call `init()` as the last statement.
- `const` by default, `let` only when reassigned, never `var`.
- Strict equality (`===`). Prefer `async/await` over `.then()` chains, each
  wrapped in `try/catch`.
- One responsibility per function; keep pure helpers above side-effecting code.
