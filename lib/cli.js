#!/usr/bin/env node
/**
 * socialdiscovery CLI — the bridge the slash commands call via Bash.
 *
 * Commands (run as: node "${CLAUDE_PLUGIN_ROOT}/lib/cli.js" <cmd> ...):
 *   config init [--force]        create .socialdiscovery/config.json
 *   config show                  print config summary
 *   config path                  print resolved file paths
 *   brand add --name .. [--url --tagline --desc --about --tags a,b --project-path /abs/dir]
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
 *   bridge open [--port N]       ensure + open the dashboard in the default browser
 *   bridge stop                  stop a detached bridge
 *   bridge token [--rotate]      print (or regenerate) the pairing token
 *   bridge status                check whether the bridge is up
 *   license connect <token>      save the Pro account token + fetch a fresh key (--server url)
 *   license refresh              re-fetch a fresh key using the saved account token
 *   license activate <key>       verify + save a Pro license key directly
 *   license show                 print the license status
 *   perf due [--limit N]         posted replies due a performance check (Pro; JSON)
 *   perf record <oppId> [--upvotes N --replies N --note s]  record a check-in
 *   perf summary                 all posted replies with first/latest checks (JSON)
 *   content add <json|->         insert an original post (Content Strategy; agents use this —
 *                                { title, body, brandName?, channels?, settings?, scheduledFor?,
 *                                  media? (absolute paths — copied into .socialdiscovery/media/,
 *                                  originals safe to delete after), source? (agent name),
 *                                  variants? ({ [integrationId]: { content?, settings? } } —
 *                                  per-channel caption/settings for cross-posts) })
 *   content list [--brand id --status s --json]
 *   content update <id> <json|-> update fields (refused once the item is in Postiz)
 *   content rm <id>
 *   content channels             list connected Postiz channels (JSON)
 *   content platform-settings <integrationId>  live per-platform schema/rules from Postiz (JSON)
 *   content schedule <id> [--type draft|schedule|now --date ISO]  hand to Postiz (Pro)
 *   content sync                 pull status/analytics back from Postiz (Pro)
 *   dir email [address] [--webmail url]  set (or show) the directory-signup email — the address
 *                                the user is signed into in the dedicated Chrome — and its webmail URL
 *   dir seed                     load the bundled registry (idempotent; user rows/edits survive)
 *   dir list [--json]
 *   dir add <url> [--name n --submit-url u]   register an arbitrary directory site
 *   dir update <id> <json|->     patch { name?, submitUrl?, signup?, oauthProviders?, testStatus?, notes? }
 *   submission start --brand <ref> --dir <slug|url>  (Pro) open an attempt; prints the JSON brief
 *   submission list [--brand ref --status s --json]
 *   submission update <id> <json|->  patch { status?, emailUsed?, listingUrl?, appendLog? }
 *   submission creds <id>        print the stored account credentials (local only, never the bridge)
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
import { buildAutonomousDiscoveryPrompt } from '../vendor/shared/prompts.js';
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
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function out(s) { process.stdout.write(s + '\n'); }
function die(s, code = 1) { process.stderr.write(s + '\n'); process.exit(code); }

const PLATFORM_ALIASES = {
  reddit: 'reddit.com', twitter: 'twitter.com', x: 'x.com', linkedin: 'linkedin.com',
  facebook: 'facebook.com', instagram: 'instagram.com', youtube: 'youtube.com',
  hn: 'news.ycombinator.com', hackernews: 'news.ycombinator.com', producthunt: 'producthunt.com',
  indiehackers: 'indiehackers.com', threads: 'threads.net', mastodon: 'mastodon.social',
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
    out(`Max turns/platform: ${config.maxTurnsPerPlatform} | engagementRatio: ${config.engagementRatio}`);
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
      });
      out(`Added brand "${brand.name}" (${brand.id})`);
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
    die('Unknown brand subcommand. Use: add | list | rm');
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
      const { ensureBridge, openInDefaultBrowser } = await import('./bridge-launcher.js');
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
        const opened = await openInDefaultBrowser(r.dashboardUrl);
        out(opened ? '(opened in your default browser)' : "(couldn't auto-open a browser — use the link above)");
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
      if (info.pro) out(`Pro (${info.email}, issued ${info.issued}, valid to ${info.expires})`);
      else out(info.expired ? 'Free — Pro key expired (run "license refresh" or reconnect)' : 'Free — no license');
      return;
    }
    die('Unknown license subcommand. Use: connect <token> [--server url] | refresh | activate <key> | show');
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
      if (!id) die('perf record requires an opportunity id');
      if (!db.getOpportunityById(id)) die(`No opportunity with id ${id}`);
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
    die('Unknown perf subcommand. Use: due [--limit N] | record <oppId> [--upvotes N --replies N --note s] | summary');
  },

  async content(positional, flags) {
    const sub = positional[0];
    if (sub === 'add') {
      const arg = positional[1];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
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
        out(`[${r.status}] ${r.id}  ${r.brand_name || 'no brand'}  (${r.source})`);
        out(`  ${r.title || '(untitled)'}`);
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
      const arg = positional[2];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
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
    die('Unknown content subcommand. Use: add | list | update | rm | channels | platform-settings | schedule | sync');
  },

  async dir(positional, flags) {
    const sub = positional[0];
    if (sub === 'seed') {
      const list = JSON.parse(fs.readFileSync(new URL('../data/directories.json', import.meta.url), 'utf8'));
      const added = db.seedDirectories(list);
      out(`Seeded ${added} new director${added === 1 ? 'y' : 'ies'} (${list.length} in registry).`);
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
        out('No directory-signup email set. Run: dir email <address> [--webmail url]');
        return;
      }
      const webmail = webmailUrlFor(email, config.directories?.webmailUrl);
      out(`Signup email: ${email}`);
      out(`Webmail: ${webmail || '(unknown provider - pass --webmail <url>, e.g. https://mail.google.com for Google Workspace)'}`);
      out('Make sure this inbox (and Google, for one-click OAuth signups) is signed in inside the Social Cue Chrome.');
      return;
    }
    if (sub === 'list') {
      const rows = db.listDirectories();
      if (flags.json) {
        out(JSON.stringify(rows.map(d => ({ ...d, oauth_providers: db.directoryProviders(d) })), null, 2));
        return;
      }
      if (!rows.length) { out('No directories — run: dir seed'); return; }
      for (const d of rows) {
        const providers = db.directoryProviders(d);
        const signup = d.signup === null ? 'signup?'
          : d.signup === 'none' ? 'no account'
          : d.signup === 'email' ? 'email signup'
          : `${d.signup}${providers.length ? ` (${providers.join('/')})` : ''}`;
        const tested = d.test_status ? ` [${d.test_status}]` : '';
        out(`${d.id}\t${signup}${tested}\t${d.name}\t${d.submit_url || d.url}`);
      }
      return;
    }
    if (sub === 'add') {
      const url = positional[1];
      if (!url || !/^https?:\/\//.test(url)) die('dir add requires a full URL (https://…)');
      const host = new URL(url).hostname.replace(/^www\./, '');
      const id = flags.id ? String(flags.id) : host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      if (db.getDirectoryById(id)) die(`Directory "${id}" already exists`);
      db.addDirectory({
        id,
        name: flags.name ? String(flags.name) : host,
        url,
        submitUrl: flags['submit-url'] ? String(flags['submit-url']) : '',
      });
      out(id);
      return;
    }
    if (sub === 'update') {
      const id = positional[1];
      if (!id) die('dir update requires a directory id');
      if (!db.getDirectoryById(id)) die(`No directory ${id}`);
      const arg = positional[2];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
      let n = 0;
      try {
        n = db.updateDirectory(id, {
          name: data.name,
          submitUrl: data.submitUrl,
          signup: data.signup,
          oauthProviders: data.oauthProviders,
          testStatus: data.testStatus,
          notes: data.notes,
        });
      } catch (err) {
        die(String(err?.message ?? err));
      }
      out(n ? `Updated ${id}` : `Nothing to update for ${id}`);
      return;
    }
    die('Unknown dir subcommand. Use: email [address] | seed | list | add <url> | update <id> <json|->');
  },

  async submission(positional, flags) {
    const sub = positional[0];
    if (sub === 'start') {
      // Pro-gated: directory submission is part of the paid action layer.
      const { isPro } = await import('./license.js');
      const config = cfg.loadConfig();
      if (!isPro(config)) {
        die('pro_required — directory submission is a Pro feature (see "license show").');
      }
      if (!flags.brand || !flags.dir) die('submission start requires --brand <idOrName> and --dir <slug|url>');
      const resolved = cfg.resolveBrand(String(flags.brand));
      if (!resolved) die(`No brand matches "${flags.brand}"`);
      const brand = config.brands.find(b => b.id === resolved.id);

      // Make sure the bundled registry is loaded, then resolve the target —
      // an arbitrary URL auto-registers as a user directory.
      const seedList = JSON.parse(fs.readFileSync(new URL('../data/directories.json', import.meta.url), 'utf8'));
      db.seedDirectories(seedList);
      const dirRef = String(flags.dir);
      let directory = null;
      if (/^https?:\/\//.test(dirRef)) {
        const host = new URL(dirRef).hostname.replace(/^www\./, '');
        const slug = host.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        directory = db.getDirectoryById(slug)
          ?? db.listDirectories().find(d => d.url.includes(host))
          ?? db.getDirectoryById(db.addDirectory({ id: slug, name: host, url: dirRef }));
      } else {
        directory = db.getDirectoryById(dirRef.toLowerCase());
        if (!directory) die(`No directory "${dirRef}" — use a registry slug (dir list) or a full URL`);
      }

      const existing = db.findActiveSubmission(brand.id, directory.id);
      if (existing) {
        die(`Already ${existing.status} for ${brand.name} → ${directory.name} (submission ${existing.id}). Failed/skipped attempts can be retried; active ones resume via "submission update".`);
      }

      const submissionId = db.createSubmission({
        brandId: brand.id,
        brandName: brand.name,
        directoryId: directory.id,
        directoryUrl: directory.submit_url || directory.url,
      });

      // Signup email = the address the user is signed into in the dedicated
      // Chrome (config.directories). Generated directory-account credentials
      // are only needed when the site may take an email/password signup
      // (signup NULL/email/mixed) — OAuth-only and form-only sites skip them.
      const { webmailUrlFor } = await import('./webmail.js');
      const signupEmail = config.directories?.signupEmail || null;
      const webmailUrl = webmailUrlFor(signupEmail, config.directories?.webmailUrl) || null;
      let credentials = null;
      let credentialsExisted = false;
      if (signupEmail && directory.signup !== 'none' && directory.signup !== 'oauth') {
        const creds = await import('./credentials.js');
        credentialsExisted = !!creds.getCredentials(brand.id, directory.id);
        credentials = creds.ensureCredentials(brand.id, directory.id, { email: signupEmail });
      }
      const signupNote = signupEmail
        ? null
        : 'No signup email configured - run: dir email <address> (the email the user is signed into in the Social Cue Chrome)';
      db.appendSubmissionLog(submissionId, `started (target: ${directory.submit_url || directory.url})`);

      out(JSON.stringify({
        submissionId,
        brand: {
          id: brand.id, name: brand.name, url: brand.url, tagline: brand.tagline,
          shortDescription: brand.shortDescription, aboutBrand: brand.aboutBrand,
          tags: brand.tags, projectPath: brand.projectPath || null,
        },
        directory: {
          id: directory.id, name: directory.name, url: directory.url,
          submitUrl: directory.submit_url || null,
          signup: directory.signup ?? null,
          oauthProviders: db.directoryProviders(directory),
          testStatus: directory.test_status ?? null,
          notes: directory.notes || '',
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
      const rows = db.querySubmissions({
        brandId,
        status: flags.status ? String(flags.status) : null,
        limit: flags.limit ? Number(flags.limit) : 100,
      });
      if (flags.json) { out(JSON.stringify(rows, null, 2)); return; }
      if (!rows.length) { out('No submissions.'); return; }
      for (const s of rows) {
        out(`[${s.status}] ${s.id}  ${s.brand_name}  → ${s.directory_id ?? s.directory_url}`);
        if (s.email_used) out(`  email: ${s.email_used}`);
        if (s.listing_url) out(`  listing: ${s.listing_url}`);
        out('');
      }
      return;
    }
    if (sub === 'update') {
      const id = positional[1];
      if (!id) die('submission update requires an id');
      if (!db.getSubmissionById(id)) die(`No submission ${id}`);
      const arg = positional[2];
      const json = arg === '-' || arg === undefined ? fs.readFileSync(0, 'utf8') : arg;
      const data = JSON.parse(json);
      let n = 0;
      try {
        n = db.updateSubmission(id, { status: data.status, emailUsed: data.emailUsed, listingUrl: data.listingUrl });
      } catch (err) {
        die(String(err?.message ?? err));
      }
      if (data.appendLog) n += db.appendSubmissionLog(id, String(data.appendLog));
      out(n ? `Updated ${id}` : `Nothing to update for ${id} (pass status, emailUsed, listingUrl and/or appendLog)`);
      return;
    }
    if (sub === 'creds') {
      const id = positional[1];
      if (!id) die('submission creds requires a submission id');
      const row = db.getSubmissionById(id);
      if (!row) die(`No submission ${id}`);
      if (!row.directory_id) die(`Submission ${id} has no directory id — no credentials stored`);
      const creds = await import('./credentials.js');
      const c = creds.getCredentials(row.brand_id, row.directory_id);
      if (!c) { out('No stored credentials for this brand+directory.'); return; }
      out(JSON.stringify(c, null, 2));
      return;
    }
    die('Unknown submission subcommand. Use: start | list | update | creds');
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

  brief(positional, flags) {
    const config = cfg.loadConfig();
    const brands = config.brands.filter(b => b.isActive);
    if (!brands.length) die('No active brands. Add one with: brand add --name ...');
    const platforms = config.platforms.map(resolvePlatform);
    const seenUrls = db.getRecentSeenUrls({ days: config.seenUrlsTtlDays, limit: 500 });
    const maxTurns = flags['max-turns'] ? Number(flags['max-turns']) : config.maxTurnsPerPlatform * platforms.length;
    out(buildAutonomousDiscoveryPrompt(
      brands, platforms, config.autoLike, maxTurns, config.engagementRatio,
      config.strategyWeights, config.collectMemeIdeas, seenUrls, guidance.loadGuidance()
    ));
  },
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    out('socialdiscovery CLI — commands: config | brand | opp | seen | run | brief | bridge | license | perf | content | dir | submission | guidance');
    out('See lib/cli.js header for usage.');
    return;
  }
  const handler = HANDLERS[cmd];
  if (!handler) die(`Unknown command: ${cmd}`);
  const { positional, flags } = parseArgs(rest);
  const result = handler(positional, flags);
  if (result && typeof result.catch === 'function') {
    result.catch(err => die(String(err?.message ?? err)));
  }
}

main();
