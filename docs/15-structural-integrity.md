# 15 · Structural Integrity Gate

> **The single greatest risk this server carries is writing a structurally
> malformed record into the database the portal renders itself from.** One bad
> record can take down the whole UI. This page documents the incident that
> proved it, the invariant it violated, and the hard, un-bypassable gate that
> now prevents a repeat. **`[2.6.0]`**

## The incident (postmortem)

**2026-06-29 — "all my pages got deleted."** Every page vanished from
the portal's navigation and the browser console showed:

```
can't access property "length", l.pages is undefined
can't access property "lg", t.data.grid.layouts is undefined
can't access property "id", r.buffer is null
```

Nothing was deleted. All 21 layouts and 87 blocks were intact in the database.
The portal builds its page/navigation list by iterating **every** layout and
reading `json_data.grid.layouts.{lg,md,sm}`. **One** layout — created via this
MCP server on 2026-06-26 — had a grid containing only `blocks` and
`block_layouts`, with **no `layouts`** object. While building the list the
renderer hit that record, threw `grid.layouts is undefined`, and the entire
`pages` collection failed to construct (`l.pages is undefined`). Result: a
single malformed page made **all** pages disappear.

The fix at the time was to repair that one layout's `json_data`. This page is
about making that class of bug **impossible to write in the first place**.

## The invariant

A layout (page) that carries a grid **must** have a renderable grid:

| Key | Requirement | Why |
|-----|-------------|-----|
| `json_data.grid.id` | string (default `"content"`) | grid identity |
| `json_data.grid.layouts.lg` / `.md` / `.sm` | each a box object | **the page-list killer if missing** |
| `json_data.grid.blocks` | array | block id list |
| `json_data.grid.block_layouts.{lg,md,sm}` | objects | per-breakpoint placement |
| `json_data.grid.block_hidden` | array | hidden-block list |

The portal default box per breakpoint (verified against healthy layouts):

```json
{ "lg": { "width": 100, "height": 100, "align": "center", "sizingUnit": "%", "cellSize": 2 },
  "md": { "width": 100, "height": 100, "align": "center", "sizingUnit": "%", "cellSize": 6 },
  "sm": { "width": 100, "height": 100, "align": "center", "sizingUnit": "%", "cellSize": 10 } }
```

## The gate (hard rule, enforced in code)

Every content write funnels through **`createResource` / `updateResource`** in
[`src/resources.ts`](../src/resources.ts). Both now call a single chokepoint
**`gateStructure()`**, which delegates to
**`normalizeAndValidateForWrite()`** in [`src/structure.ts`](../src/structure.ts):

1. **Normalise (auto-repair).** Fills every safely-defaultable invariant
   (`grid.id`, `grid.layouts.{lg,md,sm}`, `grid.block_layouts`,
   `grid.block_hidden`) **without overwriting** anything the caller set, so a
   normal page build can never emit the missing-`layouts` shape. Repairs are
   logged: `[structure] auto-repaired layout on update: …`.
2. **Assert (hard reject).** After repair the portal invariant must hold. If it
   still can't (e.g. `json_data` or `grid` is the wrong type), the write is
   **refused** with an actionable error — the malformed body never reaches the DB.

Why this layer and not just the agents (below): it runs on the **final** body —
after field-pick, and for a full-replace PUT **after the merge with the current
record** — so it validates exactly what will land in the database. It cannot be
skipped by any tool, prompt, or agent. `add_block_to_page`, `set_page_blocks`,
`remove_block_from_page`, `create_resource`, `update_resource`, and
`restore_resource` all pass through it.

This is **the multi-stage approach's final stage made non-optional.** The
portal-block agent handoff (see [13 · Agents & Workflows](13-agents-and-workflows.md))
is the *advisory* front of the pipeline; this gate is the *enforced* back of it.
An agent that proposes a malformed write gets a hard rejection it must fix —
the same as a human or a script would.

## Extending the contract

`structure.ts` keys normalisers by resource. Today only `layout` has a
contract; **resources without one pass through unchanged.** As each resource's
portal-breaking shapes are characterised, add a normaliser:

```ts
// src/structure.ts
const NORMALIZERS: Record<string, (body) => StructureResult> = {
  layout: normalizeLayout,
  // theme:  normalizeTheme,   // ← add the next contract here
};
```

A normaliser returns `{ body, repairs, errors }`: `repairs` are informational
auto-fixes; a non-empty `errors` array **must** block the write. Keep
normalisers **pure** (operate on a copy, never mutate the caller's object) and
**additive** (fill missing structure, never overwrite caller intent). Cover each
new contract in [`test/structure.test.ts`](../test/structure.test.ts), and always
include a test that reproduces the exact malformed shape you are defending
against.

## Rules of thumb

- **Never hand-build a layout `json_data.grid` with only `blocks` /
  `block_layouts`.** Include `id`, `layouts.{lg,md,sm}`, and `block_hidden` — or
  let the gate fill them.
- **A gate rejection is a real defect, not a nuisance.** It means the body would
  have broken the portal. Fix the structure; do not try to route around it.
- **Diagnosing "all pages vanished":** `list_resource layout` (full) and scan
  for any layout whose `json_data.grid.layouts` is missing; repair with
  `update_resource` (the gate will also complete it). Version control auto-commits
  the fix, so it's revertible.
