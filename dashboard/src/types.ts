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
  /** Text read from the post media by local OCR at collection time (lossy). */
  ocrText: string | null;
}

export type OpportunityKind = 'reply' | 'recommendation';

export interface LicenseInfo {
  pro: boolean;
  email?: string;
  issued?: string;
  expires?: string;
  expired?: boolean;
  /** Maintainer machine (admin key set): the free-tier preview switch exists. */
  canPreviewFree?: boolean;
  /** Preview is on: the Pro key is fine but everything answers as free. */
  previewFree?: boolean;
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

export type View = 'opportunities' | 'submitted' | 'content' | 'posts' | 'settings';

/** A brand as shown on the read-only Settings page (richer than the label Brand). */
export interface BrandDetail {
  id: string;
  name: string;
  url: string;
  tagline: string;
  shortDescription: string;
  aboutBrand: string;
  tags: string[];
  /** Optional local project folder agents mine for submission assets. */
  projectPath: string;
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
  /** Directory-signup email (an address, not a secret) + its webmail URL. */
  directories?: DirectorySettings;
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
  /**
   * Agent-authored per-channel packaging for cross-posts: caption/settings
   * overrides keyed by Postiz integration id. Read-only in the dashboard —
   * the editor never sends this field, which is what preserves it on save.
   */
  variants: Record<string, { content?: string; settings?: Record<string, unknown> }>;
  /**
   * How `body` is written: 'text' (a social caption) or 'markdown' (a
   * paste-ready article whose images are already hosted — set by article
   * producers like seoblog). Read-only in the dashboard.
   */
  format: 'text' | 'markdown';
  /** The producer's note to the poster (intended venue, where images live). Read-only. */
  notes: string;
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

/* ---------- Product Posts (Pro "post anywhere") ---------- */

/** The email the user is signed into in the dedicated Chrome, for signups. */
export interface DirectorySettings {
  signupEmail: string;
  /** Optional override; empty = derived from the address's provider. */
  webmailUrl: string;
  /** What the agent will actually open ('' = unknown provider, needs the override). */
  effectiveWebmailUrl: string;
}

/** How a destination gates posting. null = not yet known (learned on the first attempt). */
export type DestinationSignup = 'none' | 'email' | 'oauth' | 'mixed';
export type DestinationKind = 'directory' | 'launch' | 'community' | 'forum';
/** Display grouping for the catalog. */
export type DestinationCategory =
  | 'startup' | 'launch' | 'ai-tools' | 'ai-agents' | 'mcp' | 'claude' | 'browser-ext' | 'mac' | 'ios'
  | 'review' | 'oss' | 'startup-db' | 'regional' | 'community' | 'forum';
/** Product types a destination accepts. */
export type DestinationFit = 'saas' | 'ai' | 'mcp' | 'claude-plugin' | 'chrome-ext' | 'mac' | 'ios' | 'oss' | 'devtool';
export type DestinationCost = 'free' | 'freemium' | 'paid' | 'revshare';
export type PostType = 'listing' | 'article' | 'thread' | 'link';
export type SubjectKind = 'brand' | 'content' | 'adhoc';

/** A place to post, from the Pro venue playbook (synced) or user-added. */
export interface Destination {
  id: string;
  name: string;
  url: string;
  submitUrl: string | null;
  kind: DestinationKind;
  postTypes: PostType[];
  signup: DestinationSignup | null;
  /** OAuth buttons seen on the site (google, github, ...). */
  oauthProviders: string[];
  category: DestinationCategory | null;
  fits: DestinationFit[];
  cost: DestinationCost | null;
  /** Shared playbook notes (synced from the licensing site). */
  notes: string;
  /** This machine's own learnings; never leave the machine. */
  localNotes: string;
  source: 'server' | 'seed' | 'user';
}

export type PostStatus =
  | 'pending' | 'account_created' | 'awaiting_verification'
  | 'submitted' | 'live' | 'failed' | 'skipped';

/** One subject→destination attempt (driven by /socialcue-post). */
export interface ProductPost {
  id: string;
  subjectKind: SubjectKind;
  subjectId: string | null;
  /** "brand:<id>" | "content:<id>" | "adhoc:<slug>" — also the asset-cache key. */
  subjectKey: string;
  subjectName: string;
  subjectUrl: string;
  subjectPath: string | null;
  brandId: string | null;
  destinationId: string | null;
  destinationUrl: string;
  destinationName: string | null;
  destinationKind: DestinationKind | null;
  postType: PostType;
  status: PostStatus;
  emailUsed: string;
  listingUrl: string | null;
  log: { at: string; msg: string }[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
}

/** A cached asset for a subject (.socialdiscovery/assets/<subjectKey>/). */
export interface AssetOnFile {
  role: string;
  file: string;
  bytes: number;
  width: number | null;
  height: number | null;
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
