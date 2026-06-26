---
description: Audit existing blocks for bugs, a11y, responsiveness, and design fit.
argument-hint: [optional filter — e.g. a page or name prefix]
---

Audit existing portal blocks. **Read-only — do not fix anything.**

Confirm a portal is connected (`active_config`); if not, send the user to `/portal-setup`.

**Scope the set.** If `$ARGUMENTS` is given, audit only blocks matching that filter (a page, a name prefix, etc.); otherwise audit all blocks. State the scope before starting.

**Run it** one of two ways:
- **Automated:** run the `.claude/workflows/portal-audit.js` Workflow — it fans the auditors across the scoped blocks and returns a ranked report. Prefer this for a large set.
- **Manual:** fan **portal-block-adversary** (bugs, silent-data traps, edge cases, a11y, responsiveness) and **portal-block-advisor** (design fit, does it serve the question) across the scoped blocks via the Task tool, then synthesize.

**Synthesize** a single ranked report: **blocking issues first** (broken bindings, `$`-trap blanking, empty-block column mismatches, silent-data truncation), then a11y/responsive problems, then design-fit notes — each tied to a `block_id`.

This command does not modify anything. Close by offering to send the flagged blocks through `/portal-build`'s debugger stage to fix them.
