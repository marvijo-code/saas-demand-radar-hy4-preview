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

interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
}

interface XSearchResponse {
  data?: XTweet[];
  meta?: { result_count?: number; next_token?: string };
  errors?: { message?: string }[];
}

/**
 * X (Twitter) recent-search adapter.
 *
 * Requires `X_BEARER_TOKEN` (a paid X API project). The adapter stays completely inert
 * without it: it reports that it is unavailable instead of inventing posts, so the whole
 * product and the acceptance suite run without any paid credential.
 */
export const xAdapter: SourceAdapter = {
  id: 'x',
  label: 'X recent search',
  describe(): AdapterDescriptor {
    return {
      id: 'x',
      label: 'X recent search',
      ready: config.sources.xBearerToken.length > 0,
      limits: [
        'Requires X_BEARER_TOKEN from a paid X API project; inactive without it.',
        'Recent search only returns the last 7 days of public posts, not full history.',
        'Rate limited by X (typically 180 requests / 15 min on basic tiers).',
        'Only public posts are read; no private account data is requested.',
      ],
    };
  },
  async fetch(ctx: AdapterContext): Promise<AdapterResult> {
    if (!config.sources.xBearerToken) {
      return {
        records: [],
        notes: ['X adapter skipped: X_BEARER_TOKEN is not configured.'],
        unavailable: {
          message: 'The X adapter is inactive because no API bearer token is configured.',
          hint: 'Set X_BEARER_TOKEN to enable live X ingestion, or ingest the deterministic snapshot instead.',
        },
      };
    }

    const url = new URL('https://api.x.com/2/tweets/search/recent');
    url.searchParams.set('query', buildQuery(ctx));
    url.searchParams.set('max_results', String(clamp(ctx.maxResults, 10, 100)));
    url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id,lang');
    url.searchParams.set('expansions', 'author_id');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.sources.xBearerToken}`,
        'User-Agent': 'saas-demand-radar/1.0',
      },
      signal: AbortSignal.timeout(config.sources.httpTimeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`X API responded ${response.status}: ${detail || response.statusText}`);
    }
    const payload = (await response.json()) as XSearchResponse;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((entry) => entry.message ?? 'unknown X error').join('; '));
    }

    const records: RawSourceRecord[] = [];
    const errors: AdapterError[] = [];
    const tweets = payload.data ?? [];
    tweets.forEach((tweet, index) => {
      try {
        records.push(
          normalizeRecord(
            {
              platform: 'x',
              externalId: tweet.id,
              url: `https://x.com/i/web/status/${tweet.id}`,
              author: tweet.author_id ? null : null,
              publishedAt: tweet.created_at ?? new Date().toISOString(),
              text: tweet.text,
              engagement: {
                likes: tweet.public_metrics?.like_count ?? 0,
                replies: tweet.public_metrics?.reply_count ?? 0,
                reposts: (tweet.public_metrics?.retweet_count ?? 0) + (tweet.public_metrics?.quote_count ?? 0),
                views: tweet.public_metrics?.impression_count ?? 0,
              },
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
        `X recent search returned ${records.length} post(s) for query "${buildQuery(ctx)}".`,
        'X recent search only covers the last 7 days of public posts.',
      ],
    };
  },
};

function buildQuery(ctx: AdapterContext): string {
  const keywords = ctx.keywords.filter(Boolean);
  if (keywords.length) {
    return `(${keywords.map((keyword) => `"${keyword}"`).join(' OR ')}) -is:retweet lang:en`;
  }
  return config.sources.xQuery;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
