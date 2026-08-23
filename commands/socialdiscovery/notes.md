---
description: Give feedback on Social Cue's drafted replies, rewrite the pending drafts to match your voice, or save a good rewrite as a golden example.
argument-hint: "[feedback like 'too salesy', or 'rewrite the drafts', or 'save #3 as an example']"
allowed-tools: Bash, Read, Edit, Skill
---

# /socialdiscovery:notes

Load the `review-notes` skill first — it defines the voice-guidance file format and
every workflow below. The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`.

Then act on `$ARGUMENTS`:

- **Feedback on the drafts** ("too salesy", "shorter", "stop opening with the
  product") → capture it as a Voice rule per the skill, and offer to rewrite the
  pending drafts against it.
- **A rewrite request** ("rewrite the drafts", "fix the queue") → run the skill's
  rewrite flow over the `new` queue and summarize what changed.
- **A confirmation** ("that one's good", "use my version as an example") → promote
  it with `guidance add-example` per the skill.
- **Empty** → show the current guidance (`guidance show`), the pending-draft count
  (`opp list --status new`), and any unswept notes (`opp notes`) worth distilling;
  ask what they'd like to do.
