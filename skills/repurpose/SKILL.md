---
name: repurpose
description: The repurposing playbook behind /suggest-crosspost — which of the user's existing pieces (videos, articles, posts, good comments, live product posts) become what on which other platform, how to rank the ideas, and how to write each derived draft so it reads native. Load when suggesting or writing cross-platform repurposings.
user-invocable: false
---

# Repurposing playbook

One good piece should show up in several places, each time in that place's
own shape. You work from the `suggest brief` digest: every `source` has a
`covered` list (where it already went) and `derived` (drafts already made from
it). Your job is the gap between what exists and where it could still land.

## 1. The matrix — what becomes what

| Source | Good targets |
|---|---|
| **Video** (Content Library item with `hasVideo`, or a TikTok/Shorts/Reel) | X or Threads **thread** (hook + 4–6 beats + link in the last post); **Reddit text post** to a fitting sub (story first, no link in the body); **LinkedIn post** (no links in body, link in first comment); **Indie Hackers / blog article** outline |
| **Article** (`format: markdown`, dev.to / IH / blog) | **Shorts / TikTok script** (≤60s, spoken, one idea); **X thread**; **Reddit post** (the one useful takeaway, expanded); **Indie Hackers** version with the founder angle |
| **Comment that got traction** (activity `comment`/`reply`, score ≥ 3 or replies) | **Standalone post** on X / Threads / Bluesky (the point, without the thread context); **Reddit post** that expands it into a how-to; **LinkedIn** if it's a lesson |
| **Reddit post that did well** | X / Threads thread; Indie Hackers post; Show HN only if the post *is* the product |
| **Product post gone live** (a listing, Show HN, launch) | Announcement thread on X / Threads; Indie Hackers milestone; a Reddit "I built…" post in a sub that allows it |
| **Original post logged from the phone** (activity `post`) | Whichever of the above fits its shape — a quick take becomes a thread; a longer post becomes an article outline |

Never propose: a target already in `covered`; a target that duplicates an
entry in `derived`; YouTube/TikTok/Instagram as a target for text (those want
video — suggest a *script* instead, saved as a draft for the video agents).

## 2. Ranking

Score each candidate on, in this order:
1. **Recency** — sources from the last 14 days first; older ones only if they
   are evergreen (how-to, lesson, comparison) rather than news.
2. **Performance** — `metrics`, `perf` (latest check-in), `score` /
   `replyCount`: what already landed once will land again.
3. **Evergreen-ness** — a durable point beats a reaction to a moment.
4. **Balance** — rotate across the user's brands and across target platforms;
   don't give five X threads for one brand.

Aim for 5–10 suggestions, best first. Quality over count: skip a source
rather than force a weak angle.

## 3. Voice and platform shape

Run `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" guidance show` before writing and
follow the user's voice rules and examples. Then shape for the target:

- **X / Threads / Bluesky**: first line is the whole hook; short lines; no
  hashtags walls; Threads and Bluesky are casual and link-averse — put a
  product name in plain text only where it belongs. A thread is 4–8 posts, each
  standing alone.
- **Reddit**: read the sub's self-promo policy from the venue playbook if it
  is a community the user posts to; lead with the experience, not the product;
  no link in the body unless the sub allows it; a title that states the
  specific takeaway.
- **LinkedIn**: a lesson with a personal frame; short paragraphs; no external
  links in the body.
- **Indie Hackers**: founder-to-founder, numbers where honest, the product
  named where it is genuinely the subject.
- **Hacker News** (Show HN only): plain, technical, no marketing adjectives.
- **Shorts / TikTok script**: spoken words only, one idea, a first-3-seconds
  hook, ≤150 words; note on-screen text in brackets.
- **Article outline**: H2 list with one line each, plus the intro paragraph.

Keep the user's actual claims: never invent metrics, quotes or outcomes that
are not in the source.

## 4. Saving a draft

Each pick becomes one Content Library item via `content add` with
`source: "suggest-crosspost"`, `status: "draft"`, `derivedFrom: "<source
key>"` and `notes` starting `for <platform key>: …` (the platform key as the
user's config uses it: `x`, `threads`, `reddit`, `linkedin`, `indiehackers`,
`hackernews`, `bluesky`, `youtube`, `tiktok`). Format is `markdown` for
articles/outlines, `text` for everything else. The title is what the user
will recognise in the dashboard ("X thread: <topic>", "Reddit post:
<topic>", "Shorts script: <topic>").
