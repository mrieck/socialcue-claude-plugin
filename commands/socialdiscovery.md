---
description: Run social discovery for your brands — drive your local browser, find ranked conversations worth joining + drafted replies into the local store.
argument-hint: "[optional brand name to focus on]"
allowed-tools: Bash, Task, Read, Edit, Skill, mcp__plugin_socialcue_socialcue-browser__launch_browser, mcp__plugin_socialcue_socialcue-browser__get_logged_in_platforms
---

# /socialdiscovery

You are orchestrating a Social Cue discovery run. The browser is the user's own
dedicated, already-logged-in Chrome profile, and all output goes to the local
store. Discovery only collects opportunities for the user to review — posting is
a separate step that happens after they approve a reply.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

## Steps

1. **Check config.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show`
   - If the config doesn't exist or there are **no active brands**, stop and tell the
     user to run `/socialcue-setup` first (they need at least one brand).

2. **Sweep new draft notes into voice guidance.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" opp notes`
   - Empty list `[]` → skip this step, say nothing.
   - Otherwise these are dashboard notes the user left on drafts that haven't
     reached the voice guidance yet. Load the `review-notes` skill and follow its
     "Sweeping dashboard notes" flow: distill the notes into Voice rules (merge
     with existing rules, don't duplicate), then stamp each swept row with
     `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" opp update <id> '{"noteSwept": true}'`.
   - Doing this **before** step 6 matters: `brief` injects the guidance file, so
     the run drafts in the user's updated voice. Tell the user in one line what
     rules you added or sharpened.

3. **Make sure the dedicated browser is up.** Call
   `mcp__plugin_socialcue_socialcue-browser__launch_browser` — it's a no-op if Chrome is already
   running, otherwise it starts the dedicated profile (never ask the user to run a
   terminal command). Then call `mcp__plugin_socialcue_socialcue-browser__get_logged_in_platforms`:
   - Target platform(s) present → continue.
   - Missing → a window just opened; ask the user to sign in there and tell you
     when done, then re-check. Don't open a run until this passes.

4. **Open a run.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" run new`
   Capture the printed run id — you'll pass it to collected opportunities.

5. **Open the live dashboard.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" bridge open`
   This starts the local bridge if needed (detached — it keeps running after the
   command returns) and opens the dashboard in the user's default browser. Show the
   user the printed dashboard URL as well, and tell them opportunities will stream
   into the dashboard live while discovery runs. If it errors, don't block the run —
   relay the message and continue; the report file still gets written at the end.

6. **Get the run brief.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" brief`
   This prints the full discovery brief (brands, detected platforms, strategy budget,
   and previously-seen URLs to skip), assembled from the shared scoring brain.

7. **Collect due performance check-ins (Pro).** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" perf due`
   - If it prints `pro_required` or an empty list `[]`, skip this — say nothing.
   - Otherwise it prints a JSON list of posted replies due a check-in. You'll pass
     it to the subagent as a **"Performance check-ins"** section prepended to the
     brief (the subagent visits each thread and records reception via the
     `record_performance` MCP tool before discovery starts).

8. **Delegate the browse-and-assess loop to the discovery subagent.** Use the Task
   tool to launch the `discovery-subagent`, passing it:
   - the run id from step 4,
   - the brief text from step 6 (with the step-7 check-in list prepended, if any),
   - the focus brand from `$ARGUMENTS` if provided.
   The subagent drives the browser (Phase 2 MCP tools), scores conversations against
   the `scoring-brain` skill, and records each find with the
   `mcp__plugin_socialcue_socialcue-browser__collect_opportunity` tool (screenshot + local store).

9. **Finish + report.** When the subagent returns, close the run and write a report:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" run finish <run id> --summary "<one-line recap>"`
   This writes `.socialdiscovery/runs/<run id>/report.md`. Then show the new ones:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" opp list --status new`
   Give the user a short ranked summary, remind them the **dashboard** (the URL from
   step 5) is where they review, edit drafts, leave notes, and set statuses — the
   report file is also at the path above — and that these are drafts for review;
   nothing was posted. If they don't like the drafts, `/socialdiscovery:notes`
   captures their feedback and rewrites the queue in their voice.
   (Pro users can post assisted from the dashboard: it opens the thread pre-filled in
   the dedicated browser and they click submit themselves.)

## Notes
- If the browser MCP tools (`mcp__plugin_socialcue_socialcue-browser__*`) are **not available** at
  all, the plugin install is broken (the browser server ships with it) — tell the
  user to reinstall/reload the plugin.
- Reddit-first: unless the user asks otherwise, focus on Reddit.
