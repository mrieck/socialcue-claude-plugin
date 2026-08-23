---
description: Submit a brand to an online directory (Pro) — agent-driven form filling in your own browser, signing up as you (Google login or your own email, verification mail read from your webmail), and a hard stop for your review before anything is submitted.
argument-hint: "[brand name] [directory slug or URL]"
allowed-tools: Bash, Read, Glob, Skill, mcp__plugin_socialcue_socialcue-browser__launch_browser, mcp__plugin_socialcue_socialcue-browser__navigate, mcp__plugin_socialcue_socialcue-browser__read_page, mcp__plugin_socialcue_socialcue-browser__screenshot, mcp__plugin_socialcue_socialcue-browser__click, mcp__plugin_socialcue_socialcue-browser__click_at, mcp__plugin_socialcue_socialcue-browser__type, mcp__plugin_socialcue_socialcue-browser__type_text, mcp__plugin_socialcue_socialcue-browser__act, mcp__plugin_socialcue_socialcue-browser__press_key, mcp__plugin_socialcue_socialcue-browser__scroll, mcp__plugin_socialcue_socialcue-browser__wait, mcp__plugin_socialcue_socialcue-browser__get_page_info, mcp__plugin_socialcue_socialcue-browser__upload, mcp__plugin_socialcue_socialcue-browser__list_tabs, mcp__plugin_socialcue_socialcue-browser__open_tab, mcp__plugin_socialcue_socialcue-browser__switch_tab, mcp__plugin_socialcue_socialcue-browser__close_tab
---

# /socialcue-submit

You are driving a **directory submission**: getting the user's brand listed on a
directory site (startup directories, product listings, tool catalogs). The browser
is the user's own dedicated Chrome profile. Nothing is ever submitted without the
user's explicit approval in this conversation.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

## Steps

1. **Check config + Pro.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show` — no config or no active
   brands → stop and point at `/socialcue-setup`. Then
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" license show` — if free tier, explain
   that directory submission is a Pro feature ($19/mo, `/socialcue-setup` covers
   upgrading) and stop.
   Then `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" dir email` — if no signup email
   is set, ask which email they want their brand's directory accounts on (it's
   the address they're signed into in the Social Cue Chrome; Google login is
   used where sites offer it), save it with `dir email <address>` (plus
   `--webmail <url>` when the provider isn't recognised, e.g. Google Workspace
   → https://mail.google.com), and remind them to have that inbox and their
   Google account signed in inside the Social Cue Chrome window.

2. **Resolve brand + target.** Parse `$ARGUMENTS` (brand name, then directory).
   - One active brand and no argument → use it; several → ask.
   - Load the registry: `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" dir seed` then
     `dir list`. If the user named a directory or gave a URL, use that; otherwise
     show the list (with any prior submissions from
     `submission list --brand <ref>` marked) and ask which one to submit to.
     Arbitrary URLs are fine — anything with a submit form is attemptable.

3. **Start the attempt.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" submission start --brand '<ref>' --dir '<slug|url>'`
   and capture the JSON brief: submission id, brand fields, directory info
   (`signup` method, `oauthProviders`, `testStatus`, + learned `notes` from past
   runs — read them), `signupEmail` + `webmailUrl`, a generated `password` when
   an email signup may be needed (keep it for the signup form; it's also
   stored, see `submission creds`; `credentialsExisted` means an account was
   made on a previous run), and `dryRunPosts`.
   - "Already <status> for …" → tell the user, show `submission list --brand`,
     and stop unless they pick a different directory.

4. **Discover brand assets.** If the brief has a `projectPath`, explore that
   folder (Glob/ls — e.g. `**/*logo*`, `**/screenshot*`, `README*`, `docs/`) and
   note candidate logo images, screenshots, and descriptive copy worth reusing.
   Don't impose structure — just look around, and prefer square PNGs for logos.
   No projectPath → work from the brand fields alone; ask the user for a logo
   path only if the form requires one.

5. **Launch the browser** with `launch_browser` (no-op if already up).

6. **Run the submission.** Load the `directory-submission` skill and follow it —
   it covers signup (OAuth first, else email + reading the verification mail from
   the user's webmail in a second tab), form filling by refs, uploads, captchas,
   and the mandatory pre-submit review stop. Log every meaningful step via
   `submission update <id> '{"appendLog": "..."}'`.

7. **Wrap up.** Show `submission list --brand '<ref>'`, remind the user the
   Directories tab in the dashboard (`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" bridge open`)
   tracks all of this, and — if the directory reviews submissions before
   publishing — that the listing may take days to appear (they can paste the
   live URL into the dashboard later, or a future run can check).

## Notes
- One directory per invocation; each submit needs its own explicit approval.
- If the browser MCP tools are unavailable, the plugin install is broken — tell
  the user to reinstall/reload the plugin.
