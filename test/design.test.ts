/**
 * design.test.ts — unit tests for the design_intake building blocks:
 *   - color.ts  (parse/convert/derive + brand-color extraction from HTML)
 *   - theme.ts  (preferences → portal token map)
 *   - website.ts (SSRF host classification + the offline/blocked paths of the fetch)
 *
 * Everything here is offline: the website tests only exercise literal-IP / local-name
 * classification and pre-DNS rejections, so no real network request is made.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseColor,
  toHex,
  darken,
  lighten,
  isNeutral,
  readableTextOn,
  extractBrandColors,
} from "../src/color.js";
import { synthesizeTheme } from "../src/theme.js";
import { classifyAddress, classifyHost, fetchSiteColors } from "../src/website.js";

// ── color.ts ──────────────────────────────────────────────────────────────────
test("parseColor handles #rgb, #rrggbb, #rrggbbaa, rgb(), and rejects junk", () => {
  assert.deepEqual(parseColor("#1f6feb"), { r: 0x1f, g: 0x6f, b: 0xeb });
  assert.deepEqual(parseColor("#f00"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseColor("#ff000080"), { r: 255, g: 0, b: 0 }); // alpha dropped
  assert.deepEqual(parseColor("rgb(16, 111, 235)"), { r: 16, g: 111, b: 235 });
  assert.equal(parseColor("teal"), null);
  assert.equal(parseColor("#12345"), null); // length 5 → invalid
  assert.equal(parseColor(""), null);
});

test("toHex round-trips and clamps", () => {
  assert.equal(toHex({ r: 31, g: 111, b: 235 }), "#1f6feb");
  assert.equal(toHex({ r: 300, g: -5, b: 0 }), "#ff0000");
});

test("darken/lighten move toward black/white", () => {
  assert.equal(darken("#ffffff", 1), "#000000");
  assert.equal(lighten("#000000", 1), "#ffffff");
  assert.equal(darken("not-a-color", 0.5), "not-a-color"); // unparseable passes through
});

test("isNeutral flags white/black/gray but not brand hues", () => {
  assert.equal(isNeutral("#ffffff"), true);
  assert.equal(isNeutral("#000000"), true);
  assert.equal(isNeutral("#333333"), true); // gray
  assert.equal(isNeutral("#1f6feb"), false); // saturated blue
  assert.equal(isNeutral("#ff5733"), false);
});

test("readableTextOn picks dark ink on light bg and vice versa", () => {
  assert.equal(readableTextOn("#ffffff"), "#1f2430");
  assert.equal(readableTextOn("#0e0f13"), "#f4f4f7");
});

test("extractBrandColors prefers theme-color, ranks brand hues, drops neutrals", () => {
  const html = `
    <head>
      <meta name="theme-color" content="#1f6feb">
      <style>.a{color:#1f6feb;background:#ffffff}.b{color:#ff5733}.c{color:#ff5733}</style>
    </head>
    <body style="color:#333333"></body>`;
  const b = extractBrandColors(html);
  assert.equal(b.themeColor, "#1f6feb");
  assert.equal(b.candidates[0], "#1f6feb"); // theme-color leads
  assert.ok(b.candidates.includes("#ff5733"));
  assert.ok(!b.candidates.includes("#ffffff")); // neutral filtered
  assert.ok(!b.candidates.includes("#333333")); // neutral filtered
});

test("extractBrandColors tolerates empty/garbage input", () => {
  assert.deepEqual(extractBrandColors(""), { candidates: [] });
  assert.deepEqual(extractBrandColors("<p>hello</p>").candidates, []);
});

// ── theme.ts ──────────────────────────────────────────────────────────────────
test("synthesizeTheme maps a dark/compact/sharp pref onto house tokens", () => {
  const t = synthesizeTheme({ primary: "#1f6feb", mode: "dark", density: "compact", radius: "sharp" });
  assert.equal(t.customProperties["--color-primary"], "#1f6feb");
  assert.equal(t.customProperties["--body-bg-color"], "#0e0f13"); // dark base
  assert.equal(t.customProperties["--card-radius"], "2px"); // sharp
  assert.equal(t.customProperties["--space-gap"], "10px"); // compact
  assert.ok(t.customProperties["--color-secondary"], "accent derived when omitted");
  assert.equal(t.customProperties["--chart-1"], "#1f6feb");
  assert.ok(t.name.includes("Dark"));
  assert.deepEqual(t.css, []);
});

test("synthesizeTheme honors light/spacious/pill, explicit accent, brand name + notes", () => {
  const t = synthesizeTheme({
    primary: "#1f6feb",
    accent: "#ff0000",
    mode: "light",
    density: "spacious",
    radius: "pill",
    brandName: "Acme",
    websiteUrl: "https://acme.com",
    header: "prominent",
    sidebar: "fixed",
  });
  assert.equal(t.customProperties["--body-bg-color"], "#f6f7f9"); // light base
  assert.equal(t.customProperties["--card-radius"], "18px"); // pill
  assert.equal(t.customProperties["--space-gap"], "18px"); // spacious
  assert.equal(t.customProperties["--color-secondary"], "#ff0000");
  assert.equal(t.name, "Acme Light");
  assert.ok(t.notes.some((n) => /Brand reference/i.test(n)));
  assert.ok(t.notes.some((n) => /Header/i.test(n)));
  assert.ok(t.notes.some((n) => /Sidebar/i.test(n)));
});

test("synthesizeTheme falls back to the house blue on an unparseable primary", () => {
  const t = synthesizeTheme({ primary: "chartreuse", mode: "light", density: "compact", radius: "subtle" });
  assert.equal(t.customProperties["--color-primary"], "#009fe4");
});

// ── website.ts (offline only) ──────────────────────────────────────────────────
test("classifyAddress blocks private/reserved IPs and allows public ones", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.5.4", "192.168.1.1", "100.64.0.1", "::1"]) {
    assert.equal(classifyAddress(ip), "blocked", ip);
  }
  assert.equal(classifyAddress("8.8.8.8"), "public");
  assert.equal(classifyAddress("1.1.1.1"), "public");
});

test("classifyHost blocks local names and literal private IPs without DNS", async () => {
  assert.equal(await classifyHost("localhost"), "blocked");
  assert.equal(await classifyHost("printer.local"), "blocked");
  assert.equal(await classifyHost("svc.internal"), "blocked");
  assert.equal(await classifyHost("127.0.0.1"), "blocked");
  assert.equal(await classifyHost("10.1.2.3"), "blocked");
});

test("fetchSiteColors refuses SSRF/invalid targets before any network call", async () => {
  const loopback = await fetchSiteColors("http://127.0.0.1/");
  assert.equal(loopback.ok, false);
  assert.match(loopback.reason ?? "", /private|loopback|link-local/i);

  const creds = await fetchSiteColors("https://user:pass@example.com");
  assert.equal(creds.ok, false);
  assert.match(creds.reason ?? "", /credential/i);

  const bad = await fetchSiteColors("not a url");
  assert.equal(bad.ok, false);
  assert.match(bad.reason ?? "", /valid url/i);

  const empty = await fetchSiteColors("");
  assert.equal(empty.ok, false);
});
