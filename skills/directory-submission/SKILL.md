---
name: directory-submission
description: Playbook for submitting a brand to a directory site with the Social Cue browser tools — signing up as the user (OAuth first, else email + a verification code read from their own webmail in a second tab), accessibility-ref form filling, uploads, captcha handling, and the mandatory human review before submit. Load when running a directory submission.
user-invocable: false
---

# Directory Submission Playbook

You have a submission brief (from `submission start`): submission id, brand
fields, directory target (`signup`, `oauthProviders`, `testStatus`, `notes`),
the user's `signupEmail` + `webmailUrl`, optionally a generated `password`
(+ `credentialsExisted`), and the `dryRunPosts` flag. The browser tools are the
`mcp__plugin_socialcue_socialcue-browser__*` set; the CLI is
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js"`.

The browser is the user's own dedicated Chrome, signed into their platforms,
their Google account and their email. You act **as them**: accounts get created
on `signupEmail`, and verification mail is read from their webmail in a second
tab. You never learn or type their email/Google password.

**Prime rules — never break these:**
1. **Never click the final submit/publish button without the user's explicit
   approval in this conversation** — and never at all when `dryRunPosts` is
   true (then the user clicks it themselves in the browser).
2. **Never attempt to solve a captcha.** It's the user's browser — ask them.
3. If a page states automated/agent submissions are prohibited, stop, tell the
   user, and mark the submission `skipped`.
4. `read_page` after every navigation, tab switch, or action that changes the
   page — refs (`e1`, `e2`…) are invalidated by all of them.
5. Never type a password into a Google/GitHub/Microsoft login form. If one
   appears, the user signs in themselves in the Chrome window.

## 1. Reach the form

Navigate to the brief's `submitUrl` (or the site's homepage and find
"Submit" / "Add product" / "List your startup"). If you had to discover the
submit URL, save it for next time:
`dir update <directoryId> '{"submitUrl": "<url>"}'`.

Read the directory's `notes` and `testStatus` from the brief first — they hold
quirks learned on past runs (field order, image size limits, review delays,
custom dropdowns). When you learn a new quirk this run, append it:
`dir update <directoryId> '{"notes": "<existing notes + new line>"}'`.

## 2. Signup, if there's a login wall

No `signupEmail` in the brief (`signupNote` set): stop and ask the user which
email they want their directory accounts on, save it with
`dir email <address>` (add `--webmail <url>` if it's a custom domain), and make
sure that inbox is signed in inside the Social Cue Chrome before continuing.

A login/register wall before the form — in order of preference:

1. **An account already exists** (`credentialsExisted` true): log in with the
   stored credentials — `submission creds <id>` prints email + password. Then
   `submission update <id> '{"status": "account_created", "appendLog": "logged in (existing account)"}'`.

2. **OAuth button available** (Continue with Google / GitHub / Microsoft /
   Discord …): use it — it's one click for an account the user is already
   signed into. Click the button; if a popup opens, `list_tabs` shows it as a
   new tab — `switch_tab` to it, pick the `signupEmail` account in the account
   chooser, approve, and it usually closes itself (`list_tabs` again, switch
   back). If a Google/GitHub **login form** appears instead of an account
   chooser, the user isn't signed into that provider in this profile: tell them
   to sign in in the Chrome window and say "done" — never type their password.
   Then `submission update <id> '{"status": "account_created", "emailUsed": "<signupEmail>", "appendLog": "signed up via <provider> OAuth"}'`.

3. **Email/password signup**: fill the form via refs with `signupEmail` and the
   brief's `password` (brand name where a name is asked), submit, then:
   1. `submission update <id> '{"status": "awaiting_verification", "emailUsed": "<signupEmail>", "appendLog": "signup submitted"}'`
   2. **Read the verification mail yourself:** `open_tab <webmailUrl>` (no
      `webmailUrl` in the brief → ask the user for their webmail URL and save
      it with `dir email <address> --webmail <url>`). `read_page`. If the
      webmail shows a login form, ask the user to sign in in that tab and say
      "done". Find the newest message from the directory (use the search box —
      sender domain or the site name — and check spam if it's not in the
      inbox), open it via refs.
   3. A **magic link** → click it. It may load in this tab or open a new one
      (`list_tabs`); continue wherever it lands and `close_tab` the stale one.
      An **OTP code** → read it, `switch_tab` back to the signup tab,
      `read_page`, `act` fill it, submit.
   4. Nothing after two refreshes ~1 min apart → tell the user (address used,
      what to look for), offer to wait longer or let them check; if they find
      it, they can click the link themselves and say "done".
   5. Confirm you're logged in (`read_page`), `close_tab` the webmail tab, then
      `submission update <id> '{"status": "account_created", "appendLog": "verified + logged in"}'`.

4. **Neither works** (captcha you must not solve, phone verification, an
   invite-only site): captcha → `screenshot`, ask the user to solve it in the
   Chrome window and say "done"; anything else → explain and let them choose
   to do the step themselves or skip
   (`submission update <id> '{"status": "skipped"}'`).

## 3. Fill the submission form

Map brand fields onto the form by meaning, not by name matching:
- name → product/startup/tool name fields
- url → website/link fields
- tagline → tagline/one-liner/short pitch (mind character limits shown on the page)
- shortDescription → short description/summary fields
- aboutBrand + shortDescription → long description fields (write fresh prose
  from them; don't paste awkward fragments)
- tags → tags/categories/topics (pick the site's closest existing categories)
- contact email fields → `signupEmail`

Technique:
- `read_page {interactive: true}` → identify fields → `act(ref, 'fill'|'select'|'check', value)`
  one at a time → re-read → verify the value stuck before moving on.
- Dropdowns/comboboxes that `select` can't drive: `click` to open, `read_page`,
  click the option.
- **File uploads** (logo, screenshots): `upload` with absolute paths from the
  asset-discovery step. Prefer a ref; if the file input has no accessible node
  (hidden `<input type=file>` behind a styled button), pass the CSS selector
  `input[type=file]` as the target instead. Typical asks: a square logo
  (240×240 or 400×400 PNG), a screenshot around 1270×760, an OG/social image
  1200×630 — respect the limits stated on the page; if no suitable asset was
  found, ask the user for a path.
- Pricing/launch-date/social-link fields: fill what you know from the brand
  config or projectPath docs; leave truly unknown optional fields empty and
  flag them in the review summary; ask the user for required ones you can't
  answer.
- **Never invent facts** — no fake metrics, founding dates, or team sizes.

Captcha at any point: `screenshot`, tell the user to solve it in the Chrome
window and say "done", then `read_page` and continue.

## 4. Review stop (mandatory)

When the form is complete and BEFORE any submit/publish/finish click:
1. `screenshot` the filled form.
2. Present a field-by-field summary of exactly what will be submitted
   (including which files were attached).
3. Ask for explicit approval.
   - `dryRunPosts` true: do NOT click submit even if approved — tell the user
     the form is filled and waiting; they click submit in the browser and
     tell you once done.
4. Only after approval (or the user's "done" in dry-run), continue.

## 5. Record the outcome

- Success page / confirmation: capture any listing or status URL
  (`get_page_info`), then
  `submission update <id> '{"status": "submitted", "listingUrl": "<url if any>", "appendLog": "submitted; <confirmation detail>"}'`
  If the directory says "under review", log the stated review time.
- Failure (form rejected, account blocked, dead site):
  `submission update <id> '{"status": "failed", "appendLog": "<what happened>"}'`
- Learned anything durable about this directory? `dir update` it — that's what
  makes the next run better:
  - how signup works: `{"signup": "none"|"email"|"oauth"|"mixed", "oauthProviders": ["google", …]}`
  - whether the flow works end to end: `{"testStatus": "works"|"needs_fix"|"blocked"}`
  - submit URL, image size limits, custom widgets, review delays → `notes`.

## Pacing

Between form actions, small natural pauses happen via the browser layer — don't
add bulk waits. But never chain a second directory into the same run without
the user asking, and never parallelize submissions.
