---
description: Cross-post one video to YouTube Shorts, TikTok and Instagram Reels — drafts per-platform captions and settings for your approval in chat, then schedules through Postiz. No web UI.
argument-hint: "<video path> [topic / context / preferred time]"
allowed-tools: Bash, Read, Skill
---

# /crosspost

Load the `crosspost` skill and follow it exactly.

From `$ARGUMENTS`, identify:
- the **video file path** (ask if missing — never guess),
- any **context** about the video (what it shows, the product, the CTA),
- an optional **preferred posting time**.

The skill drives the whole flow: preflight the Postiz channels and the video
file, author platform-native packaging for each channel, present everything in
chat for approval, and only after explicit approval hand it to Postiz via the
CLI. Never schedule anything the user has not approved verbatim.
