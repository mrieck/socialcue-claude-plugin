---
description: Open the Social Cue dashboard without running discovery — review the queue, edit drafts, leave notes.
allowed-tools: Bash
---

# /load-dashboard

Open the local Social Cue dashboard for review only. Do **not** run discovery, do
not launch the browser MCP tools, and do not start a discovery subagent.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

## Steps

1. **Check config.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show`
   If the config doesn't exist, stop and tell the user to run `/socialcue-setup`
   first — the bridge needs a config (pairing token) to start.

2. **Open the dashboard.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" bridge open`
   This starts the local bridge if needed (detached — it keeps running after the
   command returns) and opens the dashboard in the user's default browser. Relay
   the printed dashboard URL. If it errors, relay the message (e.g. port conflict)
   instead of retrying blindly.

3. **Quick queue summary.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" opp list --status new`
   Tell the user in a line or two how many new opportunities are waiting (or that
   the queue is empty — suggest `/socialdiscovery` to find fresh ones). Remind
   them the dashboard is where they review, edit drafts, leave notes, and set
   statuses; notes they leave there get swept into their voice guidance at the
   start of the next discovery run (or on demand via `/socialdiscovery:notes`).
