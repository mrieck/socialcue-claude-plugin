---
name: review-notes
description: Social Cue's draft-feedback loop — capture the user's notes on drafted replies ("too salesy", "shorter", "not my voice"), distill them into voice-guidance rules, rewrite queued drafts against that guidance, and promote user-confirmed rewrites into golden before→after examples. Load this whenever the user gives feedback on Social Cue draft replies, asks to rewrite pending drafts, or wants a rewrite saved as an example of their voice.
---

# Social Cue — Review Notes

You maintain the user's **voice guidance** — the file that teaches future discovery
runs to draft replies that sound like the user — and you rewrite queued drafts
against it on request.

The CLI is at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js` (run with `node`).

## Where things live

- **`voice-guidance.md`** — find it with `guidance path`; create it with
  `guidance init`. It is user-editable config (edit the file directly with
  Read/Edit); the whole file is injected into every discovery brief as the
  **USER VOICE GUIDANCE** section, which outranks the generic draft rules.
- Format:
  - `## Voice rules` — short imperative rules, one bullet each.
  - `## Brand: <name>` — optional per-brand rule sections (only for feedback that
    truly applies to one brand).
  - `## Golden examples` — dated `### <date — platform — brand>` blocks with
    `**Before:**` (the generated draft), `**After:**` (the user's rewrite),
    optional `**Why:**`. Newest first. Managed via `guidance add-example`, not
    hand-splicing.
- Queued drafts live in SQLite: `opp list --status new --json` (fields:
  `suggested_reply` = generated draft, `user_reply` = the user's/your rewrite,
  `reply_note` = per-draft feedback, `example_saved_at` = promoted to example,
  `note_swept_at` = note distilled into guidance; editing a note clears it).

## Capturing feedback (a note like "too salesy" or "shorter")

1. Distill it into ONE short imperative rule (e.g. "Never open with the product
   name — lead with the thread's problem", "1–2 lines unless the thread is
   technical").
2. Read the existing `## Voice rules` first: **merge or sharpen an existing rule
   rather than adding a near-duplicate.** A tight list of 5–15 rules beats a long
   contradictory one.
3. Brand-specific feedback goes under that brand's `## Brand: <name>` section
   (create it if needed); everything else is global.
4. Confirm back to the user what rule you wrote.

## Rewriting queued drafts ("rewrite the pending drafts per my notes")

1. `opp list --status new --json` for the queue; read the guidance file
   (`guidance show`) and load the `scoring-brain` skill if not already loaded
   (platform norms still apply).
2. For each draft (skip `kind: "recommendation"` rows — those are posting nudges,
   not replies): rewrite `suggested_reply` following Voice rules + golden
   examples + any `reply_note` on that row. Match the register of the examples'
   "After" texts — they are the user's own writing.
3. Write each rewrite back:
   `opp update <id> '{"userReply": "<rewritten text>"}'`
   (never overwrite `suggested_reply`; `userReply` is the working copy and the
   dashboard shows it as the draft).
4. Only touch `new` (or explicitly requested) rows — never `posted`/`skipped`.
   **This skill only edits drafts — posting happens from the dashboard after the
   user approves.**
5. Summarize what changed and why in a few lines.

## Promoting a confirmed rewrite ("this one's good — use it as an example")

When the user confirms a rewrite is good (theirs or one of yours they edited/blessed):

```
node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" guidance add-example '{"oppId": "<id>", "why": "<what makes it right, if the user said>"}'
```

`oppId` pulls Before (`suggested_reply`), After (`user_reply`), brand and platform
from the row and stamps `example_saved_at`. For a rewrite that never lived in the
queue, pass `{"before": "...", "after": "...", "platform": "...", "why": "..."}`.

**Cap: ~10 examples.** When over, curate: drop the oldest/least-distinct blocks and
fold their lesson into a Voice rule (that's the compression step — examples earn
their prompt tokens by being distinct). Tell the user what you folded.

## Sweeping dashboard notes

`reply_note` values (set from the dashboard Notes box) are raw feedback that hasn't
reached the guidance file yet. `opp notes` lists exactly the unswept ones (notes
with no `note_swept_at`; editing a note in the dashboard clears the stamp, so it
comes back). `/socialdiscovery` runs this sweep automatically at the start of every
run, before assembling the brief; do it here too when asked to review notes or
after a rewrite pass:

1. `opp notes` — empty means nothing to do.
2. Distill recurring themes into Voice rules (dedupe as above).
3. Stamp each note you distilled: `opp update <id> '{"noteSwept": true}'`.
4. Mention which notes you swept.
