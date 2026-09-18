/**
 * Feed the venue playbook from what happens to product posts. Called after
 * every `post update` (CLI and bridge): a stated review time at submit
 * becomes the venue's `reviewEta`; live/failed becomes a recorded outcome
 * (days from submit → live, or the failure note). The local mirror updates
 * at once; with the admin key the same lands on the shared playbook.
 */
import * as db from './db.js';
import { hasAdminKey, pushVenue, pushVenueOutcome } from './venues-sync.js';

const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

/**
 * @param before the post row before the update
 * @param patch  what `post update` was given ({ status?, reviewEta?, appendLog? })
 * @returns {Promise<string[]>} human-readable lines about what was recorded
 */
export async function recordPostExperience(before, patch = {}) {
  const after = db.getPostById(before.id);
  const venueId = after?.destination_id;
  const venue = venueId ? db.getDestinationById(venueId) : null;
  if (!after || !venue) return [];
  const lines = [];
  // Without the admin key, review_eta/outcomes are server-owned and the next
  // sync would overwrite them — the user's own experience goes to local_notes,
  // which sync never touches, and nothing leaves the machine.
  const admin = hasAdminKey();
  const localLine = async text => {
    const local = (db.getDestinationById(venueId).local_notes ?? '').trim();
    db.updateDestination(venueId, { localNotes: local ? `${local}\n${text}` : text });
  };

  if (patch.reviewEta && patch.reviewEta !== venue.review_eta) {
    if (admin) {
      db.updateDestination(venueId, { reviewEta: patch.reviewEta });
      const r = await pushVenue(venueId, { reviewEta: patch.reviewEta });
      lines.push(`playbook ${venueId}: review time "${patch.reviewEta}"${r.pushed ? ' (shared)' : ` (push failed: ${r.reason})`}`);
    } else {
      await localLine(`${new Date().toISOString().slice(0, 10)}: site said review "${patch.reviewEta}"`);
      lines.push(`your learnings ${venueId}: review time "${patch.reviewEta}"`);
    }
  }

  const became = patch.status && patch.status !== before.status ? patch.status : null;
  const result = became === 'live' ? 'live' : became === 'failed' ? 'failed' : null;
  if (result) {
    const outcome = { at: new Date().toISOString(), result };
    if (result === 'live' && after.submitted_at) outcome.days = daysBetween(after.submitted_at, after.verified_at ?? outcome.at);
    if (patch.appendLog) outcome.note = String(patch.appendLog).slice(0, 300);
    // A rejection is a failure the site decided on — keep the distinction for the brief.
    if (result === 'failed' && /reject|declin|not approved|denied/i.test(outcome.note ?? '')) outcome.result = 'rejected';
    const summary = `${outcome.result}${outcome.days != null ? ` after ${outcome.days} day(s)` : ''}${outcome.note ? ` — ${outcome.note}` : ''}`;
    if (admin) {
      db.addDestinationOutcome(venueId, outcome);
      const r = await pushVenueOutcome(venueId, outcome);
      lines.push(`playbook ${venueId}: ${summary}${r.pushed ? ' (shared)' : ` (push failed: ${r.reason})`}`);
    } else {
      await localLine(`${outcome.at.slice(0, 10)}: ${summary}`);
      lines.push(`your learnings ${venueId}: ${summary}`);
    }
  }
  return lines;
}
