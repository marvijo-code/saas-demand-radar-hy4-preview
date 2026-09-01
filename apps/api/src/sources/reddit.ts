import type { RawSourceRecord } from '@sdr/shared';
import { config } from '../config.ts';
import { normalizeRecord } from './normalize.ts';
import type {
  AdapterContext,
  AdapterDescriptor,
  AdapterError,
  AdapterResult,
  SourceAdapter,
} from './types.ts';

interface RedditChild {
  data?: {
    id?: string;
    name?: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    author?: string;
    created_utc?: number;
    ups?: number;
    num_comments?: number;
    subreddit?: string;
  };
}

interface RedditListing {
  data?: { children?: RedditChild[] };
}

async function redditGet(path: string, search: URLSearchParams): Promise<RedditListing> {
  const useOAuth = Boolean(config.sources.redditClientId && config.sources.redditClientSecret);
  const base = useOAuth ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const url = new URL(`${base}${path}`);
  search.forEach((value, key) => url.searchParams.set(key, value));

  const headers: Record<string, string> = {
    'User-Agent': config.sources.redditUserAgent,
    Accept: 'application/json',
  };
  if (useOAuth) {
    const token = await redditAppToken();
    headers.Authorization = `bearer ${token}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(config.sources.httpTimeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Reddit responded ${response.status}: ${detail || response.statusText}`);
  }
  return (await response.json()) as RedditListing;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function redditAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const basic = Buffer.from(
    `${config.sources.redditClientId}:${config.sources.redditClientSecret}`,
  ).toString('base64');
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.sources.redditUserAgent,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(config.sources.httpTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Reddit token request failed with ${response.status}.`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('Reddit token response was missing an access token.');
  cachedToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/**
 * Reddit search adapter.
 *
 * Reddit's public JSON search endpoint works with nothing but a descriptive User-Agent, so
 * the adapter is usable without credentials. When `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`
 * are present it switches to the authenticated OAuth endpoint for higher rate limits.
 */
export const redditAdapter: SourceAdapter = {
  id: 'reddit',
  label: 'Reddit search',
  describe(): AdapterDescriptor {
    return {
      id: 'reddit',
      label: 'Reddit search',
      ready: true,
      limits: [
        'Public JSON search needs no credentials but is rate limited per IP by Reddit.',
        'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to use the higher OAuth rate limit.',
        'Only public posts are read; deleted or quarantined posts are not returned.',
        'Search relevance ordering means some older matches may be missed between runs.',
      ],
    };
  },
  async fetch(ctx: AdapterContext): Promise<AdapterResult> {
    const subreddits = ctx.subreddits.length ? ctx.subreddits : config.sources.redditSubreddits;
    const query = ctx.keywords.length
      ? ctx.keywords.map((keyword) => `"${keyword}"`).join(' OR ')
      : config.sources.redditQuery;

    const search = new URLSearchParams();
    search.set('q', query);
    search.set('sort', 'new');
    search.set('limit', String(Math.min(Math.max(ctx.maxResults, 1), 100)));
    search.set('raw_json', '1');
    const path = subreddits.length
      ? `/r/${subreddits.join('+')}/search`
      : '/search';
    if (subreddits.length) search.set('restrict_sr', '1');

    const listing = await redditGet(path, search);
    const children = listing.data?.children ?? [];

    const records: RawSourceRecord[] = [];
    const errors: AdapterError[] = [];
    children.forEach((child, index) => {
      const data = child.data ?? {};
      const id = data.id ?? (data.name ? data.name.replace(/^t3_/, '') : '');
      const text = [data.title ?? '', data.selftext ?? ''].join('\n\n').trim();
      try {
        records.push(
          normalizeRecord(
            {
              platform: 'reddit',
              externalId: id,
              url: data.permalink ? `https://www.reddit.com${data.permalink}` : '',
              author: data.author && data.author !== '[deleted]' ? data.author : null,
              publishedAt: new Date((data.created_utc ?? 0) * 1000).toISOString(),
              text,
              engagement: {
                upvotes: Math.max(0, data.ups ?? 0),
                comments: Math.max(0, data.num_comments ?? 0),
              },
              subreddit: data.subreddit ? `r/${data.subreddit}` : undefined,
            },
            index,
          ),
        );
      } catch (error) {
        errors.push({ index, message: error instanceof Error ? error.message : String(error) });
      }
    });

    return {
      records,
      errors,
      notes: [
        `Reddit search returned ${records.length} post(s) for query "${query}"${subreddits.length ? ` in ${subreddits.join(', ')}` : ''}.`,
        config.sources.redditClientId
          ? 'Authenticated with the Reddit OAuth application credentials.'
          : 'Used the public Reddit JSON endpoint (no credentials configured).',
      ],
    };
  },
};
