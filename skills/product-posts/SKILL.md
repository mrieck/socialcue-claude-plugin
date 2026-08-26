---
name: product-posts
description: Playbook for posting something — a brand, a Content Library article/video, or an ad-hoc project — to a directory, launch site, community (subreddit, Indie Hackers, Show HN, Dev.to) or forum with the Social Cue browser tools. Signing up as the user (OAuth first, else email + a verification code read from their own webmail in a second tab), finding or producing the assets each form needs on the fly, accessibility-ref form filling, uploads, captcha handling, and the mandatory human review before anything is submitted. Load when running a product post.
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
1. **Never click the final submit/publish/post button without the user's
   explicit approval in this conversation** — and never at all when
   `dryRunPosts` is true (then the user clicks it themselves in the browser).
2. **Never attempt to solve a captcha.** It's the user's browser — ask them.
3. If a page states automated/agent submissions are prohibited, stop, tell the
   user, and mark the post `skipped`.
4. `read_page` after every navigation, tab switch, or action that changes the
   page — refs (`e1`, `e2`…) are invalidated by all of them.
5. Never type a password into a Google/GitHub/Microsoft login form. If one
   appears, the user signs in themselves in the Chrome window.
6. **Communities and forums have rules.** Before composing a `thread`/`link`/
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

No `signupEmail` in the brief (`signupNote` set): stop and ask the user which
email they want their accounts on, save it with `dest email <address>` (add
`--webmail <url>` if it's a custom domain), and make sure that inbox is signed
in inside the Social Cue Chrome before continuing.

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
      `webmailUrl` in the brief → ask the user for their webmail URL and save
      it with `dest email <address> --webmail <url>`). `read_page`. If the
      webmail shows a login form, ask the user to sign in in that tab and say
      "done". Find the newest message from the site. **Gmail:** don't hunt
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
   4. Nothing after two refreshes ~1 min apart → tell the user (address used,
      what to look for), offer to wait longer or let them check; if they find
      it, they can click the link themselves and say "done".
   5. Confirm you're logged in (`read_page`), `close_tab` the webmail tab, then
      `post update <id> '{"status": "account_created", "appendLog": "verified + logged in"}'`.

4. **Neither works** (captcha you must not solve, phone verification, an
   invite-only site): captcha → `screenshot`, ask the user to solve it in the
   Chrome window and say "done"; anything else → explain and let them choose
   to do the step themselves or skip
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
- Ask the user only when nothing usable exists or the form demands something
  you can't produce (a video, a real team photo). **Never fabricate images of
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
  bodies: `type_text` into the editor, then `read_page` to confirm it landed
  (rich editors sometimes eat newlines — paragraph by paragraph if so).
- **Trust the accessible name over the placeholder** when they disagree
  (`textbox "Email"` is the truth). Screenshot before submitting anything
  you filled by placeholder.
- **Never touch the page's own search box.** `read_page` tags it
  `[site-search]`; clicking its submit button navigates away and drops the
  whole form.
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
  `selected` chips it returns.
- Native `<select>`: `act select` by option text or value.
- **Never invent facts** — no fake metrics, founding dates, team sizes, or
  testimonials. Unknown optional fields stay empty (flag them in the review);
  ask the user for required ones you can't answer.
- Captcha at any point: `screenshot`, tell the user to solve it in the Chrome
  window and say "done", then `read_page` and continue.

**listing** (directories, launch sites) — map the subject onto the form by
meaning, not by field name:
- name → product/startup/tool name · url → website/link
- tagline → tagline/one-liner/short pitch (mind the character limit shown)
- shortDescription → short description/summary
- aboutBrand + shortDescription (+ a content item's `body`, + README copy from
  `path`) → long description: write fresh prose, don't paste fragments
- tags → tags/categories/topics (pick the site's closest existing ones)
- contact email → `signupEmail`; pricing / launch date / social links → only
  what you actually know. For an ad-hoc subject with no brand fields, work
  from its README/site and say so in the review.

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
  not re-upload those images inline. In a rich editor, type it paragraph by
  paragraph and re-insert the images from their URLs. `media[0]` is the
  cover/hero file for a cover slot (dev.to, Hashnode); Indie Hackers has none.
  Read the item's `notes` first — it names the venue it was written for and
  where the images live. Only lightly adapt (title idiom, tag list); the
  user already reviewed the body.
- Respect the editor: markdown textarea → paste markdown; rich editor → type
  paragraphs and check headings/links rendered. Cover image slot → §3.
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
- Title follows the site's format: Show HN → `Show HN: <Name> – <one-liner>`;
  Reddit/Lobsters → descriptive, no marketing tone. URL = the subject's `url`
  (a content item → its `releaseUrl`, else the brand site). Optional text
  field → a two-to-four sentence maker note. Tags where offered.

**After the main form** some sites continue: AlternativeTo asks which
existing apps yours is an alternative to (required), others ask for a
launch date, a category vote, or offer paid priority review. Treat these as
part of the same review — read the page, fill what you can, and surface
anything with a price or a judgement call (which competitors to list, pay
$5 to skip a months-long queue) to the user instead of deciding.

## 5. Review stop (mandatory)

When the form is complete and BEFORE any submit/publish/post click:
1. `screenshot` the filled form.
2. Present exactly what will go out: every field, the full title + body text
   for articles/threads, and which files were attached.
3. Ask for explicit approval.
   - `dryRunPosts` true: do NOT click submit even if approved — tell the user
     the form is filled and waiting; they click in the browser and tell you
     once done.
   - Hacker News and any site whose `notes` say the user must click: same —
     hand the click to the user.
4. Only after approval (or the user's "done" in dry-run), continue.

## 6. Record the outcome

- Success page / confirmation / the live post: capture its URL
  (`get_page_info`), then
  `post update <id> '{"status": "submitted", "listingUrl": "<url if any>", "appendLog": "submitted; <confirmation detail>"}'`
  If the site says "under review", log the stated review time. A community
  post that's visible immediately can go straight to `"status": "live"`.
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
