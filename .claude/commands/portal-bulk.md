---
model: sonnet
effort: medium
description: A guarded bulk change across many blocks/pages.
argument-hint: <the change to make>
---

Apply a change across many blocks/pages — guarded. Change: **$ARGUMENTS**

Confirm a portal is connected (`active_config`); if not, send the user to `/portal-setup`.

Launch the **portal-bulk-operator** agent (via the Task tool) with the change above, and require this sequence:

1. **Snapshot first** — `snapshot_portal` before any write, so the whole batch is revertible (`restore_resource`).
2. **Dry-run plan** — identify every affected block/page and present the exact intended change as a plan. Use atomic `set_page_blocks` for page reordering/placement, **not** parallel `add_block_to_page` calls. Any `update_block` on a bound block must re-send its existing `ui_queries` or the binding is wiped.
3. **Get explicit confirmation BEFORE applying.** Do not write anything until the user approves the dry-run plan.
4. **Apply, then verify** — re-read a sample of the changed resources to confirm the change landed and nothing was blanked.
5. **Report rollback** — state the snapshot handle and exactly how to revert.

Finish with: what changed (counts + scope), verification result, and the rollback handle.
