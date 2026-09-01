import type { EngagementCounts, Platform, RawSourceRecord } from '@sdr/shared';
import { PLATFORMS } from '@sdr/shared';

/** Thrown for a single malformed record. Ingestion records the message and continues. */
export class RecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordValidationError';
  }
}

const ENGAGEMENT_KEYS = ['likes', 'replies', 'reposts', 'upvotes', 'comments', 'views'] as const;
const MAX_TEXT = 8_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new RecordValidationError(`\`${field}\` must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new RecordValidationError(`\`${field}\` must not be empty.`);
  if (trimmed.length > max) {
    throw new RecordValidationError(`\`${field}\` must be at most ${max} characters.`);
  }
  return trimmed;
}

function parseEngagement(value: unknown): EngagementCounts {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new RecordValidationError('`engagement` must be an object.');
  const counts: EngagementCounts = {};
  for (const key of ENGAGEMENT_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new RecordValidationError(`\`engagement.${key}\` must be a non-negative number.`);
    }
    counts[key] = Math.floor(parsed);
  }
  return counts;
}

/** Derives `r/<name>` from a Reddit permalink so grouping can use the community as a signal. */
export function subredditFromUrl(url: string): string | null {
  const match = /reddit\.com\/r\/([A-Za-z0-9_]{1,40})\b/i.exec(url);
  return match?.[1] ? `r/${match[1]}` : null;
}

/**
 * Validates and normalises one raw record coming from any adapter.
 *
 * Everything that is not present in the public source stays `null` — no fact is invented,
 * and a record that fails validation is reported instead of being silently dropped.
 */
export function normalizeRecord(raw: unknown, index: number): RawSourceRecord {
  if (!isObject(raw)) {
    throw new RecordValidationError(`Record ${index} must be an object.`);
  }
  const platform = requireString(raw.platform, `records[${index}].platform`, 20) as Platform;
  if (!PLATFORMS.includes(platform)) {
    throw new RecordValidationError(
      `records[${index}].platform must be one of: ${PLATFORMS.join(', ')}.`,
    );
  }
  const externalId = requireString(raw.externalId ?? raw.external_id, `records[${index}].externalId`, 200);
  const url = requireString(raw.url, `records[${index}].url`, 1_000);
  if (!/^https?:\/\/\S+$/i.test(url)) {
    throw new RecordValidationError(`records[${index}].url must be an http(s) URL.`);
  }
  const text = requireString(raw.text, `records[${index}].text`, MAX_TEXT);
  const publishedAtRaw = raw.publishedAt ?? raw.published_at;
  const publishedAt = requireString(publishedAtRaw, `records[${index}].publishedAt`, 40);
  const parsed = Date.parse(publishedAt);
  if (Number.isNaN(parsed)) {
    throw new RecordValidationError(`records[${index}].publishedAt must be an ISO-8601 date.`);
  }
  const authorRaw = raw.author;
  if (authorRaw !== undefined && authorRaw !== null && typeof authorRaw !== 'string') {
    throw new RecordValidationError(`records[${index}].author must be a string.`);
  }
  const author = typeof authorRaw === 'string' && authorRaw.trim() ? authorRaw.trim().slice(0, 120) : null;

  const subredditRaw = raw.subreddit;
  const subreddit =
    typeof subredditRaw === 'string' && subredditRaw.trim()
      ? subredditRaw.trim().slice(0, 60)
      : subredditFromUrl(url);

  return {
    platform,
    externalId,
    url,
    author,
    publishedAt: new Date(parsed).toISOString(),
    text,
    engagement: parseEngagement(raw.engagement),
    subreddit,
  };
}

export function normalizeRecords(raw: unknown): { records: RawSourceRecord[]; errors: { index: number; message: string }[] } {
  if (!Array.isArray(raw)) {
    throw new RecordValidationError('`records` must be an array.');
  }
  const records: RawSourceRecord[] = [];
  const errors: { index: number; message: string }[] = [];
  raw.forEach((entry, index) => {
    try {
      records.push(normalizeRecord(entry, index));
    } catch (error) {
      errors.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { records, errors };
}
