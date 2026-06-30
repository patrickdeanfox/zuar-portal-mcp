/**
 * naming.test.ts — unit tests for the naming convention helpers, the naming
 * authoring rules, and the metadata-only domain downgrade.
 *
 * Everything under test is pure (no network/env), so these pin down the exact
 * grammar (scope → kind → subject), the tag-merge invariant, the CSS-scope
 * findings, and that a datasource RENAME is gated as content (not data).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseName,
  suggestName,
  slugify,
  mergeTags,
  cssScopeFindings,
  tagForScope,
  scopeForTag,
} from "../src/naming.js";
import { validateBlock, type ValidationResult } from "../src/rules.js";
import { getDescriptor, effectiveUpdateDomain } from "../src/resources.js";

function fired(v: ValidationResult, ruleId: string): boolean {
  return [...v.errors, ...v.warnings].some((m) => m.includes(`[${ruleId}]`));
}

// ── slugify ───────────────────────────────────────────────────────────────────
test("slugify lowercases and dashes separators", () => {
  assert.equal(slugify("HC · KPI Band"), "hc-kpi-band");
  assert.equal(slugify("CRM Sales Bookings — all rows"), "crm-sales-bookings-all-rows");
  assert.equal(slugify("Lat/Long"), "latlong");
});

// ── parseName ─────────────────────────────────────────────────────────────────
test("parseName decomposes a conforming name", () => {
  const p = parseName("HC · KPI Band");
  assert.equal(p.scope, "HC");
  assert.equal(p.scopeTag, "healthcare");
  assert.equal(p.kind, "kpi");
  assert.equal(p.conforms, true);
});

test("parseName recovers kind + subject from a chart phrase", () => {
  const p = parseName("HC · Chart Revenue by Department");
  assert.equal(p.scope, "HC");
  assert.equal(p.kind, "chart");
  assert.equal(p.subject, "Revenue by Department");
  assert.equal(p.conforms, true);
});

test("parseName grades a non-conforming legacy name", () => {
  const p = parseName("Logo 1");
  assert.equal(p.scope, null);
  assert.equal(p.kind, null);
  assert.equal(p.conforms, false);
});

test("parseName accepts a scope with no closed-vocab kind (conforms=false)", () => {
  const p = parseName("SYS · amCharts Loader");
  assert.equal(p.scope, "SYS");
  assert.equal(p.scopeTag, "system");
  assert.equal(p.kind, null);
  assert.equal(p.conforms, false);
});

// ── suggestName ───────────────────────────────────────────────────────────────
test("suggestName builds display, slug and tags from a code", () => {
  const s = suggestName({ kind: "kpi", scope: "HC" });
  assert.equal(s.display_name, "HC · KPI Band");
  assert.equal(s.slug, "hc-kpi-band");
  assert.deepEqual(s.tags, ["healthcare", "kpi"]);
});

test("suggestName accepts a facet tag as scope and a subject", () => {
  const s = suggestName({ kind: "chart", scope: "healthcare", subject: "Revenue by Department" });
  assert.equal(s.display_name, "HC · Chart Revenue by Department");
  assert.deepEqual(s.tags, ["healthcare", "chart"]);
});

test("suggestName handles a scope-less utility kind", () => {
  const s = suggestName({ kind: "table", scope: "FIN" });
  assert.equal(s.display_name, "FIN · Detail Table");
  assert.deepEqual(s.tags, ["financial", "table"]);
});

test("suggestName OMITS the kind word for resource kinds (datasource), like pages", () => {
  const s = suggestName({ kind: "datasource", scope: "DW", subject: "Dim Customer" });
  assert.equal(s.display_name, "DW · Dim Customer"); // not "DW · Datasource Dim Customer"
  assert.equal(s.slug, "dw-dim-customer");
  assert.deepEqual(s.tags, ["data-warehouse", "datasource"]);
  assert.equal(s.kind, "datasource");
});

test("suggestName appends a source facet marker + tag for data assets", () => {
  const s = suggestName({ kind: "datasource", scope: "HC", subject: "Clinical Encounters", source: "sample" });
  assert.equal(s.display_name, "HC · Clinical Encounters — Sample");
  assert.deepEqual(s.tags, ["healthcare", "datasource", "sample"]);
  assert.equal(s.source, "sample");
});

test("suggestName: DW scope maps to the data-warehouse facet tag", () => {
  assert.equal(tagForScope("DW"), "data-warehouse");
  assert.equal(scopeForTag("data-warehouse"), "DW");
});

test("suggestName ignores an unknown source facet (no marker, no tag)", () => {
  const s = suggestName({ kind: "query", scope: "DW", subject: "Sales by Month", source: "bogus" });
  assert.equal(s.display_name, "DW · Sales by Month");
  assert.deepEqual(s.tags, ["data-warehouse", "query"]);
  assert.equal(s.source, null);
});

// ── scope <-> tag ─────────────────────────────────────────────────────────────
test("scope code <-> facet tag round-trips", () => {
  assert.equal(tagForScope("HC"), "healthcare");
  assert.equal(scopeForTag("healthcare"), "HC");
  assert.equal(tagForScope("nope"), null);
});

// ── mergeTags ─────────────────────────────────────────────────────────────────
test("mergeTags is a deduped union that never drops existing tags", () => {
  assert.deepEqual(mergeTags(["Menu"], ["system", "integration"]), ["Menu", "system", "integration"]);
  assert.deepEqual(mergeTags(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
});

test("mergeTags tolerates non-array / empty inputs", () => {
  assert.deepEqual(mergeTags(undefined, ["x"]), ["x"]);
  assert.deepEqual(mergeTags(["x"], "not-an-array"), ["x"]);
  assert.deepEqual(mergeTags(null, null), []);
});

// ── cssScopeFindings ──────────────────────────────────────────────────────────
test("cssScopeFindings flags global leaks and passes scoped CSS", () => {
  assert.equal(cssScopeFindings(":root{--a:1}").length, 1);
  assert.equal(cssScopeFindings("* { margin:0 }").length, 1);
  assert.equal(cssScopeFindings("body{margin:0}").length, 1);
  assert.deepEqual(cssScopeFindings(".hc-card .hc-canvas{width:100%}"), []);
});

// ── rules wiring ──────────────────────────────────────────────────────────────
test("naming_css_scope warns on a :root leak in a block's CSS", () => {
  const v = validateBlock({ json_data: { html: "<div></div>" }, css: [":root{--a:1}"] });
  assert.ok(fired(v, "naming_css_scope"));
});

test("naming_block_name is OFF by default (project-specific, opt-in)", () => {
  const v = validateBlock({ name: "Logo 1", json_data: { html: "" }, css: [] });
  assert.equal(fired(v, "naming_block_name"), false);
});

// ── domain downgrade (Finding #2) ─────────────────────────────────────────────
test("a datasource name/tags-only update is gated as content, not data", () => {
  const ds = getDescriptor("datasource")!;
  assert.equal(effectiveUpdateDomain(ds, { name: "Random Sales" }), "content");
  assert.equal(effectiveUpdateDomain(ds, { tags: ["x"] }), "content");
});

test("a datasource SQL/connection update stays data-domain", () => {
  const ds = getDescriptor("datasource")!;
  assert.equal(effectiveUpdateDomain(ds, { sql: "SELECT 1" }), "data");
  assert.equal(effectiveUpdateDomain(ds, { name: "x", database_connection: {} }), "data");
});

test("a content resource update is always content", () => {
  const layout = getDescriptor("layout")!;
  assert.equal(effectiveUpdateDomain(layout, { name: "x" }), "content");
});
