---
description: Guided Social Cue onboarding — drafts your brand profile from your website, picks platforms, and checks the browser connection. Run this once before /socialdiscovery.
argument-hint: "[your brand's website URL]"
allowed-tools: Bash, Read, Edit, WebFetch, AskUserQuestion, mcp__plugin_socialcue_socialcue-browser__launch_browser, mcp__plugin_socialcue_socialcue-browser__get_logged_in_platforms, mcp__plugin_socialcue_socialcue-browser__open_tab, mcp__plugin_socialcue_socialcue-browser__read_page, mcp__plugin_socialcue_socialcue-browser__close_tab
---

# /socialcue-setup

You are onboarding a new Social Cue user. Interview them conversationally — one
step at a time, never a wall of questions. Config goes to
`.socialdiscovery/config.json` in their project, and discovery runs on the Claude
subscription they already have — it only collects; posting happens later, after
they approve a reply.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

## Steps

### 1. Initialize

Run: `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config init`
(idempotent — safe if config already exists).

If it fails with `Cannot find module` / `ERR_MODULE_NOT_FOUND`, this is a fresh
install — dependencies aren't bundled. Tell the user you're installing the
plugin's Node packages (one-time, ~30s), run
`npm install --omit=dev --prefix "${CLAUDE_PLUGIN_ROOT}"`, then retry. If npm
itself fails, show the error and stop — nothing else works without deps.

If config already exists **and** has
brands, say so, show `config show`, and ask whether they want to add another brand,
change platforms, or redo the browser setup — then jump to that step only.

### 2. Draft the brand profile from their website

Ask for their brand's website URL (use `$ARGUMENTS` if it looks like a URL — don't
re-ask). Then **WebFetch the site and draft the profile for them** — this is the
whole point of this command; don't make them type what the site already says:

- **name** — the brand/product name
- **tagline** — one line, from the site's own hero/positioning
- **shortDescription** — 1–2 sentences: what it is, who it's for
- **tags** — 5–10 lowercase keywords for social search (product category, the
  problems it solves, competitor/category terms people actually post about — not
  marketing fluff)
- **aboutBrand** — brand-voice notes for the reply drafter: tone, positioning,
  what to emphasize, anything to never claim

Present the draft compactly and ask what to adjust (they always know something the
site doesn't — especially voice). If they have no website, interview for the same
fields instead, and leave url empty.

### 3. Save the brand

Run (single-quote every value; drop flags that are empty):

```
node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" brand add --name '<name>' --url '<url>' \
  --tagline '<tagline>' --desc '<shortDescription>' --about '<aboutBrand>' \
  --tags 'tag1,tag2,tag3' --project-path '<absolute project dir>'
```

**Project folder (`--project-path`)**: if the current working directory *is* this
brand's project (its repo/site/docs — usually true when the user set up Social Cue
from inside their project), pass the absolute cwd automatically — don't ask.
Otherwise ask once, casually ("Is there a folder on this machine with this brand's
assets — logo, screenshots, docs?"); it's optional, drop the flag if none. Agents
use it later to find reusable images/copy for Product Posts (directory listings,
launch sites, community posts).

Then ask if they have another brand to add (agencies often do); if so, repeat from
step 2.

### 4. Pick platforms

Use AskUserQuestion (multiSelect) to ask which platforms to hunt on. Offer:
**Reddit (Recommended)** — best signal, start here; **X / Twitter**;
**Hacker News**; **Founder communities** — Indie Hackers + Product Hunt, great
for dev-tool/SaaS brands. (They can name others via "Other" — any domain works.)
Recommend starting with Reddit only: fewer platforms = deeper coverage per run.

Then write the choice into config: run `config path` to locate `config.json`, and
edit its `platforms` array (Read + Edit) using these keys: `reddit`, `x`,
`hackernews`, `indiehackers`, `producthunt` ("Founder communities" = both) — or a
bare domain like `linkedin.com` for anything else. Confirm afterwards with
`config show`.

### 5. Browser connection

Explain in one short paragraph: discovery drives a **dedicated** Chrome profile —
not their daily browser — that they sign into normally. Their logins never leave
the machine.

Then start it for them: call the `mcp__plugin_socialcue_socialcue-browser__launch_browser` tool
(no terminal needed — it starts the dedicated profile with the debug port, or
reports it's already running, and opens a window on the Reddit login page). Tell
them to sign into their chosen platforms in that window and say when they're done,
then confirm with `mcp__plugin_socialcue_socialcue-browser__get_logged_in_platforms`.

- Logged into their platforms → confirm, move on.
- launch_browser errors (e.g. Chrome not installed) → relay the error, give the
  manual fallback, and don't block setup on it — they can sort it out before their
  first run:
  `google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.socialcue-chrome"`
- Custom port or profile location: set `browser.cdpUrl` / `browser.profilePath` in
  `config.json` — launch_browser respects both.

### 5b. Product Posts signup email (Pro only — skip on free unless they ask)

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" license show`. If Pro is active (or
the user asks about getting listed on directories or posting to communities), set
up the signup email:

- Ask which email they want new accounts on — one address for everything
  (Product Hunt, BetaList, Dev.to, …). Explain in a sentence: the agent
  signs up *as them* in the Social Cue Chrome — "Continue with Google" where a
  site offers it, otherwise an email signup on this address, reading the
  verification email from their own webmail in a second tab. Social Cue never
  stores their email password, only the address.
- Save it: `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" dest email <address>` — it
  prints the webmail URL it derived. "Unknown provider" (custom domain) → ask
  which webmail they use and re-run with `--webmail <url>` (Google Workspace →
  https://mail.google.com).
- Then have them sign in: `open_tab` on that webmail URL (the dedicated Chrome
  is up from step 5), tell them to sign into that inbox **and** their Google
  account (accounts.google.com) in that window, and say "done". Confirm with
  `read_page` on the webmail tab (an inbox, not a login form), then `close_tab`.
- If Google refuses to sign in inside the dedicated profile ("this browser may
  not be secure"), don't block on it — note it, move on; the submit flow falls
  back to email signup and asks them for the manual click when needed.
- Mention `/socialcue-post` is how they run one (the dashboard's Product Posts
  tab builds the command).

### 6. Wrap up

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show` and summarize: brands
configured, platforms chosen, browser status. Tell them the next step is
`/socialdiscovery` (with the dedicated Chrome running), and that it only **collects**
opportunities and drafts for their review — nothing is posted until they approve a
reply (on Pro, Claude can then click submit for them). Mention that
`/socialdiscovery` opens the **review dashboard** in their browser automatically
(results stream in live), and they can reopen it any time with
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" bridge open`.

## Notes

- Adjusting weights (`strategyWeights`, `engagementRatio`, `autoLike`,
  `maxTurnsPerPlatform`) is out of scope here — defaults are good. Tell them they
  can just ask later in plain language (e.g. "add X to my Social Cue platforms",
  "bump my engagement ratio") — the config skill handles it.
- If WebFetch can't reach the site, say so and fall back to interviewing.
