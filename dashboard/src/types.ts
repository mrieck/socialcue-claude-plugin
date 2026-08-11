/** Mirrors the bridge API (camelCase mapping of the SQLite rows). */

export interface Opportunity {
  id: string;
  brandId: string | null;
  brandName: string;
  runId: string | null;
  source: 'plugin' | 'extension';
  platform: string;
  platformUrl: string;
  title: string;
  context: string;
  opportunityType: string;
  relevanceScore: number | null;
  relevanceReason: string;
  suggestedReply: string;
  suggestedAction: string;
  /** The user's rewrite; null = untouched. Effective reply = userReply ?? suggestedReply. */
  userReply: string | null;
  replyNote: string;
  exampleSavedAt: string | null;
  status: CanonicalStatus;
  screenshotPath: string | null;
  createdAt: string;
  publishedAt: string | null;
  postedIntentAt: string | null;
  kind: OpportunityKind;
  venueId: string | null;
}

export type OpportunityKind = 'reply' | 'recommendation';

export interface LicenseInfo {
  pro: boolean;
  email?: string;
  issued?: string;
  expires?: string;
  expired?: boolean;
}

export interface PostIntentResult {
  id: string;
  opened: boolean;
  prefilled: boolean;
  submitted: boolean;
  method: string | null;
  status: CanonicalStatus;
  postedIntentAt: string | null;
  message: string;
}

export type CanonicalStatus = 'new' | 'reviewed' | 'approved' | 'posted' | 'skipped' | 'failed';

export const CANONICAL_STATUSES: CanonicalStatus[] = [
  'new', 'reviewed', 'approved', 'posted', 'skipped', 'failed',
];

export interface Brand {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
}

export interface Filters {
  status: string;    // '' = all
  notStatus: string; // comma-separated statuses to exclude, '' = none
  platform: string;  // '' = all
  brand: string;     // brand id, '' = all
  source: string;    // '' = all
  kind: string;      // '' = all ('reply' | 'recommendation')
}

/** Sidebar badge counts (from /api/changes). */
export interface Counts {
  opportunities: number;   // new replies
  submitted: number;       // posted
  content: number;         // content ideas/drafts + fresh "places to post" nudges
}

export type View = 'opportunities' | 'submitted' | 'content' | 'settings';

/** A brand as shown on the read-only Settings page (richer than the label Brand). */
export interface BrandDetail {
  id: string;
  name: string;
  url: string;
  tagline: string;
  shortDescription: string;
  aboutBrand: string;
  tags: string[];
  isActive: boolean;
}

/** Read-only snapshot of the config a discovery run will use. */
export interface Settings {
  brands: BrandDetail[];
  platforms: string[];
  strategyWeights: Record<string, number>;
  engagementRatio: number | null;
  maxTurnsPerPlatform: number | null;
  /** Assisted posting never clicks submit — pre-fill only, still marked posted. */
  dryRunPosts: boolean;
  cdpUrl: string;
  /** Connection state only — the API key is never sent to the dashboard. */
  postiz?: PostizStatus;
}

/* ---------- Content Strategy (original posts via Postiz) ---------- */

export type ContentStatus = 'idea' | 'draft' | 'scheduled' | 'published' | 'failed';

export const CONTENT_STATUSES: ContentStatus[] = [
  'idea', 'draft', 'scheduled', 'published', 'failed',
];

/** An original post drafted locally and (optionally) scheduled via Postiz. */
export interface ContentItem {
  id: string;
  brandId: string | null;
  brandName: string;
  title: string;
  body: string;
  /** Postiz integration ids this post targets. */
  channels: string[];
  /** Per-integration Postiz settings, e.g. { [id]: { __type: 'reddit', subreddit: [...] } }. */
  settings: Record<string, unknown>;
  status: ContentStatus;
  scheduledFor: string | null;
  postizPostId: string | null;
  releaseUrl: string | null;
  venueId: string | null;
  /** Latest analytics snapshot from Postiz (shape varies by platform). */
  metrics: Record<string, unknown>;
  /** Local file attachments (absolute paths), uploaded to Postiz on schedule. */
  media: string[];
  /** Who created it: 'user' (dashboard), 'cli', or an agent name like 'meme-agent'. */
  source: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  publishedAt: string | null;
  lastSyncedAt: string | null;
}

/** A connected Postiz channel. */
export interface PostizChannel {
  id: string;
  name: string;
  /** Platform key, e.g. 'reddit', 'x'. Postiz calls this `identifier`. */
  identifier: string;
  disabled?: boolean;
}

export interface PostizStatus {
  connected: boolean;
  apiUrl: string;
  /** Brand id -> Postiz integration ids for that brand's accounts. */
  channelMap: Record<string, string[]>;
}

/** One posted reply with its first and latest performance check-in (Pro).
 *  Keyed by opportunity id; decorates the Submitted view's rows and detail pane. */
export interface PerformanceRow {
  id: string;
  platform: string;
  platformUrl: string;
  title: string;
  brandName: string;
  postedAt: string;
  firstUpvotes: number | null;
  firstReplies: number | null;
  upvotes: number | null;
  replies: number | null;
  checkedAt: string | null;
  note: string;
  checks: number;
}
