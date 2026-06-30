/**
 * naming.ts
 *
 * The Zuar Portal naming convention, as pure helpers shared by the naming tools
 * (suggest_name / parse_name) and the authoring rules.
 *
 * The rule in one line: a name is a STRUCTURED slug that encodes
 *   scope → kind → subject
 * so both humans and tools can recover, from the name alone, WHERE a thing lives
 * (scope), WHAT it is (kind), and WHAT it means (subject). The display form is
 * Title Case separated by " · "; the machine form is a kebab slug. `kind` is
 * matched by membership in a closed vocabulary, not by position, so word order
 * stays human-readable.
 *
 *   "HC · KPI Band"        -> scope HC (healthcare), kind kpi,  subject "Band"
 *   "FIN · Chart Band"     -> scope FIN (financial), kind chart, subject "Band"
 *   "SYS · amCharts Loader"-> scope SYS (system),    kind —,    subject "amCharts Loader"
 *
 * The vocabularies below are sensible built-in defaults (seeded from a real
 * portal). They are intentionally data, not hard-coded logic, so a future
 * per-project `naming` config block can override them without touching callers.
 *
 * This module is the home of the lessons from the live naming pass:
 *   - display name vs machine slug are two surfaces (slugs are stable contracts);
 *   - tags MERGE, never replace (mergeTags);
 *   - the CSS-collision risk is global selectors leaking out of a block
 *     (cssScopeFindings), not "every class must be block-prefixed".
 */

export const DISPLAY_SEP = " · ";

// Scope code -> the full facet tag it maps to. Codes are terse (they head a
// display name); tags are the flat, kebab facet vocabulary used for discovery.
export const SCOPE_TAGS: Record<string, string> = {
  HC: "healthcare",
  FIN: "financial",
  SC: "supply-chain",
  RT: "retail",
  IOT: "iot",
  CRM: "crm",
  MKT: "marketing",
  EXEC: "executive",
  SYS: "system",
  DW: "data-warehouse",
};

// Resource kinds name the record TYPE itself, which is already known from context
// (you're looking at the datasource / query / page list), so the kind word is NOT
// injected into the display name — exactly how pages are named ("Industry Showcase ·
// Healthcare", not "... · Page Healthcare"). The kind still becomes a facet tag.
export const RESOURCE_KINDS = new Set(["page", "partial", "query", "datasource", "theme", "group"]);

// Source facet for DATA assets (datasources / queries): the single most important
// hidden fact about a dataset — can I trust it in production? Shown as a "— <Source>"
// suffix and a flat tag. Key = facet tag; value = the Title-case display word.
// `live` is the conventional unmarked default (omit `source` to leave a name unmarked).
export const SOURCE_TAGS: Record<string, string> = {
  sample: "Sample", // synthetic / demo / seed data
  live: "Live", // real connected operational data
  telemetry: "Telemetry", // the portal's own usage / audit data
  curated: "Curated", // a derived / modeled view, not a raw table
  reference: "Reference", // static lookup / dimension data
};

// Closed `kind` vocabulary. Key = canonical facet tag (lowercase, used on the
// resource's `tags`); value = the Title-case word(s) used in the display name.
export const KIND_DISPLAY: Record<string, string> = {
  kpi: "KPI Band",
  chart: "Chart",
  table: "Detail Table",
  filter: "Filter Bar",
  hero: "Hero",
  navigation: "Navigation",
  map: "Map",
  text: "Text",
  page: "Page",
  partial: "Partial",
  query: "Query",
  datasource: "Datasource",
  theme: "Theme",
};

// First word(s) of a display phrase that imply a kind, mapped to the kind tag.
// Lets parseName recover the kind from "Chart Revenue by Department" etc.
const KIND_KEYWORDS: Array<[RegExp, string]> = [
  [/\bkpi\b/i, "kpi"],
  [/\bchart(s)?\b/i, "chart"],
  [/\btable\b/i, "table"],
  [/\bfilter\b/i, "filter"],
  [/\bhero\b/i, "hero"],
  [/\bnav(igation|igator)?\b/i, "navigation"],
  [/\bmap\b/i, "map"],
];

export interface ParsedName {
  raw: string;
  scope: string | null; // the scope CODE (e.g. "HC"), if present
  scopeTag: string | null; // the facet tag the scope maps to (e.g. "healthcare")
  kind: string | null; // a closed-vocab kind tag (e.g. "kpi"), if detected
  subject: string | null; // the remaining human phrase
  slug: string; // derived stable machine slug
  conforms: boolean; // scope present AND a kind detected
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Lower-case kebab slug: spaces/punctuation → single dashes, trimmed. */
export function slugify(input: string): string {
  return String(input)
    .normalize("NFKD")
    .replace(/[^\w\s·-]/g, "") // drop punctuation except word chars/space/·/-
    .replace(/[·\s]+/g, "-") // separators → dash
    .replace(/_+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Look up the facet tag for a scope code (case-insensitive), or null. */
export function tagForScope(code: string): string | null {
  return SCOPE_TAGS[code.toUpperCase()] ?? null;
}

/** Reverse: the scope code for a facet tag, or null. */
export function scopeForTag(tag: string): string | null {
  const found = Object.entries(SCOPE_TAGS).find(([, t]) => t === tag.toLowerCase());
  return found ? found[0] : null;
}

/** Detect a closed-vocab kind from a free phrase, or null. */
export function detectKind(phrase: string): string | null {
  for (const [re, kind] of KIND_KEYWORDS) if (re.test(phrase)) return kind;
  return null;
}

/**
 * Parse a display name into its convention parts. Tolerant: a name with no
 * scope/kind still parses (conforms=false) so callers can grade it.
 */
export function parseName(name: string): ParsedName {
  const raw = String(name ?? "");
  const segments = raw.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  let scope: string | null = null;
  let phrase = raw.trim();

  if (segments.length >= 2) {
    const head = segments[0];
    // A scope code is a known code, or a short all-caps token (2–5 chars).
    if (SCOPE_TAGS[head.toUpperCase()] || /^[A-Z]{2,5}$/.test(head)) {
      scope = head.toUpperCase();
      phrase = segments.slice(1).join(DISPLAY_SEP).trim();
    }
  }

  const kind = detectKind(phrase);
  // Subject = phrase with the leading kind word(s) stripped, if any.
  let subject: string | null = phrase || null;
  if (kind) {
    const stripped = phrase
      .replace(/^(kpi band|kpi|charts?|detail table|table|filter bar|filter|hero|navigation|navigator|map)\b[\s:·-]*/i, "")
      .trim();
    subject = stripped || null;
  }

  return {
    raw,
    scope,
    scopeTag: scope ? tagForScope(scope) : null,
    kind,
    subject,
    slug: slugify(raw),
    conforms: scope !== null && kind !== null,
  };
}

export interface SuggestInput {
  kind: string; // a kind tag (kpi/chart/table/…) or a free word
  scope?: string; // a scope code (HC) or a facet tag (healthcare)
  subject?: string; // the human subject phrase
  qualifier?: string; // optional variant/grain (ytd, by-region)
  source?: string; // data-asset source facet (sample/live/telemetry/curated/reference)
}

export interface SuggestedName {
  display_name: string; // "HC · KPI Band — YTD"
  slug: string; // "hc-kpi-band-ytd"
  tags: string[]; // ["healthcare", "kpi"]
  scope: string | null;
  kind: string | null;
  source: string | null;
}

/**
 * Build a convention-conforming name from parts. `scope` accepts either a code
 * ("HC") or a facet tag ("healthcare"); `kind` accepts a kind tag or free word.
 *
 * For RESOURCE kinds (datasource/query/page/partial/theme/group) the kind word is
 * omitted from the display name — the record type is already known from context, so
 * the name reads "DW · Dim Customer", not "DW · Datasource Dim Customer" (mirrors how
 * pages are named). The kind still becomes a facet tag. A `source` facet (for data
 * assets) appends a "— <Source>" marker and a source tag.
 */
export function suggestName(input: SuggestInput): SuggestedName {
  const rawScope = (input.scope ?? "").trim();
  let scopeCode: string | null = null;
  if (rawScope) {
    scopeCode = SCOPE_TAGS[rawScope.toUpperCase()]
      ? rawScope.toUpperCase()
      : scopeForTag(rawScope);
    if (!scopeCode && /^[A-Za-z]{2,5}$/.test(rawScope)) scopeCode = rawScope.toUpperCase();
  }

  const kindKey = (input.kind ?? "").trim().toLowerCase();
  const kindTag = KIND_DISPLAY[kindKey] ? kindKey : detectKind(input.kind ?? "");
  const kindDisplay = kindTag ? KIND_DISPLAY[kindTag] : titleCase(input.kind ?? "");
  const isResourceKind = kindTag !== null && RESOURCE_KINDS.has(kindTag);

  const subject = (input.subject ?? "").trim();
  const qualifier = (input.qualifier ?? "").trim();
  const rawSource = (input.source ?? "").trim().toLowerCase();
  const sourceTag = rawSource && SOURCE_TAGS[rawSource] ? rawSource : null;

  // Display phrase: resource kinds omit the kind word (the subject IS the name);
  // content kinds lead with the kind word. Then qualifier, then source — each after
  // an em dash.
  let phrase: string;
  if (isResourceKind) {
    phrase = subject || kindDisplay;
  } else {
    phrase = kindDisplay;
    if (subject) phrase = `${kindDisplay} ${subject}`.trim();
  }
  if (qualifier) phrase = `${phrase} — ${titleCase(qualifier)}`;
  if (sourceTag) phrase = `${phrase} — ${SOURCE_TAGS[sourceTag]}`;

  const display = scopeCode ? `${scopeCode}${DISPLAY_SEP}${phrase}` : phrase;

  const tags: string[] = [];
  const scopeTag = scopeCode ? tagForScope(scopeCode) : null;
  if (scopeTag) tags.push(scopeTag);
  if (kindTag) tags.push(kindTag);
  if (sourceTag) tags.push(sourceTag);

  return {
    display_name: display,
    slug: slugify(display),
    tags,
    scope: scopeCode,
    kind: kindTag,
    source: sourceTag,
  };
}

/** Title-case a free word/phrase, leaving ALLCAPS acronyms (≤3) intact. */
export function titleCase(s: string): string {
  return String(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z]{2,3}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Merge tag lists into a deduped union, preserving order (existing first).
 * The convention's #1 tag rule: NEVER drop an existing tag — a tag may be
 * functional (e.g. a "Menu" tag that drives nav membership).
 */
export function mergeTags(existing: unknown, additions: unknown): string[] {
  const norm = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...norm(existing), ...norm(additions)]) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * CSS-collision findings for a single block's CSS. The real risk a block poses
 * to its page siblings is GLOBAL selectors leaking out of the block — not the
 * presence of generic class names (a family-prefixed `.hc-card` shared with
 * identical bodies is fine). So we flag only the unambiguous global leaks:
 *   - `:root { … }`  — defines page-global CSS custom properties
 *   - `* { … }`      — a universal reset that hits the whole page
 *   - bare top-level `body`/`html` selectors
 * Returns human-readable issue strings (empty = clean).
 */
export function cssScopeFindings(css: string): string[] {
  const text = String(css ?? "");
  const issues: string[] = [];
  if (/(^|[\s,}])\:root\s*\{/.test(text)) {
    issues.push(":root{} defines page-global CSS variables from inside a block — scope tokens to the block's wrapper or set them on a theme.");
  }
  if (/(^|[\s,}])\*\s*[{,]/.test(text)) {
    issues.push("universal `*` selector resets every element on the page, not just this block — scope it under the block wrapper.");
  }
  if (/(^|[\s,}])(body|html)\s*[{,]/i.test(text)) {
    issues.push("bare `body`/`html` selector styles the whole page from inside a block — scope under the block wrapper instead.");
  }
  return issues;
}
