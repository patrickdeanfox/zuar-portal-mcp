/**
 * color.ts
 *
 * Pure color utilities + brand-color extraction from a page's HTML, used by the
 * `design_intake` tool to (a) suggest a starting palette from the user's website
 * and (b) synthesize a theme token map. No I/O — everything here is deterministic
 * and unit-testable on plain strings.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` and `rgb()/rgba()` into RGB, else null. */
export function parseColor(input: string): RGB | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const hex = /^#?([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (rgb) {
    const r = +rgb[1];
    const g = +rgb[2];
    const b = +rgb[3];
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) return { r, g, b };
  }
  return null;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** RGB → `#rrggbb`. */
export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Linear blend a→b by t∈[0,1]. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const ch = (x: number, y: number) => x + (y - x) * t;
  return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b) };
}

/** Darken a hex toward black by `amt`∈[0,1] (returns the input unchanged if unparseable). */
export function darken(hex: string, amt: number): string {
  const c = parseColor(hex);
  return c ? toHex(mix(c, { r: 0, g: 0, b: 0 }, amt)) : hex;
}

/** Lighten a hex toward white by `amt`∈[0,1]. */
export function lighten(hex: string, amt: number): string {
  const c = parseColor(hex);
  return c ? toHex(mix(c, { r: 255, g: 255, b: 255 }, amt)) : hex;
}

/** WCAG relative luminance (0=black, 1=white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** HSV-style saturation (0=gray, 1=fully saturated). */
export function saturation({ r, g, b }: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** A near-white, near-black, or low-saturation gray — i.e. not a "brand" color. */
export function isNeutral(hex: string): boolean {
  const c = parseColor(hex);
  if (!c) return true;
  const lum = relativeLuminance(c);
  if (lum > 0.92 || lum < 0.02) return true; // near white / near black
  return saturation(c) < 0.18; // grayish
}

/** Pick a readable near-black or near-white ink for a given background. */
export function readableTextOn(hex: string): string {
  const c = parseColor(hex);
  if (!c) return "#1f2430";
  return relativeLuminance(c) > 0.5 ? "#1f2430" : "#f4f4f7";
}

export interface BrandColors {
  themeColor?: string; // from <meta name="theme-color"> if present
  candidates: string[]; // ranked, neutrals dropped, most brand-like first
}

/**
 * Extract candidate brand colors from a page's HTML. Prioritizes
 * `<meta name="theme-color">`, then ranks every hex/rgb color found (inline styles,
 * `<style>` blocks, attributes) by saturation×frequency, dropping neutrals. Returns
 * up to `limit` candidates. Pure — operates on the HTML string only.
 */
export function extractBrandColors(html: string, limit = 6): BrandColors {
  if (typeof html !== "string" || !html) return { candidates: [] };

  let themeColor: string | undefined;
  const meta = /<meta[^>]+name=["']theme-color["'][^>]*>/i.exec(html);
  if (meta) {
    const content = /content=["']([^"']+)["']/i.exec(meta[0]);
    const tc = content ? parseColor(content[1]) : null;
    if (tc) themeColor = toHex(tc);
  }

  const counts = new Map<string, number>();
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const c = parseColor(m[0]);
    if (!c) continue;
    const hex = toHex(c);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .filter(([hex]) => !isNeutral(hex))
    .map(([hex, n]) => ({ hex, score: n * (0.4 + saturation(parseColor(hex)!)) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.hex);

  const candidates: string[] = [];
  if (themeColor && !isNeutral(themeColor)) candidates.push(themeColor);
  for (const hex of ranked) {
    if (!candidates.includes(hex)) candidates.push(hex);
    if (candidates.length >= limit) break;
  }
  return { themeColor, candidates };
}
