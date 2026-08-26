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
- 🖼️ **Reads memes and screenshots** - image and video posts go through fully
  local OCR (bundled tesseract), so image-heavy threads get scored too - no
  vision tokens, and the pixels never leave your machine.
- 🚀 **Product Posts (Pro)** - say *"put PlugMyPlugin on Product Hunt"* or
  *"post the DemoDay video to r/SideProject"* and Claude gets it there:
  directories, launch sites, subreddits, Indie Hackers, Show HN, forums. It
  signs up as you where needed, digs up the logo and screenshots each form
  wants, fills it in your own browser, and stops for your approval before
  anything is submitted.
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

**4. Get listed (Pro).**

```
/socialcue:socialcue-post PlugMyPlugin on Product Hunt
```

Plain English in, a submitted listing out. Say what to post (a brand, an
article or video from your Content Library, or any repo/URL) and where (a
directory, launch site, subreddit, Indie Hackers, Show HN, a forum, or just a
URL with a submit form). Claude works out the rest in your dedicated Chrome
and pauses for a hard review before it clicks submit. See
[Product Posts](#product-posts) below.

## 💼 Free vs Pro

Discovery, review, and content scheduling are free and never gated. Pro
unlocks **product posts**, **assisted posting** and **tracking**:

| | Free | Pro |
|---|:---:|:---:|
| Discovery runs, scoring, drafted replies | ✓ | ✓ |
| Dashboard queue, draft editing, voice feedback loop | ✓ | ✓ |
| Chrome extension sync (localhost bridge) | ✓ | ✓ |
| **Content scheduling** - schedule original posts through your own [Postiz](https://postiz.pro/socialcue) account, with status and analytics synced back | ✓ | ✓ |
| **Assisted posting** - opens the thread and pre-fills your approved reply; you click submit, or opt in per post to have Claude click it | | ✓ |
| **Reply performance tracking** - discovery runs check how your posted replies are doing (upvotes, replies) over time | | ✓ |
| **Product Posts** - get a brand, an article, or any project listed on directories and launch sites, or posted to subreddits, Indie Hackers, Show HN and forums — the agent fills the form in your own browser, finds the logos/screenshots it needs, and you approve before anything submits | | ✓ |

Pro is **$19/mo** at **[trysocialcue.com](https://trysocialcue.com)**. After
subscribing you get an account token; paste it into the dashboard's License
panel, or run `/socialcue:activate-pro <token>`, and the plugin keeps a
short-lived, **offline-verified** license key fresh automatically.

<a name="product-posts"></a>
### 🚀 Product Posts

Getting a product listed everywhere it should be is a week of tedious forms:
create an account, confirm the email, find a 512px logo, crop screenshots,
write a tagline that fits in 60 characters, repeat for the next site. Product
Posts turns that into one sentence.

```
/socialcue:socialcue-post the watermark article to Indie Hackers
/socialcue:socialcue-post my claude-plugins repo to Show HN
/socialcue:socialcue-post Social Cue on https://some-directory.com/submit
```

- **Anything as the subject** - one of your brands, an article or video from
  the Content Library (including ones written by the
  [seoblog](https://github.com/mrieck/claude-plugins) plugin), or an ad-hoc
  project: a GitHub URL or a local folder is enough.
- **Anywhere as the destination** - a Pro-only **venue playbook** synced from
  trysocialcue.com covers the common directories, launch sites, subreddits,
  Indie Hackers, Show HN, Dev.to and forums, with each site's post types,
  signup method and quirks. Any other URL with a submit form works too, and
  what the agent learns about a new site stays in your local store.
- **Signs up as you** - OAuth (Google/GitHub) where the site offers it,
  otherwise email plus a verification code Claude reads from your own webmail
  in a second tab. Accounts are yours, in your browser; no credentials are
  stored by the plugin.
- **Finds the assets on the fly** - logos, screenshots, OG images and
  descriptions are pulled from your brand profile, your site, the repo, or
  the content item's media, and resized to what the form wants.
- **Reads the room first** - community rules are checked before composing;
  a subreddit that forbids self-promo is marked *skipped*, not spammed.
- **Hard stop before submit** - the filled form is shown to you for review
  in the conversation. Nothing is ever submitted without your explicit go.
  Captchas are yours to solve; sites that prohibit automated submissions are
  left alone.
- **Tracked in the dashboard** - every attempt, its status and the resulting
  URL show up in the Product Posts panel, so you can see where each project
  is listed and what's still to do.

## 🔒 Where your data goes

We don't record or send your social media data anywhere - it stays on your
machine, except what goes to the models you're already using. The source is
visible so you can check:

- Discovery reads pages through Claude, so page content goes to Anthropic
  under your existing Claude subscription - the same place it goes for any
  Claude Code session.
- Nothing comes to us. No uploaded sessions, no cloud account, no telemetry.
  Opportunities live in a local SQLite file, and the dashboard binds to
  `127.0.0.1` only.
- OCR of image/video posts runs entirely on your machine (bundled model, no
  API) - the pixels go nowhere.
- The Pro license refresh and the Pro venue-playbook sync each send exactly one thing: your opaque account token. What the agent learns about a site on your machine stays in your local store.
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
