# Postiz — field notes for the Content Strategy integration

What we know about Postiz (the scheduler behind the Content Strategy tab) from
research on 2026-08-06. For how to *submit* content, see `agent-content.md`;
for our client code, see `lib/postiz-client.js` and `lib/content-actions.js`.

## What it is

Open-source social scheduler (gitroomhq/postiz-app, ~25k stars) by Nevo David:
"a calendar with a queue behind it." Channels connect via OAuth; a Redis-backed
worker publishes on schedule; 30+ platforms. Cloud plans $29–$99/mo, or free
self-hosted (Docker). Their positioning pivoted to AI agents in 2026
("prompt Postiz from Claude/ChatGPT/OpenClaw") and revenue ~3x'd — the
agent-feeds-scheduler workflow we built is their fastest-growing use case.

## Cloud vs self-hosted — the practical difference

**Same product features, very different setup burden.**

- **Cloud**: Postiz's own platform-approved OAuth apps are pre-configured.
  Connecting an account is just "click, log in, approve." No developer-app
  paperwork. This is the low-friction path and the one to recommend to
  SocialCue users by default.
- **Self-hosted**: you must create **your own developer app on every platform**
  you post to (X developer account, Meta app + review for Instagram/Facebook,
  TikTok developer audit, Google Cloud OAuth app for YouTube, LinkedIn app,
  Reddit app…) and wire each key into Postiz env vars. The platform paperwork —
  not running the container — is the real cost. Notable traps:
  - **YouTube**: a Google OAuth app left "In testing" kills refresh tokens
    every 7 days → posts silently stop. Set the app to "In production."
  - **Meta/TikTok/LinkedIn**: app review processes take days–weeks.
  - **X**: API access has its own pricing/tier hoops on your own app.

- **Both** (cloud can't save you from these — they're platform account rules):
  - Instagram needs a business/creator account linked to a Facebook page;
    TikTok/LinkedIn/Facebook similarly want business-grade accounts.
  - Mastodon and Bluesky are friction-free by comparison.

## Public API limits that shaped our integration

- Post creation only — **cannot comment on other people's threads or reply to
  others' tweets**. (Replies stay SocialCue's assisted-browser flow.) The
  "comments" feature threads under *your own* post.
- **No reschedule via the public API** (that needs their internal session-JWT
  API, which we deliberately don't touch). Hence our rule: once an item is
  sent, the local row is a read-only mirror — delete + recreate to change it.
- ~90 requests/hour (100 cloud) on create; one create call carries all
  channels of a post, so we batch per item and cap analytics calls per sync.
- Auth is the raw API key in `Authorization` (no `Bearer` prefix).
- Endpoints we use: `GET /integrations`, `POST /posts`, `GET /posts`,
  `DELETE /posts/:id`, `GET /analytics/post/:id`, `POST /upload`.
  Also available when we want it: `GET /integration-settings/:id` (per-channel
  schema/limits — the right way to build real per-platform forms) and
  `POST /integration-trigger/:id` (dynamic data like Reddit flairs).

## Their agent tooling (context, not a dependency)

`gitroomhq/postiz-agent`: a CLI + Claude Code skill (`npx skills add
gitroomhq/postiz-agent`), OAuth device-flow login, JSON output everywhere.
Its recommended agent loop — discover integrations → read per-platform schema →
create → check analytics — is the pattern to copy if we deepen Phase B.
SocialCue agents should keep going through our own `content add` (see
`agent-content.md`) so the review queue stays in the loop; the Postiz skill
would bypass human review.

## Ecosystem / how people use it

Three tribes: self-hosters (Buffer refugees), n8n/Make automators (many
community templates: Airtable→25 channels, blog-RSS→LLM→posts, Drive-video
pipelines with manual approval), and agent users (the growth segment). The
winning shape everywhere is "content produced upstream → approval step →
Postiz publishes" — which is exactly the Content Strategy pipeline.

## Affiliate

Program runs on Tolt (postiz.tolt.io) / Dub Partners; terms visible after
registering. Once registered, set the real link in one place:
`POSTIZ_REFERRAL_URL` in `dashboard/src/components/ContentPanel.tsx`
(then `npm run dashboard:build`).
