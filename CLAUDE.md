# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **Social Cue Claude Code plugin** — the active discovery sensor. `/socialdiscovery`
drives the user's own dedicated, logged-in Chrome profile to find social-media
conversations worth joining for their brands, scores them, and writes ranked
opportunities + drafted replies to a local store. Discovery runs on the user's
Claude subscription and only collects; posting happens after the user approves.

## Commands

```bash
npm install                         # better-sqlite3 (native) + zod
                                    # prefix with NODE_OPTIONS=--dns-result-order=ipv4first if npm hangs

# Drive the CLI directly (what the slash commands do under the hood):
node lib/cli.js config init
node lib/cli.js brand add --name "Acme" --url https://acme.dev --tags "ci,devops"
node lib/cli.js brief                # print the assembled discovery prompt
node lib/cli.js opp list --status new
# Full command list is in the lib/cli.js header: config | brand | opp | seen | run | brief | guidance

# Isolate runtime data when testing (otherwise it writes to ./.socialdiscovery):
SOCIALCUE_DIR=$(mktemp -d)/.socialdiscovery node lib/cli.js config init
```

Install into Claude Code for an end-to-end test:
```
/plugin marketplace add <abs path to this dir>
/plugin install socialcue@socialcue
/reload-plugins
```

**Cache-snapshot gotcha (local dev):** `/plugin install` *copies* this repo (including
`node_modules`, which the MCP server needs) into
`~/.claude/plugins/cache/socialcue/socialcue/<version>/` — it does **not** symlink. So
edits here are NOT live; to pick them up, **bump `version` in `.claude-plugin/plugin.json`**
(forces a fresh cache dir), then `/plugin marketplace update socialcue` →
`/plugin install socialcue@socialcue` → `/reload-plugins`. Run `npm install` here first
so the copied `node_modules` is complete (must include `patchright`, `better-sqlite3`,
`@modelcontextprotocol/sdk`).

There is no test suite yet; verify by exercising `lib/cli.js` against a `SOCIALCUE_DIR`
temp dir (see Phase 1 verification in the build plan).

## Architecture (the parts that span files)

**Two-tier storage — keep the split.** `lib/config.js` owns
`.socialdiscovery/config.json` (brands, accounts, platforms, browser CDP url, strategy
weights) and `lib/guidance.js` owns `.socialdiscovery/voice-guidance.md` (draft-reply
voice rules + golden before→after examples) — both **user-editable sources of truth**.
`lib/db.js` owns `.socialdiscovery/socialcue.db` (SQLite) which holds **generated
state only**: `seen_urls`, `opportunities`, `runs`. Brands are deliberately NOT
duplicated into SQLite. `lib/paths.js` resolves all paths under `.socialdiscovery/`
in cwd (override with `SOCIALCUE_DIR`).

**The CLI is the bridge.** Slash commands and the subagent are **markdown prompts**
(`commands/`, `agents/`) — they do not import `lib/` directly. They shell out to
`node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" <cmd>`. This keeps the prompt layer thin and
the logic testable. `${CLAUDE_PLUGIN_ROOT}` is injected by Claude Code.

**Run flow:** `/socialdiscovery` (command) → checks config, sweeps unswept draft
notes into voice guidance (`opp notes`, see Voice feedback loop), `run new`, then `brief` →
delegates to the `discovery-subagent` (Task tool) → subagent loads the `scoring-brain`
skill, drives the browser, dedupes via `seen check`, records via the
`collect_opportunity` MCP tool (screenshot + insert, which also marks the URL seen) →
command summarizes with `opp list --status new`.

**`brief` is where config meets the brain.** It loads active brands + maps
`config.platforms` (keys like `reddit`) to `KNOWN_PLATFORMS` descriptors + pulls recent
seen URLs + the voice guidance, then calls the shared `buildAutonomousDiscoveryPrompt`.
That's the single assembly point for a run's instructions.

**Voice feedback loop.** Drafts are written once into `opportunities.suggested_reply`
(immutable); the user's rewrite goes in `user_reply` (effective reply =
`user_reply || suggested_reply` — the dashboard, `/post` pre-fill, and run report all
use it) with per-draft feedback in `reply_note`. The dashboard PATCHes these via
`PATCH /api/opportunities/:id` (free tier — review is never gated); "Save as example"
(`POST …/:id/save-example`) appends the before→after pair to `voice-guidance.md` and
stamps `example_saved_at`. The `review-notes` skill (+ `/socialdiscovery:notes`)
distills notes into rules, rewrites the queue via `opp update`, and curates examples
(~10 cap). Sweeps are tracked via `note_swept_at` (`opp notes` lists unswept ones;
`opp update <id> '{"noteSwept": true}'` stamps; writing `replyNote` clears the stamp) —
`/socialdiscovery` sweeps automatically before assembling the brief, so dashboard
notes reach the guidance without a separate command. `brief` injects the file as the
USER VOICE GUIDANCE prompt section (capped ~6k chars in shared `prompts.js`), so runs
draft in the user's voice from the start. `/load-dashboard` opens the dashboard
(bridge + queue summary) without running discovery.

## The bridge + dashboard (Phase 4)

`bridge/` is a zero-dependency `node:http` loopback server (`node lib/cli.js
bridge start`, default port 8377) that serves the unified opportunities API +
the dashboard, and receives extension pushes on `POST /api/sync`.
`bridge ensure|open|stop` (lib/bridge-launcher.js) run it detached
(pid/log under `.socialdiscovery/`); `/socialdiscovery` calls `bridge open` so
results stream into the dashboard live during a run. Rules that
must not drift:

- **Binds `127.0.0.1` only**; Bearer pairing token (`config.json` →
  `bridge.token`) on everything except `/api/health`; Host-header allowlist; no
  CORS allow headers. Never expose beyond loopback, never add cloud sync.
- **Merge identity is `normalizeUrl(platform_url)`** via the
  `opportunities.normalized_url` column — first wins, existing rows are never
  overwritten. Status vocab maps in `bridge/status-map.js` (mirrored in the
  extension's `src/lib/bridge.ts` — change both or neither).
- **`/api/changes` is data_version + an in-process write counter**
  (`bridge/changes.js`) because same-connection writes don't move
  `PRAGMA data_version`. Bump it from any new mutating endpoint.
- The Settings tab edits the discovery run knobs (platforms, strategy weights,
  engagementRatio, maxTurnsPerPlatform) via `PATCH /api/settings/run` and brand
  profiles (name/url/tagline/descriptions/tags/isActive) via
  `PATCH /api/brands/:id` (`cfg.updateBrand`, re-validated through the shared
  schemas). Brand add/remove stays with `/socialcue-setup` + CLI; browser,
  tokens and the Postiz key are NOT writable from the dashboard.
- `dashboard/` is a self-contained Vite+React app (own `node_modules`).
  `dashboard/dist` is **committed** (plugin installs copy the repo; no
  post-install build) — rebuild with `npm run dashboard:build` before release,
  never hand-edit it.

## "Places to post" is REMOVED (2026-08-11) — Content Strategy leads with "Your content"

The venue-nudge checklist (`lib/venue-catalog.js`, `lib/recommendations.js`,
`RecommendationChecklist.tsx`, the `/api/recommendations*` routes) was deleted:
it was a deterministic brand×venue template loop with a hardcoded 8/10 "score",
and its catalog tags never matched real free-text brand tags, so it rendered
the same 3 universal venues per brand. Don't reintroduce it without real
signal. The Content Strategy tab now opens with a **"Your content"** header
over the content_items list (user-composed + agent/CLI drafts, `source`
badges) with the composer alongside; the sidebar Content badge counts
`content_items` in `idea|draft` only.

Vestiges kept on purpose (posted/skipped recommendation rows still exist in
history, and `venue_id` still arrives via `content add`):
- `opportunities.kind` + `venue_id` columns; `kind:'recommendation'` rows are
  never auto-submitted by assisted posting (their URL is a submit form).
- The `venue_posts` ledger + `db.recordVenuePost` (PATCH `posted` on a
  recommendation row) + `db.completeVenueRecommendation` (fired from
  `lib/content-actions.js` when a venue-linked content item schedules or a
  Postiz sync sees it published; idempotent, no-ops with no open nudge).

## Pro licensing + assisted posting (Phase 5)

- **Verification is offline-only**: Ed25519-signed `SC1-…` keys verified by
  `lib/license.js` against an embedded public key. Keys now carry an `expires`
  date and are **short-lived**; an expired key reads as free. The key string is
  stored in `config.json` → `license` (shared `ConfigSchema`). Don't add
  obfuscation or a network check to the *verification* path — it must stay a
  source-visible offline check.
- **Subscription + auto-refresh** (`lib/license-refresh.js`): Pro is a $19/mo
  subscription sold by the licensing site (`../socialcue-website`, Polar). After
  buying, the user gets an opaque **account token** (`scacct_…`) and runs
  `license connect <token>` (or pastes it into the dashboard upgrade modal,
  `POST /api/license/connect`). The plugin then pulls a fresh signed key from
  `config.licenseServerUrl` (default `https://trysocialcue.com`) via
  `GET /api/license/current` (Bearer = the token) — refreshing on bridge start
  (`ensureBridge`, fire-and-forget) and when the key nears expiry. **The plugin
  never records or sends the user's social media data anywhere — page content
  reaches only the models, through Claude Code itself.** The license refresh
  carries only the token — never brands, pages, or opportunities — and the
  opt-in Postiz integration (see Content Strategy below) sends only posts the
  user composed. It's
  offline-tolerant: network failures keep the old key until it truly expires; a
  403 means the subscription lapsed → the key ages out to free. CLI:
  `license connect <token> [--server url]` / `license refresh` / `license show`
  / `license activate <key>` (manual/dev keys). The private key lives only on the
  licensing site (Railway secret); rotate via that repo's `npm run keygen` and
  update `PUBLIC_KEY_PEM` here.
- **Assisted posting** (`POST /api/opportunities/:id/post`, Pro-gated 403
  `pro_required`): `bridge/post-intent.js` connects to the dedicated Chrome
  over CDP (lazy `import('patchright')` — the bridge stays zero-dependency
  until a post fires), opens the thread, pre-fills the reply box
  (HN/old-reddit textarea `.fill`; new-Reddit shadow-DOM contenteditable via
  `keyboard.insertText`), and brings the window forward. **Submitting is opt-in
  per request** (`{ submit: true }` in the POST body → `submitReply()` clicks the
  platform's submit control): the default is pre-fill only and the user clicks
  post themselves; "Post & submit for me" in the dashboard sends the flag. A post
  only ever fires from an explicit user action on an approved reply — nothing
  submits unattended, and venue recommendations (`kind: 'recommendation'`) are
  never auto-submitted (their URL is a full submission form, not a reply box).
  Firing an intent stamps `opportunities.posted_intent_at` and promotes
  `new/reviewed` → `approved`; a successful auto-submit marks `posted`, otherwise
  marking `posted` stays manual in the dashboard.
- Free vs Pro line: discovery, the queue UI, and all of Content Strategy
  (including Postiz scheduling/sync — affiliate play, see Content Strategy) are
  free; **assisted posting**, **reply performance tracking**, and **directory
  submission** (see its section) are Pro. Never gate discovery.
- Assisted-posting pre-fill covers HN + old/new Reddit + X + Indie Hackers +
  Product Hunt (`bridge/post-intent.js` `prefillReply`); unknown platforms
  degrade to open-only with the draft on the clipboard.

## Content Strategy (original posts via Postiz)

The second pillar next to reply opportunities: **original** posts per brand,
composed in the dashboard's Content Strategy tab and scheduled (free) through
the user's own [Postiz](https://postiz.com) account, with status + analytics
synced back. Postiz's public API cannot comment on other people's threads —
replies remain the assisted-browser flow in `bridge/post-intent.js` (pre-fill by
default, submit clicked only on per-request opt-in). Postiz scheduling is a
different, explicitly-opt-in path: the user composes the post and clicks
Schedule themselves.

- **Opt-in boundary**: `lib/postiz-client.js` is the single outbound module
  (modeled on `license-refresh.js`: never throws, `{ok, status?, data?, reason?}`).
  Dormant until `config.postiz.apiKey` is set (shared `ConfigSchema`,
  `postiz: {apiUrl, apiKey, channelMap}` — cloud default, self-hosted via
  `apiUrl`). `channelMap` is **brandId → [integration ids]** (Settings →
  "Accounts → brands") and is **many-to-many**: one account can back several
  or all brands (founder accounts), and no assignment = "any brand". A brand's
  posts default to its accounts (editor preselects them; accounts assigned
  ONLY to other brands hide behind a toggle; agent/CLI submissions without
  explicit channels fill from it via `channelsForBrand()` in
  `lib/content-actions.js`). It sends only content the user composed for scheduling; the API
  key is never logged, never returned by any endpoint (`/api/settings` and
  `/api/postiz/status` expose connection state + apiUrl only).
- **Storage**: `content_items` table in `lib/db.js` (drafts, channels/settings
  JSON, postiz_post_id, status `idea|draft|scheduled|published|failed`,
  metrics snapshot). Authored, not discovered — no seen-URL identity.
- **Bridge**: `bridge/content-routes.js` (delegated from `routes.js` after
  auth). The entire Postiz pillar is **free** — CRUD,
  `/api/postiz/connect|disconnect|status|integrations`,
  `POST /api/content/:id/schedule` and `POST /api/content/sync`
  (409 `postiz_not_connected` when no key). Content edits
  are refused once an item is in Postiz (the local row becomes a mirror).
- **Postiz is FREE on purpose (2026-08-11, user decision): Social Cue plans to
  be a Postiz affiliate, so users adopting Postiz is a win — never Pro-gate
  scheduling/sync.** The dashboard links Postiz via `POSTIZ_REFERRAL_URL`
  (`ContentPanel.tsx`) — swap in the affiliate link there when it exists.
  Pro remains: assisted posting + reply performance tracking + directory submission.
- **Agent ingestion**: external producer agents (demo-video, meme, blog agents)
  drop finished work into the queue via `content add` (CLI, preferred — works
  without the bridge, validates media paths) or `POST /api/content`; see
  `docs/agent-content.md`. Items carry `source` (agent name, badge in the
  dashboard) and `media`: absolute local paths at submission, **copied into
  the managed store `.socialdiscovery/media/<itemId>/` at ingestion**
  (`lib/media-store.js`) — rows hold store-relative entries, so producers may
  delete their originals immediately; legacy absolute-path rows still resolve.
  Postiz upload happens at schedule time via `uploadFile`; deleting an item
  removes its media dir. Schedule/sync logic is shared between bridge and CLI
  in `lib/content-actions.js`. Agents create items; they never schedule.

## Reply performance tracking (Pro "track" pillar)

- Ledger: `reply_checks` table (`lib/db.js` — `recordReplyCheck`,
  `listPerformanceDue`, `performanceSummary`). One row per check-in so the
  dashboard shows growth (first vs latest), not a snapshot.
- Capture is subagent-driven, not scraped: `/socialdiscovery` step 6 runs
  `perf due` (CLI; Pro-gated) and prepends the list to the brief; the
  discovery subagent visits each thread, finds the user's own comment, and
  records via the `record_performance` MCP tool. Checks throttle to one per
  ~20h per reply. Recommendations are excluded (their URL is a submit page).
- Surface: the dashboard **Submitted** tab (Pro) — metric chips on reply rows
  plus a Performance section in the detail pane ← `GET /api/performance`
  (`bridge/routes.js`, 403 `pro_required` on free, same gate as posting; the
  dashboard swallows the 403 so free users see Submitted undecorated).

## Directory submission (Pro "submit anywhere" pillar)

`/socialcue-submit <brand> <directory|URL>` gets a brand listed on directory
sites (Product Hunt, BetaList, arbitrary URLs) by driving the dedicated Chrome
over the existing MCP browser tools (`read_page` refs → `act`/`upload`), with
a **mandatory human review stop before any submit click** (`dryRunPosts` makes
the user click submit themselves, same rule as assisted posting). The playbook
lives in `skills/directory-submission/SKILL.md`; the command is thin.

- **State**: `directories` (registry; seeded idempotently from
  `data/directories.json` — INSERT OR IGNORE plus a backfill of still-empty
  `signup`/`oauth_providers`/`test_status`/`submit_url` on seed rows, so user
  rows/edits/notes survive and new seed knowledge still lands; retired seed
  ids like `betapage`→`pitchwall` are deleted when unreferenced) and
  `submissions` (per brand+directory attempt: status lifecycle
  `pending|account_created|awaiting_verification|submitted|live|failed|skipped`,
  JSON step log) in `lib/db.js`. Registry rows carry **how the site gates
  submissions**: `signup` (`NULL` unknown | `none` | `email` | `oauth` |
  `mixed`), `oauth_providers` (JSON list: google/github/…), `test_status`
  (`NULL` | `works` | `needs_fix` | `blocked`) and free-text `notes` — the
  agent writes all of these back via `dir update` so re-runs improve. The
  initial values were ported from the old cueupsocial project's per-site test
  notes (`SUBMISSION_INFO.md`).
- **Signup email + webmail (no AgentMail — removed 2026-08-15)**: the agent
  signs up *as the user* in the dedicated Chrome. `config.directories.
  {signupEmail, webmailUrl}` (shared `DirectoriesConfigSchema`; `dir email`
  CLI, `PATCH /api/settings/directories`, Settings tab) hold the address the
  user is signed into there; `lib/webmail.js` derives the webmail URL from
  the provider (gmail→mail.google.com…). OAuth ("Continue with Google") is
  the preferred path since the profile is already signed in; email/password
  signups use `signupEmail` + a generated password, and the agent reads the
  verification mail by opening the webmail in a **second tab** (browser MCP
  `list_tabs`/`open_tab`/`switch_tab`/`close_tab`, popups auto-adopted). It
  never learns or types the user's mailbox/Google password.
- **Credentials**: generated directory-account passwords live in
  `.socialdiscovery/submission-credentials.json` (0600, `lib/credentials.js`),
  keyed brandId:directoryId so re-submissions reuse the account (the brief's
  `credentialsExisted`) — deliberately NOT in SQLite so no bridge query can
  serve them. `submission creds <id>` prints them locally; no bridge endpoint
  ever does. The email on a record is the user's own `signupEmail`.
- **Brand assets**: `BrandSchema.projectPath` (optional, set by
  `/socialcue-setup` automatically when run from the project folder) points at
  the user's existing project dir; the command explores it freely at
  submission time for logos/screenshots/copy — no imposed structure.
- **Pro line**: `submission start` (CLI) and `GET/PATCH /api/submissions`
  (`bridge/directory-routes.js`) gate on `isPro`; the registry
  (`GET /api/directories`) and the signup-email setting are free (setup, not
  acting). The dashboard **Directories** tab is a state surface only — it
  copies the `/socialcue-submit` command instead of triggering automation
  (agent work needs the Claude Code loop) and shows signup/test badges.
- Never solve captchas (ask the user — it's their browser); stop if a page
  prohibits automated submissions; one directory per approval, never parallel.

## Distribution

Dev remotes are private Bitbucket; the **public repo** is the GitHub mirror
`mrieck/socialcue-claude-plugin`, listed in the `productive-mark` marketplace
(`mrieck/claude-plugins`) — users install with
`/plugin marketplace add mrieck/claude-plugins` →
`/plugin install socialcue@productive-mark` (or add this repo directly).
Publish with `scripts/release-github.sh` — it pushes a **squashed snapshot** of
HEAD (never private history), refuses on a dirty tree or stale `dashboard/dist`.
The repo's social-preview image (`docs/socialcue_social_1280x640.png`) is set
manually in GitHub repo settings.
License is PolyForm Shield 1.0.0 (`LICENSE.md`) — source-visible on purpose so
the privacy claims are verifiable.

## Generated files — do not edit

- `vendor/shared/` and `skills/scoring-brain/SKILL.md` are **vendored/rendered** from
  `../socialcue-shared`. Edit the brain there and run `npm run sync` in that repo.
- `lib/*` imports the brain via `../vendor/shared/*.js`.

## Browser connection (MCP server)

Discovery attaches to a **dedicated** Chrome profile (`--remote-debugging-port=9222
--user-data-dir=...`) — never the daily driver, never an uploaded session. The
`launch_browser` MCP tool starts that profile itself (detached spawn, probe + poll on
`/json/version`); it lives in the MCP server rather than `lib/cli.js` **on purpose**:
in Claude Cowork, Bash runs in a sandboxed VM while plugin MCP servers run natively on
the host, so the MCP layer is the only place that can open a real window. Default
profile dir is `~/.socialcue-chrome`; override with `browser.profilePath` in config. The MCP browser server is `mcp/browser-server/server.js` +
`browser.js` (ported from the old actor's `mcp-server.js` + `browser.js`, but uses
Patchright `connectOverCDP`), declared via the root `.mcp.json` as `socialcue-browser`
(declared in `.mcp.json` as `socialcue-browser`, but because this ships as a plugin,
Claude Code namespaces the tools as `mcp__plugin_socialcue_socialcue-browser__*` — that
prefixed form is what command/subagent `allowed-tools`/`tools` lists must use, or the
subagent gets zero browser tools). Connection is **lazy** — the first
browser tool call connects using `config.browser.cdpUrl`, and returns an actionable
error if Chrome isn't reachable. `closeBrowser()` disconnects without killing the
user's browser. `collect_opportunity` screenshots + writes to SQLite via `lib/db.js`
and saves PNGs under `.socialdiscovery/runs/<runId>/`.

**Tabs.** `browser.js` owns a list of tabs (`tabs[]`, small stable integer ids, one
active) rather than a single page — `list_tabs` / `open_tab` / `switch_tab` /
`close_tab` exist for side trips (the directory-signup flow opens the user's webmail
in a 2nd tab to read a verification code, then switches back with the form intact).
Every other tool acts on the active tab; switching clears refs (re-run `read_page`).
Popups opened by our tabs (OAuth, target=_blank) are auto-adopted (never the user's
own tabs); closing the last tab is refused; if the user closes our last tab by hand,
the next tool call re-opens a holding tab. Add the four tool names to any command
`allowed-tools` list that needs them (only `/socialcue-submit` + setup today).

Validated: `connectOverCDP` + `Accessibility.getFullAXTree` (the ref system's
dependency) work against real Chrome. `deps`: `patchright` is JS-only here — we attach
to the user's Chrome, so no `patchright install` browser download is needed.

**Local OCR for image/video posts (`read_image_text`).** The accessibility tree
drops alt-less images and `<video>` entirely, so image-dominant posts would
otherwise cost a `screenshot` (vision tokens) to read. `read_image_text` instead
runs **tesseract-wasm locally** in a worker thread (`mcp/browser-server/ocr.js`):
`findVisibleMedia` in `browser.js` tags the largest visible media (walking open
shadow roots — Reddit's video player lives in one), element-screenshots each
(compositor pixels, so no CORS taint and `<video>` yields its current frame),
and returns plain text — free, ~instant, zero image tokens. The wasm runtime
comes from the `tesseract-wasm` npm package; the model is **committed** at
`mcp/browser-server/ocr-assets/eng.traineddata` (refresh via
`node scripts/fetch-ocr-assets.mjs`). Heavy deps (`tesseract-wasm`, `pngjs`)
are imported lazily so a stale `node_modules` degrades to a per-call error, not
a dead server. The subagent passes useful text to `collect_opportunity` as
`ocrText` → `opportunities.ocr_text` (plugin-only; deliberately not in the
shared sync schema). OCR output is a lossy hint — filters (`looksLikeText`,
min 8 chars, 1500 cap) are ported verbatim from the extension's offscreen OCR
so both sensors read images the same way.
