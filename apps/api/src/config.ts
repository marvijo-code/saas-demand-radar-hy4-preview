/**
 * Runtime configuration. Nothing secret is ever forwarded to the browser: the web app is
 * configured through `VITE_API_BASE_URL` only, which defaults to the public API origin.
 */
import { resolve } from 'node:path';

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  port: int(process.env.PORT, 4174),
  webPort: int(process.env.WEB_PORT, 4173),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4173',
  apiOrigin: process.env.API_ORIGIN ?? 'http://127.0.0.1:4174',
  databasePath: process.env.SDR_DATABASE_PATH
    ? resolve(process.env.SDR_DATABASE_PATH)
    : undefined,
  corsOrigins: list(process.env.SDR_CORS_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173'),
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 12),
  sessionCookieName: 'sdr_session',
  rateLimit: {
    loginWindowMs: int(process.env.RATE_LOGIN_WINDOW_MS, 5 * 60_000),
    loginMax: int(process.env.RATE_LOGIN_MAX, 10),
    mutationWindowMs: int(process.env.RATE_MUTATION_WINDOW_MS, 60_000),
    mutationMax: int(process.env.RATE_MUTATION_MAX, 120),
    readWindowMs: int(process.env.RATE_READ_WINDOW_MS, 60_000),
    readMax: int(process.env.RATE_READ_MAX, 600),
  },
  scheduler: {
    enabled: bool(process.env.SDR_SCHEDULER_ENABLED, true),
    tickMs: int(process.env.SDR_SCHEDULER_TICK_MS, 30_000),
  },
  snapshotPath: process.env.SDR_SNAPSHOT_PATH ?? 'source-snapshot.json',
  maxIngestRecords: int(process.env.SDR_MAX_INGEST_RECORDS, 500),
  sources: {
    // Adapters are replaceable. Without credentials the live adapters stay inactive and
    // report that clearly instead of inventing data.
    xBearerToken: process.env.X_BEARER_TOKEN ?? process.env.X_API_BEARER_TOKEN ?? '',
    xQuery: process.env.X_SEARCH_QUERY ?? '("I wish there was" OR "is there a tool") -is:retweet lang:en',
    xMaxResults: int(process.env.X_MAX_RESULTS, 25),
    redditUserAgent: process.env.REDDIT_USER_AGENT ?? 'saas-demand-radar/1.0 (by /u/your-team)',
    redditClientId: process.env.REDDIT_CLIENT_ID ?? '',
    redditClientSecret: process.env.REDDIT_CLIENT_SECRET ?? '',
    redditSubreddits: list(process.env.REDDIT_SUBREDDITS ?? 'SaaS,Entrepreneur,smallbusiness'),
    redditQuery:
      process.env.REDDIT_QUERY ?? '"is there a tool" OR "I wish there was" OR "alternative to"',
    redditMaxResults: int(process.env.REDDIT_MAX_RESULTS, 25),
    httpTimeoutMs: int(process.env.SDR_HTTP_TIMEOUT_MS, 8_000),
  },
} as const;

export type AppConfig = typeof config;
