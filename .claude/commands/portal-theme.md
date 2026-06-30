---
model: sonnet
effort: medium
description: Design or apply a portal theme.
argument-hint: <theme goal / brand>
---

Design or apply a portal-wide theme. Goal: **$ARGUMENTS**

Confirm a portal is connected (`active_config`); if not, send the user to `/portal-setup`.

Launch the **portal-theme-designer** agent (via the Task tool) with the goal above. Remind it to:

- **`snapshot_portal` first** so the change is revertible (`restore_resource`) before touching any tokens.
- Theme through CSS variables / theme tokens (light + dark), aligned to the brand in `$ARGUMENTS` and the project brief.
- **Report which blocks will NOT pick up the theme** — blocks that hardcode hex colors or fonts instead of consuming `var(--token, …)` are immune to theming and must be flagged (and ideally listed by `block_id`) so the user can decide whether to fix them.

Finish with: what the theme changed, the snapshot/rollback handle, and the list of hardcoded-color blocks that won't inherit it.
