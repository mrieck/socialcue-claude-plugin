---
description: Activate Social Cue Pro with the account token from your purchase email — saves it and fetches your license key.
argument-hint: "[account token from your email, starts with scacct_]"
allowed-tools: Bash
---

# /activate-pro

Connect this machine to the user's Social Cue Pro subscription. The argument is
the account token from their purchase or recovery email (it starts with
`scacct_`).

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

## Steps

1. **Get the token.** Use the command argument. If none was given, ask the user
   to paste the token from their email (it starts with `scacct_`). Never guess
   or invent one.

2. **Connect.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" license connect <token>`

3. **Relay the result verbatim-ish.**
   - Success prints `Connected — Pro active for <email> …` — congratulate the
     user briefly and mention Pro features are now on (unified dashboard queue,
     assisted posting, performance tracking, directory submission).
   - "subscription looks inactive" — the token was saved but their subscription
     isn't active; point them at https://trysocialcue.com/account.
   - Any other failure (e.g. offline) — the token is saved and the plugin
     retries automatically; they can also ask you to run
     `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" license refresh` later.

Do not print or log the token back to the user beyond what the CLI outputs -
treat it like a password.
