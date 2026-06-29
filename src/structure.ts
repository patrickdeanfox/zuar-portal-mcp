/**
 * structure.ts
 *
 * HARD structural validation for content records before they are written to the
 * portal database. This is the LAST line of defence: every create/update flows
 * through resources.ts -> normalizeAndValidateForWrite(), so a structurally
 * malformed record can never reach the DB that the portal renders itself from.
 *
 * Why this exists
 * ---------------
 * The portal builds its page/navigation list by iterating EVERY layout and
 * reading `json_data.grid.layouts.{lg,md,sm}`. A single layout missing that
 * object throws `t.data.grid.layouts is undefined` while the list is built,
 * which collapses the whole `pages` collection (`l.pages is undefined`) — i.e.
 * ONE malformed record makes ALL pages disappear from the UI. On 2026-06-29
 * patrick-portal hit exactly this: an MCP-created layout had a grid with only
 * `blocks` + `block_layouts` and no `layouts`, and every page vanished.
 *
 * The contract
 * ------------
 * Each resource may register a normaliser. A normaliser:
 *   1. REPAIRS what is safely defaultable (fills `grid.layouts` etc.) so normal
 *      workflows never emit a known-broken shape, and
 *   2. REJECTS what cannot be safely repaired (returns hard `errors`).
 * After normalisation the record is asserted to satisfy the portal invariants;
 * if it still doesn't, the write is refused with a clear, actionable error.
 *
 * Resources covered today: layout, partial (both place blocks on a responsive
 * grid), theme (token map + css array) and query (datasource binding shape).
 * Resources with no registered normaliser pass through unchanged — add a
 * contract here as each resource's portal-breaking shapes are characterised.
 */

export interface StructureResult {
  /** The normalised body to write (safe defaults filled in). */
  body: Record<string, unknown>;
  /** Human-readable auto-repairs applied (informational; not failures). */
  repairs: string[];
  /** Hard, unrepairable structural problems — a non-empty list MUST block the write. */
  errors: string[];
}

const BREAKPOINTS = ["lg", "md", "sm"] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

// Per-breakpoint defaults for a layout's grid.layouts, matching the portal's own
// page scaffold (verified against healthy patrick-portal layouts).
const LAYOUT_BOX_DEFAULTS: Record<Breakpoint, Record<string, number | string>> = {
  lg: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 2 },
  md: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 6 },
  sm: { width: 100, height: 100, align: "center", sizingUnit: "%", cellSize: 10 },
};

// Per-breakpoint defaults for a partial's layouts (header/footer/sidebars), matching
// the portal's partial scaffold.
const PARTIAL_BOX_DEFAULTS: Record<Breakpoint, Record<string, number | string>> = {
  lg: { width: 100, height: 100, align: "left", sizingUnit: "%", cellSize: 5 },
  md: { width: 100, height: 100, align: "left", sizingUnit: "%", cellSize: 5 },
  sm: { width: 100, height: 100, align: "left", sizingUnit: "%", cellSize: 5 },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalise a "grid-like" container (a layout's `grid`, or a partial's `json_data`)
 * in place on a COPY. Both share the same render contract: a `layouts.{lg,md,sm}`
 * map of boxes, a `blocks` array, a `block_layouts.{lg,md,sm}` map, and a
 * `block_hidden` array. Only ADDS missing structure — never overwrites caller
 * values — so a custom/full-bleed surface keeps its intent.
 */
function normalizeGridLike(
  container: Record<string, unknown>,
  opts: { boxDefaults: Record<Breakpoint, Record<string, number | string>>; idDefault?: string; pathPrefix: string }
): { container: Record<string, unknown>; repairs: string[] } {
  const repairs: string[] = [];
  const c: Record<string, unknown> = { ...container };
  const p = opts.pathPrefix;

  if (opts.idDefault !== undefined && (typeof c.id !== "string" || c.id.length === 0)) {
    c.id = opts.idDefault;
    repairs.push(`${p}.id set to "${opts.idDefault}"`);
  }

  // layouts.{lg,md,sm} — the invariant whose absence makes EVERY page/partial vanish.
  const layouts = isPlainObject(c.layouts) ? { ...(c.layouts as Record<string, unknown>) } : {};
  if (!isPlainObject(c.layouts)) repairs.push(`${p}.layouts created (was missing/invalid)`);
  for (const bp of BREAKPOINTS) {
    if (!isPlainObject(layouts[bp])) {
      layouts[bp] = { ...opts.boxDefaults[bp] };
      repairs.push(`${p}.layouts.${bp} filled with portal default`);
    }
  }
  c.layouts = layouts;

  if (!Array.isArray(c.blocks)) {
    c.blocks = [];
    repairs.push(`${p}.blocks normalised to []`);
  }

  const blockLayouts = isPlainObject(c.block_layouts) ? { ...(c.block_layouts as Record<string, unknown>) } : {};
  if (!isPlainObject(c.block_layouts)) repairs.push(`${p}.block_layouts created`);
  for (const bp of BREAKPOINTS) {
    if (!isPlainObject(blockLayouts[bp])) blockLayouts[bp] = {};
  }
  c.block_layouts = blockLayouts;

  if (!Array.isArray(c.block_hidden)) {
    c.block_hidden = [];
    repairs.push(`${p}.block_hidden normalised to []`);
  }

  return { container: c, repairs };
}

// Assert the render-critical invariant after repair (the page/partial-list killer).
function layoutsInvariantHolds(container: unknown): boolean {
  if (!isPlainObject(container)) return false;
  const l = (container as Record<string, unknown>).layouts;
  return isPlainObject(l) && BREAKPOINTS.every((bp) => isPlainObject((l as Record<string, unknown>)[bp]));
}

/**
 * Back-compat export: normalise just a layout's `grid` object (used by the page
 * placement helpers and tests). Pure — operates on a copy.
 */
export function normalizeLayoutGrid(grid: Record<string, unknown>): { grid: Record<string, unknown>; repairs: string[] } {
  const { container, repairs } = normalizeGridLike(grid, {
    boxDefaults: LAYOUT_BOX_DEFAULTS,
    idDefault: "content",
    pathPrefix: "grid",
  });
  return { grid: container, repairs };
}

// ── Per-resource normalisers ──────────────────────────────────────────────────

function normalizeLayout(body: Record<string, unknown>): StructureResult {
  const repairs: string[] = [];
  const errors: string[] = [];
  const out: Record<string, unknown> = { ...body };

  if (out.json_data === undefined) return { body: out, repairs, errors }; // portal defaults apply
  if (!isPlainObject(out.json_data)) {
    errors.push("layout.json_data must be an object.");
    return { body: out, repairs, errors };
  }
  const jd: Record<string, unknown> = { ...(out.json_data as Record<string, unknown>) };
  if (jd.grid !== undefined && !isPlainObject(jd.grid)) {
    errors.push("layout.json_data.grid must be an object.");
    return { body: out, repairs, errors };
  }
  const grid = isPlainObject(jd.grid) ? (jd.grid as Record<string, unknown>) : {};
  const normalized = normalizeLayoutGrid(grid);
  jd.grid = normalized.grid;
  for (const r of normalized.repairs) repairs.push(`json_data.${r}`);
  out.json_data = jd;

  if (!layoutsInvariantHolds(jd.grid)) {
    errors.push(
      "layout.json_data.grid.layouts.{lg,md,sm} is required — without it the portal throws " +
        "'grid.layouts is undefined' while building the page list and ALL pages disappear."
    );
  }
  return { body: out, repairs, errors };
}

function normalizePartial(body: Record<string, unknown>): StructureResult {
  const repairs: string[] = [];
  const errors: string[] = [];
  const out: Record<string, unknown> = { ...body };

  if (out.json_data === undefined) return { body: out, repairs, errors };
  if (!isPlainObject(out.json_data)) {
    errors.push("partial.json_data must be an object.");
    return { body: out, repairs, errors };
  }
  // A partial (header/footer/sidebars) places blocks directly on json_data — same
  // render contract as a layout grid, but one level up. It is GLOBAL CHROME: a
  // malformed partial breaks every page, so the same invariant is enforced.
  const { container, repairs: r } = normalizeGridLike(out.json_data as Record<string, unknown>, {
    boxDefaults: PARTIAL_BOX_DEFAULTS,
    pathPrefix: "json_data",
  });
  out.json_data = container;
  for (const m of r) repairs.push(m);

  if (!layoutsInvariantHolds(out.json_data)) {
    errors.push(
      "partial.json_data.layouts.{lg,md,sm} is required — a partial is global chrome (header/footer/" +
        "sidebars); without it every page that renders the partial throws."
    );
  }
  return { body: out, repairs, errors };
}

function normalizeTheme(body: Record<string, unknown>): StructureResult {
  const repairs: string[] = [];
  const errors: string[] = [];
  const out: Record<string, unknown> = { ...body };

  if (out.json_data === undefined) return { body: out, repairs, errors };
  if (!isPlainObject(out.json_data)) {
    errors.push("theme.json_data must be an object.");
    return { body: out, repairs, errors };
  }
  const jd: Record<string, unknown> = { ...(out.json_data as Record<string, unknown>) };

  // customProperties is the CSS-variable token map every block reads. It must be a
  // flat object; a wrong type breaks global theming. Default {} if absent.
  if (jd.customProperties === undefined) {
    jd.customProperties = {};
    repairs.push("json_data.customProperties defaulted to {}");
  } else if (!isPlainObject(jd.customProperties)) {
    errors.push("theme.json_data.customProperties must be an object (a flat token map).");
  } else {
    for (const [k, v] of Object.entries(jd.customProperties as Record<string, unknown>)) {
      if (v !== null && typeof v !== "string" && typeof v !== "number") {
        errors.push(`theme.json_data.customProperties.${k} must be a string/number value (got ${typeof v}).`);
        break;
      }
    }
  }

  // css is an array of rule strings; the portal joins it. A non-array breaks render.
  if (jd.css === undefined) {
    jd.css = [];
    repairs.push("json_data.css defaulted to []");
  } else if (!Array.isArray(jd.css)) {
    errors.push("theme.json_data.css must be an array of CSS strings.");
  }

  out.json_data = jd;
  return { body: out, repairs, errors };
}

function normalizeQuery(body: Record<string, unknown>): StructureResult {
  const repairs: string[] = [];
  const errors: string[] = [];
  const out: Record<string, unknown> = { ...body };

  // A query binds one or more datasources as [{ id, alias }]. If present it must be
  // an array of objects; an empty/absent binding is left to the portal's own
  // "a query must have a datasource" check (and to referential validation).
  if (out.datasources !== undefined) {
    if (!Array.isArray(out.datasources)) {
      errors.push("query.datasources must be an array of { id, alias } objects.");
    } else {
      const bad = out.datasources.some((d) => !isPlainObject(d));
      if (bad) errors.push("query.datasources entries must be objects, e.g. { id: '<datasource-uuid>', alias: 'datasource' }.");
    }
  }
  return { body: out, repairs, errors };
}

// Per-resource normaliser registry. Absent => pass through unchanged.
const NORMALIZERS: Record<string, (body: Record<string, unknown>) => StructureResult> = {
  layout: normalizeLayout,
  partial: normalizePartial,
  theme: normalizeTheme,
  query: normalizeQuery,
};

/** True if this resource has a registered structural contract. */
export function hasStructureContract(resourceKey: string): boolean {
  return resourceKey in NORMALIZERS;
}

/**
 * The single structural gate. Call with the FINAL body that is about to be
 * written (post field-pick, and for PUT post-merge) so the assertion reflects
 * exactly what will land in the DB.
 */
export function normalizeAndValidateForWrite(
  resourceKey: string,
  body: Record<string, unknown>
): StructureResult {
  const fn = NORMALIZERS[resourceKey];
  if (!fn) return { body, repairs: [], errors: [] };
  return fn(body);
}
