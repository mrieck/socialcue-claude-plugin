---
description: Log what you posted from your phone — visits your own profile / replies pages on each logged-in platform, records every post and comment since the last run, files your original posts in the Content Library so /suggest-crosspost can repurpose them, and (Pro) checks how your posted replies and posts are doing for the Analytics tab. Logging is free.
argument-hint: "[optional: platform names, or 'since YYYY-MM-DD']"
allowed-tools: Bash, Read, mcp__plugin_socialcue_socialcue-browser__launch_browser, mcp__plugin_socialcue_socialcue-browser__get_logged_in_platforms, mcp__plugin_socialcue_socialcue-browser__navigate, mcp__plugin_socialcue_socialcue-browser__read_page, mcp__plugin_socialcue_socialcue-browser__scroll, mcp__plugin_socialcue_socialcue-browser__wait, mcp__plugin_socialcue_socialcue-browser__click, mcp__plugin_socialcue_socialcue-browser__get_page_info, mcp__plugin_socialcue_socialcue-browser__screenshot, mcp__plugin_socialcue_socialcue-browser__collect_activity, mcp__plugin_socialcue_socialcue-browser__record_performance, mcp__plugin_socialcue_socialcue-browser__handle_dialog, mcp__plugin_socialcue_socialcue-browser__list_tabs, mcp__plugin_socialcue_socialcue-browser__open_tab, mcp__plugin_socialcue_socialcue-browser__switch_tab, mcp__plugin_socialcue_socialcue-browser__close_tab
---

# /log-activity

You are collecting the user's **own** posts and comments — things they wrote
on their phone or by hand that Social Cue never saw — so nothing they made is
lost and the good ideas can be repurposed later. This is a read-only visit to
their own profile / replies pages in the dedicated Chrome. You never like,
reply, post or search.

The CLI lives at `${CLAUDE_PLUGIN_ROOT}/lib/cli.js`. Run it with `node`.

`$ARGUMENTS` may name platforms ("reddit x") or a start date ("since
2026-09-01"); otherwise every configured platform since the last run.

## Steps

1. **Check config.** `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" config show` —
   no config → stop and point at `/socialcue-setup`. No Pro gate: logging is
   free.

2. **Browser + logins.** Call `launch_browser` (no-op if up), then
   `get_logged_in_platforms`. Keep only platforms that are both configured and
   logged in. Nothing logged in → tell the user which window to sign into and
   stop.

3. **Handles.** Run `config handles seed` (fills blanks from brand social
   links; say nothing if it prints "Nothing to seed"), then
   `activity brief` (add `--platforms a,b` / `--since ISO` from
   `$ARGUMENTS`). For every platform under **Missing handles**: navigate to its
   home URL, `read_page` the header / account menu, find the username the page
   shows for the logged-in user, save it with
   `config handles set <platform> <handle>`, and re-run `activity brief`. If a
   handle can't be read, skip that platform and say so at the end.

4. **Open a run.** `run new --platforms <comma list>` → keep the run id.

5. **Collect, one platform at a time** in brief order. Every platform in the
   brief gets visited. The only budget is the brief's **turns per platform**
   (the Settings slider `maxTurnsPerPlatform`); there is no per-run item cap,
   no scroll cap, and one platform never uses up another's budget. Never invent
   a limit that the brief doesn't state:
   - `navigate` to each page in the brief → `read_page` with `compact: true`.
     If the page shows only "Loading…", `wait` 2s and read again.
   - Walk newest → oldest. For each item the user wrote, call
     `collect_activity` with the platform key, the **direct permalink**, the
     kind for that page (`post` on submissions/posts pages; `comment` for a
     comment on someone's thread; `reply` when the card says "Replying to";
     `repost` when it says reposted), the text verbatim, and — for
     comments/replies — `parentUrl` + `parentTitle` (the thread title or the
     parent author + first line) and `community` (r/sub, forum). Convert
     relative times ("3h ago") to ISO for `postedAt`; pass `score` /
     `replyCount` when shown; pass the run id; pass `brandId` only when the
     item is clearly about one of the user's brands.
   - Skip cards written by other people (a repost by someone else, a parent
     post shown for context).
   - Keep scrolling until an item is older than the brief's cutoff or the
     page ends. On platforms the brief marks "Stop on logged items", also stop
     after two consecutive `skipped: true` results; on "Keep going past logged
     items" platforms an earlier run stopped short, so scroll past them to the
     cutoff. Then move to the next page.
   - When every page of a platform reached its stop point, run
     `activity synced <platform key>`. If the turn budget ran out first, don't:
     the next run picks up from the same cutoff. Say which platforms ran out.
   - Pacing: `navigate` already pauses; never fire tools in bursts; one tab;
     `screenshot` only if a page refuses to read. If a platform's profile
     shows no activity list, report "could not read <platform> profile" and
     move on — don't improvise other URLs.
   - Notifications pages are **not** visited: the comments/replies pages
     already contain everything the user typed, including replies sent from a
     notification.

6. **Performance check-ins (Pro).** Run `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" perf due`.
   `pro_required` or `[]` → skip this step and say nothing. Otherwise it is a JSON list of
   things the user posted that are due a check (each with `id`, `kind`, `platform_url`):
   - `reply`: the user's reply in someone else's thread. `activity`: a comment the user
     chose to track. Look first at the comments page you just read in step 5: it usually
     shows each of the user's comments with its points and reply count, so record those
     without a visit. Otherwise `navigate` to the URL, `read_page`, find the user's own
     comment (author = the logged-in account) and read its score and direct replies.
   - `product_post`: the URL is the user's own post (a subreddit post, a listing, a Show
     HN). Read its score and comment count, and note whether it is still up, removed by
     mods, or flaired.
   Record each with `record_performance(oppId: <id>, upvotes, replyCount, note)`; omit
   numbers you can't see, and use `note: "removed"` when it's gone. Check every item in
   the list; there is no cap. Never vote, reply or otherwise touch the thread.

7. **Close the run.** `run finish <id> --summary "activity: N posts, M comments across <platforms>; K check-ins"`.

8. **Report.** A short table per platform: posts / comments / replies /
   reposts logged, how many were already known, whether the platform was read
   to its cutoff (synced) or ran out of turns, and which posts were filed in
   the Content Library (title + content item id from each `contentItemId`).
   Then the check-ins: how many were recorded, and the two or three that moved most
   (upvotes or replies since the last check), plus any that were removed.
   Then the two follow-ups, one line each: `node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" activity track <id>`
   adds a comment to these check-ins (Pro), and `/suggest-crosspost` turns
   what you logged into posts for other platforms. Mention the Analytics tab
   shows the log and the check-ins (`bridge open`).

## Notes
- If the browser MCP tools are unavailable, the plugin install is broken —
  tell the user to reinstall/reload the plugin.
- This command changes nothing on any platform. It only reads and records.
- Open human pages one at a time. Never script requests or open a site's JSON/API
  endpoints in the user's Chrome.
