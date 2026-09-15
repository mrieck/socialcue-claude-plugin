---
name: crosspost
description: Cross-post one video to multiple platforms (YouTube Shorts, TikTok, Instagram Reels) with per-platform captions, titles, tags and settings, approved in chat and scheduled via the Postiz API. Load this when the user asks to cross-post, publish, or schedule a video to social platforms, or invokes /crosspost.
argument-hint: "<video path> [topic / context / preferred time]"
---

# Social Cue — Crosspost

One video, several platform-native packagings, **approved in chat**, then
scheduled through the user's Postiz account. The CLI is at
`${CLAUDE_PLUGIN_ROOT}/lib/cli.js` (run with `node`).

From the user's invocation arguments, identify:
- the **video file path** (ask if missing — never guess),
- any **context** about the video (what it shows, the product, the CTA),
- an optional **preferred posting time**.

**The approval gate is the whole contract.** Social Cue's standing rule is
"agents create content items — they never schedule." This flow is the one
sanctioned exception: you may run `content schedule` **only after the user has
approved the exact copy, channels and time in this chat**. Any edit request
restarts approval. Never schedule unapproved content, and never "improve" copy
after approval without re-showing it.

## 1. Preflight

1. **Channels.** Run `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content channels`.
   This is also the connectivity check — it dies with guidance if Postiz is not
   connected. From the JSON, pick the target integrations and note for each:
   `id`, `name`, and `identifier`. The identifier is the settings `__type` and
   matters: Instagram may be `instagram` or `instagram-standalone` — always use
   the identifier the channel actually reports.
2. **Video file.** Verify it exists. Postiz accepts **`.mp4` only** (no
   mov/webm), max 1GB. Run
   `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,codec_name -of json <file>`:
   - not mp4/h264 → offer to transcode (`ffmpeg -i in -c:v libx264 -c:a aac out.mp4`);
   - landscape → warn: YouTube will NOT treat it as a Short (Shorts = vertical,
     ≤3 min; there is no API flag — YouTube infers from aspect + duration);
   - note the duration for the copy (e.g. don't promise "in 30 seconds" on a 90s video).
3. **Brand.** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show` — resolve
   which brand this belongs to (sets dashboard filtering and channel defaults).

If a platform's exact field list is ever in doubt, fetch the live schema:
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content platform-settings <integrationId>`
(returns `{output: {rules, maxLength, settings (JSON Schema), tools}}`). The
cheat-sheet below covers the normal path with zero extra API calls. Postiz
**silently discards** inapplicable settings rather than rejecting them — a
typo'd key will not error, so copy field names exactly.

## 2. Platform cheat-sheet

Baselines below are applied automatically by the scheduler
(`defaultSettingsFor`); your variant settings only need the fields you are
actually choosing. All settings objects must carry `__type` = the channel's
identifier.

**YouTube** (`__type: "youtube"`)
- `title` — REQUIRED, 2–100 chars. Searchable, front-loaded, ideally <70 so it
  doesn't truncate. This is the video's headline — spend effort here.
- `type` — `"public" | "unlisted" | "private"` (visibility; default public).
- `tags` — optional `[{value, label}]` (value = label), total length ≤500 chars.
- `selfDeclaredMadeForKids` — `"yes" | "no"` (default omit; use "no" normally).
- Caption/`content` = the **description**, ≤5000 chars: 1–2 sentence summary,
  link, hashtags at the end.
- Media: exactly ONE attachment and it must be the video.
- No altered-content/AI-disclosure API flag exists — if the video contains AI
  avatars or synthetic people, remind the user to set the disclosure manually
  in YouTube Studio after publish.

**TikTok** (`__type: "tiktok"`)
- Baseline already sends: `privacy_level: "PUBLIC_TO_EVERYONE"`, `duet: true`,
  `stitch: true`, `comment: true`, `autoAddMusic: "no"`,
  `brand_content_toggle: false`, `brand_organic_toggle: false`,
  `content_posting_method: "DIRECT_POST"`.
- `title` — optional, ≤90 chars, casual with hashtags inline.
- `video_made_with_ai: true` — SET THIS whenever the video contains AI
  avatars/synthetic people. It is TikTok's required disclosure.
- Keep `DIRECT_POST`: the `UPLOAD` method only drops the video into the TikTok
  app inbox (24h to finish by hand) while Postiz still reports success.
- Caption/`content` is the on-screen caption.

**Instagram Reels** (`__type: "instagram"` or `"instagram-standalone"` — match
the channel's identifier)
- `post_type: "post"` — there is NO `"reel"` value; a single video with
  post_type "post" becomes a Reel automatically. (`"story"` is the other option.)
- Caption/`content`: the hook must live in the **first 125 chars** (feed
  truncation point). 3–5 hashtags. Links are NOT clickable — never paste a URL
  as the CTA; say the domain or "link in bio".

## 3. Author the packagings

One shared video; a distinct, platform-native voice per channel:

- **YouTube**: search-led. Title answers "what will I get"; description opens
  with the payoff, then detail, link, tags.
- **Instagram**: hook-first caption (question or bold claim in the first line),
  short body, hashtags at the end.
- **TikTok**: casual, native, first-person; hashtags inline; shorter is better.

Pick ONE posting time (Postiz posts all channels of an item together). Use the
user's stated time; otherwise propose the next sensible slot and say why.

## 4. Present for approval

Show, verbatim and clearly separated per channel: account name, the full
caption/description, YouTube title + tags + visibility, TikTok settings summary
(privacy, AI flag), Instagram post_type — plus the shared time and the video
file. Then **stop and wait**. Iterate on any edits and re-show. Only explicit
approval ("go", "post it", "approved") unlocks step 5.

## 5. Submit

One `content add`, then one `content schedule`.

**Write the JSON payload to a temp file first** (with the Write tool), then
pass the file path to `content add`. Never pipe the JSON through `echo` — in
zsh (macOS default) the builtin echo interprets `\n` escapes inside your JSON
strings and corrupts the payload.

```json
{
  "title": "<the YouTube title — also the item's working title>",
  "body": "<fallback caption (used by any channel without a variant)>",
  "brandName": "<brand>",
  "channels": ["<ytId>", "<ttId>", "<igId>"],
  "media": ["/absolute/path/video.mp4"],
  "source": "crosspost",
  "status": "draft",
  "variants": {
    "<ytId>": {
      "content": "<YouTube description>",
      "settings": { "__type": "youtube", "title": "<title>", "type": "public",
                    "tags": [{"value": "tag1", "label": "tag1"}] }
    },
    "<ttId>": {
      "content": "<TikTok caption>",
      "settings": { "__type": "tiktok", "title": "<short title>", "video_made_with_ai": false }
    },
    "<igId>": {
      "content": "<Instagram caption>",
      "settings": { "__type": "instagram", "post_type": "post" }
    }
  }
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content add /path/to/item.json
```

Then (`<id>` is what `content add` printed; `<ISO>` carries the user's UTC
offset, e.g. `2026-08-23T16:15:00-05:00` — check `date +%z` rather than
assuming):

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content schedule <id> --type schedule --date <ISO>
```

Postiz publishes all channels of one item together. If the user wants
different platforms at different times, make one item per time slot (each with
its own channels/variants) and schedule each — this works fine.

After scheduling, verify with
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content posts` — every channel of the
item should show a `QUEUE` row at the right `publishDate` (times print in UTC).

`--type draft` creates a Postiz-side draft instead (validation dry-run);
`--type now` publishes immediately — only on explicit request. The video upload
happens inside `schedule` and can take a couple of minutes for a big file.
Report the printed Postiz post id; analytics/release URLs arrive later via
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content sync`.

Note: `content list --json` prints raw DB rows — `variants`/`settings` are JSON
strings there; parse before reasoning about them.

## 6. Fixing mistakes

Once sent, the local row is a **read-only mirror** (no reschedule/edit via the
public API). `content update` refuses; the path is
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content rm <id>` (this also deletes
the remote Postiz post) and recreate. If it already PUBLISHED to a platform,
deletion does not un-publish there — tell the user to remove it on-platform.

## 7. First TikTok publish on a new account

Known gotcha: **unaudited** TikTok API apps get privacy forced to `SELF_ONLY`
at publish time regardless of what was sent. Postiz **cloud** uses Postiz's own
audited TikTok app, so cloud users are normally fine; the real risk is
self-hosted Postiz with the user's own TikTok developer app.

There is no way to test this before a real publish: a Postiz `--type draft`
stays inside Postiz and **never appears in TikTok** (with `DIRECT_POST`
nothing reaches TikTok until publish; `UPLOAD` mode does hit the TikTok inbox
but silently discards privacy and every other setting, so it proves nothing).
Do not send the user hunting for a draft in TikTok Studio.

Instead, on the first-ever TikTok crosspost: schedule normally, tell the user
to open the posted video right after publish time and check its privacy. If it
shows "Only me", they flip it to public in the TikTok app (two taps) — and note
in future runs that this account's app is unaudited.
