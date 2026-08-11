<a name="top"></a>

![Social Cue - find the conversations worth joining.](docs/socialcue_banner.png)

# Social Cue

**Your next customers are already talking about the problem you solve. Claude finds those threads.**

Social Cue is a [Claude Code](https://claude.com/claude-code) plugin that hunts
Reddit, Hacker News and X for the conversations worth joining for your brand -
scored, ranked, and paired with a reply drafted in your voice - by driving your
own logged-in browser. It runs on the Claude subscription you already have, so
discovery adds no extra AI bill and needs no API key. Your queue lives in a
local store; there is no cloud account and no telemetry.

```
/socialcue:socialdiscovery
```

## ✨ What you get

- 🔎 **Real browsing, not keyword alerts** - Claude drives a dedicated Chrome
  profile the way you would: search, open threads, read the room, move on.
  No scraping APIs, no uploaded credentials.
- 🧠 **Scored, not dumped** - every conversation runs through a scoring brain:
  relevance 1-10, opportunity type, and why it's worth your time. Only threads
  worth joining make the queue.
- ✍️ **Replies drafted in your voice** - each opportunity arrives with a
  drafted reply. Leave notes ("too salesy", "shorter"), and the voice feedback
  loop rewrites the queue and remembers for next time.
- 🗂️ **A local dashboard** - one queue to review, edit, approve and track,
  served from localhost. Nothing syncs to a cloud.
- 💸 **No extra AI bill** - discovery runs on your existing Claude Code
  subscription. That's the whole point.
- 🧩 **Companion Chrome extension** - a passive sensor that collects
  opportunities while you browse normally
  ([Chrome Web Store](https://chromewebstore.google.com/detail/social-cue/gifjbbpfhkpjogafmndjiekcblenpljo)),
  merging into the same local queue over a localhost bridge.

## 🚀 Install

In Claude Code:

```
/plugin marketplace add mrieck/claude-plugins
/plugin install socialcue@productive-mark
```

(`productive-mark` is the marketplace, hosted in
[mrieck/claude-plugins](https://github.com/mrieck/claude-plugins); `socialcue`
is the plugin - this repo.)

The first time you run setup, Claude checks the install and fetches the
plugin's Node packages if they're missing - no manual `npm install`.

> **Requirements:** [Claude Code](https://claude.com/claude-code), Node 18+,
> and Google Chrome.

## 🏁 Quick start

**1. Set up (once).**

```
/socialcue:socialcue-setup
```

Give it your website URL and it drafts your brand profile for you (name,
tagline, search tags, voice notes - you just correct it), asks which platforms
to hunt on, and connects the browser. Discovery uses a **dedicated Chrome
profile**, not your daily browser: Social Cue launches it for you, and you sign
into your platforms in that window once.

**2. Hunt.**

```
/socialcue:socialdiscovery
```

Claude browses, scores, and files ranked opportunities with drafted replies
into `.socialdiscovery/` in your project - a local SQLite store plus a config
file you can read and edit. Results stream into the dashboard live during the
run.

**3. Review.**

```
/socialcue:load-dashboard
```

Opens the queue without running discovery: filter by platform, brand or
status, edit drafts, leave feedback notes, approve. To change settings later,
just ask in plain language ("add X to my Social Cue platforms").

## 💼 Free vs Pro

Discovery, review, and content scheduling are free and never gated. Pro
unlocks **assisted posting** and **tracking**:

| | Free | Pro |
|---|:---:|:---:|
| Discovery runs, scoring, drafted replies | ✓ | ✓ |
| Dashboard queue, draft editing, voice feedback loop | ✓ | ✓ |
| Chrome extension sync (localhost bridge) | ✓ | ✓ |
| **Content scheduling** - schedule original posts through your own [Postiz](https://postiz.com) account, with status and analytics synced back | ✓ | ✓ |
| **Assisted posting** - opens the thread and pre-fills your approved reply; you click submit, or opt in per post to have Claude click it | | ✓ |
| **Reply performance tracking** - discovery runs check how your posted replies are doing (upvotes, replies) over time | | ✓ |

Pro is **$19/mo** at **[trysocialcue.com](https://trysocialcue.com)**. After
subscribing you get an account token; paste it into the dashboard's License
panel and the plugin keeps a short-lived, **offline-verified** license key
fresh automatically.

## 🔒 Where your data goes

To the AI provider you already pay, and to nobody else - the source is visible
so you can check:

- Discovery reads pages through Claude, so page content goes to Anthropic
  under your existing Claude subscription - the same place it goes for any
  Claude Code session. That's the only reader.
- Nothing comes to us. No uploaded sessions, no cloud account, no telemetry.
  Opportunities live in a local SQLite file, and the dashboard binds to
  `127.0.0.1` only.
- The Pro license refresh sends exactly one thing: your opaque account token.
  Never your brands, pages, or opportunities.
- Postiz is opt-in: only if you connect your own API key, and only the posts
  you composed and chose to schedule.

## 🔍 Under the hood

- Slash commands and the discovery subagent are markdown prompts; the logic
  lives in a small Node CLI (`lib/cli.js`), a zero-dependency localhost bridge
  (`bridge/`), and a React dashboard (`dashboard/`) the bridge serves.
- Browser driving is an MCP server (`mcp/browser-server/`) that attaches to
  the dedicated Chrome profile over CDP.
- The scoring brain (`skills/scoring-brain/`, `vendor/shared/`) is vendored
  from a shared package, so the plugin and the Chrome extension score
  identically.

## 📄 License

[PolyForm Shield 1.0.0](LICENSE.md) - source-visible on purpose, so the
privacy claims above are verifiable in the code you're actually running.
