/**
 * structure.test.ts — unit tests for the hard structural write-gate.
 *
 * normalizeAndValidateForWrite() is the last line of defence before a record is
 * written to the portal DB. The regression it exists to prevent: a layout with a
 * grid that has `blocks`/`block_layouts` but NO `layouts.{lg,md,sm}`, which makes
 * the portal throw `grid.layouts is undefined` while building the page list and
 * makes EVERY page disappear (observed on a live portal, 2026-06-29). These tests pin both
 * the auto-repair behaviour and the hard-reject behaviour.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAndValidateForWrite, normalizeLayoutGrid } from "../src/structure.js";

const BREAKPOINTS = ["lg", "md", "sm"] as const;

function gridLayoutsValid(jsonData: any): boolean {
  const l = jsonData?.grid?.layouts;
  return !!l && BREAKPOINTS.every((bp) => l[bp] && typeof l[bp] === "object");
}

test("THE regression: a grid with blocks but no layouts is auto-repaired, not written broken", () => {
  // Exactly the malformed shape that crashed a live portal.
  const body = {
    name: "MCP Showcase",
    json_data: {
      grid: {
        blocks: ["ae99152a-dd7b-49f4-a1cf-0d7818547741"],
        block_layouts: { lg: {}, md: {}, sm: {} },
      },
    },
  };
  const r = normalizeAndValidateForWrite("layout", body);
  assert.deepEqual(r.errors, [], `should repair, not reject: ${r.errors.join(" | ")}`);
  assert.ok(gridLayoutsValid(r.body.json_data), "grid.layouts.{lg,md,sm} must exist after normalisation");
  assert.ok(r.repairs.some((m) => m.includes("layouts")), "repair should be reported");
});

test("auto-repair preserves the caller's blocks and block_layouts", () => {
  const body = {
    json_data: { grid: { blocks: ["b1"], block_layouts: { lg: { b1: { left: 0, top: 0, width: 100, height: 90 } }, md: {}, sm: {} } } },
  };
  const r = normalizeAndValidateForWrite("layout", body);
  const grid: any = (r.body.json_data as any).grid;
  assert.deepEqual(grid.blocks, ["b1"], "blocks untouched");
  assert.equal(grid.block_layouts.lg.b1.height, 90, "block placement untouched");
  assert.equal(grid.id, "content", "grid.id defaulted");
});

test("a healthy layout passes through with no errors and stays valid", () => {
  const body = {
    json_data: {
      slug: "ok",
      grid: {
        id: "content",
        layouts: {
          lg: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 2 },
          md: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 6 },
          sm: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 10 },
        },
        blocks: [],
        block_layouts: { lg: {}, md: {}, sm: {} },
        block_hidden: [],
      },
    },
  };
  const r = normalizeAndValidateForWrite("layout", body);
  assert.deepEqual(r.errors, []);
  assert.ok(gridLayoutsValid(r.body.json_data));
});

test("a partial breakpoint (only lg) is completed, not rejected", () => {
  const body = { json_data: { grid: { layouts: { lg: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 2 } } } } };
  const r = normalizeAndValidateForWrite("layout", body);
  assert.deepEqual(r.errors, []);
  assert.ok(gridLayoutsValid(r.body.json_data), "md and sm must be filled");
});

test("json_data without a grid still gets a renderable grid", () => {
  const body = { json_data: { slug: "x" } };
  const r = normalizeAndValidateForWrite("layout", body);
  assert.deepEqual(r.errors, []);
  assert.ok(gridLayoutsValid(r.body.json_data), "a grid with layouts is scaffolded");
});

test("a layout create with no json_data is allowed (portal supplies defaults)", () => {
  const r = normalizeAndValidateForWrite("layout", { name: "New Page" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.body.json_data, undefined, "must not invent json_data when caller omitted it");
});

test("json_data of the wrong type is a HARD reject", () => {
  const r = normalizeAndValidateForWrite("layout", { json_data: "nope" });
  assert.ok(r.errors.length > 0, "non-object json_data must be refused");
});

test("grid of the wrong type is a HARD reject", () => {
  const r = normalizeAndValidateForWrite("layout", { json_data: { grid: "nope" } });
  assert.ok(r.errors.length > 0, "non-object grid must be refused");
});

test("does not overwrite a custom grid.id or custom layout boxes", () => {
  const body = {
    json_data: {
      grid: {
        id: "custom-content",
        layouts: { lg: { width: 50, height: 50, align: "left", sizingUnit: "%", cellSize: 4 }, md: {}, sm: {} },
        blocks: [],
        block_layouts: {},
      },
    },
  };
  const r = normalizeAndValidateForWrite("layout", body);
  const grid: any = (r.body.json_data as any).grid;
  assert.equal(grid.id, "custom-content", "custom id preserved");
  assert.equal(grid.layouts.lg.cellSize, 4, "custom lg box preserved");
  assert.equal(grid.layouts.lg.width, 50, "custom width preserved");
});

test("resources without a registered normaliser pass through untouched", () => {
  const body = { name: "q", raw_sql: "select 1" };
  const r = normalizeAndValidateForWrite("query", body);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.body, body, "unregistered resource body is unchanged");
  assert.deepEqual(r.repairs, []);
});

test("normalizeLayoutGrid is pure — input grid is not mutated", () => {
  const grid = { blocks: ["b1"] };
  const before = JSON.stringify(grid);
  normalizeLayoutGrid(grid);
  assert.equal(JSON.stringify(grid), before, "must not mutate the caller's grid object");
});

// ── partial: global chrome, same render contract one level up ──
test("a partial with blocks but no layouts is auto-repaired (it's global chrome)", () => {
  const body = { name: "header", json_data: { id: "header", blocks: ["b1"], block_layouts: { lg: {}, md: {}, sm: {} } } };
  const r = normalizeAndValidateForWrite("partial", body);
  assert.deepEqual(r.errors, [], `should repair: ${r.errors.join(" | ")}`);
  const l = (r.body.json_data as any).layouts;
  assert.ok(l && l.lg && l.md && l.sm, "partial json_data.layouts.{lg,md,sm} filled");
});

test("a healthy partial passes through unchanged", () => {
  const body = {
    json_data: {
      id: "footer",
      blocks: [],
      layouts: { lg: { align: "left", cellSize: 5, sizingUnit: "%", height: 100, width: 100 }, md: { align: "left", cellSize: 5, sizingUnit: "%", height: 100, width: 100 }, sm: { align: "left", cellSize: 5, sizingUnit: "%", height: 100, width: 100 } },
      block_layouts: { lg: {}, md: {}, sm: {} },
      block_hidden: [],
    },
  };
  const r = normalizeAndValidateForWrite("partial", body);
  assert.deepEqual(r.errors, []);
});

test("partial json_data of the wrong type is a HARD reject", () => {
  const r = normalizeAndValidateForWrite("partial", { json_data: "nope" });
  assert.ok(r.errors.length > 0);
});

// ── theme: token map + css array ──
test("theme missing customProperties/css gets safe defaults", () => {
  const r = normalizeAndValidateForWrite("theme", { name: "t", json_data: { chartTheme: "kelly" } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual((r.body.json_data as any).customProperties, {});
  assert.deepEqual((r.body.json_data as any).css, []);
});

test("theme css as a string is a HARD reject (portal expects an array)", () => {
  const r = normalizeAndValidateForWrite("theme", { json_data: { css: ".x{color:red}", customProperties: {} } });
  assert.ok(r.errors.some((m) => m.includes("css")));
});

test("theme customProperties as an array is a HARD reject", () => {
  const r = normalizeAndValidateForWrite("theme", { json_data: { customProperties: ["--x", "#fff"] } });
  assert.ok(r.errors.some((m) => m.includes("customProperties")));
});

test("a healthy theme passes through unchanged", () => {
  const r = normalizeAndValidateForWrite("theme", { json_data: { customProperties: { "--color-primary": "#009fe4" }, css: [".a{}"] } });
  assert.deepEqual(r.errors, []);
});

// ── query: datasource binding shape ──
test("query.datasources as a non-array is a HARD reject", () => {
  const r = normalizeAndValidateForWrite("query", { name: "q", datasources: "nope" });
  assert.ok(r.errors.some((m) => m.includes("datasources")));
});

test("query.datasources entries must be objects", () => {
  const r = normalizeAndValidateForWrite("query", { datasources: ["bare-uuid-string"] });
  assert.ok(r.errors.some((m) => m.includes("datasources")));
});

test("a healthy query passes through unchanged", () => {
  const r = normalizeAndValidateForWrite("query", { name: "q", datasources: [{ id: "ds-1", alias: "datasource" }], raw_sql: "select 1" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.repairs, []);
});
