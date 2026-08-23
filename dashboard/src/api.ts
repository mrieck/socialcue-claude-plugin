/**
 * Bridge API client. The pairing token arrives once via the URL fragment
 * (`/#token=…`, printed by `bridge start`), is stashed in localStorage, and the
 * fragment is stripped so it never lingers in the address bar or history.
 */
import type { Brand, BrandDetail, CanonicalStatus, ContentItem, ContentStatus, Counts, Directory, DirectorySettings, Filters, LicenseInfo, Opportunity, PerformanceRow, PostIntentResult, PostizChannel, PostizStatus, Settings, Submission, SubmissionStatus } from './types';

const TOKEN_KEY = 'sc-bridge-token';

export function bootstrapToken(): string | null {
  const m = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
  if (m) {
    localStorage.setItem(TOKEN_KEY, m[1]);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch { /* not json */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export function getOpportunities(filters: Filters): Promise<Opportunity[]> {
  const q = new URLSearchParams();
  if (filters.status) q.set('status', filters.status);
  if (filters.notStatus) q.set('notStatus', filters.notStatus);
  if (filters.platform) q.set('platform', filters.platform);
  if (filters.brand) q.set('brand', filters.brand);
  if (filters.source) q.set('source', filters.source);
  if (filters.kind) q.set('kind', filters.kind);
  q.set('limit', '200');
  return api<{ opportunities: Opportunity[] }>(`api/opportunities?${q}`).then(r => r.opportunities);
}

/** Bulk-skip every reply that isn't posted/skipped — the "Clear all" button. */
export function clearOpportunities(): Promise<{ skipped: number }> {
  return api('api/opportunities/clear', { method: 'POST', body: JSON.stringify({}) });
}

export interface OpportunityPatch {
  status?: CanonicalStatus;
  /** null reverts to the original generated draft. */
  userReply?: string | null;
  replyNote?: string;
}

/** Partial update of status and/or the user's review fields. Returns the updated row. */
export function patchOpportunity(id: string, patch: OpportunityPatch): Promise<Opportunity> {
  return api(`api/opportunities/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function patchStatus(id: string, status: CanonicalStatus): Promise<Opportunity> {
  return patchOpportunity(id, { status });
}

/** Promote the user's rewrite into a voice-guidance golden example. */
export function saveExample(id: string, why?: string): Promise<{ id: string; exampleSavedAt: string; examples: number }> {
  return api(`api/opportunities/${encodeURIComponent(id)}/save-example`, {
    method: 'POST',
    body: JSON.stringify(why ? { why } : {}),
  });
}

export function getBrands(): Promise<Brand[]> {
  return api<{ brands: Brand[] }>('api/brands').then(r => r.brands);
}

export function getSettings(): Promise<Settings> {
  return api<Settings>('api/settings');
}

export interface BrandPatch {
  name?: string;
  url?: string;
  tagline?: string;
  shortDescription?: string;
  aboutBrand?: string;
  tags?: string[];
  projectPath?: string;
  isActive?: boolean;
}

/** Edit one brand's profile in place (Settings tab). */
export function patchBrand(id: string, patch: BrandPatch): Promise<BrandDetail> {
  return api<{ brand: BrandDetail }>(`api/brands/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then(r => r.brand);
}

export interface RunSettingsPatch {
  platforms?: string[];
  strategyWeights?: { search: number; feed: number; trending: number };
  engagementRatio?: number;
  maxTurnsPerPlatform?: number;
  dryRunPosts?: boolean;
}

/** Save the discovery run knobs (Settings tab) straight into config.json. */
export function saveRunSettings(patch: RunSettingsPatch): Promise<{
  platforms: string[];
  strategyWeights: Record<string, number>;
  engagementRatio: number;
  maxTurnsPerPlatform: number;
}> {
  return api('api/settings/run', { method: 'PATCH', body: JSON.stringify(patch) });
}

export function getChanges(): Promise<{ dataVersion: number; counts: Counts }> {
  return api<{ dataVersion: number; counts: Counts }>('api/changes');
}

export function getLicense(): Promise<LicenseInfo> {
  return api<LicenseInfo>('api/license');
}

export function activateLicense(key: string): Promise<LicenseInfo> {
  return api<LicenseInfo>('api/license', { method: 'POST', body: JSON.stringify({ key }) });
}

/** Save the Pro account token and fetch a fresh key in one step. */
export function connectLicense(token: string): Promise<LicenseInfo> {
  return api<LicenseInfo>('api/license/connect', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Fetch an opportunity's screenshot (with the token in the header, not the URL)
 * and return an object URL for an <img>. Caller must URL.revokeObjectURL it.
 */
export async function fetchScreenshotUrl(id: string): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const res = await fetch(`api/opportunities/${encodeURIComponent(id)}/screenshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return URL.createObjectURL(await res.blob());
}

/** Reply performance check-ins (Pro). Throws ApiError(403 'pro_required') on free. */
export function getPerformance(): Promise<PerformanceRow[]> {
  return api<{ performance: PerformanceRow[] }>('api/performance').then(r => r.performance);
}

/** Assisted posting (Pro): open + pre-fill in the dedicated browser.
 *  Pass submit: true to also click the platform's submit control. */
export function postIntent(id: string, opts: { submit?: boolean } = {}): Promise<PostIntentResult> {
  return api<PostIntentResult>(`api/opportunities/${encodeURIComponent(id)}/post`, {
    method: 'POST',
    body: JSON.stringify(opts.submit ? { submit: true } : {}),
  });
}

/* ---------- Content Strategy (original posts via Postiz) ---------- */

export interface ContentPatch {
  brandId?: string | null;
  title?: string;
  body?: string;
  channels?: string[];
  settings?: Record<string, unknown>;
  status?: ContentStatus;
  scheduledFor?: string | null;
}

export function getContent(filters: { brand?: string; status?: string } = {}): Promise<ContentItem[]> {
  const q = new URLSearchParams();
  if (filters.brand) q.set('brand', filters.brand);
  if (filters.status) q.set('status', filters.status);
  q.set('limit', '200');
  return api<{ items: ContentItem[] }>(`api/content?${q}`).then(r => r.items);
}

export function createContent(item: ContentPatch): Promise<ContentItem> {
  return api<ContentItem>('api/content', { method: 'POST', body: JSON.stringify(item) });
}

export function patchContent(id: string, patch: ContentPatch): Promise<ContentItem> {
  return api<ContentItem>(`api/content/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteContent(id: string): Promise<{ id: string; deleted: boolean; remoteDeleted: boolean }> {
  return api(`api/content/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Upload one attachment (raw bytes; JSON content-type would be wrong here). */
export async function uploadContentMedia(id: string, file: File): Promise<ContentItem> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const res = await fetch(
    `api/content/${encodeURIComponent(id)}/media?filename=${encodeURIComponent(file.name)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: file },
  );
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = ((await res.json()) as { error?: string }).error ?? detail; } catch { /* not json */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<ContentItem>;
}

export function removeContentMedia(id: string, entry: string): Promise<ContentItem> {
  return api<ContentItem>(
    `api/content/${encodeURIComponent(id)}/media?entry=${encodeURIComponent(entry)}`,
    { method: 'DELETE' },
  );
}

/** Hand a draft to Postiz (Pro): 'draft' | 'schedule' | 'now'. */
export function scheduleContent(
  id: string,
  opts: { type: 'draft' | 'schedule' | 'now'; date?: string },
): Promise<ContentItem> {
  return api<ContentItem>(`api/content/${encodeURIComponent(id)}/schedule`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

/** Pull status/analytics back from Postiz (Pro). */
export function syncContent(force = false): Promise<{ synced: number; skipped?: string }> {
  return api(`api/content/sync${force ? '?force=1' : ''}`, { method: 'POST', body: JSON.stringify({}) });
}

export function getPostizStatus(): Promise<PostizStatus> {
  return api<PostizStatus>('api/postiz/status');
}

/** Validate + save a Postiz API key. The key is write-only: never returned. */
export function connectPostiz(apiKey: string, apiUrl?: string): Promise<{ connected: boolean; apiUrl: string; channels: PostizChannel[] }> {
  return api('api/postiz/connect', {
    method: 'POST',
    body: JSON.stringify(apiUrl ? { apiKey, apiUrl } : { apiKey }),
  });
}

export function disconnectPostiz(): Promise<{ connected: boolean }> {
  return api('api/postiz/disconnect', { method: 'POST', body: JSON.stringify({}) });
}

export function getPostizChannels(): Promise<PostizChannel[]> {
  return api<{ channels: PostizChannel[] }>('api/postiz/integrations').then(r => r.channels);
}

/** Save the brand ↔ Postiz-account association. */
export function savePostizChannelMap(
  channelMap: Record<string, string[]>,
): Promise<{ channelMap: Record<string, string[]> }> {
  return api('api/postiz/channel-map', { method: 'POST', body: JSON.stringify({ channelMap }) });
}

/* ---------- Directory submission (Pro "submit anywhere") ---------- */

export function getDirectories(): Promise<Directory[]> {
  return api<{ directories: Directory[] }>('api/directories').then(r => r.directories);
}

/** Submission attempts (Pro). Throws ApiError(403 'pro_required') on free. */
export function getSubmissions(brand?: string): Promise<Submission[]> {
  const q = brand ? `?brand=${encodeURIComponent(brand)}` : '';
  return api<{ submissions: Submission[] }>(`api/submissions${q}`).then(r => r.submissions);
}

/** Status-level edits only (mark live/skipped, paste the listing URL). */
export function patchSubmission(
  id: string,
  patch: { status?: SubmissionStatus; listingUrl?: string },
): Promise<Submission> {
  return api<{ submission: Submission }>(`api/submissions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then(r => r.submission);
}

/** Save the directory-signup email / webmail URL (free — setup, not acting). */
export function saveDirectorySettings(patch: { signupEmail?: string; webmailUrl?: string }): Promise<DirectorySettings> {
  return api('api/settings/directories', { method: 'PATCH', body: JSON.stringify(patch) });
}
