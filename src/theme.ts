/**
 * theme.ts
 *
 * Synthesize a portal `theme` token map from the design preferences collected by
 * `design_intake`. Pure and deterministic: same prefs → same tokens. The output
 * `customProperties` uses the house design-system token names (so existing blocks
 * pick it up) plus a few extra layout/chart tokens. Header/sidebar preferences are
 * portal *chrome* (nav/config), not block tokens, so they're recorded in `notes`
 * rather than written into the token map.
 */

import { darken, mix, parseColor, readableTextOn, toHex } from "./color.js";

export type Mode = "light" | "dark";
export type Density = "compact" | "spacious";
export type Radius = "sharp" | "subtle" | "rounded" | "pill";
export type FontFeel = "system" | "geometric" | "humanist" | "rounded" | "serif" | "mono";

export interface DesignPrefs {
  brandName?: string;
  websiteUrl?: string;
  primary: string; // hex (falls back to the house blue if unparseable)
  accent?: string; // hex (derived from primary if omitted)
  mode: Mode;
  density: Density;
  radius: Radius;
  font?: FontFeel;
  header?: string; // recorded only (portal nav chrome, not a block token)
  sidebar?: string; // recorded only
}

const FONT_STACKS: Record<FontFeel, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  geometric: "'Poppins', 'Montserrat', 'Century Gothic', system-ui, sans-serif",
  humanist: "'Inter', 'Segoe UI', Roboto, system-ui, sans-serif",
  rounded: "'Nunito', 'Quicksand', 'Varela Round', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
};

const RADIUS_PX: Record<Radius, { card: string; control: string }> = {
  sharp: { card: "2px", control: "2px" },
  subtle: { card: "6px", control: "5px" },
  rounded: { card: "12px", control: "8px" },
  pill: { card: "18px", control: "999px" },
};

const DENSITY: Record<Density, { gap: string; cardPad: string; sectionGap: string }> = {
  compact: { gap: "10px", cardPad: "12px", sectionGap: "16px" },
  spacious: { gap: "18px", cardPad: "22px", sectionGap: "32px" },
};

export interface SynthesizedTheme {
  name: string;
  customProperties: Record<string, string>;
  css: string[];
  notes: string[];
}

/** A simple, deterministic accent when the user gives none: rotate channels + lift. */
function deriveAccent(primaryHex: string): string {
  const c = parseColor(primaryHex);
  if (!c) return "#7c5cff";
  const rotated = { r: c.g, g: c.b, b: c.r };
  return toHex(mix(rotated, { r: 255, g: 255, b: 255 }, 0.08));
}

export function synthesizeTheme(prefs: DesignPrefs): SynthesizedTheme {
  const pc = parseColor(prefs.primary);
  const primary = pc ? toHex(pc) : "#009fe4";
  const ac = prefs.accent ? parseColor(prefs.accent) : null;
  const accent = ac ? toHex(ac) : deriveAccent(primary);
  const dark = prefs.mode === "dark";

  const bodyBg = dark ? "#0e0f13" : "#f6f7f9";
  const blockBg = dark ? "#181a20" : "#ffffff";
  const text = dark ? "#f4f4f7" : "#1f2430";
  const gray200 = dark ? "#2a2d36" : "#e5e7eb";
  const gray500 = dark ? "#9aa0ab" : "#6b7280";
  const border = dark ? "rgba(255,255,255,.09)" : "rgba(16,24,40,.08)";
  const shadow = dark ? "0 1px 3px rgba(0,0,0,.45)" : "0 1px 3px rgba(16,24,40,.06)";

  const rad = RADIUS_PX[prefs.radius];
  const den = DENSITY[prefs.density];
  const font = FONT_STACKS[prefs.font ?? "humanist"];

  const customProperties: Record<string, string> = {
    "--color-primary": primary,
    "--color-primary-dark": darken(primary, 0.16),
    "--color-primary-contrast": readableTextOn(primary),
    "--color-secondary": accent,
    "--color-accent": accent,
    "--color-text": text,
    "--color-muted": gray500,
    "--color-gray-200": gray200,
    "--color-gray-500": gray500,
    "--body-bg-color": bodyBg,
    "--block-bg-color": blockBg,
    "--card-bg-color": blockBg,
    "--color-border": border,
    "--card-shadow": shadow,
    "--color-success": "#1ebba6",
    "--color-warn": "#f6a609",
    "--color-danger": "#ef5777",
    "--font-stack-primary": font,
    "--card-radius": rad.card,
    "--control-radius": rad.control,
    "--space-gap": den.gap,
    "--card-padding": den.cardPad,
    "--section-gap": den.sectionGap,
    // Categorical chart palette (primary + accent lead).
    "--chart-1": primary,
    "--chart-2": accent,
    "--chart-3": "#1ebba6",
    "--chart-4": "#f6a609",
    "--chart-5": "#7c5cff",
    "--chart-6": "#34c759",
  };

  const variant = dark ? "Dark" : "Light";
  const name = prefs.brandName ? `${prefs.brandName} ${variant}` : `Custom ${variant}`;

  const notes: string[] = [];
  if (prefs.websiteUrl) notes.push(`Brand reference: ${prefs.websiteUrl}`);
  if (prefs.header) {
    notes.push(
      `Header preference "${prefs.header}" recorded — header/nav chrome is set at the portal config level (update_config / portal-theme-designer), not in the theme token map.`
    );
  }
  if (prefs.sidebar) {
    notes.push(
      `Sidebar preference "${prefs.sidebar}" recorded — applies to portal navigation layout, not block tokens.`
    );
  }

  return { name, customProperties, css: [], notes };
}
