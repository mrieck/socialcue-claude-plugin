---
description: Post something somewhere (Pro) — get a brand, a Content Library article/video, or any project listed on a directory, launched on a launch site, or posted to a subreddit, Indie Hackers, Show HN or a forum. Agent-driven in your own browser, signing up as you where needed, finding the assets each form wants on the fly, and a hard stop for your review before anything is submitted.
argument-hint: "[what to post, in plain words] to [where — a site name, subreddit, or URL]"
allowed-tools: Bash, Read, Glob, Skill, mcp__plugin_socialcue_socialcue-browser__launch_browser, mcp__plugin_socialcue_socialcue-browser__navigate, mcp__plugin_socialcue_socialcue-browser__read_page, mcp__plugin_socialcue_socialcue-browser__screenshot, mcp__plugin_socialcue_socialcue-browser__click, mcp__plugin_socialcue_socialcue-browser__click_at, mcp__plugin_socialcue_socialcue-browser__type, mcp__plugin_socialcue_socialcue-browser__type_text, mcp__plugin_socialcue_socialcue-browser__act, mcp__plugin_socialcue_socialcue-browser__press_key, mcp__plugin_socialcue_socialcue-browser__scroll, mcp__plugin_socialcue_socialcue-browser__wait, mcp__plugin_socialcue_socialcue-browser__get_page_info, mcp__plugin_socialcue_socialcue-browser__upload, mcp__plugin_socialcue_socialcue-browser__list_tabs, mcp__plugin_socialcue_socialcue-browser__open_tab, mcp__plugin_socialcue_socialcue-browser__switch_tab, mcp__plugin_socialcue_socialcue-browser__close_tab
---

# /socialcue-post

You are driving a **product post**: getting a *subject* — one of the user's
brands, an article/video from their Content Library, or any ad-hoc project (a
single GitHub repo, a side tool) — onto a *destination*: a directory listing, a
launch site, a community post (subreddit, Indie Hackers, Show HN, Dev.to) or a
forum thread. The browser is the user's own dedicated Chrome profile. Nothing
is ever submitted without the user's explicit approval in this conversation.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

`$ARGUMENTS` is **plain English**, not a syntax — e.g. "the DemoDay video to
r/SideProject", "PlugMyPlugin on Product Hunt", "my claude-plugins repo to
Show HN", "that watermark article to Indie Hackers", or nothing at all. You
work out the subject and destination; the `--subject`/`--dest` flags below are
how *you* talk to the CLI, never something the user has to type.

## Steps

1. **Check config + Pro.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show` — no config → stop and
   point at `/socialcue-setup`. Then
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" license show` — if free tier, explain
   that Product Posts is a Pro feature ($19/mo, `/socialcue-setup` covers
   upgrading) and stop.
   Then `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" dest email` — if no signup email
   is set, ask which email they want new accounts on (it's the address they're
   signed into in the Social Cue Chrome; Google login is used where sites offer
   it), save it with `dest email <address>` (plus `--webmail <url>` when the
   provider isn't recognised, e.g. Google Workspace → https://mail.google.com),
   and remind them to have that inbox and their Google account signed in inside
   the Social Cue Chrome window.

2. **Work out the subject** from what the user said. Gather the candidates
   quietly first — `config show` (brands) and
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" content list --json` (Content
   Library titles, newest first) — then match:
   - Names or clearly means a brand → `--subject brand:<name>`.
   - Describes a piece of content ("the DemoDay video", "that watermark
     article", "my latest post") → pick the best-matching Content Library item
     and use `--subject content:<id>`. Prefer an item whose `notes` name the
     requested destination (a seoblog-written "for Indie Hackers" item when the
     user says Indie Hackers). If two match about equally, ask with
     their titles; never make the user find an id.
   - A repo, a URL, "my new tool", something not in either list → **ad-hoc**:
     `--subject adhoc --name "<name>" [--url <url>] [--path /abs] [--brand <ref>]`.
     Infer name/url from what they said (a GitHub URL gives both); ask for a
     local folder only if it isn't obvious (cwd often is it). `--brand` is
     just context/voice, e.g. one repo under an umbrella brand.
   - Nothing said and one active brand → use it; several → ask in one line.
   Confirm your reading in half a sentence as you go ("Posting the DemoDay
   video to r/SideProject — starting.") rather than asking a form's worth of
   questions.

3. **Work out the destination.** Load the venue playbook:
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" dest list` (Pro; it syncs the shared
   playbook from trysocialcue.com first — columns: id, kind, post types,
   signup, name, url). An empty list names the reason (no token, offline);
   `dest sync --force` retries. Match the user's words to a row
   ("Show HN" → `hackernews-show`, "r/SideProject" → `reddit-sideproject`,
   "Product Hunt" → `producthunt`); a URL is used as-is (any site with a
   submit/post form is attemptable — an unknown URL auto-registers). If they
   didn't say where, show a short grouped list with prior attempts from
   `post list --subject <key>` marked, and ask. Pass `--type` only when the
   destination supports several post types and the intent is clear (a Reddit
   text `thread` vs. a `link` post).

4. **Start the attempt.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" post start --subject '<spec>' [--name --url --path --brand] --dest '<slug|url>' [--type t]`
   and capture the JSON brief: `postId`, `postType`, `subject` (kind, key,
   name, url, path, brand fields, a content item's `body` + `media`), `brand`,
   `destination` (`kind`, `postTypes`, `signup`, `oauthProviders`, `category`,
   `fits`, `cost`, playbook `notes` — read them), `assets` (`dir`, what's `onFile`, and
   `searchHints` for where to scrounge more), `signupEmail` + `webmailUrl`, a
   generated `password` when an email signup may be needed (also stored — see
   `post creds`; `credentialsExisted` means an account was made on a previous
   run), and `dryRunPosts`.
   - "Already <status> for …" → tell the user, show `post list --subject`, and
     stop unless they pick a different destination.

5. **Launch the browser** with `launch_browser` (no-op if already up).

6. **Run the post.** Load the `product-posts` skill and follow it — it covers
   signup (OAuth first, else email + reading the verification mail from the
   user's webmail in a second tab), finding or producing assets on the fly,
   composing by post type (listing form, article, thread, link), form filling
   by refs, uploads, captchas, and the mandatory pre-submit review stop. Log
   every meaningful step via `post update <id> '{"appendLog": "..."}'`.

7. **Wrap up.** Show `post list --subject '<key>'`, remind the user the
   Product Posts tab in the dashboard (`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" bridge open`)
   tracks all of this, and — if the destination reviews before publishing —
   that the listing may take days to appear (they can paste the live URL into
   the dashboard later, or a future run can check).

## Notes
- One destination per invocation; each submit needs its own explicit approval.
- If the browser MCP tools are unavailable, the plugin install is broken — tell
  the user to reinstall/reload the plugin.
