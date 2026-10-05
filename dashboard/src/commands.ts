/** The plugin's user-invocable slash commands — single source for the sidebar
 *  list and the details modal so the two can't drift. */

export const PLUGIN_NS = 'socialcue';

export type Need = 'pro' | 'browser' | 'postiz';

export interface CommandInfo {
  name: string;
  hint: string;
  description: string;
  needs: Need[];
  example: string;
}

export const COMMANDS: CommandInfo[] = [
  {
    name: 'socialdiscovery',
    hint: 'Find conversations, draft replies',
    description: 'Drives your Social Cue browser through Reddit, X, HN and the rest, scores threads worth joining for your brands, and drops ranked opportunities with drafted replies into Conversations. Collect-only: nothing is posted.',
    needs: ['browser'],
    example: '',
  },
  {
    name: 'content-post',
    hint: 'Post a brand, article or repo anywhere',
    description: 'Gets a brand, a Content Library item, or an ad-hoc project onto a directory, launch site, subreddit, Indie Hackers, Show HN or forum. Signs up as you where needed, finds the assets each form wants, and tracks every attempt under Product Posts.',
    needs: ['pro', 'browser'],
    example: 'the DemoDay video to r/SideProject',
  },
  {
    name: 'postiz-post',
    hint: 'Schedule a video to YouTube, TikTok, IG',
    description: 'One video, per-platform captions, titles, tags and settings, approved verbatim in chat, then scheduled through your Postiz account. The only flow that schedules on your behalf.',
    needs: ['postiz'],
    example: '~/clips/overboard-tour.mp4 launch teaser, tomorrow 9am',
  },
  {
    name: 'suggest-crosspost',
    hint: 'Repurpose what you already made',
    description: 'Reads your Content Library, logged activity and live product posts, and suggests how to repurpose them for platforms they have not reached yet. Your picks become linked drafts in the Content Library; nothing is posted.',
    needs: [],
    example: 'Overboard',
  },
  {
    name: 'log-activity',
    hint: 'Log posts you made elsewhere',
    description: 'Visits your own profile and replies pages on each logged-in platform and records every post and comment since the last run, so posts made from your phone are not lost. Original posts land in the Content Library as published.',
    needs: ['browser'],
    example: 'reddit x hackernews',
  },
  {
    name: 'load-dashboard',
    hint: 'Open this dashboard',
    description: 'Starts the local bridge if needed and opens this dashboard in the Social Cue browser, then summarizes the queue. No discovery run.',
    needs: [],
    example: '',
  },
  {
    name: 'socialdiscovery:notes',
    hint: 'Fix the drafts to sound like you',
    description: 'Give feedback on drafted replies, rewrite the pending queue in your voice, and save a good rewrite as a golden example that future runs learn from.',
    needs: [],
    example: 'shorter, less salesy, never open with "Great question"',
  },
  {
    name: 'socialcue-setup',
    hint: 'Onboarding: brands, platforms, browser',
    description: 'Guided setup: drafts your brand profile from your website, picks target platforms, and checks the dedicated browser connection. Run once before anything else.',
    needs: [],
    example: '',
  },
  {
    name: 'activate-pro',
    hint: 'Connect your Pro account token',
    description: 'Saves the account token from your Pro purchase email and fetches your license key. Pro unlocks assisted posting, performance tracking and Product Posts.',
    needs: [],
    example: 'scacct_…',
  },
];

export const slash = (c: CommandInfo) => `/${c.name}`;
export const slashNs = (c: CommandInfo) => `/${PLUGIN_NS}:${c.name}`;

export const NEED_LABELS: Record<Need, string> = {
  pro: 'Pro',
  browser: 'Social Cue browser',
  postiz: 'Postiz account',
};
