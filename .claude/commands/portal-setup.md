---
model: sonnet
effort: medium
description: First-time setup — connect this folder to a portal and align to the user/business/data.
---

Set this project up to work against a Zuar Portal. One-time, per folder.

1. **Check current state.** Call `active_config`. If a config is already active, report which portal/host it points at (host + identity only — **never print secrets**) and confirm with the user whether to keep it or reconfigure. If it is already configured and a `.zuar-portal/brief.md` exists, there is nothing to do — say so and stop.

2. **If not configured (or the user wants to reconfigure):** launch the **portal-onboarding** agent (via the Task tool) to:
   - collect the portal credentials and write them with `init_project_config` to `./.zuar-portal/config.json`,
   - then run the alignment Q&A — learn the user, their business, their portal, and their data — and write `./.zuar-portal/brief.md` (the brief every other agent reads).

   The richer **`setup_portal`** tool also asks (via elicitation) whether the user has the **Claude for Chrome** extension — recorded as `browser.claudeInChrome`. With it, the build pipeline can *see* a rendered block (screenshot, console) for visual debugging and a final visual sign-off, not just review code. Mention the payoff, and the one caveat: visual checks need the user **signed into the portal in Chrome** (the MCP's API key doesn't authenticate the browser session). It degrades gracefully when the extension isn't present.

3. **Confirm sign-in.** After onboarding returns, verify the connection is live (identity/version) and report success: which portal this folder is now bound to and that the brief was written. Do **not** echo passwords, tokens, or any secret value at any point.

No arguments. After this, `/portal-build`, `/portal-theme`, `/portal-bulk`, and `/portal-audit` are ready to use.
