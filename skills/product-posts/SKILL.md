---
name: product-posts
description: Playbook for posting something — a brand, a Content Library article/video, or an ad-hoc project — to a directory, launch site, community (subreddit, Indie Hackers, Show HN, Dev.to) or forum with the Social Cue browser tools. Signing up as the user (OAuth first, else email + a verification code read from their own webmail in a second tab), finding or producing the assets each form needs on the fly, accessibility-ref form filling, uploads, and recording the outcome. Load when running a product post.
user-invocable: false
---

# Product Posts Playbook

You have a post brief (from `post start`): `postId`, `postType`
(`listing` | `article` | `thread` | `link`), the **subject** (what you're
posting — `kind` brand | content | adhoc, plus name/url/path, the brand's
tagline/description/about/tags when there is one, and for a content item its
`body` and attached `media`), the owning `brand` (or null), the **destination**
(`kind`, `postTypes`, `signup`, `oauthProviders`, `category`, `fits`, `cost`,
playbook `notes` + your `localNotes`), the **assets** block (`dir`, `onFile`, `searchHints`), the user's
`signupEmail` + `webmailUrl`, optionally a generated `password`
(+ `credentialsExisted`), and the `dryRunPosts` flag. The browser tools are the
`mcp__plugin_socialcue_socialcue-browser__*` set; the CLI is
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js"`.

The browser is the user's own dedicated Chrome, signed into their platforms,
their Google account and their email. You act **as them**: accounts get created
on `signupEmail`, verification mail is read from their webmail in a second tab,
community posts go out under their existing Reddit/IH/HN account. You never
learn or type their email/Google password.

**Prime rules — never break these:**
0. **On directory and launch sites: decide, don't ask.** These runs go
   overnight with nobody watching, so a question is a dead run. Every
   judgement call is yours — category, tags, which competitors or
   alternatives to list, launch date, pricing model, a required field the
   brief doesn't cover. Work it out from the brief, the product's site and
   repo, make the most defensible pick, and log it
   (`appendLog: "decided: <field> = <value> (<why>)"`) so the user can read
   your choices in the morning. When something truly can't be done without
   them (a login only they can do, a challenge that won't pass), don't wait:
   record what's needed in the log, set the honest status, and go on to the
   next destination. Two limits stay: **never pay** (take the free tier,
   decline upsells and paid queue-skips) and **never lie about the product**
   (see "Never invent" below). Community and forum destinations are the
   exception to all of this — they post under the user's real accounts, so
   there you still ask.
1. **Human-verification widgets on directory and launch sites are yours to
   click.** A "confirm you are human" checkbox (Turnstile, hCaptcha's
   checkbox) passes on the browser's own reputation, and this is the user's
   real, warm Chrome profile — click it and carry on. If it escalates to an
   image or puzzle challenge, don't grind it: `screenshot`, log it, mark the
   post `failed` and move on to the next destination rather than stalling
   the run. **Don't do
   this on a community or forum destination** (Reddit, HN, Indie Hackers,
   DEV) — those post under the user's real accounts, where a ban costs more
   than any listing is worth.
   Likewise **native dialogs are never auto-answered**: a result carrying
   `dialogOpen` means an alert/confirm/prompt is up — read its message, then
   `handle_dialog` accept/dismiss. Pick whichever keeps the submission moving
   and loses nothing (dismiss a "leave page with unsaved changes" prompt while
   a form is half filled); never accept one that deletes an account or listing.
2. `read_page` after every navigation, tab switch, or action that changes the
   page — refs (`e1`, `e2`…) are invalidated by all of them.
3. Never type a password into a Google/GitHub/Microsoft login form. If one
   appears, only the user can sign in: try the site's email signup instead,
   and if there is none, log "needs <provider> sign-in", mark it `failed` and
   move on.
4. **Communities and forums have rules.** Before composing a `thread`/`link`/
   `article`, open the sub's or forum's rules/self-promo policy and read it. If
   the rules forbid what you're about to post (no self-promo, no launches,
   karma minimums you don't meet), stop, tell the user, and mark it `skipped`
   — a removed post costs more than a skipped one.

## 1. Reach the target

Navigate to the brief's `submitUrl`, or the site's homepage and find
"Submit" / "Add product" / "List your startup" / "New post" / "Create post" /
"New thread". If you had to discover the URL, save it for next time:
`dest update <destinationId> '{"submitUrl": "<url>"}'`.

Read the destination's `notes` from the brief first — the shared Pro venue
playbook (signup path, form quirks, image limits, review delays, flair and
self-promo rules) followed, when present, by a "Your own learnings" section
from this machine's earlier runs. When you learn a new quirk this run, record
it: `dest update <destinationId> '{"notes": "<what you learned>"}'` — on a
normal install that lands in your local learnings (never uploaded); on the
maintainer's machine (admin key set) it is pushed to the shared playbook, so
write it as a durable, site-level fact, not a diary entry.

## 2. Signup / login, if there's a wall

No `signupEmail` in the brief (`signupNote` set): OAuth-only sites still work;
for the rest, ask the user which email they want their accounts on if they're
there to answer (save it with `dest email <address>`, `--webmail <url>` for a
custom domain) — otherwise log it, mark the post `failed` and move on.

Communities/forums (`destination.kind` community | forum) normally use the
account the user is **already logged into** in this Chrome — check
`get_logged_in_platforms`-style cues on the page first (username in the header).
If they're logged in, there's nothing to sign up for; skip to §3.

A login/register wall before the form — in order of preference:

1. **An account already exists** (`credentialsExisted` true): log in with the
   stored credentials — `post creds <id>` prints email + password. Then
   `post update <id> '{"status": "account_created", "appendLog": "logged in (existing account)"}'`.

2. **OAuth button available** (Continue with Google / GitHub / Microsoft /
   Discord …): use it — it's one click for an account the user is already
   signed into. Click the button; if a popup opens, `list_tabs` shows it as a
   new tab — `switch_tab` to it, pick the `signupEmail` account in the account
   chooser, approve, and it usually closes itself (`list_tabs` again, switch
   back). If a Google/GitHub **login form** appears instead of an account
   chooser, the user isn't signed into that provider in this profile: tell them
   to sign in in the Chrome window and say "done" — never type their password.
   Then `post update <id> '{"status": "account_created", "emailUsed": "<signupEmail>", "appendLog": "signed up via <provider> OAuth"}'`.

3. **Email/password signup**: fill the form via refs with `signupEmail` and the
   brief's `password` (subject or brand name where a name is asked), submit, then:
   1. `post update <id> '{"status": "awaiting_verification", "emailUsed": "<signupEmail>", "appendLog": "signup submitted"}'`
   2. **Read the verification mail yourself:** `open_tab <webmailUrl>` (no
      `webmailUrl` in the brief → try the provider's usual webmail for that
      address; a custom domain you can't resolve → log it and leave the post
      at `awaiting_verification`). `read_page`. If the webmail shows a login
      form, that's the user's to do: log "webmail signed out", leave the post
      at `awaiting_verification` and move on. Find the newest message from the site. **Gmail:** don't hunt
      through Primary/Promotions/Updates tabs — navigate straight to a
      search URL, which covers every tab and spam:
      `https://mail.google.com/mail/u/0/#search/from%3A<site-domain>+newer_than%3A1h`
      (or `in%3Aanywhere+<site name>+verify`). Other webmail: use its search
      box with the sender domain or site name, and check spam. Open the
      message via refs (`read_page` — the list rows are links).
   3. A **magic link** → click it. It may load in this tab or open a new one
      (`list_tabs`); continue wherever it lands and `close_tab` the stale one.
      An **OTP code** → read it, `switch_tab` back to the signup tab,
      `read_page`, `act` fill it, submit.
   4. Nothing after two refreshes ~1 min apart → check spam once more, use the
      site's "resend" if it has one, give it one more minute. Still nothing →
      log the address used and what to look for, leave the post at
      `awaiting_verification` (a later run picks it up) and move on.
   5. Confirm you're logged in (`read_page`), `close_tab` the webmail tab, then
      `post update <id> '{"status": "account_created", "appendLog": "verified + logged in"}'`.

4. **Neither works** (phone verification, an invite-only site, a challenge
   that escalates past a checkbox): explain and let the user choose to do the
   step themselves or skip
   (`post update <id> '{"status": "skipped"}'`).

## 3. Assets — find or make what the form needs, on the fly

This is guidance, not a checklist. Every destination wants something
different (a 240px square logo, a 1270×760 screenshot, a 1200×630 OG image, a
cover image, nothing at all), so **look at the form first** and only source
what it actually asks for, in the sizes it states.

- Check `assets.onFile` first — a cached role that fits (or is bigger and the
  right shape) is the answer; resize a copy if needed.
- Otherwise scrounge, cheapest first, using `assets.searchHints`: the
  subject's local folder (`path` — Glob for logos, icons, screenshots, README
  images), attached content `media`, the subject's website (favicon /
  apple-touch-icon, `og:image`, hero — `navigate` + `get_page_info`, or read
  the HTML), a GitHub repo's social preview / README images / owner avatar, or
  just `screenshot` the live site or app.
- Resize / convert locally: `sips -z <h> <w> in.png --out out.png`,
  `sips -s format png in.jpg --out out.png`, `sips -c <h> <w>` to crop;
  `ffmpeg -i demo.mp4 -ss 3 -frames:v 1 frame.png` for a frame from a video,
  `ffmpeg -i in.png -vf "scale=1270:760:force_original_aspect_ratio=decrease,pad=1270:760:(ow-iw)/2:(oh-ih)/2" out.png`
  to fit-and-pad. **Pad logos to square, never stretch them.** Work in a temp
  folder; give files descriptive names.
- Anything worth reusing → `post asset add "<subject.key>" <role> </abs/file>`
  with a descriptive role (`logo-square-400`, `screenshot-1270x760`,
  `og-1200x630`, or your own `<what>-<WxH>`). Next time it shows up in
  `onFile` and you skip all of this.
- Nothing usable and the form demands something you can't produce (a video,
  a real team photo): leave it out if optional; if required, log it, mark
  the post `failed` and move on. **Never fabricate images of
  things that don't exist** — no invented screenshots, no AI-generated
  "product" shots.
- Upload with `upload` and absolute paths. Prefer a ref; if the file input has
  no accessible node (hidden `<input type=file>` behind a styled button), pass
  a CSS selector — and make it specific (`input[name=screenshot]`), since a
  page often has separate icon and screenshot inputs. **One upload path per
  asset**: if the form also offers "upload by URL", use either the URL or the
  file, never both (that duplicates the image). Verify the preview appears.

## 4. Compose and fill, by post type

Shared technique:
- `read_page {interactive: true}` → identify fields → `act(ref, 'fill'|'select'|'check', value)`
  one at a time → re-read → verify the value stuck before moving on. Long
  bodies: a plain `<textarea>` takes `type_text`/`set_value` (markdown
  textareas take markdown as-is). A **rich editor** (contenteditable —
  Indie Hackers, Medium-style, Lexical, ProseMirror) gets `insert_html`:
  click the editor, then `insert_html {markdown}` (or `{html}`) — it lands
  real paragraphs/headings/bold/links/lists in one shot and returns counts to
  verify. Pasting markdown into a rich editor leaves `##` literal and doubles
  blank lines; typing it line by line is slow and fragile. If the editor's
  toolbar has no heading style, pass `headings: "bold"`. Then `read_page`
  and a screenshot to confirm.
- **Caret keys on Mac:** Home/End scroll the page instead of moving the
  caret; `press_key` remaps them inside an editable field, but prefer
  `ArrowRight` to collapse a selection and avoid keyboard-selection
  gymnastics altogether — `insert_html` replaces the whole body.
- **Trust the accessible name over the placeholder** when they disagree
  (`textbox "Email"` is the truth). Screenshot before submitting anything
  you filled by placeholder.
- **Never touch the page's own search box.** `read_page` tags the site's
  global search `[site-search]`; clicking its submit button navigates away
  and drops the whole form. A form's own typeahead is not tagged — if one
  ever is, it's a false positive (check the surrounding form) — but treat a
  tagged field as off-limits until you've confirmed that.
- Refs are bound to the element, so they survive re-renders; a ref that
  says "no longer on the page" means the element was replaced — `read_page`
  again. `act`/`type`/`click` also accept a **CSS selector**
  (`#react-select-tags-input`, `[name=websiteUrl]`, `input[name=screenshot]`)
  and a label; use one when the accessible name is awkward.
- A field the framework ignores (typed text vanishes, React form doesn't
  validate) → `set_value` (native setter + input/change). Works for
  `<select>` by option text too.
- Typeaheads / tag pickers (react-select, MUI): `select_option {target,
  query}` — it types, waits, and clicks the suggestion whose text matches
  **exactly**, never by position ("Windows" can't become "Windows Phone").
  Pass `option: ""` first to just see the suggestions, then pick; check the
  `selected` chips it returns. **One typeahead call at a time** — an open
  suggestion list covers the next field and the click times out ("subtree
  intercepts pointer events"); `press_key Escape` closes a stray list.
- Native `<select>`: `act select` by option text or value.
- Native date inputs appear as one `textbox "…" [type=date, fill "YYYY-MM-DD"]`
  — `act fill` it with that format (never the Month/Day/Year parts).
- **Never invent** metrics, user counts, revenue, testimonials, awards or
  press — nothing that makes the product look like more than it is. Everything
  else you answer as well as you can: unknown optional fields stay empty;
  required ones get your best real answer, worked out from the brief, the
  site and the repo (founding date → first commit or launch post; team size →
  a solo founder is 1; pricing model → read the pricing page) and logged as a
  decision.
- Human-verification checkbox at any point: click it, `read_page`, continue.
  A challenge that won't pass on a click: `screenshot`, log it, mark the post
  `failed`, move on.

**listing** (directories, launch sites) — map the subject onto the form by
meaning, not by field name:
- name → product/startup/tool name · url → website/link
- tagline → tagline/one-liner/short pitch (mind the character limit shown)
- shortDescription → short description/summary
- aboutBrand + shortDescription (+ a content item's `body`, + README copy from
  `path`) → long description: write fresh prose, don't paste fragments
- tags → tags/categories/topics (pick the site's closest existing ones)
- contact email → `signupEmail`
- `pricingUrl` / `pricingSummary` / `repoUrl` / `launchedOn` / `founders` /
  `socialLinks` (brand "listing facts") → pricing page, price tiers, GitHub /
  open-source URL, release date, founders, LinkedIn/X links. **Blank means
  unknown — leave the form field empty and flag it**, never guess. When the
  user gives you one of these during a run, save it for next time:
  `brand update <name> --pricing-url … --launched YYYY-MM-DD --founders "…" --link linkedin=…`.
  For an ad-hoc subject with no brand fields, work from its README/site and
  say so in the review.
- **The listing usually continues after "Submit".** Many directories
  (SaaSHub, AlternativeTo, …) drop you on a manage/profile page with separate
  sections — logo, screenshots (each needs a title), pricing, description,
  features, platforms — and **each section has its own Save/Update button**.
  Fill them all; after each save, re-read the overview page and confirm the
  value persisted (a section you filled but never saved shows as "Missing").
  Verification badges that require an email on the product's own domain are
  the user's call — ask, don't skip silently.

**article** (Indie Hackers post, Dev.to, Hashnode, a blog-style form) —
- Title + body. If the subject is a content item, its `body` is the draft:
  keep the voice, adapt length/format to the site. Otherwise write a
  first-person piece from the subject + brand fields: why it exists, what it
  does, what you learned — not a product page. The link goes near the end,
  once, in context.
- **`format: markdown` items** (written by an article producer such as
  seoblog's `/seoblog:socialcue`) are paste-ready: the body is finished
  markdown for this kind of site and its `![alt](https://…)` images are
  **already hosted** — paste the body as-is into a markdown editor and do
  not re-upload those images inline. In a rich editor, `insert_html
  {markdown}` converts it (images stay as their hosted URLs). `media[0]` is the
  cover/hero file for a cover slot (dev.to, Hashnode); Indie Hackers has none.
  Read the item's `notes` first — it names the venue it was written for and
  where the images live. Only lightly adapt (title idiom, tag list); the
  user already reviewed the body.
- Respect the editor: markdown textarea → paste markdown; rich editor →
  `insert_html` and check headings/links rendered (no heading style in the
  toolbar → `headings: "bold"`). Cover image slot → §3.
- Tags/topics from the site's own list; canonical URL field → the original
  post's URL if this is a repost.

**thread** (Reddit text post, forum thread) —
- Read the sub/forum rules and flair list (rule 6). Pick the flair the rules
  ask for via the dropdown.
- Title: plain, specific, no clickbait, no "Introducing". Body: conversational,
  disclose that you built it, share the story or the ask, link inside the body
  only where the rules allow. For a content item, condense its `body` to the
  sub's norms rather than pasting it whole.
- Attach media only where the form allows it and the rules don't punish it.

**link** (Show HN, Reddit link post, Lobsters) —
- Title follows the site's format: Show HN → `Show HN: <Name> – <what it does>`;
  Reddit/Lobsters → descriptive, no marketing tone. URL = the subject's `url`
  (a content item → its `releaseUrl`, else the brand site). Tags where offered.
- **Show HN gets auto-killed for promo signals** (it happened twice from an
  aged, high-karma account). Before submitting, check the title against
  this list and rewrite if any hit: "(free)"/"free", "open source" as a hook,
  "launch", "introducing", "new", "best", "AI-powered", emoji, "!", ALL CAPS,
  version numbers, questions, superlatives. Describe, don't sell. **Leave the
  text box empty when a URL is given** — the maker note goes in as the first
  comment after submit (why you built it, what's different, limitations,
  feedback wanted). HN wants the user to click submit themselves. Right after
  submit, GET `https://hacker-news.firebaseio.com/v0/item/<id>.json`; if
  `dead: true`, report it — never resubmit, email hn@ycombinator.com. The
  venue's playbook `notes` carry the full rule set; read them.

**After the main form** some sites continue: AlternativeTo asks which
existing apps yours is an alternative to (required), others ask for a
launch date, a category vote, or offer paid priority review. Treat these as
part of the same submission and finish them yourself. Competitors or
"alternative to": pick the 3-5 best-known products a buyer would actually
compare this one with — from the brand profile if it names any, else from
the product's own site and a quick search of the directory — and log the
list. Launch date: the earliest slot offered. Anything with a price (pay $5
to skip a months-long queue, featured placement): decline and take the free
path; if there is no free path, mark it `skipped` with the price in the log.

## 5. Check the form, then submit

When the form is complete:
1. `screenshot` it and re-read it. Wrong field mappings and silently truncated
   text are the common failure here, and a bad listing is hard to undo.
2. Submit, then log exactly what went out: every field, the full title + body
   text for articles/threads, and which files were attached.
   - `dryRunPosts` true: the user has asked to click submit themselves — leave
     the form filled, tell them it's waiting, and stop there.
   - Hacker News and any site whose `notes` say the user must click: hand the
     click over.

## 6. Record the outcome

- Success page / confirmation / the live post: capture its URL
  (`get_page_info`), then
  `post update <id> '{"status": "submitted", "listingUrl": "<url if any>", "appendLog": "submitted; <confirmation detail>"}'`
  A community post that's visible immediately can go straight to
  `"status": "live"`.
- **Record the queue — this builds the playbook.** Every attempt teaches the
  venue playbook what to expect (`Expect: … Seen: …` at the top of a venue's
  `notes` in future briefs, for every Pro user), so every `submitted` listing
  carries what the site said about its review — the confirmation page, the
  confirmation email, the site's FAQ or pricing page if the page itself is
  silent (one look, not a hunt):
  `post update <id> '{"reviewEta": "<verbatim, e.g. \"reviewed within 2-4 weeks\" | \"instant\" | \"not stated\">", "expectedLiveAt": "<ISO date = today + the upper bound, omit if not stated>"}'`
  Paid fast-tracks go in the same string ("free: ~30 days; $49 for 24h") —
  you still take the free path. That's all you record by hand: `post update`
  feeds the venue automatically — the review time at submit, and when a post
  is later marked `live` or `failed`, an outcome (submit→live days, or the
  `appendLog` text as the reason — so make a rejection's log say why). Put
  anything qualitative about the venue (was the listing worth it, what the
  site did with it) in `notes` via `dest update` as before.
- Content Library subject (`content:<id>`) that is now visibly live: also run
  `content publish <id> <live url>` so the item leaves the drafts queue with
  its link (the non-Postiz path; refused for items Postiz owns).
- Failure (form rejected, post removed on the spot, account blocked, dead
  site): `post update <id> '{"status": "failed", "appendLog": "<what happened>"}'`
- Learned anything durable about this destination? `dest update` it — that's
  what makes the next run better (local learnings, or the shared playbook
  when this machine holds the admin key):
  - how signup works: `{"signup": "none"|"email"|"oauth"|"mixed", "oauthProviders": ["google", …]}`
  - wrong `category`, product fit or pricing: `{"category": "ai-tools", "fits": ["ai","mcp"], "cost": "freemium"}`
  - wrong `kind` or extra `postTypes` you discovered: `{"kind": "community", "postTypes": ["thread","link"]}`
  - submit URL, image size limits, custom widgets, flair names, review delays → `notes`.

## Pacing

Between form actions, small natural pauses happen via the browser layer — don't
add bulk waits. But never chain a second destination into the same run without
the user asking, and never parallelize posts.
