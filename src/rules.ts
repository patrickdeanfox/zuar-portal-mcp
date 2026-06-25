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
  | "no_deprecated_data_api"
  | "require_top_level_config"
  | "require_debug_toggle"
  | "require_init"
  | "require_loaded_callback"
  | "no_data_polling"
  | "enforce_theme_vars";

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
  no_deprecated_data_api: "warn",
  require_top_level_config: "warn",
  require_debug_toggle: "warn",
  require_init: "warn",
  require_loaded_callback: "warn",
  no_data_polling: "warn",
  enforce_theme_vars: "warn",
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
  "## Data + loading",
  "- Read `currentBlock.queryResults[index]`; never read `.data` directly — use a",
  "  `getQueryData(index)` helper. Column names are lowercase_with_underscores and must",
  "  match the query aliases (mismatch is the #1 cause of an empty block).",
  "- Deprecated, don't use: currentBlock.data/.columns, zPortal.dataSource, fetchResults.",
  "- Obtain `currentBlock.getOnLoadedCallback()` early; call it exactly once after the",
  "  UI is drawn (in a `finally` for async). Omitting it stalls the page (loaded_timeout).",
  "- Script runs once per query load; return early if required queries haven't loaded.",
  "- No polling/listeners for data (setInterval, DOMContentLoaded). No custom loading",
  "  states — Portal renders a skeleton loader.",
  "",
  "## Theme (enforced)",
  "- Consume the theme via `var(--color-*, fallback)`; never hardcode hex/fonts.",
  "  Key tokens: --color-primary #FA225B, --color-text #313131, --block-bg-color,",
  "  --system-gray #F6F6F6, --color-lightgray #E4E4E4, --font-stack-primary 'Roboto'.",
  "- Wrap markup in `<div id=\"zuar-block-root\">` and scope all CSS under #zuar-block-root.",
  "",
  "## AngularJS $compile footguns",
  "- Block HTML runs through `$compile`. `{{ }}` is evaluated — escape literals as",
  "  `&#123;&#123;` or set text via JS. `$` in strings (currency) can be mangled — use",
  "  `Intl.NumberFormat`. Same caution for `{`, `}`, and `ng-` attributes.",
  "",
  "## Interactivity + safety (enforced)",
  "- Inline `on*` handlers and external `<script src>` are stripped — use",
  "  `addEventListener` / `data-zuar-action` and `name=` inputs; load libs dynamically",
  "  or via AMCHARTS_LOADER. Give clickable elements hover/focus-visible/active states.",
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
    report("no_external_script_src", "External <script src> is stripped — load libraries dynamically or via AMCHARTS_LOADER.");
  }
  if (hasHtml && /\son[a-z]+\s*=\s*["']/i.test(html)) {
    report("no_inline_event_handlers", "Inline on* handlers are stripped — use addEventListener or data-zuar-action.");
  }
  if (hasHtml && /\{\{/.test(html)) {
    report("angular_interpolation", "'{{' is evaluated by AngularJS $compile — escape as &#123;&#123; or set text via JS.");
  }
  if (hasHtml && (/currentBlock\.(data|columns)\b/.test(html) || /zPortal\.dataSource\b/.test(html) || /\bfetchResults\b/.test(html))) {
    report("no_deprecated_data_api", "Deprecated data API — use currentBlock.queryResults[n] via a getQueryData() helper (not currentBlock.data/.columns, zPortal.dataSource, or fetchResults).");
  }

  // ── Style rules (only meaningful when HTML/JS is provided) ──
  if (hasHtml && html.trim()) {
    const hasScript = /<script[\s>]/i.test(html);
    if (!/\bconst\s+CONFIG\b/.test(html) && !/\bDEBUG\b/.test(html)) {
      report("require_top_level_config", "No top-level CONFIG block detected (const CONFIG / DEBUG).");
    }
    if (!/\bDEBUG\b/.test(html)) {
      report("require_debug_toggle", "No DEBUG-gated logging toggle detected.");
    }
    if (!/\binit\s*\(\s*\)/.test(html)) {
      report("require_init", "No bottom-level init() call detected to control order of operations.");
    }
    if (hasScript && !/getOnLoadedCallback/.test(html)) {
      report("require_loaded_callback", "No getOnLoadedCallback() — obtain it early and call once after render, or the loader hangs (loaded_timeout).");
    }
    if (/setInterval\s*\(/.test(html) || /DOMContentLoaded/.test(html)) {
      report("no_data_polling", "Query data is ready when the script runs — drop setInterval/DOMContentLoaded polling.");
    }
  }

  // ── Theme rule (either section can violate) ──
  const themeScope = `${html}\n${css}`;
  if ((hasHtml || hasCss) && /#[0-9a-fA-F]{3,8}\b/.test(themeScope) && !/var\(\s*--/.test(themeScope)) {
    report("enforce_theme_vars", "Hardcoded color(s) found with no theme variables (use var(--...)).");
  }

  return result;
}
