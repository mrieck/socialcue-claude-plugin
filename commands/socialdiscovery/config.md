---
description: Manage Social Cue config — brands, target platforms, and the dedicated browser connection. Load this whenever the user asks to change Social Cue settings (platforms, weights, autoLike, engagementRatio, browser CDP URL, brands) outside of guided onboarding.
argument-hint: "[what you want to change, in plain language]"
user-invocable: false
allowed-tools: Bash, Read, Edit
---

# /socialdiscovery:config

Help the user manage their local Social Cue config. Everything is stored in
`.socialdiscovery/config.json` in the current project. Brands and accounts are the
user-editable source of truth (the SQLite DB only holds generated state).

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`.

## Common actions

- **Initialize:** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config init`
- **Show current config:** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show`
- **Show file paths:** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config path`
- **Add a brand:**
  `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" brand add --name "Acme" --url "https://acme.dev" --tagline "..." --desc "..." --about "voice notes" --tags "tag1,tag2"`
- **List brands:** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" brand list`
- **Remove a brand:** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" brand rm "<id or name>"`

## Editing other settings

For platforms, strategy weights, the browser CDP URL, `autoLike`, `engagementRatio`,
etc., read `config.json` (use `config path` to find it) and edit the JSON directly
with the user's intent. Keep it valid against the schema — after editing, run
`config show` to confirm it parses.

## What to do

1. Read `$ARGUMENTS` to understand what the user wants to change.
2. If config doesn't exist yet, run `config init` first.
3. Make the change via the CLI (preferred) or by editing `config.json`.
4. Run `config show` and confirm the result back to the user.

## Browser setup reminder (for discovery)
Discovery drives a **dedicated** Chrome profile (not the daily driver). The user
launches it themselves, signs into the platforms, and Social Cue attaches over CDP:
```
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.socialcue-chrome"
```
The `browser.cdpUrl` in config must match the port (default `http://127.0.0.1:9222`).
