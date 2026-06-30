# 05 · Authoring Rules

`create_block` and `update_block` run **`validateBlock`** (`src/rules.ts`) on the payload before any
API call. Each rule has a configurable severity:

- **`error`** → the write is **hard-rejected** (no API call). Fix and retry.
- **`warn`** → the write proceeds; warnings are returned alongside the result.
- **`off`** → the check is skipped.

Read the active config anytime with **`get_rules`** (returns severities + the full conventions text,
also exposed as the `zportal://guide/conventions` resource).

## The rules

| Rule | Default | Catches / requires |
|------|---------|--------------------|
| `no_css_in_html` | error | `<style>`/`<link rel=stylesheet>` in the HTML field — CSS belongs in the `css` field |
| `no_html_in_css` | error | HTML/JS markup in the CSS field |
| `no_doctype_html_tags` | error | `<!DOCTYPE>/<html>/<head>/<body>` — body-level markup only |
| `no_unsafe_js` | error | `eval()`, `new Function()`, `document.write()` |
| **`no_raw_dollar`** `[2.2.0]` | **error** | A literal `$` next to a quote/backtick/`&`/`$`/digit (e.g. `'$'`, `"$"`, `$1`) — mangled by `$compile`, blanks the block. Use `toLocaleString({currency})`, `String.fromCharCode(36)`, or `&#36;`. Ignores `${…}` and `$(`. |
| `no_external_script_src` | warn | `<script src>` (stripped by the portal) — use `zPortal.resources.load(url)` |
| `no_inline_event_handlers` | warn | inline `on*=` handlers — prefer `addEventListener` |
| `angular_interpolation` | warn | `{{` — evaluated by `$compile`; escape as `&#123;&#123;` or set via JS |
| `no_deprecated_data_api` | warn | `currentBlock.data`/`.columns` (use `queryResults[n]`) and `siteConfig` (use `currentBlock.config`) |
| `require_top_level_config` | warn | a top-level `CONFIG`/`DEBUG` to hoist constants + toggles |
| `require_debug_toggle` | warn | a `DEBUG`/`verboseLogging` flag gating console output |
| `require_init` | warn | a bottom-level `init()` call or an IIFE wrapper (order of ops, no global leaks) |
| `require_loaded_callback` | warn | async work (lib load/fetch/promise) without `getOnLoadedCallback()` — page loader can hang |
| `no_data_polling` | warn | `setInterval`/`DOMContentLoaded` for data — it's ready synchronously |
| `require_query_binding` | warn | reads `queryResults`/`getQueryData` but has no bound `ui_queries` → renders empty/fallback |
| `no_amcharts_loader` | warn | the `AMCHARTS_LOADER` two-block pattern — load via `zPortal.resources.load` instead |
| `enforce_theme_vars` | warn | hardcoded hex colors with no `var(--…)` theme variable |
| `naming_css_scope` `[2.7.0]` | warn | global CSS leaking out of a block — `:root{}`, `*`, bare `body`/`html` — clobbers sibling blocks. See [17](17-naming-convention.md) |
| `naming_block_name` `[2.7.0]` | **off** | block name doesn't match the `SCOPE · Kind Subject` convention. Project-specific — opt in via `rules.json`. Use `suggest_name` to generate one |

> Structure/safety rules default to **error**; style/footgun rules default to **warn**. `no_raw_dollar`
> is the one footgun that defaults to **error** because it silently kills the entire block. The
> `naming_*` rules are new in `[2.7.0]`: `naming_css_scope` is universally-good hygiene (warn),
> `naming_block_name` is project-specific (off by default).
>
> **Metadata-only updates `[2.7.0]`:** `update_block` now validates only the fields you change, so a
> rename/retag is never blocked by a pre-existing violation (e.g. a legacy `$`) in untouched content.

## Why `no_raw_dollar` exists
During an 8-page dashboard build, three "money" blocks (`'$'+value`) rendered completely blank with
**zero** lint warnings — the conventions documented the `$compile` footgun but nothing enforced it.
The runtime error was a cryptic `Failed to execute 'appendChild' … Unexpected identifier`. The rule
turns that silent, hard-to-diagnose failure into an immediate, actionable rejection at author time.
See [12 · Troubleshooting](12-troubleshooting.md).

## Configuring rules
Resolution order — exactly **one** source is selected (the first that exists), then merged over the
built-in defaults (the two file sources don't combine with each other):
1. `PORTAL_BLOCK_RULES_FILE` — path to your own rules JSON.
2. Bundled `assets/rules.json` (+ sibling `assets/conventions.md` via `conventions_file`).
3. Built-in defaults in `src/rules.ts`.

`rules.json` shape:
```json
{
  "enforcement": {
    "no_raw_dollar": "error",
    "enforce_theme_vars": "warn",
    "no_inline_event_handlers": "off"
  },
  "conventions_file": "conventions.md"
}
```
- Set any rule to `error` / `warn` / `off`.
- Replace `conventions_file` with an inline `conventions` string to fully customize the guidance text.
- Unknown keys are ignored; any parse failure falls back to defaults.

> The **conventions** text isn't just docs — it's injected into the `create_zportal_block` prompt and
> exposed as `zportal://guide/conventions`, so editing it changes how blocks get authored, while
> `enforcement` changes what's blocked.
