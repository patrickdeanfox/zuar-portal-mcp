---
model: sonnet
effort: medium
description: Run the alignment Q&A (business / portal / data discovery) on its own.
---

Run the alignment Q&A by itself — no credential changes required.

Confirm a portal is connected (`active_config`); if not, point the user to `/portal-setup` (which does setup + alignment together).

Launch the **portal-onboarding** agent (via the Task tool) in **"align only" mode**: do **not** reconfigure credentials or call `init_project_config`. Instead, interview the user to learn (or refresh) the user, their business, their portal, and their data, then **(re)write `./.zuar-portal/brief.md`** — the brief every other agent reads.

Use this after `/portal-setup` when the business focus, audience, or data has shifted and the brief needs to catch up. Finish by confirming the brief was updated and summarizing what changed.
