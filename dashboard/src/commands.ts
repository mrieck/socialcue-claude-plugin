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
    description: 'Drives your Social Cue browser through Reddit, X, HN and the rest, scores threads worth joining for your brands. Add "resay" to find threads where something you already said fits.',
    needs: ['browser'],
    example: '/socialcue:socialdiscovery resay',
  },
  {
    name: 'content-post',
    hint: 'Post a brand, article or repo anywhere',
    description: 'Posts a brand or piece of content to directory, launch site, subreddit, forum, etc.',
    needs: ['pro', 'browser'],
    example: 'the DemoDay video to r/SideProject',
  },
  {
    name: 'postiz-post',
    hint: 'Schedule a video to YouTube, TikTok, IG',
    description: 'Schedules one video to YouTube, TikTok and Instagram through your Postiz account.',
    needs: ['postiz'],
    example: '~/clips/overboard-tour.mp4 launch teaser, tomorrow 9am',
  },
  {
    name: 'suggest-crosspost',
    hint: 'Repurpose what you already made',
    description: 'Suggests how to repurpose what you already made for platforms it has not reached.',
    needs: [],
    example: 'Overboard',
  },
  {
    name: 'log-activity',
    hint: 'Log posts you made elsewhere',
    description: 'Records the posts and comments you made on each platform since the last run, and (Pro) checks how your posted replies and posts are doing for the Analytics tab.',
    needs: ['browser'],
    example: 'reddit x hackernews',
  },
  {
    name: 'load-dashboard',
    hint: 'Open this dashboard',
    description: 'Opens this dashboard without running discovery.',
    needs: [],
    example: '',
  },
  {
    name: 'socialdiscovery:notes',
    hint: 'Fix the drafts to sound like you',
    description: 'Takes your feedback on drafted replies and rewrites them in your voice.',
    needs: [],
    example: 'shorter, less salesy, never open with "Great question"',
  },
  {
    name: 'socialcue-setup',
    hint: 'Onboarding: brands, platforms, browser',
    description: 'Guided setup for your brands, platforms and browser connection.',
    needs: [],
    example: '',
  },
  {
    name: 'activate-pro',
    hint: 'Connect your Pro account token',
    description: 'Saves your Pro account token and fetches your license key.',
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
