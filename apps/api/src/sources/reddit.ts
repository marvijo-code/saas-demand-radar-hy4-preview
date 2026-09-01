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
  const url = new URL(`https://oauth.reddit.com${path}`);
  search.forEach((value, key) => url.searchParams.set(key, value));

  const headers: Record<string, string> = {
    'User-Agent': config.sources.redditUserAgent,
    Accept: 'application/json',
  };
  const token = await redditAppToken();
  headers.Authorization = `bearer ${token}`;

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

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function tag(entry: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(entry);
  return match?.[1] ? decodeEntities(match[1]).trim() : '';
}

function attribute(entry: string, name: string, attributeName: string): string {
  const element = new RegExp(`<${name}\\b[^>]*\\b${attributeName}="([^"]+)"[^>]*>`, 'i').exec(entry);
  return element?.[1] ? decodeEntities(element[1]).trim() : '';
}

function textFromHtml(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

/** Parse the public Reddit Atom feed without adding an XML dependency. */
export function parseRedditAtom(xml: string): { records: RawSourceRecord[]; errors: AdapterError[] } {
  const records: RawSourceRecord[] = [];
  const errors: AdapterError[] = [];
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];

  entries.forEach((match, index) => {
    const entry = match[1] ?? '';
    const url = attribute(entry, 'link', 'href');
    const feedId = tag(entry, 'id').replace(/^t3_/, '');
    const externalId = feedId || /\/comments\/([^/]+)/i.exec(url)?.[1] || '';
    const title = textFromHtml(tag(entry, 'title'));
    const content = textFromHtml(tag(entry, 'content'));
    const text = [title, content].filter(Boolean).join('\n\n');
    const author = tag(tag(entry, 'author'), 'name').replace(/^\/u\//, '') || null;
    const publishedAt = tag(entry, 'published') || tag(entry, 'updated');
    const subreddit = attribute(entry, 'category', 'label') || undefined;

    try {
      records.push(
        normalizeRecord(
          {
            platform: 'reddit',
            externalId,
            url,
            author,
            publishedAt,
            text,
            engagement: {},
            subreddit,
          },
          index,
        ),
      );
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  });

  return { records, errors };
}

async function redditRssGet(
  subreddits: string[],
  query: string,
  maxResults: number,
): Promise<{ records: RawSourceRecord[]; errors: AdapterError[] }> {
  const scope = subreddits.length ? `/r/${subreddits.join('+')}` : '';
  const url = new URL(`https://www.reddit.com${scope}/search.rss`);
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'new');
  url.searchParams.set('limit', String(Math.min(Math.max(maxResults, 1), 100)));
  if (subreddits.length) url.searchParams.set('restrict_sr', 'on');

  const response = await fetch(url, {
    headers: {
      'User-Agent': config.sources.redditUserAgent,
      Accept: 'application/atom+xml,application/xml;q=0.9',
    },
    signal: AbortSignal.timeout(config.sources.httpTimeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Reddit RSS responded ${response.status}: ${detail || response.statusText}`);
  }
  const xml = await response.text();
  if (!xml.includes('<feed') || !xml.includes('</feed>')) {
    throw new Error('Reddit RSS returned a response that was not an Atom feed.');
  }
  return parseRedditAtom(xml);
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

    const useOAuth = Boolean(config.sources.redditClientId && config.sources.redditClientSecret);
    if (!useOAuth) {
      const { records, errors } = await redditRssGet(subreddits, query, ctx.maxResults);
      return {
        records,
        errors,
        notes: [
          `Reddit RSS search returned ${records.length} post(s) for query "${query}"${subreddits.length ? ` in ${subreddits.join(', ')}` : ''}.`,
          'Used Reddit public RSS search (no credentials configured). RSS does not include vote or comment counts.',
        ],
      };
    }

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
        'Authenticated with the Reddit OAuth application credentials.',
      ],
    };
  },
};
