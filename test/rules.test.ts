/**
 * rules.test.ts — unit tests for the block authoring validator.
 *
 * validateBlock() is pure (no network, no env beyond the rules cache) and is the
 * single gate every create/update/validate_block call runs through, so it's the
 * highest-value thing to pin down. Assertions check WHICH rule fired (by id) and,
 * for a couple of rules, that the default severity routes it to errors vs warnings.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBlock, getRules, type ValidationResult } from "../src/rules.js";

// A block whose HTML lives where the validator looks for it (json_data.html).
function block(html: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { json_data: { html }, css: [], ...extra };
}

// True if any error OR warning carries the given rule id — severity-agnostic.
function fired(v: ValidationResult, ruleId: string): boolean {
  return [...v.errors, ...v.warnings].some((m) => m.includes(`[${ruleId}]`));
}

test("a clean, well-structured block produces no errors", () => {
  const html = [
    "<div class='wrapper'><span id='v'></span></div>",
    "<script>",
    "const CONFIG = { DEBUG: false };",
    "const log = (...a) => { if (CONFIG.DEBUG) console.log(...a); };",
    "function init() { document.getElementById('v').textContent = 'ok'; }",
    "init();",
    "</script>",
  ].join("\n");
  const v = validateBlock(block(html, { css: [".wrapper{color:var(--color-text)}"] }));
  assert.deepEqual(v.errors, [], `unexpected errors: ${v.errors.join(" | ")}`);
});

test("<style> in the HTML section is a hard error (no_css_in_html)", () => {
  const v = validateBlock(block("<style>.x{color:red}</style><div>hi</div>"));
  assert.ok(fired(v, "no_css_in_html"));
  assert.ok(v.errors.some((m) => m.includes("[no_css_in_html]")), "should route to errors by default");
});

test("eval() is a hard error (no_unsafe_js)", () => {
  const v = validateBlock(block("<script>eval('1+1');</script>"));
  assert.ok(v.errors.some((m) => m.includes("[no_unsafe_js]")));
});

test("full-document tags are rejected (no_doctype_html_tags)", () => {
  const v = validateBlock(block("<!DOCTYPE html><html><body>x</body></html>"));
  assert.ok(v.errors.some((m) => m.includes("[no_doctype_html_tags]")));
});

test("a raw $ next to a quote is a hard error (no_raw_dollar)", () => {
  const v = validateBlock(block("<script>const s = \"$\";</script>"));
  assert.ok(v.errors.some((m) => m.includes("[no_raw_dollar]")), "literal $ String.replace footgun");
});

test("jQuery $( and template ${ do NOT trip no_raw_dollar", () => {
  const v = validateBlock(block("<script>const x = `${1}`; $(document);</script>"));
  assert.ok(!fired(v, "no_raw_dollar"), "must not false-positive on $( or ${");
});

test("{{ }} interpolation is flagged as a warning (angular_interpolation)", () => {
  const v = validateBlock(block("<div>{{ value }}</div>"));
  assert.ok(fired(v, "angular_interpolation"));
  assert.ok(v.warnings.some((m) => m.includes("[angular_interpolation]")), "default severity is warn");
});

test("hardcoded hex with no theme var is flagged (enforce_theme_vars)", () => {
  const v = validateBlock(block("<div style='x'></div>", { css: [".wrapper{color:#ff0000}"] }));
  assert.ok(fired(v, "enforce_theme_vars"));
});

test("partial update touching only css is not penalised for missing html rules", () => {
  // No json_data => hasHtml is false => structure/style rules that need HTML stay silent.
  const v = validateBlock({ css: [".wrapper{color:var(--color-text)}"] });
  assert.deepEqual(v.errors, []);
  assert.ok(!fired(v, "require_init"), "html-only rules must not fire on a css-only edit");
});

test("getRules() exposes every rule id with a severity", () => {
  const { enforcement } = getRules();
  const ids = Object.keys(enforcement);
  assert.ok(ids.length >= 15, `expected the full rule set, got ${ids.length}`);
  for (const [id, sev] of Object.entries(enforcement)) {
    assert.ok(["error", "warn", "off"].includes(sev), `${id} has invalid severity ${sev}`);
  }
});
