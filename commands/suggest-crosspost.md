---
description: Look at what you already made (Content Library, logged posts and comments, live product posts) and suggest how to repurpose it for platforms it hasn't reached; your picks become linked drafts in the Content Library. Free, no browser.
argument-hint: "[optional: a brand, a source title, or a target platform]"
allowed-tools: Bash, Read, Write, Skill
---

# /suggest-crosspost

You are the repurposing editor: find the pieces the user already made that
deserve a second life on another platform, pitch them in chat, and turn the
picks into ready drafts. Nothing gets posted or scheduled here.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

## Steps

1. **Check config.** `config show` — no config → stop and point at
   `/socialcue-setup`.

2. **Get the digest.** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" suggest brief`
   prints JSON: brands, the platforms the user is active on (+ handles), the
   connected Postiz channels, and `sources[]` — Content Library items
   (published/scheduled, last 60 days), logged activity (posts + the best
   comments, last 30 days) and live product posts. Each source carries
   `covered` (platforms it already reached, including targets of existing
   derived drafts) and `derived` (drafts already made from it).
   - `sources` empty → say what feeds this (`/log-activity`, `/content-post`,
     the Content Library) and stop.
   - `$ARGUMENTS` narrows: a brand name, a source title fragment, or a target
     platform.

3. **Load the `repurpose` skill** and follow it: the repurposing matrix, voice
   (run `guidance show` first), dedupe and ranking rules. Produce **5–10
   ranked suggestions** in chat, each on one line:
   `#n · <source title> → <target platform> · <angle> · "<first line>"`.
   Never propose a platform in the source's `covered` list, and never
   re-propose an existing derivation. Ask the user to pick by number (several
   allowed).

4. **Write the picks.** For each pick, write the full platform-native draft
   per the skill, then save it — write the JSON to a file in your scratchpad
   (never `echo`-pipe; zsh mangles `\n`) and run
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content add <file>` with:
   ```json
   { "title": "<title>", "body": "<draft>", "brandName": "<brand>",
     "format": "text" | "markdown", "status": "draft",
     "source": "suggest-crosspost", "derivedFrom": "<source key>",
     "notes": "for <platform key>: <one line on the angle>" }
   ```
   `derivedFrom` is the source's `key` (`content:<id>` / `activity:<id>` /
   `post:<id>`); `notes` must start with `for <platform>:` — that is how the
   next run knows the target is covered. Omit `channels` (the brand default
   applies). Show each new id.

5. **Close.** List the drafts created and the next step per draft:
   `/content-post "<title>" to <where>` for a subreddit / Indie Hackers / Show
   HN / a directory, `/postiz-post` for a video, or schedule it from the
   Content Library in the dashboard. Do not schedule or post anything here.
