---
name: portal-bulk-ops
description: Trigger when making changes across MANY Zuar Portal blocks or pages at once (bulk rename, restyle, retag, rebind, or place), or when the user runs /portal-bulk. The safe-discipline orchestration on top of the snapshot/validate/restore MCP tools.
---

# Portal bulk ops (safe discipline)

Bulk changes touch many resources, so a mistake multiplies. Run them through the
**`portal-bulk-operator`** agent (`.claude/agents/`) or the **`/portal-bulk`** command — this
skill is the thin discipline they follow. The per-block authoring rules still apply on every
edit: see **`assets/conventions.md`** (binding, the `$` trap, scoped CSS, safety) and the global
**`zportal`** skill. For bulk **data writes back to a database**, do not hand-roll SQL in a loop —
use the global **`db-modifications`** skill (the `/api/db_modifications/run` service).

## The loop (never skip a step)

1. **Snapshot first — the rollback point.** Call **`snapshot_portal`** before any write. This is
   your one-command revert if the batch goes wrong. (Writes are also mirrored to version control
   when configured — `vc_status` / `vc_log` — and any single resource is revertible via
   `restore_resource`.)
2. **Enumerate the targets.** `list_blocks` / `list_resource` to build the exact set you'll touch.
   Resolve it to concrete ids; don't operate on a fuzzy "all blocks like X" — name them.
3. **Dry-run plan + confirm.** Produce a plan: for each target, the current value → the proposed
   value (rename/restyle/retag/rebind/placement). Show it and **get explicit confirmation** before
   any mutation. No silent bulk writes.
4. **Apply in a controlled loop — one at a time, validated.** For each target:
   - `get_block` first to read current state, **including its existing `ui_queries`**.
   - Make the change.
   - **`validate_block`** on the new `json_data` + `css`; fix errors before writing.
   - `update_block` — and **RE-SEND the existing `ui_queries` verbatim**. Omitting it wipes the
     binding and the block goes blank. This is the #1 bulk footgun.
5. **Page placement is atomic.** To set the blocks on a page, use **`set_page_blocks`** (one
   atomic call with the full ordered list). **Never** fire parallel `add_block_to_page` calls —
   they race and corrupt page order / drop blocks.
6. **Verify.** After the batch, re-`list`/`get_block` a sample (and any rebound blocks) to confirm
   the changes landed and bindings survived. Spot-check live data still flows on rebinds.
7. **Revert if wrong.** Roll a single resource back with **`restore_resource`**, or fall back to
   the **`snapshot_portal`** taken in step 1 to undo the whole batch.

## Guardrails

- **Serial, not parallel,** for writes that share state (page block lists especially). `set_page_blocks`
  is the atomic primitive; never concurrent `add_block_to_page`.
- **Every `update_block` re-sends `ui_queries`** — re-state it from the `get_block` you did this loop.
- **`validate_block` per item**, not once for the batch — each edit can introduce a new error.
- **Data (SQL) and admin (user/security) writes are opt-in** (`PORTAL_ALLOW_DATA_WRITES` /
  `PORTAL_ALLOW_ADMIN_WRITES`); content/block writes are on by default. Bulk DB writes go through
  the global **`db-modifications`** skill, not raw loops.
