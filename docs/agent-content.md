# Submitting content to Social Cue (for producer agents)

> Background on Postiz itself (cloud vs self-hosted, API limits, platform
> gotchas): see `postiz-notes.md`.

Social Cue's **Content Strategy** queue holds original posts per brand. Producer
agents (demo-video agent, meme agent, blog-post agent, …) drop finished work in
here; the user reviews it in the dashboard and schedules it across channels
through their own Postiz account. Agents **create items — they never schedule or
publish**; acting stays with the user.

> The one sanctioned exception is the **crosspost flow**
> (`skills/crosspost/SKILL.md`): there the review happens in chat instead of
> the dashboard, and the orchestrating agent may run `content schedule` — but
> only after the user approved the exact copy, channels and time in chat.

## Preferred: the CLI

From the plugin directory (or via `${CLAUDE_PLUGIN_ROOT}` when installed):

```bash
echo '{
  "title": "How Acme cut CI time 3x",
  "body": "The post text — one body used for every channel it targets.",
  "brandName": "Acme",
  "source": "demo-video-agent",
  "media": ["/abs/path/to/demo.mp4"],
  "scheduledFor": "2026-08-10T15:00:00.000Z"
}' | node lib/cli.js content add -
```

Prints the new item id. Field notes:

- `brandName` (or `brandId`) — matched against the user's configured brands so
  dashboard filters work; an unknown name is kept as a display label.
- `source` — **your agent's name**. Shown as a badge in the dashboard so the
  user knows who made what. Defaults to `cli`.
- `media` — **absolute paths** to local files (images/video). They are
  **copied into the managed store** (`.socialdiscovery/media/<itemId>/`) at
  `content add` time, so once the id prints you may delete your originals /
  clean your scratch dir — the queue owns its copies from then on. Postiz
  upload happens later, when the user schedules. `content add` refuses missing
  or relative paths.
- `scheduledFor` — optional suggestion; the user can change it before sending.
- Omit `channels`/`settings` — when the brand resolves and the user has mapped
  Postiz accounts to brands (dashboard Settings → "Accounts → brands"), the
  brand's own accounts are filled in automatically. Only pass explicit
  integration ids (see `content channels`) when you need to override that.
- Optional `status`: `idea` (default) or `draft`. Use `idea` for pitches the
  user should triage, `draft` for finished, ready-to-schedule work.
- Optional `variants` — per-channel packaging for cross-posts, keyed by Postiz
  integration id: `{ "<integrationId>": { "content": "platform caption",
  "settings": { "__type": "youtube", "title": "...", ... } } }`. At schedule
  time each channel resolves `content` → `variants[id].content ?? body`, and
  settings merge platform defaults < `settings[id]` < `variants[id].settings`.
  The dashboard shows variants read-only and preserves them on save.

Other useful commands: `content list --json`, `content update <id> <json|->`,
`content rm <id>`, `content channels`. Full list in the `lib/cli.js` header.

## Alternative: the bridge HTTP API

When the bridge is running (`bridge status`), POST the same shape to
`http://127.0.0.1:8377/api/content` with the pairing token
(`node lib/cli.js bridge token`) as `Authorization: Bearer <token>`.
The CLI is preferred — it works even when the bridge is down and validates
media paths.

## What happens next

Items land in the dashboard's **Content Strategy** tab (badge counts
ideas/drafts). The user reviews, picks channels, and clicks Schedule — media
uploads to Postiz at that moment, and status/analytics sync back afterward.
Don't poll or retry: once `content add` prints an id, the hand-off is done.
