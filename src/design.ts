/**
 * design.ts
 *
 * The portal's house visual design system, surfaced as an MCP resource
 * (zportal://guide/design-system) and referenced by the create-block prompt so
 * generated/edited blocks share one look — palette, typography, spacing, chart
 * styling, and component patterns. This is guidance (read by the model), not a
 * hard-enforced rule like rules.ts; pair it with design skills for ad-hoc restyles.
 *
 * Resolution (first hit wins): PORTAL_DESIGN_FILE env path -> bundled
 * assets/design.md -> built-in default. Any failure falls back to the default.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./config.js";

const DESIGN_ENV_VAR = "PORTAL_DESIGN_FILE";
const BUNDLED_DESIGN_RELPATH = ["..", "assets", "design.md"]; // from dist/ -> repo root

// Concise self-contained fallback if no design.md is bundled/configured.
const DEFAULT_DESIGN = [
  "# zPortal house design system (fallback)",
  "",
  "Build polished, consistent, executive-grade surfaces — not generic boilerplate.",
  "",
  "- **Color:** derive from theme tokens — `var(--color-primary, #009fe4)`, `--color-text`,",
  "  `--body-bg-color`. Never hardcode brand hex. Categorical chart palette (in order):",
  "  primary, #1ebba6, #f6a609, #7c5cff, #ef5777, #34c759. Semantic: success #1ebba6,",
  "  warn #f6a609, danger #ef5777.",
  "- **Type:** font `var(--font-stack-primary)`. Scale: KPI value 26/800, card title 14/800,",
  "  eyebrow 11/700 uppercase letter-spacing .12em, body 13/500, caption 11/600 muted (#6b7280).",
  "  Metrics use `font-variant-numeric: tabular-nums`.",
  "- **Layout:** 14px gaps, 12px card radius, 1px hairline border rgba(0,0,0,.07), soft shadow",
  "  `0 1px 3px rgba(16,24,40,.06)`. Cards are white on the page bg. KPI band = 6-up grid",
  "  collapsing 3-up then 2-up. Charts side-by-side, stacking on small screens.",
  "- **Charts:** ECharts (complex) / Chart.js (simple); thin axes, no gridline clutter,",
  "  right-aligned value labels, currency via toLocaleString (never a literal $).",
  "- **Polish:** hover lift on clickable cards, focus-visible rings, generous padding,",
  "  one accent per surface. Avoid: pure-black text, harsh borders, cramped density, rainbow charts.",
].join("\n");

let cachedDesign: string | null = null;

function distDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    log("design: failed to read", file, (e as Error).message);
    return null;
  }
}

/** Resolve the active design system text. Cached once per process. */
export function getDesign(): string {
  if (cachedDesign !== null) return cachedDesign;

  const envPath = process.env[DESIGN_ENV_VAR];
  if (envPath) {
    const text = readFileSafe(envPath);
    if (text && text.trim()) {
      cachedDesign = text;
      return cachedDesign;
    }
    log("design: env override unreadable, falling back", envPath);
  }

  const bundled = path.join(distDir(), ...BUNDLED_DESIGN_RELPATH);
  if (fs.existsSync(bundled)) {
    const text = readFileSafe(bundled);
    if (text && text.trim()) {
      cachedDesign = text;
      return cachedDesign;
    }
  }

  cachedDesign = DEFAULT_DESIGN;
  return cachedDesign;
}
