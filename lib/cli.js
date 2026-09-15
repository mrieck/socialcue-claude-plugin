#!/usr/bin/env node
/**
 * socialdiscovery CLI — the bridge the slash commands call via Bash.
 *
 * Commands (run as: node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" <cmd> ...):
 *   config init [--force]        create .socialdiscovery/config.json
 *   config show                  print config summary
 *   config path                  print resolved file paths
 *   brand add --name .. [--url --tagline --desc --about --tags a,b --project-path /abs/dir
 *                         --pricing-url --pricing "Free; Pro $19/mo" --repo-url --launched YYYY-MM-DD
 *                         --founders "A, B" --link linkedin=https://… (repeatable)]
 *   brand update <id|name> [same flags as add; --active true|false]   partial update
 *   brand list
 *   brand rm <idOrName>
 *   opp list [--status new] [--limit 50] [--json]
 *   opp add <json|->             insert an opportunity (json arg or stdin)
 *   opp update <id> <json|->     update review fields ({ userReply?, replyNote?, noteSwept? })
 *   opp notes                    reply notes not yet swept into voice guidance (JSON)
 *   opp status <id> <status>
 *   seen check <url>             exit 0 = seen, 3 = new
 *   seen add <url> [--platform p]
 *   run new [--platforms a,b]    print new run id
 *   run list
 *   brief [--max-turns N]        print the assembled discovery brief (prompt)
 *   bridge start [--port N]      start the localhost bridge + dashboard (blocks)
 *   bridge ensure [--port N]     start the bridge detached if not already up
 *   bridge open [--port N]       ensure + open the dashboard in the Social Cue Chrome profile
 *   bridge stop                  stop a detached bridge
 *   bridge token [--rotate]      print (or regenerate) the pairing token
 *   bridge status                check whether the bridge is up
 *   license connect <token>      save the Pro account token + fetch a fresh key (--server url)
 *   license refresh              re-fetch a fresh key using the saved account token
 *   license activate <key>       verify + save a Pro license key directly
 *   license show                 print the license status
 *   perf due [--limit N]         posted replies + product posts due a performance check (Pro; JSON, each row has kind)
 *   perf record <id> [--upvotes N --replies N --note s]  record a check-in (opportunity or product post id)
 *   perf summary                 all posted replies with first/latest checks (JSON)
 *   lead brief                   the FOUNDER INVITATIONS brief section (Pro; also inside `brief`)
 *   lead list [--status s --brand b --limit N --json]   people investigated for a personal invitation
 *   lead show <id> | lead status <id> <status> | lead update <id> <json|->   ({ userDm?, objection?, note?, status? })
 *   goals list [--week YYYY-MM-DD] [--json]   the weekly goals board (Analytics tab) for that week
 *   goals items <id|title> [--week YYYY-MM-DD]   the auto-counted items behind one goal (with ids)
 *   goals exclude <id|title> <itemId> | goals include <id|title> <itemId>   stop / resume counting one auto item
 *   goals add <json|file|->      { title, target, brandName?|brandId?, rule? } — rule is
 *                                { type: 'content', platform?, source?, titlePrefix?, excludeTitlePrefix? }
 *                                | { type: 'post', destinationHost?, postType? } | { type: 'reply', platform? }
 *                                | null (manual-only)
 *   goals log <id|title-substring> [--note s --at ISO --ref key --source name]   "Log one" (source defaults to cli;
 *                                --ref makes repeats idempotent, e.g. --ref seoblog:<site>:<slug>)
 *   goals rm <id>
 *   goals seed                   add the starter set (no-op once any goal exists)
 *   content add <json|file|->    insert an original post (Content Strategy; agents use this —
 *                                { title, body, brandName?, channels?, settings?, scheduledFor?,
 *                                  media? (absolute paths — copied into .socialdiscovery/media/,
 *                                  originals safe to delete after), source? (agent name),
 *                                  variants? ({ [integrationId]: { content?, settings? } } —
 *                                  per-channel caption/settings for cross-posts),
 *                                  format? ('text' | 'markdown' — markdown = paste-ready article
 *                                  with hosted image URLs), notes? (producer's note to the poster) })
 *   content list [--brand id --status s --json]
 *   content update <id> <json|file|->  update fields (refused once the item is in Postiz)
 *   content rm <id>
 *   content channels             list connected Postiz channels (JSON)
 *   content platform-settings <integrationId>  live per-platform schema/rules from Postiz (JSON)
 *   content schedule <id> [--type draft|schedule|now --date ISO]  hand to Postiz
 *   content sync                 pull status/analytics back from Postiz
 *   content posts [--from ISO --to ISO --json]  list remote Postiz posts (verify a schedule)
 *   dest email [address] [--webmail url]  set (or show) the signup email — the address the user is
 *                                signed into in the dedicated Chrome — and its webmail URL
 *   dest sync [--force]          (Pro) pull the shared venue playbook from the licensing site (throttled to ~6h unless --force)
 *   dest list [--kind directory|launch|community|forum] [--category c] [--fits tag] [--json]   (Pro; syncs first)
 *   dest add <url> [--name n --submit-url u --kind k --post-types a,b --category c --fits a,b --cost free|freemium|paid|revshare]
 *   dest update <id> <json|->    patch { name?, submitUrl?, signup?, oauthProviders?, notes?, localNotes?, kind?, postTypes?, category?, fits?, cost? }
 *                                `notes` go to your local learnings unless an admin key is set, then they are pushed to the shared playbook
 *   dest admin-key <key|--clear> (maintainer) store the VENUES_API_KEY so learnings from this machine push to the playbook
 *   post start --subject <brand:ref|content:<id>|adhoc> [--name n --url u --path /abs --brand ref]
 *              --dest <slug|url> [--type listing|article|thread|link]   (Pro) open an attempt; prints the JSON brief
 *   post list [--subject key --brand ref --kind k --status s --json]
 *   post update <id> <json|->    patch { status?, emailUsed?, listingUrl?, appendLog? }
 *   post creds <id>              print the stored account credentials (local only, never the bridge)
 *   post assets <subjectKey> [--json]           reusable assets on file for a subject
 *   post asset add <subjectKey> <role> </abs>   cache a found/produced asset (e.g. logo-square-400)
 *   (dir / submission remain as aliases of dest / post)
 *   license preview-free on|off  (maintainer) make this install behave as free to test the free tier
 *   guidance path                print the voice-guidance.md path
 *   guidance show                print the voice guidance (creates scaffold if missing)
 *   guidance init                create voice-guidance.md if missing
 *   guidance add-example <json|->  promote a rewrite to a golden example
 *                                ({ oppId?, before?, after, why? } — oppId fills
 *                                 before/brand/platform from the row and stamps it)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cfg from './config.js';
import * as db from './db.js';
import * as paths from './paths.js';
import * as guidance from './guidance.js';
import { buildAutonomousDiscoveryPrompt, buildInvitationsSection } from '../vendor/shared/prompts.js';
import { KNOWN_PLATFORMS } from '../vendor/shared/platforms.js';

/* ---------- tiny argv parser ---------- */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      let val = true;
      if (!(next === undefined || next.startsWith('--'))) { val = next; i++; }
      // A repeated flag (--link a=… --link b=…) collects into an array.
      if (flags[key] !== undefined) flags[key] = [].concat(flags[key], val);
      else flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// `cli … | head` closes stdout early; without this Node throws an unhandled EPIPE and prints a stack trace.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
function out(s) { process.stdout.write(s + '\n'); }
function die(s, code = 1) { process.stderr.write(s + '\n'); process.exit(code); }

// JSON payload argument: "-"/omitted = stdin, a path to an existing .json file
// (safest for agents — shell echo mangles \n escapes, zsh's builtin especially),
// or inline JSON. Returns the parsed value or dies with a pointed message.
function readJsonArg(arg, what) {
  const raw = arg === '-' || arg === undefined
    ? fs.readFileSync(0, 'utf8')
    : !arg.trimStart().startsWith('{') && !arg.trimStart().startsWith('[') && fs.existsSync(arg)
      ? fs.readFileSync(arg, 'utf8')
      : arg;
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`${what}: invalid JSON (${String(err?.message ?? err)}). Tip: write the JSON to a file and pass its path — piping via echo corrupts \\n escapes in some shells (zsh).`);
  }
}

const PLATFORM_ALIASES = {
  reddit: 'reddit.com', twitter: 'twitter.com', x: 'x.com', linkedin: 'linkedin.com',
  facebook: 'facebook.com', instagram: 'instagram.com', youtube: 'youtube.com',
  hn: 'news.ycombinator.com', hackernews: 'news.ycombinator.com', producthunt: 'producthunt.com',
  indiehackers: 'indiehackers.com', threads: 'threads.com', mastodon: 'mastodon.social',
  bluesky: 'bsky.app', tiktok: 'tiktok.com', quora: 'quora.com', devto: 'dev.to',
};

/** Map a config platform key ("reddit") to a discovery platform descriptor. */
function resolvePlatform(key) {
  const domain = key.includes('.') ? key : (PLATFORM_ALIASES[key.toLowerCase()] || `${key}.com`);
  const known = KNOWN_PLATFORMS[domain];
  if (known) {
    return { ...known, domain, isKnown: true };
  }
  return {
    domain,
    name: key,
    homeUrl: `https://${domain}`,
    hints: ['Navigate to the homepage and explore', 'Find the search and community areas'],
    algorithmTips: [],
    isKnown: false,
  };
}

/** Write a human-readable markdown report for a run -> runs/<id>/report.md */
function writeRunReport(runId, summary = '') {
  const rows = db.listOpportunitiesByRun(runId);
  const dir = path.join(paths.runsDir(), runId);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  lines.push(`# Discovery run ${runId}`);
  lines.push('');
  lines.push(`_${new Date().toISOString()} — ${rows.length} opportunit${rows.length === 1 ? 'y' : 'ies'}_`);
  if (summary) { lines.push(''); lines.push(summary); }
  lines.push('');
  for (const r of rows) {
    lines.push(`## ${r.relevance_score ?? '?'}/10 — ${r.title || '(untitled)'}`);
    lines.push(`- **Platform:** ${r.platform} · **Type:** ${r.opportunity_type} · **Status:** ${r.status}`);
    lines.push(`- **URL:** ${r.platform_url}`);
    if (r.relevance_reason) lines.push(`- **Why:** ${r.relevance_reason}`);
    if (r.context) lines.push(`- **Context:** ${r.context}`);
    if (r.screenshot_path) lines.push(`- **Screenshot:** ${r.screenshot_path}`);
    lines.push('');
    lines.push(r.user_reply != null ? '**Draft reply (edited by you):**' : '**Draft reply:**');
    lines.push('');
    lines.push('> ' + ((r.user_reply ?? r.suggested_reply) || '(none)').replace(/\n/g, '\n> '));
    lines.push('');
  }
  const reportPath = path.join(dir, 'report.md');
  fs.writeFileSync(reportPath, lines.join('\n') + '\n');
  return reportPath;
}

/* ---------- commands ---------- */

/**
 * Listing-fact flags shared by `brand add` / `brand update`. `--link` is
 * repeatable (`--link linkedin=https://… --link x=https://…`); only flags that
 * were actually passed land in the patch, so an update never blanks a field.
 */
function brandListingFlags(flags) {
  const patch = {};
  const str = (flag, key) => { if (flags[flag] !== undefined && flags[flag] !== true) patch[key] = String(flags[flag]); };
  str('pricing-url', 'pricingUrl');
  str('pricing', 'pricingSummary');
  str('repo-url', 'repoUrl');
  str('launched', 'launchedOn');
  str('founders', 'founders');
  if (flags.link !== undefined) {
    const links = {};
    for (const raw of [].concat(flags.link)) {
      const m = /^([a-z0-9_-]+)=(https?:\/\/\S+)$/i.exec(String(raw).trim());
      if (!m) die(`--link must look like site=https://url (got "${raw}")`);
      links[m[1].toLowerCase()] = m[2];
    }
    patch.socialLinks = links;
  }
  return patch;
}

// Founder invitations (Pro): the dynamic brief block — each brand's ideal-customer
// rubric, the per-run cap, and the people already investigated (90-day window).
function renderInvitationsSection(config, brands) {
  const seen = db.recentLeadProfiles({ days: 90 }).map(p => `: `);
  return buildInvitationsSection({ brands, maxLeadsPerRun: config.maxLeadsPerRun, seenHandles: seen });
}

const HANDLERS = {
  config(positional, flags) {
    const sub = positional[0];
    if (sub === 'init') {
      const { created, config } = cfg.initConfig({ force: !!flags.force });
      out(created ? `Created ${paths.configPath()}` : `Config already exists at ${paths.configPath()} (use --force to reset)`);
      out(`Platforms: ${config.platforms.join(', ')} | Browser CDP: ${config.browser.cdpUrl}`);
      return;
    }
    if (sub === 'path') {
      out(`base:   ${paths.baseDir()}`);
      out(`config: ${paths.configPath()}`);
      out(`db:     ${paths.dbPath()}`);
      out(`runs:   ${paths.runsDir()}`);
      return;
    }
    // show (default)
    const config = cfg.loadConfig();
    out(`Config: ${paths.configPath()}${cfg.configExists() ? '' : ' (not created yet — showing defaults)'}`);
    out(`Platforms: ${config.platforms.join(', ')}`);
    out(`Browser CDP: ${config.browser.cdpUrl}`);
    out(`Strategy weights: feed ${config.strategyWeights.feed}% / search ${config.strategyWeights.search}% / trending ${config.strategyWeights.trending}%`);
    out(`Max turns/platform: ${config.maxTurnsPerPlatform} | engagementRatio: ${config.engagementRatio} | minScore: ${config.minScore} | maxLeadsPerRun: ${config.maxLeadsPerRun}`);
    out(`Auto-UTM tagging of own-site links when scheduling via Postiz: ${config.utmTagging === false ? 'off' : 'on'}`);
    out(`\nBrands (${config.brands.length}):`);
    for (const b of config.brands) {
      out(`  - [${b.isActive ? 'x' : ' '}] ${b.name} (${b.id})`);
      out(`      ${b.url}${b.tags.length ? ' | tags: ' + b.tags.join(', ') : ''}`);
    }
  },

  brand(positional, flags) {
    const sub = positional[0];
    if (sub === 'add') {
      if (!flags.name) die('brand add requires --name');
      const brand = cfg.addBrand({
        name: String(flags.name),
        url: flags.url ? String(flags.url) : '',
        tagline: flags.tagline ? String(flags.tagline) : '',
        shortDescription: flags.desc ? String(flags.desc) : '',
        aboutBrand: flags.about ? String(flags.about) : '',
        tags: flags.tags ? String(flags.tags).split(',').map(t => t.trim()).filter(Boolean) : [],
        projectPath: flags['project-path'] ? String(flags['project-path']) : '',
        idealCustomer: flags['ideal-customer'] ? String(flags['ideal-customer']) : '',
        requirements: flags.requirements ? String(flags.requirements) : '',
        disqualifiers: flags.disqualifiers ? String(flags.disqualifiers) : '',
        ...brandListingFlags(flags),
      });
      out(`Added brand "${brand.name}" (${brand.id})`);
      return;
    }
    if (sub === 'update' || sub === 'set') {
      const ref = positional[1];
      if (!ref) die('brand update requires a brand id or name');
      const resolved = cfg.resolveBrand(ref);
      if (!resolved) die(`No brand matches "${ref}"`);
      const patch = brandListingFlags(flags);
      if (flags.name !== undefined) patch.name = String(flags.name);
      if (flags.url !== undefined) patch.url = String(flags.url);
      if (flags.tagline !== undefined) patch.tagline = String(flags.tagline);
      if (flags.desc !== undefined) patch.shortDescription = String(flags.desc);
      if (flags.about !== undefined) patch.aboutBrand = String(flags.about);
      if (flags.tags !== undefined) patch.tags = String(flags.tags).split(',').map(t => t.trim()).filter(Boolean);
      if (flags['project-path'] !== undefined) patch.projectPath = String(flags['project-path']);
      if (flags['ideal-customer'] !== undefined) patch.idealCustomer = String(flags['ideal-customer']);
      if (flags.requirements !== undefined) patch.requirements = String(flags.requirements);
      if (flags.disqualifiers !== undefined) patch.disqualifiers = String(flags.disqualifiers);
      if (flags.active !== undefined) patch.isActive = String(flags.active) !== 'false';
      if (!Object.keys(patch).length) die('brand update: nothing to change (pass at least one flag)');
      let brand;
      try { brand = cfg.updateBrand(resolved.id, patch); } catch (err) { die(String(err?.message ?? err)); }
      out(`Updated brand "${brand.name}" (${brand.id}): ${Object.keys(patch).join(', ')}`);
      return;
    }
    if (sub === 'list') {
      const config = cfg.loadConfig();
      if (!config.brands.length) { out('No brands configured.'); return; }
      for (const b of config.brands) out(`${b.id}\t${b.isActive ? 'active' : 'inactive'}\t${b.name}\t${b.url}`);
      return;
    }
    if (sub === 'rm') {
      const removed = cfg.removeBrand(positional[1]);
      out(removed ? `Removed ${removed} brand(s).` : `No brand matched "${positional[1]}".`);
      return;
    }
    die('Unknown brand subcommand. Use: add | update | list | rm');
  },

  opp(positional, flags) {
    const sub = positional[0];
    if (sub === 'list') {
      const rows = db.listOpportunities({ status: flags.status ? String(flags.status) : null, limit: flags.limit ? Number(flags.limit) : 50 });
      if (flags.json) { out(JSON.stringify(rows, null, 2)); return; }
      if (!rows.length) { out('No opportunities.'); return; }
      for (const r of rows) {
        out(`[${r.status}] ${r.relevance_score ?? '?'}/10  ${r.platform}  ${r.opportunity_type}  ${r.id}`);
        out(`  ${r.title}`);
        out(`  ${r.platform_url}`);
        const draft = r.user_reply ?? r.suggested_reply;
        if (draft) out(`  draft${r.user_reply != null ? ' (edited)' : ''}: ${draft.replace(/\n/g, ' ')}`);
        if (r.reply_note) out(`  note: ${r.reply_note.replace(/\n/g, ' ')}`);
        out('');
      }
      return;
    }
    if (sub === 'add') {
      const arg = positional[1];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
      const id = db.addOpportunity(data);
      out(`Added opportunity ${id}`);
      return;
    }
    if (sub === 'update') {
      const id = positional[1];
      if (!id) die('opp update requires an opportunity id');
      if (!db.getOpportunityById(id)) die(`No opportunity ${id}`);
      const arg = positional[2];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
      const n = db.updateOpportunityReview(id, { userReply: data.userReply, replyNote: data.replyNote, noteSwept: data.noteSwept });
      out(n ? `Updated ${id}` : `Nothing to update for ${id} (pass userReply, replyNote and/or noteSwept)`);
      return;
    }
    if (sub === 'notes') {
      out(JSON.stringify(db.listUnsweptNotes(), null, 2));
      return;
    }
    if (sub === 'status') {
      const [, id, status] = positional;
      const n = db.setOpportunityStatus(id, status);
      out(n ? `Updated ${id} -> ${status}` : `No opportunity ${id}`);
      return;
    }
    die('Unknown opp subcommand. Use: list | add | update | notes | status');
  },

  seen(positional, flags) {
    const sub = positional[0];
    if (sub === 'check') {
      const seen = db.isUrlSeen(positional[1]);
      out(seen ? 'seen' : 'new');
      process.exit(seen ? 0 : 3);
    }
    if (sub === 'add') {
      db.markUrlSeen(positional[1], { platform: flags.platform ? String(flags.platform) : null });
      out('ok');
      return;
    }
    die('Unknown seen subcommand. Use: check | add');
  },

  run(positional, flags) {
    const sub = positional[0];
    if (sub === 'new') {
      const platforms = flags.platforms ? String(flags.platforms).split(',') : cfg.loadConfig().platforms;
      out(db.createRun({ platforms }));
      return;
    }
    if (sub === 'list') {
      for (const r of db.listRuns({})) out(`${r.id}\t${r.status}\t${r.started_at}\t${r.platforms}`);
      return;
    }
    if (sub === 'finish') {
      const id = positional[1];
      if (!id) die('run finish requires a run id');
      const summary = flags.summary ? String(flags.summary) : '';
      db.finishRun(id, { status: 'done', summary });
      const reportPath = writeRunReport(id, summary);
      out(`Run ${id} finished. Report: ${reportPath}`);
      return;
    }
    die('Unknown run subcommand. Use: new | list | finish');
  },

  async bridge(positional, flags) {
    const sub = positional[0];
    if (sub === 'start') {
      // Lazy import keeps the rest of the CLI fast.
      const { startBridge } = await import('../bridge/server.js');
      const { buildSyncHandler } = await import('../bridge/sync.js');
      let started;
      try {
        started = await startBridge({
          port: flags.port ? Number(flags.port) : null,
          syncHandler: buildSyncHandler(),
        });
      } catch (err) {
        die(String(err.message ?? err));
      }
      out(`Social Cue bridge listening on ${started.url} (loopback only)`);
      out(`Dashboard: ${started.dashboardUrl}`);
      out(`Pairing token (for the extension options page): ${started.token}`);
      out('Press Ctrl-C to stop.');
      process.on('SIGINT', () => { started.server.close(); process.exit(0); });
      return; // server keeps the event loop alive
    }
    if (sub === 'ensure' || sub === 'open') {
      const { ensureBridge, openDashboard } = await import('./bridge-launcher.js');
      let r;
      try {
        r = await ensureBridge({ port: flags.port ? Number(flags.port) : null });
      } catch (err) {
        die(String(err?.message ?? err));
      }
      out(r.alreadyRunning
        ? `Bridge already running on port ${r.port}.`
        : `Bridge started (detached, logs: ${r.logPath}).`);
      if (r.staleVersion) {
        out(`Note: the running bridge is version ${r.staleVersion} but this plugin is ${r.localVersion} — run \`bridge stop\` then \`bridge ensure\` to pick up the new version.`);
      }
      if (!r.token) out('Warning: no pairing token in config — restart the bridge to generate one.');
      out(`Dashboard: ${r.dashboardUrl}`);
      if (sub === 'open') {
        const o = await openDashboard(r.dashboardUrl);
        const why = o.note ? ` — ${o.note}` : '';
        out({
          'socialcue-tab': '(opened in a new tab of the Social Cue browser)',
          'socialcue-launched': '(launched the Social Cue browser on the dashboard)',
          'default': `(opened in your default browser${why})`,
          'none': `(couldn't auto-open a browser${why} — use the link above)`,
        }[o.where]);
      }
      return;
    }
    if (sub === 'stop') {
      const { stopBridge } = await import('./bridge-launcher.js');
      const r = await stopBridge({ port: flags.port ? Number(flags.port) : null });
      out(r.message);
      return;
    }
    if (sub === 'token') {
      const { ensureToken } = await import('../bridge/server.js');
      const bridge = ensureToken({ rotate: !!flags.rotate });
      out(bridge.token);
      return;
    }
    if (sub === 'status') {
      const config = cfg.loadConfig();
      const port = flags.port ? Number(flags.port) : config.bridge.port;
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
        const body = await r.json();
        if (body?.app === 'socialcue-bridge') { out(`up (port ${port}, version ${body.version})`); return; }
        die(`Port ${port} answered but is not a Social Cue bridge.`, 3);
      } catch {
        die(`down (nothing answering on 127.0.0.1:${port})`, 3);
      }
    }
    die('Unknown bridge subcommand. Use: start | ensure | open | stop | token | status');
  },

  async license(positional, flags) {
    const sub = positional[0];
    const { parseLicense, licenseInfo } = await import('./license.js');
    if (sub === 'activate') {
      const key = positional[1];
      if (!key) die('license activate requires a key');
      const parsed = parseLicense(key);
      if (!parsed.valid) die(`Invalid license key: ${parsed.error}`);
      const config = cfg.loadConfig();
      config.license = key;
      cfg.saveConfig(config);
      out(`Pro activated for ${parsed.payload.email}.`);
      return;
    }
    if (sub === 'connect') {
      const token = positional[1];
      if (!token) die('license connect requires your account token (scacct_…)');
      const { refreshLicense } = await import('./license-refresh.js');
      const config = cfg.loadConfig();
      config.licenseAccountToken = token.trim();
      if (flags.server) config.licenseServerUrl = String(flags.server).replace(/\/+$/, '');
      cfg.saveConfig(config);
      const r = await refreshLicense({ force: true });
      if (r.refreshed) {
        const info = licenseInfo(cfg.loadConfig());
        out(`Connected — Pro active for ${info.email} (key valid to ${info.expires}).`);
      } else if (r.status === 401 || r.status === 403) {
        die(`Token saved, but the subscription looks inactive (${r.reason}). Check your account at ${config.licenseServerUrl}/account.`);
      } else {
        die(`Token saved, but couldn't fetch a key (${r.reason}). It'll retry automatically; run "license refresh" to try again.`);
      }
      return;
    }
    if (sub === 'refresh') {
      const { refreshLicense } = await import('./license-refresh.js');
      const r = await refreshLicense({ force: true });
      out(r.refreshed ? 'Refreshed — fetched a new Pro key.' : `No refresh: ${r.reason}.`);
      return;
    }
    if (sub === 'show') {
      const info = licenseInfo(cfg.loadConfig());
      if (info.pro) out(`Pro (${info.email}, issued ${info.issued}, valid to ${info.expires})${info.canPreviewFree ? ' — maintainer: "license preview-free on" to test the free tier' : ''}`);
      else if (info.previewFree) out(`Free (PREVIEW — Pro key for ${info.email} is fine; "license preview-free off" to restore)`);
      else out(info.expired ? 'Free — Pro key expired (run "license refresh" or reconnect)' : 'Free — no license');
      return;
    }
    if (sub === 'preview-free') {
      const config = cfg.loadConfig();
      if (!config.venues?.adminKey) die('preview-free is maintainer-only (needs "dest admin-key")');
      const v = positional[1];
      if (v === 'on' || v === 'off') { config.devPreviewFree = v === 'on'; cfg.saveConfig(config); }
      else if (v !== undefined) die('license preview-free on|off');
      out(config.devPreviewFree ? 'Previewing the FREE tier (isPro() is false everywhere on this machine).' : 'Pro behaves normally.');
      return;
    }
    die('Unknown license subcommand. Use: connect <token> [--server url] | refresh | activate <key> | show | preview-free on|off');
  },

  async perf(positional, flags) {
    const sub = positional[0];
    if (sub === 'due') {
      // Pro-gated: performance tracking is the "track" pillar of the paid tier.
      const { isPro } = await import('./license.js');
      if (!isPro(cfg.loadConfig())) {
        out('pro_required — performance tracking is a Pro feature (see "license show").');
        return;
      }
      const limit = flags.limit ? Number(flags.limit) : 10;
      out(JSON.stringify(db.listPerformanceDue({ limit }), null, 2));
      return;
    }
    if (sub === 'record') {
      const id = positional[1];
      if (!id) die('perf record requires an opportunity or product post id');
      if (!db.getOpportunityById(id) && !db.getPostById(id)) die(`No opportunity or product post with id ${id}`);
      db.recordReplyCheck(id, {
        upvotes: flags.upvotes !== undefined ? Number(flags.upvotes) : null,
        replyCount: flags.replies !== undefined ? Number(flags.replies) : null,
        note: typeof flags.note === 'string' ? flags.note : '',
      });
      out(`Recorded check for ${id}.`);
      return;
    }
    if (sub === 'summary') {
      out(JSON.stringify(db.performanceSummary(), null, 2));
      return;
    }
    die('Unknown perf subcommand. Use: due [--limit N] | record <id> [--upvotes N --replies N --note s] | summary');
  },

  async goals(positional, flags) {
    const goals = await import('./goals.js');
    const sub = positional[0];
    if (sub === 'list' || sub === undefined) {
      const summary = goals.weekSummary({ weekParam: typeof flags.week === 'string' ? flags.week : null });
      if (flags.json) { out(JSON.stringify(summary, null, 2)); return; }
      if (!summary.goals.length) {
        out(`Week ${summary.week.label}: no goals yet. Run "goals seed" for the starter set or "goals add".`);
        return;
      }
      const w = summary.week;
      const ends = new Date(w.endsAt);
      out(`Week ${w.labelLong}${w.isCurrent ? ` (this week — ends ${ends.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left)` : ''}`);
      for (const g of summary.goals) {
        const mark = g.count >= g.target ? '✓' : ' ';
        const detail = `${g.autoCount} auto${g.excludedCount ? ` (${g.excludedCount} excluded)` : ''} + ${g.manualCount} logged`;
        out(`${mark} ${String(g.count).padStart(3)}/${String(g.target).padEnd(3)} ${g.title}${g.brandName ? ` [${g.brandName}]` : ''}  (${detail}; ${g.ruleLabel})  ${g.id.slice(0, 8)}`);
      }
      out(`${summary.totals.met}/${summary.totals.goals} goals met · ${summary.totals.count}/${summary.totals.target} items`);
      return;
    }
    if (sub === 'add') {
      const data = readJsonArg(positional[1], 'goals add');
      let brandId = data.brandId ?? null;
      if (!brandId && data.brandName) {
        const b = cfg.resolveBrand(data.brandName);
        if (!b) die(`No brand matches "${data.brandName}"`);
        brandId = b.id;
      }
      let rule;
      try { rule = goals.validateRule(data.rule); } catch (err) { die(String(err?.message ?? err)); }
      let row;
      try { row = db.createGoal({ title: data.title, target: data.target ?? 1, brandId, rule }); }
      catch (err) { die(String(err?.message ?? err)); }
      out(`Added goal ${row.id}: ${row.title} (${row.target}/week, ${goals.describeRule(rule)})`);
      return;
    }
    if (sub === 'log') {
      const ref = positional[1];
      if (!ref) die('goals log requires a goal id or a unique title substring');
      const { goal, candidates } = goals.resolveGoal(ref);
      if (!goal) {
        die(candidates.length
          ? `"${ref}" matches several goals: ${candidates.map(c => `${c.title} (${c.id.slice(0, 8)})`).join(', ')}`
          : `No goal matches "${ref}"`);
      }
      let r;
      try {
        r = db.addGoalEntry(goal.id, {
          at: typeof flags.at === 'string' ? flags.at : null,
          note: typeof flags.note === 'string' ? flags.note : '',
          source: typeof flags.source === 'string' && flags.source ? flags.source : 'cli',
          ref: typeof flags.ref === 'string' && flags.ref ? flags.ref : null,
        });
      } catch (err) { die(String(err?.message ?? err)); }
      const week = goals.weekBounds(new Date(r.entry.at), goals.configuredWeekStart());
      const count = goals.goalSummary(goal, week, cfg.loadConfig().brands ?? []).count;
      out(`${r.created ? 'Logged' : 'Already logged'} "${goal.title}" for week ${week.label}: now ${count}/${goal.target}.`);
      return;
    }
    if (sub === 'items' || sub === 'exclude' || sub === 'include') {
      const ref = positional[1];
      if (!ref) die(`goals ${sub} requires a goal id or a unique title substring`);
      const { goal, candidates } = goals.resolveGoal(ref);
      if (!goal) {
        die(candidates.length
          ? `"${ref}" matches several goals: ${candidates.map(c => `${c.title} (${c.id.slice(0, 8)})`).join(', ')}`
          : `No goal matches "${ref}"`);
      }
      const week = goals.weekBounds(goals.parseWeekParam(flags.week) ?? new Date(), goals.configuredWeekStart());
      if (sub !== 'items') {
        const itemRef = positional[2];
        if (!itemRef) die(`goals ${sub} requires the item id (see "goals items")`);
        const kind = goals.parseRule(goal.rule)?.type;
        if (!kind) die(`"${goal.title}" has no auto-rule — remove a logged entry instead`);
        // Accept an id prefix from the current week's matches.
        const matches = goals.matchRule(goal.rule, goal.brand_id, week).filter(it => it.id.startsWith(itemRef));
        if (matches.length !== 1) die(matches.length ? `"${itemRef}" matches several items` : `No counted item in week ${week.label} starts with "${itemRef}"`);
        db.setGoalExclusion(goal.id, kind, matches[0].id, sub === 'exclude');
        const count = goals.goalSummary(goal, week, cfg.loadConfig().brands ?? []).count;
        out(`${sub === 'exclude' ? 'Excluded' : 'Counting again'} "${matches[0].title}" for "${goal.title}": now ${count}/${goal.target} for week ${week.label}.`);
        return;
      }
      const { items } = goals.autoItemsForGoal(goal, week);
      if (flags.json) { out(JSON.stringify({ week, items }, null, 2)); return; }
      out(`${goal.title} — week ${week.labelLong} (${goals.describeRule(goal.rule)})`);
      if (!items.length) { out('  no auto-counted items'); return; }
      for (const it of items) {
        out(`  ${it.excluded ? '✕ excluded ' : '           '}${it.id.slice(0, 8)}  ${new Date(it.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}  ${it.title}`);
      }
      return;
    }
    if (sub === 'rm') {
      const id = positional[1];
      if (!id) die('goals rm requires a goal id');
      const { goal } = goals.resolveGoal(id);
      if (!goal) die(`No goal matches "${id}"`);
      db.deleteGoal(goal.id);
      out(`Removed goal ${goal.id} (${goal.title}) and its entries.`);
      return;
    }
    if (sub === 'seed') {
      const r = goals.seedStarterGoals();
      out(r.skipped ? 'Goals already exist — starter set not added.' : `Added ${r.added} starter goals.`);
      return;
    }
    die('Unknown goals subcommand. Use: list [--week YYYY-MM-DD --json] | items <id|title> | exclude|include <id|title> <itemId> | add <json|file|-> | log <id|title> [--note s --at ISO --ref key --source name] | rm <id> | seed');
  },

  async content(positional, flags) {
    const sub = positional[0];
    if (sub === 'add') {
      const data = readJsonArg(positional[1], 'content add');
      // Agents pass a brand by name or id; resolve against config so the
      // dashboard filters work. Unresolved names still display via brand_name.
      const config = cfg.loadConfig();
      const brand = config.brands.find(b => b.id === data.brandId)
        ?? config.brands.find(b => b.name === data.brandName);
      const media = Array.isArray(data.media) ? data.media.map(String) : [];
      for (const m of media) {
        if (!path.isAbsolute(m)) die(`media path must be absolute: ${m}`);
        if (!fs.existsSync(m)) die(`media file not found: ${m}`);
      }
      const { addContentItemWithMedia, channelsForBrand } = await import('./content-actions.js');
      // No explicit channels → default to the brand's mapped Postiz accounts
      // (config.postiz.channelMap, managed in the dashboard Settings).
      let channels = Array.isArray(data.channels) ? data.channels : [];
      if (!channels.length && brand?.id) {
        channels = channelsForBrand(config, brand.id);
      }
      // Media is COPIED into .socialdiscovery/media/<id>/ — the agent's
      // originals are safe to delete once this prints the id.
      const id = addContentItemWithMedia({
        ...data,
        media,
        channels,
        brandId: brand?.id ?? data.brandId ?? null,
        brandName: brand?.name ?? data.brandName ?? '',
        source: data.source ? String(data.source) : 'cli',
      });
      out(id);
      return;
    }
    if (sub === 'list') {
      const rows = db.queryContentItems({
        brandId: flags.brand ? String(flags.brand) : null,
        status: flags.status ? String(flags.status) : null,
        limit: flags.limit ? Number(flags.limit) : 100,
      });
      if (flags.json) { out(JSON.stringify(rows, null, 2)); return; }
      if (!rows.length) { out('No content items.'); return; }
      for (const r of rows) {
        out(`[${r.status}] ${r.id}  ${r.brand_name || 'no brand'}  (${r.source}${r.format === 'markdown' ? ', markdown' : ''})`);
        out(`  ${r.title || '(untitled)'}`);
        if (r.notes) out(`  notes: ${r.notes.replace(/\n/g, ' ')}`);
        if (r.scheduled_for) out(`  scheduled: ${r.scheduled_for}`);
        if (r.release_url) out(`  live: ${r.release_url}`);
        out('');
      }
      return;
    }
    if (sub === 'update') {
      const id = positional[1];
      if (!id) die('content update requires an id');
      const row = db.getContentItemById(id);
      if (!row) die(`No content item ${id}`);
      if (row.postiz_post_id) die(`${id} is already in Postiz — delete and recreate to change content`);
      const data = readJsonArg(positional[2], 'content update');
      if (Array.isArray(data.media)) {
        // New absolute paths get copied into the store; existing store-relative
        // entries pass through unchanged.
        const { ingestMedia } = await import('./media-store.js');
        for (const m of data.media) {
          if (path.isAbsolute(String(m)) && !fs.existsSync(String(m))) die(`media file not found: ${m}`);
        }
        try {
          data.media = ingestMedia(id, data.media.map(String));
        } catch (err) {
          die(err.message);
        }
      }
      db.updateContentItem(id, data);
      out(`Updated ${id}`);
      return;
    }
    if (sub === 'rm') {
      // The chat flow's fix-a-mistake path is delete + recreate (no reschedule
      // via the public API), so a sent item's remote post goes too — same as
      // the dashboard's delete.
      const row = db.getContentItemById(positional[1]);
      if (row?.postiz_post_id) {
        const { postizEnabled, deletePost } = await import('./postiz-client.js');
        const config = cfg.loadConfig();
        if (postizEnabled(config)) {
          const r = await deletePost(config, row.postiz_post_id);
          if (!r.ok) out(`Warning: could not delete Postiz post ${row.postiz_post_id}: ${r.reason ?? r.status}`);
        }
      }
      const n = db.deleteContentItem(positional[1]);
      if (n) {
        const { removeItemMedia } = await import('./media-store.js');
        removeItemMedia(positional[1]);
      }
      out(n ? `Removed ${positional[1]}` : `No content item ${positional[1]}`);
      return;
    }
    if (sub === 'channels') {
      const { postizEnabled, listIntegrations } = await import('./postiz-client.js');
      const config = cfg.loadConfig();
      if (!postizEnabled(config)) die('Postiz not connected — add an API key in the dashboard Settings.');
      const r = await listIntegrations(config);
      if (!r.ok) die(`Postiz unreachable: ${r.reason}`);
      out(JSON.stringify(r.data, null, 2));
      return;
    }
    if (sub === 'platform-settings') {
      const integrationId = positional[1];
      if (!integrationId) die('content platform-settings requires an integration id (see content channels)');
      const { postizEnabled, getIntegrationSettings } = await import('./postiz-client.js');
      const config = cfg.loadConfig();
      if (!postizEnabled(config)) die('Postiz not connected — add an API key in the dashboard Settings.');
      const r = await getIntegrationSettings(config, integrationId);
      if (!r.ok) die(`Postiz unreachable: ${r.reason}`);
      out(JSON.stringify(r.data, null, 2));
      return;
    }
    if (sub === 'schedule') {
      const id = positional[1];
      if (!id) die('content schedule requires an id');
      // Free on purpose: Postiz adoption is good for us (future affiliate).
      const config = cfg.loadConfig();
      const { postizEnabled } = await import('./postiz-client.js');
      if (!postizEnabled(config)) die('Postiz not connected — add an API key in the dashboard Settings.');
      const { scheduleContentItem } = await import('./content-actions.js');
      const type = ['draft', 'schedule', 'now'].includes(flags.type) ? flags.type : 'schedule';
      const r = await scheduleContentItem(config, id, {
        type,
        date: flags.date ? String(flags.date) : undefined,
      });
      if (!r.ok) die(`${r.code}: ${r.message}`);
      out(`Sent ${id} to Postiz (${type}) — postiz post ${r.row.postiz_post_id ?? 'unknown'}`);
      return;
    }
    if (sub === 'sync') {
      const config = cfg.loadConfig();
      const { postizEnabled } = await import('./postiz-client.js');
      if (!postizEnabled(config)) die('Postiz not connected — add an API key in the dashboard Settings.');
      const { syncContentFromPostiz } = await import('./content-actions.js');
      const r = await syncContentFromPostiz(config);
      if (!r.ok) die(`${r.code}: ${r.message}`);
      out(`Synced ${r.synced}/${r.checked} pending item(s).`);
      return;
    }
    if (sub === 'posts') {
      // Remote view: what Postiz actually holds (DRAFT/QUEUE/PUBLISHED/ERROR,
      // one row per channel). This is how a schedule gets verified without
      // touching the API by hand. Postiz requires a date window.
      const { postizEnabled, listPosts } = await import('./postiz-client.js');
      const config = cfg.loadConfig();
      if (!postizEnabled(config)) die('Postiz not connected — add an API key in the dashboard Settings.');
      const startDate = new Date(flags.from ? String(flags.from) : Date.now() - 24 * 3600 * 1000);
      const endDate = new Date(flags.to ? String(flags.to) : Date.now() + 7 * 24 * 3600 * 1000);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) die('content posts: --from/--to must be ISO dates');
      const r = await listPosts(config, { startDate: startDate.toISOString(), endDate: endDate.toISOString() });
      if (!r.ok) die(`Postiz unreachable: ${r.reason}`);
      const posts = r.data?.posts ?? r.data ?? [];
      const arr = Array.isArray(posts) ? posts : [posts];
      if (flags.json) { out(JSON.stringify(arr, null, 2)); return; }
      if (!arr.length) { out('No Postiz posts in window.'); return; }
      for (const p of arr) {
        const provider = p.integration?.providerIdentifier ?? p.integration?.name ?? '?';
        const text = String(p.content ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 60);
        out(`${p.state}\t${p.publishDate}\t${provider}\t${p.id}\t${text}`);
      }
      return;
    }
    die('Unknown content subcommand. Use: add | list | update | rm | channels | platform-settings | schedule | sync | posts');
  },

  async dest(positional, flags) {
    const sub = positional[0];
    if (sub === 'seed') die('dest seed is gone — the venue playbook is served to Pro accounts; run: dest sync');
    if (sub === 'sync') {
      const { syncVenues } = await import('./venues-sync.js');
      const r = await syncVenues({ force: true });
      if (r.synced) out(`Synced ${r.count} venues (${r.added} added, ${r.updated} updated, ${r.removed} removed).`);
      else if (r.reason === 'pro_required') die('pro_required — the venue playbook is a Pro feature (see "license show").');
      else out(`No sync: ${r.reason}${r.count != null ? ` (${r.count} venues on file)` : ''}.`);
      return;
    }
    if (sub === 'admin-key') {
      const config = cfg.loadConfig();
      if (flags.clear) {
        config.venues = { ...config.venues, adminKey: '' };
        cfg.saveConfig(config);
        out('Admin key cleared — learnings stay local.');
        return;
      }
      const key = positional[1];
      if (!key) {
        out(config.venues?.adminKey ? 'Admin key set — dest update/add push to the shared playbook.' : 'No admin key (dest admin-key <key> to set; --clear to remove).');
        return;
      }
      config.venues = { ...config.venues, adminKey: String(key).trim() };
      cfg.saveConfig(config);
      out('Admin key saved — learnings from this machine now push to the shared playbook.');
      return;
    }
    if (sub === 'email') {
      const config = cfg.loadConfig();
      const addr = positional[1];
      const { EMAIL_RE, webmailUrlFor } = await import('./webmail.js');
      if (addr) {
        if (!EMAIL_RE.test(addr)) die(`"${addr}" doesn't look like an email address`);
        config.directories = { ...config.directories, signupEmail: addr.trim() };
        if (flags.webmail !== undefined) {
          const w = String(flags.webmail).trim();
          if (w && !/^https?:\/\//.test(w)) die('--webmail must be a full URL (https://…)');
          config.directories.webmailUrl = w;
        }
        cfg.saveConfig(config);
      }
      const email = config.directories?.signupEmail || '';
      if (!email) {
        out('No signup email set. Run: dest email <address> [--webmail url]');
        return;
      }
      const webmail = webmailUrlFor(email, config.directories?.webmailUrl);
      out(`Signup email: ${email}`);
      out(`Webmail: ${webmail || '(unknown provider - pass --webmail <url>, e.g. https://mail.google.com for Google Workspace)'}`);
      out('Make sure this inbox (and Google, for one-click OAuth signups) is signed in inside the Social Cue Chrome.');
      return;
    }
    if (sub === 'list') {
      const { isPro } = await import('./license.js');
      if (!isPro(cfg.loadConfig())) die('pro_required — the venue playbook is a Pro feature (see "license show").');
      const { syncVenues } = await import('./venues-sync.js');
      const sync = await syncVenues();
      const kind = flags.kind ? String(flags.kind) : null;
      const category = flags.category ? String(flags.category) : null;
      const fit = flags.fits ? String(flags.fits) : null;
      const rows = db.listDestinations({ kind, category, fit });
      if (flags.json) {
        out(JSON.stringify(rows.map(d => ({
          ...d, oauth_providers: db.destinationProviders(d), post_types: db.destinationPostTypes(d),
          fits: db.destinationFits(d),
        })), null, 2));
        return;
      }
      if (!rows.length) { out(`No destinations synced yet (${sync.reason || 'sync failed'}) — check "license show" and your network, then: dest sync --force`); return; }
      for (const d of rows) {
        const providers = db.destinationProviders(d);
        const signup = d.signup === null ? 'signup?'
          : d.signup === 'none' ? 'no account'
          : d.signup === 'email' ? 'email signup'
          : `${d.signup}${providers.length ? ` (${providers.join('/')})` : ''}`;
        const fits = db.destinationFits(d).join(',');
        out(`${d.id}\t${d.category ?? d.kind}\t${db.destinationPostTypes(d).join('/')}\t${fits}\t${d.cost ?? 'cost?'}\t${signup}\t${d.name}\t${d.submit_url || d.url}`);
      }
      return;
    }
    if (sub === 'add') {
      const url = positional[1];
      if (!url || !/^https?:\/\//.test(url)) die('dest add requires a full URL (https://…)');
      const { venueIdentityForUrl } = await import('./venues-sync.js');
      const ident = venueIdentityForUrl(url);
      const id = flags.id ? String(flags.id) : ident.id;
      if (db.getDestinationById(id)) die(`Destination "${id}" already exists`);
      try {
        db.addDestination({
          id,
          name: flags.name ? String(flags.name) : ident.name,
          url,
          submitUrl: flags['submit-url'] ? String(flags['submit-url']) : '',
          kind: flags.kind ? String(flags.kind) : 'directory',
          postTypes: flags['post-types'] ? String(flags['post-types']).split(',').map(t => t.trim()) : ['listing'],
          category: flags.category ? String(flags.category) : null,
          fits: flags.fits ? String(flags.fits).split(',').map(t => t.trim()) : [],
          cost: flags.cost ? String(flags.cost) : null,
        });
      } catch (err) {
        die(String(err?.message ?? err));
      }
      const { pushVenue, hasAdminKey } = await import('./venues-sync.js');
      if (hasAdminKey()) {
        const row = db.getDestinationById(id);
        const r = await pushVenue(id, {
          name: row.name, url: row.url, submitUrl: row.submit_url || '', kind: row.kind,
          postTypes: db.destinationPostTypes(row), category: row.category, fits: db.destinationFits(row), cost: row.cost,
        });
        out(r.pushed ? `${id} (pushed to shared playbook)` : `${id} (server push failed: ${r.reason})`);
        return;
      }
      out(id);
      return;
    }
    if (sub === 'update') {
      const id = positional[1];
      if (!id) die('dest update requires a destination id');
      if (!db.getDestinationById(id)) die(`No destination ${id}`);
      const data = readJsonArg(positional[2], 'dest update');
      const { pushVenue, hasAdminKey } = await import('./venues-sync.js');
      const admin = hasAdminKey();
      // Without an admin key, `notes` are the user's own learnings: they live
      // in local_notes so the next playbook sync can't overwrite them.
      const patch = {
        name: data.name,
        submitUrl: data.submitUrl,
        signup: data.signup,
        oauthProviders: data.oauthProviders,
        notes: admin ? data.notes : undefined,
        localNotes: data.localNotes !== undefined ? data.localNotes : (admin ? undefined : data.notes),
        kind: data.kind,
        postTypes: data.postTypes,
        category: data.category,
        fits: data.fits,
        cost: data.cost,
      };
      let n = 0;
      try {
        n = db.updateDestination(id, patch);
      } catch (err) {
        die(String(err?.message ?? err));
      }
      if (!n) { out(`Nothing to update for ${id}`); return; }
      if (admin) {
        // Carry the row's identity so a locally auto-registered venue (source
        // 'user') is created on the server instead of 404ing as unknown.
        const row = db.getDestinationById(id);
        const r = await pushVenue(id, { name: row.name, url: row.url, kind: row.kind, ...data });
        out(r.pushed ? `Updated ${id} (pushed to shared playbook)` : `Updated ${id} locally (server push failed: ${r.reason})`);
      } else {
        out(data.notes !== undefined && data.localNotes === undefined ? `Updated ${id} (notes saved as your local learnings)` : `Updated ${id}`);
      }
      return;
    }
    die('Unknown dest subcommand. Use: email [address] | sync [--force] | list [--kind k] | add <url> | update <id> <json|-> | admin-key <key|--clear>');
  },

  async post(positional, flags) {
    const sub = positional[0];
    if (sub === 'start') {
      // Pro-gated: posting anywhere is part of the paid action layer.
      const { isPro } = await import('./license.js');
      const config = cfg.loadConfig();
      if (!isPro(config)) {
        die('pro_required — Product Posts is a Pro feature (see "license show").');
      }
      const destRef = flags.dest ?? flags.dir;
      if (!destRef || destRef === true) die('post start requires --dest <slug|url> (and --subject <brand:ref | content:<id> | adhoc --name "…">)');
      const { resolveSubject, buildSearchHints } = await import('./post-subject.js');
      let subject, brand;
      try { ({ subject, brand } = resolveSubject(flags, config)); } catch (err) { die(String(err?.message ?? err)); }

      // Pull the shared playbook (throttled), then resolve the target — an
      // arbitrary URL auto-registers as a user destination.
      const { syncVenues } = await import('./venues-sync.js');
      const sync = await syncVenues();
      if (!db.listDestinations().length && !sync.synced) {
        die(`No venue playbook on file (${sync.reason || 'sync failed'}) — check "license show" and your network, then: dest sync --force`);
      }
      const ref = String(destRef);
      let destination = null;
      if (/^https?:\/\//.test(ref)) {
        const { venueIdentityForUrl } = await import('./venues-sync.js');
        const ident = venueIdentityForUrl(ref);
        const norm = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
        // Exact URL first; then the slug; then a host match — but only for
        // single-venue hosts (a github.com URL must never resolve to whichever
        // GitHub list happened to be registered first).
        destination = db.listDestinations().find(d => norm(d.url) === norm(ref) || norm(d.submit_url) === norm(ref))
          ?? db.getDestinationById(ident.id)
          ?? (ident.multiTenant ? null : db.listDestinations().find(d => d.url.includes(ident.host)))
          ?? db.getDestinationById(db.addDestination({ id: ident.id, name: ident.name, url: ref }));
      } else {
        destination = db.getDestinationById(ref.toLowerCase());
        if (!destination) die(`No destination "${ref}" — use a registry slug (dest list) or a full URL`);
      }
      const postTypes = db.destinationPostTypes(destination);
      const postType = flags.type && flags.type !== true ? String(flags.type) : postTypes[0];
      if (!db.POST_TYPES.includes(postType)) die(`invalid --type ${postType} (use ${db.POST_TYPES.join('|')})`);

      const existing = db.findActivePost(subject.key, destination.id);
      if (existing) {
        die(`Already ${existing.status} for ${subject.name} → ${destination.name} (post ${existing.id}). Failed/skipped attempts can be retried; active ones resume via "post update".`);
      }

      let postId;
      try {
        postId = db.createPost({
          subjectKind: subject.kind, subjectId: subject.id, subjectKey: subject.key,
          subjectName: subject.name, subjectUrl: subject.url, subjectPath: subject.path,
          brandId: brand?.id ?? null,
          destinationId: destination.id,
          destinationUrl: destination.submit_url || destination.url,
          postType,
        });
      } catch (err) {
        die(String(err?.message ?? err));
      }

      // Signup email = the address the user is signed into in the dedicated
      // Chrome (config.directories). Generated account credentials are only
      // needed when the site may take an email/password signup (signup
      // NULL/email/mixed) — OAuth-only and form-only sites skip them.
      const { webmailUrlFor } = await import('./webmail.js');
      const signupEmail = config.directories?.signupEmail || null;
      const webmailUrl = webmailUrlFor(signupEmail, config.directories?.webmailUrl) || null;
      const creds = await import('./credentials.js');
      const credKey = creds.credentialKeyFor(subject.key, destination);
      let credentials = null;
      let credentialsExisted = false;
      if (signupEmail && destination.signup !== 'none' && destination.signup !== 'oauth') {
        credentialsExisted = !!creds.getCredentials(credKey, destination.id);
        credentials = creds.ensureCredentials(credKey, destination.id, { email: signupEmail });
      }
      const signupNote = signupEmail
        ? null
        : 'No signup email configured - run: dest email <address> (the email the user is signed into in the Social Cue Chrome)';
      db.appendPostLog(postId, `started (${postType} → ${destination.submit_url || destination.url})`);

      const assets = await import('./asset-store.js');
      const assetDir = assets.subjectAssetDir(subject.key);
      out(JSON.stringify({
        postId,
        postType,
        subject,
        brand: brand ? {
          id: brand.id, name: brand.name, url: brand.url, tagline: brand.tagline,
          shortDescription: brand.shortDescription, aboutBrand: brand.aboutBrand,
          tags: brand.tags, projectPath: brand.projectPath || null,
        } : null,
        destination: {
          id: destination.id, name: destination.name, kind: destination.kind, url: destination.url,
          submitUrl: destination.submit_url || null,
          postTypes,
          signup: destination.signup ?? null,
          oauthProviders: db.destinationProviders(destination),
          category: destination.category ?? null,
          fits: db.destinationFits(destination),
          cost: destination.cost ?? null,
          notes: db.destinationNotesForBrief(destination),
          localNotes: destination.local_notes || '',
        },
        assets: {
          dir: assetDir,
          onFile: assets.listAssets(subject.key),
          searchHints: buildSearchHints(subject),
          saveCommand: `post asset add "${subject.key}" <role> </abs/file>`,
        },
        signupEmail,
        webmailUrl,
        password: credentials?.password ?? null,
        credentialsExisted,
        signupNote,
        dryRunPosts: !!config.dryRunPosts,
      }, null, 2));
      return;
    }
    if (sub === 'list') {
      const brandId = flags.brand ? (cfg.resolveBrand(String(flags.brand))?.id ?? String(flags.brand)) : null;
      const rows = db.queryPosts({
        brandId,
        subjectKey: flags.subject && flags.subject !== true ? String(flags.subject) : null,
        destinationKind: flags.kind ? String(flags.kind) : null,
        status: flags.status ? String(flags.status) : null,
        limit: flags.limit ? Number(flags.limit) : 100,
      });
      if (flags.json) { out(JSON.stringify(rows, null, 2)); return; }
      if (!rows.length) { out('No product posts.'); return; }
      for (const s of rows) {
        out(`[${s.status}] ${s.id}  ${s.subject_name} (${s.subject_kind})  → ${s.destination_name ?? s.destination_id ?? s.destination_url}  [${s.post_type}]`);
        if (s.email_used) out(`  email: ${s.email_used}`);
        if (s.listing_url) out(`  live: ${s.listing_url}`);
        const chk = s.listing_url ? db.latestCheck(s.id) : null;
        if (chk) out(`  checked ${chk.checked_at.slice(0, 10)}: ${chk.upvotes ?? '?'} pts, ${chk.reply_count ?? '?'} comments${chk.note ? ` — ${chk.note}` : ''}`);
        out('');
      }
      return;
    }
    if (sub === 'update') {
      const id = positional[1];
      if (!id) die('post update requires an id');
      if (!db.getPostById(id)) die(`No post ${id}`);
      const data = readJsonArg(positional[2], 'post update');
      let n = 0;
      try {
        n = db.updatePost(id, { status: data.status, emailUsed: data.emailUsed, listingUrl: data.listingUrl });
      } catch (err) {
        die(String(err?.message ?? err));
      }
      if (data.appendLog) n += db.appendPostLog(id, String(data.appendLog));
      out(n ? `Updated ${id}` : `Nothing to update for ${id} (pass status, emailUsed, listingUrl and/or appendLog)`);
      return;
    }
    if (sub === 'creds') {
      const id = positional[1];
      if (!id) die('post creds requires a post id');
      const row = db.getPostById(id);
      if (!row) die(`No post ${id}`);
      if (!row.destination_id) die(`Post ${id} has no destination id — no credentials stored`);
      const creds = await import('./credentials.js');
      const destination = db.getDestinationById(row.destination_id);
      const c = creds.getCredentials(creds.credentialKeyFor(row.subject_key, destination), row.destination_id);
      if (!c) { out('No stored credentials for this destination.'); return; }
      out(JSON.stringify(c, null, 2));
      return;
    }
    if (sub === 'assets') {
      const key = positional[1];
      if (!key) die('post assets requires a subject key (brand:<id> | content:<id> | adhoc:<slug>)');
      const assets = await import('./asset-store.js');
      let rows;
      try { rows = assets.listAssets(key); } catch (err) { die(String(err?.message ?? err)); }
      if (flags.json) { out(JSON.stringify({ dir: assets.subjectAssetDir(key), assets: rows }, null, 2)); return; }
      if (!rows.length) { out(`No assets on file for ${key} (${assets.subjectAssetDir(key)})`); return; }
      for (const a of rows) out(`${a.role}\t${a.width ? `${a.width}x${a.height}` : '-'}\t${a.bytes}B\t${a.absPath}`);
      return;
    }
    if (sub === 'asset') {
      const [, op, key, role, file] = positional;
      const assets = await import('./asset-store.js');
      if (op === 'add') {
        if (!key || !role || !file) die('post asset add <subjectKey> <role> </abs/path>');
        try { out(JSON.stringify(assets.ingestAsset(key, role, file), null, 2)); } catch (err) { die(String(err?.message ?? err)); }
        return;
      }
      if (op === 'rm') {
        if (!key || !role) die('post asset rm <subjectKey> <file>');
        out(assets.removeAsset(key, role) ? `Removed ${role}` : `No such asset ${role}`);
        return;
      }
      die('Unknown post asset op. Use: add <subjectKey> <role> </abs/path> | rm <subjectKey> <file>');
    }
    die('Unknown post subcommand. Use: start | list | update | creds | assets | asset add|rm');
  },

  guidance(positional) {
    const sub = positional[0];
    if (sub === 'path') {
      out(paths.voiceGuidancePath());
      return;
    }
    if (sub === 'init') {
      const r = guidance.ensureGuidance();
      out(r.created ? `Created ${r.path}` : `Already exists: ${r.path}`);
      return;
    }
    if (sub === 'show') {
      guidance.ensureGuidance();
      out(guidance.loadGuidance().trimEnd());
      return;
    }
    if (sub === 'add-example') {
      const arg = positional[1];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
      let { oppId, before = '', after, why = '', brandName = '', platform = '' } = data;
      if (oppId) {
        const row = db.getOpportunityById(oppId);
        if (!row) die(`No opportunity ${oppId}`);
        before = before || row.suggested_reply;
        after = after || row.user_reply;
        brandName = brandName || row.brand_name;
        platform = platform || row.platform;
      }
      if (!after || !String(after).trim()) die('add-example requires "after" (or an oppId whose reply was edited)');
      const r = guidance.appendExample({ brandName, platform, before, after, why });
      if (oppId) db.markExampleSaved(oppId);
      out(`Saved example to ${r.path} (${r.examples} example${r.examples === 1 ? '' : 's'} total${r.examples > 10 ? ' — over 10, consider distilling old ones into rules' : ''})`);
      return;
    }
    die('Unknown guidance subcommand. Use: path | show | init | add-example');
  },

  async brief(positional, flags) {
    const config = cfg.loadConfig();
    const brands = config.brands.filter(b => b.isActive);
    if (!brands.length) die('No active brands. Add one with: brand add --name ...');
    const platforms = config.platforms.map(resolvePlatform);
    const seenUrls = db.getRecentSeenUrls({ days: config.seenUrlsTtlDays, limit: 500 });
    const maxTurns = flags['max-turns'] ? Number(flags['max-turns']) : config.maxTurnsPerPlatform * platforms.length;
    // Founder invitations ride along in the brief on Pro (like voice guidance),
    // so the orchestrator needs no extra step; `lead brief` prints it alone.
    const { isPro } = await import('./license.js');
    const invitations = isPro(config) ? renderInvitationsSection(config, brands) : '';
    out(buildAutonomousDiscoveryPrompt(
      brands, platforms, config.autoLike, maxTurns, config.engagementRatio,
      config.strategyWeights, config.collectMemeIdeas, seenUrls, guidance.loadGuidance(),
      config.minScore, invitations
    ));
  },

  // Alias for tests/scripts: `leads` reads more naturally in `leads list`.
  async leads(positional, flags) { return HANDLERS.lead(positional, flags); },

  async lead(positional, flags) {
    const sub = positional[0];
    if (sub === 'brief') {
      const config = cfg.loadConfig();
      const { isPro } = await import('./license.js');
      if (!isPro(config)) {
        out('pro_required — founder invitations are a Pro feature (see "license show").');
        return;
      }
      const section = renderInvitationsSection(config, config.brands.filter(b => b.isActive));
      out(section || '(founder invitations are off — maxLeadsPerRun is 0 or there are no active brands)');
      return;
    }
    if (sub === 'list') {
      const rows = db.queryLeads({
        status: flags.status ? String(flags.status) : null,
        brandId: flags.brand ? (cfg.resolveBrand(String(flags.brand))?.id ?? String(flags.brand)) : null,
        limit: flags.limit ? Number(flags.limit) : 50,
      });
      if (flags.json) { out(JSON.stringify(rows, null, 2)); return; }
      if (!rows.length) { out('No leads.'); return; }
      for (const r of rows) {
        out(`[${r.status}] ${r.fitScore ?? '?'}/10  ${r.platform}  ${r.handle || r.profileUrl}  ${r.id}`);
        out(`  ${r.brandName || 'no brand'} · ${r.productName || 'product unknown'} · ${r.fitSummary}`);
        out(`  ${r.profileUrl}`);
      }
      return;
    }
    if (sub === 'show') {
      const row = db.getLeadById(positional[1] || '');
      if (!row) die(`No lead with id ${positional[1]}`);
      out(JSON.stringify(row, null, 2));
      return;
    }
    if (sub === 'update' || sub === 'status') {
      const id = positional[1];
      if (!id) die(`lead ${sub} requires a lead id`);
      let patch;
      if (sub === 'status') {
        patch = { status: positional[2] };
      } else {
        const raw = positional[2] === '-' || !positional[2] ? fs.readFileSync(0, 'utf8') : positional[2];
        try { patch = JSON.parse(raw); } catch { die('lead update: patch must be JSON'); }
      }
      let row;
      try { row = db.updateLead(id, patch); } catch (err) { die(String(err?.message ?? err)); }
      if (!row) die(`No lead with id ${id}`);
      out(`Updated lead ${id}: ${Object.keys(patch).join(', ')} → status ${row.status}`);
      return;
    }
    die('Unknown lead subcommand. Use: brief | list [--status s --brand b --limit N --json] | show <id> | status <id> <status> | update <id> <json|->');
  },
};
// Legacy names from the directory-submission era.
HANDLERS.dir = HANDLERS.dest;
HANDLERS.submission = HANDLERS.post;

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    out('socialdiscovery CLI — commands: config | brand | opp | seen | run | brief | bridge | license | perf | goals | content | dest | post | guidance');
    out('See lib/cli.js header for usage.');
    return;
  }
  const handler = HANDLERS[cmd];
  if (!handler) die(`Unknown command: ${cmd}`);
  const { positional, flags } = parseArgs(rest);
  // Refuse to conjure a brand-new store somewhere random: every command except
  // `config` (init/show) needs an existing .socialdiscovery/ — found by walking
  // up from cwd or via SOCIALCUE_DIR. Running `content add` from a scratch
  // folder used to silently create a second, empty store there.
  if (cmd !== 'config' && !process.env.SOCIALCUE_DIR && !cfg.configExists()) {
    die(`No Social Cue store found (looked for .socialdiscovery/config.json in ${process.cwd()} and its parents).\n` +
        'Run from your project directory, set SOCIALCUE_DIR=/abs/path/.socialdiscovery, or run "config init" here to create one.');
  }
  const result = handler(positional, flags);
  if (result && typeof result.catch === 'function') {
    result.catch(err => die(String(err?.message ?? err)));
  }
}

main();
