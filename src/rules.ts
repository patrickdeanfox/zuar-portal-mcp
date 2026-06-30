/**
 * rules.ts
 *
 * Authoring-rule configuration and block validation.
 *
 * Rules drive two things:
 *   1. Guidance — the `conventions` text is surfaced as a resource and injected
 *      into the create-block prompt so the model authors blocks correctly.
 *   2. Enforcement — `validateBlock` inspects a block payload before it is sent
 *      to the portal and returns errors (severity "error") and warnings
 *      (severity "warn"). Each rule's severity is configurable.
 *
 * Resolution order for the active config (first hit wins, then merged over
 * built-in defaults): PORTAL_BLOCK_RULES_FILE env path -> bundled
 * assets/rules.json -> built-in defaults. Any failure falls back to defaults.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./config.js";
import { cssScopeFindings, parseName } from "./naming.js";

// ── Top-level config ────────────────────────────────────────────────────────
const RULES_ENV_VAR = "PORTAL_BLOCK_RULES_FILE";
const BUNDLED_RULES_RELPATH = ["..", "assets", "rules.json"]; // from dist/ -> repo root
const BUNDLED_CONVENTIONS_RELPATH = ["..", "assets", "conventions.md"];

export type Severity = "error" | "warn" | "off";

// Every enforceable rule id. Keep in sync with DEFAULT_SEVERITIES + checks.
export type RuleId =
  | "no_css_in_html"
  | "no_html_in_css"
  | "no_doctype_html_tags"
  | "no_unsafe_js"
  | "no_external_script_src"
  | "no_inline_event_handlers"
  | "angular_interpolation"
  | "no_raw_dollar"
  | "no_deprecated_data_api"
  | "require_top_level_config"
  | "require_debug_toggle"
  | "require_init"
  | "require_loaded_callback"
  | "no_data_polling"
  | "require_query_binding"
  | "no_amcharts_loader"
  | "enforce_theme_vars"
  | "naming_css_scope"
  | "naming_block_name";

export interface RulesConfig {
  enforcement: Record<RuleId, Severity>;
  conventions: string;
}

// Shape of a parsed/partial config file before merge over defaults.
interface PartialRulesInput {
  enforcement?: Partial<Record<RuleId, Severity>>;
  conventions?: string;
}

// Structure + safety rules default to hard errors; style rules default to warnings.
const DEFAULT_SEVERITIES: Record<RuleId, Severity> = {
  no_css_in_html: "error",
  no_html_in_css: "error",
  no_doctype_html_tags: "error",
  no_unsafe_js: "error",
  no_external_script_src: "warn",
  no_inline_event_handlers: "warn",
  angular_interpolation: "warn",
  no_raw_dollar: "error",
  no_deprecated_data_api: "warn",
  require_top_level_config: "warn",
  require_debug_toggle: "warn",
  require_init: "warn",
  require_loaded_callback: "warn",
  no_data_polling: "warn",
  require_query_binding: "warn",
  no_amcharts_loader: "warn",
  enforce_theme_vars: "warn",
  // Naming convention (see naming.ts + docs/NAMING_CONVENTION.md). css_scope flags
  // global selectors leaking out of a block — universally-good hygiene → warn. The
  // scope·kind name pattern is project-specific → off by default (opt in via rules.json).
  naming_css_scope: "warn",
  naming_block_name: "off",
};

const DEFAULT_CONVENTIONS = [
  "# zPortal block authoring conventions",
  "",
  "Act as a senior front-end engineer fluent in Zuar Portal. Produce a finished,",
  "themed surface, not a block in isolation.",
  "",
  "## Section separation (enforced)",
  "- HTML and JS go in the HTML section only (the block's `json_data.html`).",
  "- CSS goes in the CSS section only (the block's `css` field).",
  "- Never put `<style>`/`<link rel=\"stylesheet\">` in the HTML section, or markup in CSS.",
  "- Never include `<!DOCTYPE>`/`<html>`/`<head>`/`<body>` — body-level markup only.",
  "",
  "## JS structure",
  "- Open `<script>` with a top-level config: a `DEBUG` flag (default false), the",
  "  logger, `QUERY_INDEX` + column-name constants matching query aliases, selectors,",
  "  and every numeric threshold. Hoist all magic numbers/strings here.",
  "- Gate console output behind DEBUG via one logger: ",
  "  `const log = (...a) => { if (DEBUG) console.log('[Block]', ...a); };`",
  "- End with a single bottom-level `init()` orchestrator — the only call at end of",
  "  script (`init();`). Helpers above it stay pure; side effects live in init().",
  "",
  "## Data + loading (v1.18+)",
  "- Read `currentBlock.queryResults[index]` via a `getQueryData(index)` helper. Confirmed",
  "  v1.18/1.19 shape: .columns is a string array, .data is positional row arrays [[v0,v1],…]",
  "  (native types). `.mappedData` (when present) is those rows already as {col:value} objects —",
  "  prefer it: `q.mappedData || q.data.map(r => Object.fromEntries(q.columns.map((c,i)=>[c,r[i]])))`.",
  "  Don't hardcode indices. Column names",
  "  must match the query aliases (mismatch is the #1 cause of an empty block).",
  "- Deprecated v1.18 aliases (still work): currentBlock.data/.columns (= queryResults[0]),",
  "  siteConfig (use currentBlock.config). NOT deprecated: zPortal.dataSource.setFilters/",
  "  clearFilters, dataSource.fetchResults, dataSource.on('load',…) — these are current.",
  "- Data is present synchronously at load — don't poll (setInterval/DOMContentLoaded). To",
  "  react to filter changes use `zPortal.dataSource.on('load', dsId, handler)` (keep the",
  "  handler in a var so you can .off() it). No custom loading states — Portal has a loader.",
  "- For ASYNC blocks (lib load, fetch, promises): obtain `currentBlock.getOnLoadedCallback()`",
  "  early and call once after render (in a `finally`), or the page can stall (loaded_timeout).",
  "  Sync blocks don't need it. Use getOnAnimatedCallback() for export-after-animation.",
  "- A block binds data via `ui_queries` (NOT a `data` field — the portal has none):",
  "  [{enabled, page_size, query_id, filter_strategy}], where query_id -> a saved `query`",
  "  resource that holds the datasource + SQL. queryResults[n] maps to ui_queries[n]. A query",
  "  with no datasource fails ('a query must have a datasource'). On update_block keep the",
  "  existing ui_queries or the binding is wiped. Verify the query's real columns with",
  "  execute_query/fetch_sample_rows and match the JS column constants exactly; aggregate",
  "  (GROUP BY/COUNT) in the query SQL, not the block. ui_queries page_size: default to null =",
  "  ALL rows (null/0 = no limit); set a number only to cap intentionally (UI default 50",
  "  truncates). A hardcoded fallback masks a bad binding by rendering sample data — confirm",
  "  live rows actually flow.",
  "",
  "## Theme + scoping (enforced)",
  "- Consume the theme via `var(--token, fallback)`; never hardcode hex/fonts. v1.18 token",
  "  names: --color-primary, --color-text, --color-link, --color-success, --color-danger,",
  "  --body-bg-color, --header-bg-color, --sidebar-bg-color (values are theme-dependent).",
  "- Scope CSS to the block: wrap markup in `<div class=\"wrapper\">` and scope selectors",
  "  under `.wrapper`. When several similar blocks share a page, suffix ids/classes/vars",
  "  (#chartdiv1, CONFIG_1) and wrap the script in an IIFE so nothing leaks to window.",
  "- Never leak GLOBAL CSS out of a block: no `:root{}` (page-global tokens), no `*` reset,",
  "  no bare `body`/`html` selectors — they clobber sibling blocks on the page.",
  "",
  "## Naming (scope · kind · subject)",
  "- Name a block `SCOPE · Kind Subject`: a scope code, then a closed-vocab kind, then the",
  "  human subject — e.g. `HC · KPI Band`, `FIN · Chart Band`, `SYS · amCharts Loader`. Scope",
  "  codes map to facet tags (HC↔healthcare, FIN↔financial, SC↔supply-chain, RT↔retail, IOT↔iot,",
  "  CRM↔crm, MKT↔marketing, EXEC↔executive, SYS↔system); kinds: kpi, chart, table, filter, hero,",
  "  navigation, map, text. Use the `suggest_name` tool to generate the name + tags.",
  "- Tag the block with its scope facet + kind facet (e.g. [healthcare, kpi]). MERGE tags, never",
  "  replace — a tag like `Menu` can drive nav membership. The display name is for humans; a page",
  "  URL slug is a STABLE contract — rename the title freely, but never churn the slug.",
  "",
  "## AngularJS $compile footguns",
  "- Block HTML runs through `$compile`. `{{ }}` is evaluated — escape literals as",
  "  `&#123;&#123;` or set text via JS. **A literal `$` is ENFORCED-against** (no_raw_dollar=error):",
  "  it is rewritten by $compile via String.replace special patterns ($', $`, $&, $$, $n) and",
  "  throws a SyntaxError that blanks the whole block. For currency use",
  "  `value.toLocaleString('en-US',{style:'currency',currency:'USD'})`; for a bare sign use",
  "  `String.fromCharCode(36)` (JS) or `&#36;` (HTML). Same caution for `ng-` attrs.",
  "",
  "## Interactivity + safety (enforced)",
  "- Prefer `addEventListener`/`name=` inputs over inline on* handlers (which do work but",
  "  belong out of markup). External `<script src>` is stripped — load libs via",
  "  `zPortal.resources.load(url)`. Charts: ECharts for complex, Chart.js/vanilla for simple,",
  "  amCharts ONLY if the user asks (and load it 2-step: index.js core first, THEN modules/",
  "  themes — never the AMCHARTS_LOADER two-block pattern). Give clickables hover/focus-visible/",
  "  active states + ARIA. Use `zPortal.modal.show({...})` for modals (don't hand-roll DOM",
  "  modals); toggle blocks with `zPortal.block.show/hide(iid)`.",
  "- Re-render cleanup: the script re-runs per reload — dispose the prior am5 root",
  "  (`currentBlock.container._am5Root?.dispose()`) / clear innerHTML before rebuilding.",
  "- No `eval`/`new Function()`/`document.write`; no untrusted DOM interpolation.",
  "",
  "## Code style",
  "- `const` by default, `let` only when reassigned, never `var`; `===`; async/await",
  "  in try/catch. One statement per line; descriptive names; never minify.",
].join("\n");

const BUILTIN_DEFAULTS: RulesConfig = {
  enforcement: DEFAULT_SEVERITIES,
  conventions: DEFAULT_CONVENTIONS,
};

// ── Module state (config is read once per process) ────────────────────────────
let cachedRules: RulesConfig | null = null;

// ── Pure helpers ──────────────────────────────────────────────────────────────
function distDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

// Coerce a string|string[] payload field to a single searchable string.
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join("\n");
  return "";
}

// Pull the HTML-section source (HTML + JS) out of a block body.
function htmlSource(body: Record<string, unknown>): string {
  const jsonData = body.json_data as Record<string, unknown> | undefined;
  return asText(jsonData?.html);
}

// Merge a parsed partial config over the built-in defaults. Unknown keys ignored.
function mergeConfig(partial: PartialRulesInput): RulesConfig {
  const enforcement: Record<RuleId, Severity> = { ...DEFAULT_SEVERITIES };
  const incoming: Partial<Record<RuleId, Severity>> = partial.enforcement ?? {};
  for (const key of Object.keys(DEFAULT_SEVERITIES) as RuleId[]) {
    const sev = incoming[key];
    if (sev === "error" || sev === "warn" || sev === "off") enforcement[key] = sev;
  }
  const conventions =
    typeof partial.conventions === "string" && partial.conventions.trim()
      ? partial.conventions
      : DEFAULT_CONVENTIONS;
  return { enforcement, conventions };
}

// ── IO ────────────────────────────────────────────────────────────────────────
// Read + parse a rules JSON file. `conventions_file` (relative to the JSON file)
// is resolved into `conventions` when present. Returns null on any failure.
function readRulesFile(file: string): PartialRulesInput | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const result: PartialRulesInput = {};
    if (raw.enforcement && typeof raw.enforcement === "object") {
      result.enforcement = raw.enforcement as Partial<Record<RuleId, Severity>>;
    }
    if (typeof raw.conventions === "string") {
      result.conventions = raw.conventions;
    } else if (typeof raw.conventions_file === "string") {
      const convPath = path.resolve(path.dirname(file), raw.conventions_file);
      if (fs.existsSync(convPath)) result.conventions = fs.readFileSync(convPath, "utf8");
    }
    return result;
  } catch (e) {
    log("rules: failed to read", file, (e as Error).message);
    return null;
  }
}

// Locate and load the active rules config. Falls back to built-in defaults.
function resolveRules(): RulesConfig {
  // 1. Explicit env override.
  const envPath = process.env[RULES_ENV_VAR];
  if (envPath) {
    const parsed = readRulesFile(envPath);
    if (parsed) return mergeConfig(parsed);
    log("rules: env override unreadable, falling back", envPath);
  }

  // 2. Bundled defaults beside the build.
  const bundled = path.join(distDir(), ...BUNDLED_RULES_RELPATH);
  if (fs.existsSync(bundled)) {
    const parsed = readRulesFile(bundled);
    if (parsed) {
      // Bundled rules.json may rely on the sibling conventions.md by default.
      if (parsed.conventions === undefined) {
        const convFile = path.join(distDir(), ...BUNDLED_CONVENTIONS_RELPATH);
        if (fs.existsSync(convFile)) parsed.conventions = fs.readFileSync(convFile, "utf8");
      }
      return mergeConfig(parsed);
    }
  }

  // 3. Built-in.
  return BUILTIN_DEFAULTS;
}

// ── Public API ──────────────────────────────────────────────────────────────
export function getRules(): RulesConfig {
  if (cachedRules === null) cachedRules = resolveRules();
  return cachedRules;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate a block payload against the active rules. Only checks rules whose
 * required input is present (so partial updates aren't penalised for fields
 * they don't touch). Each violation is routed to errors/warnings by severity.
 */
export function validateBlock(body: Record<string, unknown>): ValidationResult {
  const { enforcement } = getRules();
  const result: ValidationResult = { errors: [], warnings: [] };

  const hasHtml = body.json_data !== undefined;
  const hasCss = body.css !== undefined;
  const html = htmlSource(body);
  const css = asText(body.css);

  const report = (rule: RuleId, message: string): void => {
    const sev = enforcement[rule];
    if (sev === "error") result.errors.push(`[${rule}] ${message}`);
    else if (sev === "warn") result.warnings.push(`[${rule}] ${message}`);
  };

  // ── Structure rules (need the relevant section present) ──
  if (hasHtml && (/<style[\s>]/i.test(html) || /<link[^>]+stylesheet/i.test(html))) {
    report("no_css_in_html", "CSS belongs in the CSS field, not the HTML section (found <style>/<link>).");
  }
  if (hasCss && (/<script[\s>]/i.test(css) || /<\/?[a-z][a-z0-9]*[\s>/]/i.test(css))) {
    report("no_html_in_css", "The CSS field must contain only CSS — found HTML/JS markup.");
  }
  if (hasHtml && /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(html)) {
    report("no_doctype_html_tags", "Use body-level markup only — remove <!DOCTYPE>/<html>/<head>/<body>.");
  }

  // ── Safety rules ──
  if (hasHtml && (/\beval\s*\(/.test(html) || /new\s+Function\s*\(/.test(html) || /document\.write\s*\(/.test(html))) {
    report("no_unsafe_js", "Remove eval()/new Function()/document.write — blocked in the portal sandbox.");
  }
  if (hasHtml && /<script[^>]+\bsrc\s*=/i.test(html)) {
    report("no_external_script_src", "External <script src> is stripped — load libraries via zPortal.resources.load(url) (preferred) or document.createElement('script').");
  }
  if (hasHtml && /AMCHARTS_LOADER/.test(html)) {
    report("no_amcharts_loader", "Don't use the AMCHARTS_LOADER two-block pattern. Prefer ECharts (complex charts) or Chart.js/vanilla (simple); use amCharts only when explicitly asked, loaded 2-step via zPortal.resources.load — core index.js first, then the modules/themes (they extend am5).");
  }
  if (hasHtml && /\son[a-z]+\s*=\s*["']/i.test(html)) {
    report("no_inline_event_handlers", "Prefer addEventListener over inline on* handlers — cleaner separation and CSP-safe. (Inline handlers calling global functions do work in the portal, but are harder to maintain.)");
  }
  if (hasHtml && /\{\{/.test(html)) {
    report("angular_interpolation", "'{{' is evaluated by AngularJS $compile — escape as &#123;&#123; or set text via JS.");
  }
  // A literal `$` adjacent to a quote/backtick/&/$/digit is rewritten by AngularJS $compile
  // following String.replace special-pattern rules ($', $`, $&, $$, $n) — it throws a
  // SyntaxError at inject time and silently breaks the ENTIRE block (blank KPIs/charts/table).
  // Does NOT match template-literal `${` (followed by `{`) or jQuery `$(` (followed by `(`).
  if (hasHtml && /\$['"`&$0-9]/.test(html)) {
    report(
      "no_raw_dollar",
      "Literal '$' next to a quote/backtick/&/$/digit (e.g. '$', \"$\", $1, $&) is mangled by " +
        "AngularJS $compile and breaks the whole block with a SyntaxError. Don't put a literal $ in " +
        "the HTML/JS section: for currency use value.toLocaleString('en-US',{style:'currency'," +
        "currency:'USD'}); for a bare sign use String.fromCharCode(36) in JS or &#36; in HTML text."
    );
  }
  // v1.18 deprecations only: currentBlock.data/.columns are aliases for queryResults[0],
  // and siteConfig is superseded by config. NOT deprecated: zPortal.dataSource.setFilters/
  // clearFilters (the current filter API) or dataSource.fetchResults (current ad-hoc fetch).
  if (hasHtml && (/currentBlock\.(data|columns)\b/.test(html) || /\bsiteConfig\b/.test(html))) {
    report("no_deprecated_data_api", "Deprecated v1.18 API — currentBlock.data/.columns are aliases for queryResults[0]; read currentBlock.queryResults[n] instead, and use currentBlock.config not siteConfig. (zPortal.dataSource.setFilters/clearFilters and dataSource.fetchResults are current and not flagged.)");
  }

  // ── Style rules (only meaningful when HTML/JS is provided) ──
  if (hasHtml && html.trim()) {
    const hasScript = /<script[\s>]/i.test(html);
    // CONFIG may be const/let/var and suffixed for cross-block uniqueness (CONFIG_1).
    const hasConfig = /\b(?:const|let|var)\s+CONFIG\w*/.test(html);
    const hasDebug = /\bDEBUG\b/.test(html) || /\bverboseLogging\b/.test(html);
    // An IIFE wrapper is the dominant real-world orchestrator — accept it like init().
    const hasIife = /\(\s*function\s*\(\s*\)\s*\{/.test(html) || /\(\s*\(\s*\)\s*=>\s*\{/.test(html);
    // Async/library work is what actually needs the loaded callback.
    const doesAsyncWork =
      /\basync\b|\bawait\b|\.then\s*\(|new\s+Promise\b|AMCHARTS_LOADER|resources\.load|fetchResults|setTimeout\s*\(/.test(
        html
      );

    if (!hasConfig && !hasDebug) {
      report("require_top_level_config", "No top-level config object detected (const/let/var CONFIG…). Hoist constants and toggles to one place at the top.");
    }
    if (!hasDebug) {
      report("require_debug_toggle", "No debug-gated logging toggle detected (a DEBUG/verboseLogging flag gating console output).");
    }
    if (!/\binit\s*\(\s*\)/.test(html) && !hasIife) {
      report("require_init", "No bottom-level init() call or IIFE wrapper detected to control order of operations and avoid leaking globals.");
    }
    if (hasScript && doesAsyncWork && !/getOnLoadedCallback/.test(html)) {
      report("require_loaded_callback", "Async work without getOnLoadedCallback() — obtain it early and call it once after render (in a finally), or Portal's loader can hang (loaded_timeout).");
    }
    if (/setInterval\s*\(/.test(html) || /DOMContentLoaded/.test(html)) {
      report(
        "no_data_polling",
        "currentBlock.queryResults is ready synchronously when the script runs, and the block's " +
          "markup precedes its <script>, so call init() directly — you don't need DOMContentLoaded " +
          "for DOM readiness, and never poll (setInterval) waiting for data to appear. (Genuine UI " +
          "timers — animations, debounced handlers — are fine.)"
      );
    }
  }

  // ── Query binding rule ──
  // The block reads query data but nothing is bound to feed it. The real binding is
  // `ui_queries` (each entry's query_id -> a saved query -> a datasource); the portal has
  // no `data`/`__source__` field, so `data` is only honored as a legacy hint. A bound-later
  // (portal UI) block trips this as a warn — that's the intended reminder.
  if (hasHtml && html.trim() && /queryResults|getQueryData\s*\(|currentBlock\.(data|columns)\b/.test(html)) {
    const uiq = body.ui_queries;
    const hasUiQueryBinding =
      Array.isArray(uiq) &&
      uiq.some((q) => q !== null && typeof q === "object" && (q as Record<string, unknown>).query_id);
    const dataObj = body.data as Record<string, unknown> | undefined;
    const hasDataBinding =
      !!dataObj && typeof dataObj.__source__ === "string" && dataObj.__source__.trim() !== "";
    if (!hasUiQueryBinding && !hasDataBinding) {
      report(
        "require_query_binding",
        "Block reads query data (queryResults/getQueryData) but has no bound query. Add a ui_queries entry whose query_id points to a query that has a datasource (or bind it in the portal UI) — otherwise it renders empty, or its hardcoded fallback rows, instead of live data."
      );
    }
  }

  // ── Theme rule (either section can violate) ──
  const themeScope = `${html}\n${css}`;
  if ((hasHtml || hasCss) && /#[0-9a-fA-F]{3,8}\b/.test(themeScope) && !/var\(\s*--/.test(themeScope)) {
    report("enforce_theme_vars", "Hardcoded color(s) found with no theme variables (use var(--...)).");
  }

  // ── Naming convention rules (see naming.ts) ──
  // CSS scope: a block must not leak GLOBAL selectors (:root, *, body/html) onto
  // the page, where they clobber sibling blocks. Only flagged when CSS is present.
  if (hasCss && css.trim()) {
    for (const issue of cssScopeFindings(css)) report("naming_css_scope", issue);
  }
  // Block name: grade against the scope · kind · subject convention. Off by default
  // (project-specific); only checked when the caller actually sets a name.
  if (typeof body.name === "string" && body.name.trim()) {
    const parsed = parseName(body.name);
    if (!parsed.conforms) {
      report(
        "naming_block_name",
        `Block name "${body.name}" doesn't follow the "SCOPE · Kind Subject" convention ` +
          `(e.g. "HC · KPI Band"). Run suggest_name to generate a conforming name + tags.`
      );
    }
  }

  return result;
}
