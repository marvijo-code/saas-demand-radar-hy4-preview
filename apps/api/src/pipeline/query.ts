import {
  scoreNeed,
  SIGNAL_LABELS,
  WINDOW_KEYS,
  parseWindow,
  resolveNow,
  windowStartIso,
  isWithinWindow,
} from '@sdr/shared';
import type {
  NeedDetail,
  NeedEvidence,
  NeedStatus,
  NeedSummary,
  NeedTrendPoint,
  Platform,
  ScoreBreakdown,
  SignalKind,
  SortKey,
  WindowKey,
} from '@sdr/shared';
import { loadGraph, type GraphNeed, type GraphRecord } from './graph.ts';
import { engagementTotalOf, needPhrases } from './graph.ts';
import { feedbackAggregate } from './scoring.ts';
import { latestModel, listPhraseWeights, listSourceWeights } from '../repo/ranking.ts';
import { listScoreHistory } from '../repo/needs.ts';
import { DEFAULT_WEIGHTS } from '@sdr/shared';

export interface NeedsQuery {
  window: WindowKey;
  search: string;
  platform: Platform | 'all';
  status: NeedStatus | 'all';
  sort: SortKey;
  page: number;
  pageSize: number;
  now: Date;
}

export interface NeedsQueryResult {
  needs: NeedSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  window: WindowKey;
  sort: SortKey;
  search: string;
  platform: string;
  status: string;
  modelVersion: number;
  totals: {
    records: number;
    needs: number;
    evidence: number;
    signals: number;
    engagement: number;
  };
}

export function parseNeedsQuery(params: Record<string, unknown>): NeedsQuery {
  const window = parseWindow(params.window);
  const sortRaw = typeof params.sort === 'string' ? params.sort : 'score';
  const sort: SortKey = (['score', 'recency', 'frequency', 'engagement', 'title'] as const).includes(
    sortRaw as SortKey,
  )
    ? (sortRaw as SortKey)
    : 'score';
  const platformRaw = typeof params.platform === 'string' ? params.platform : 'all';
  const platform = platformRaw === 'x' || platformRaw === 'reddit' ? platformRaw : 'all';
  const statusRaw = typeof params.status === 'string' ? params.status : 'all';
  const status = (['new', 'reviewing', 'validated', 'dismissed'] as const).includes(
    statusRaw as NeedStatus,
  )
    ? (statusRaw as NeedStatus)
    : 'all';
  return {
    window,
    search: typeof params.search === 'string' ? params.search.trim().slice(0, 200) : '',
    platform,
    status,
    sort,
    page: clampInt(params.page, 1, 1, 10_000),
    pageSize: clampInt(params.pageSize, 12, 1, 100),
    now: resolveNow(params.now),
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

interface ScoredNeed {
  need: GraphNeed;
  evidence: GraphRecord[];
  breakdown: ScoreBreakdown;
  totalEngagement: number;
  lastSeenAt: string;
}

/**
 * Filters the workspace graph, scores the surviving needs with the current model weights and
 * returns one page of results.
 *
 * Scores are computed for the *filtered* evidence set so the 24h / 7d / 30d windows really
 * compare demand in that period, while the persisted per-version score (shown on the need
 * detail page and in the version history) always describes all-time evidence.
 */
export function queryNeeds(workspaceId: string, query: NeedsQuery): NeedsQueryResult {
  const graph = loadGraph(workspaceId);
  const model = latestModel(workspaceId);
  const weights = model?.weights ?? DEFAULT_WEIGHTS;
  const phraseWeights = listPhraseWeights(workspaceId);
  const sourceWeights = listSourceWeights(workspaceId);
  const startIso = windowStartIso(query.window, query.now);
  const search = query.search.toLowerCase();

  const scored: ScoredNeed[] = [];
  for (const need of graph.needs) {
    if (query.status !== 'all' && need.status !== query.status) continue;
    let evidence = need.evidence;
    if (startIso) evidence = evidence.filter((record) => isWithinWindow(record.publishedAt, startIso));
    if (query.platform !== 'all') {
      evidence = evidence.filter((record) => record.platform === query.platform);
    }
    if (search) {
      const haystack = `${need.title} ${need.summary} ${evidence.map((record) => record.text).join(' ')}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }
    if (!evidence.length) continue;

    const breakdown = scoreNeed(
      {
        phrases: needPhrases({ ...need, evidence }),
        feedback: feedbackAggregate({ ...need, evidence }),
        now: query.now,
        evidence: evidence.map((record) => ({
          platform: record.platform,
          author: record.author,
          subreddit: record.subreddit,
          publishedAt: record.publishedAt,
          engagementTotal: engagementTotalOf(record.engagement),
          signals: record.signals,
        })),
      },
      { weights, phraseWeights, sourceWeights },
    );

    const timestamps = evidence.map((record) => Date.parse(record.publishedAt)).sort((a, b) => a - b);
    scored.push({
      need,
      evidence,
      breakdown,
      totalEngagement: evidence.reduce((sum, record) => sum + engagementTotalOf(record.engagement), 0),
      lastSeenAt: new Date(timestamps[timestamps.length - 1] ?? Date.now()).toISOString(),
    });
  }

  scored.sort((a, b) => compareNeeds(a, b, query.sort));

  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;
  const pageItems = scored.slice(offset, offset + query.pageSize);

  const signalCount = graph.records.reduce((sum, record) => sum + record.signals.length, 0);

  return {
    needs: pageItems.map((entry, index) =>
      summarise(entry, offset + index + 1),
    ),
    total,
    page,
    pageSize: query.pageSize,
    totalPages,
    window: query.window,
    sort: query.sort,
    search: query.search,
    platform: query.platform,
    status: query.status,
    modelVersion: model?.version ?? 1,
    totals: {
      records: graph.records.length,
      needs: graph.needs.length,
      evidence: graph.needs.reduce((sum, need) => sum + need.evidence.length, 0),
      signals: signalCount,
      engagement: graph.records.reduce((sum, record) => sum + engagementTotalOf(record.engagement), 0),
    },
  };
}

function compareNeeds(a: ScoredNeed, b: ScoredNeed, sort: SortKey): number {
  switch (sort) {
    case 'recency':
      return (
        Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) ||
        b.breakdown.score - a.breakdown.score ||
        a.need.id - b.need.id
      );
    case 'frequency':
      return (
        b.evidence.length - a.evidence.length ||
        b.breakdown.score - a.breakdown.score ||
        a.need.id - b.need.id
      );
    case 'engagement':
      return b.totalEngagement - a.totalEngagement || a.need.id - b.need.id;
    case 'title':
      return a.need.title.localeCompare(b.need.title);
    case 'score':
    default:
      return (
        b.breakdown.score - a.breakdown.score ||
        b.evidence.length - a.evidence.length ||
        a.need.id - b.need.id
      );
  }
}

function summarise(entry: ScoredNeed, rank: number): NeedSummary {
  const kinds = new Set<SignalKind>();
  let intentStrength = 0;
  for (const record of entry.evidence) {
    for (const signal of record.signals) {
      kinds.add(signal.kind);
      if (signal.kind === 'buying_intent' || signal.kind === 'tool_request') {
        intentStrength = Math.max(intentStrength, signal.strength);
      }
    }
  }
  const timestamps = entry.evidence.map((record) => Date.parse(record.publishedAt)).sort((a, b) => a - b);
  const aggregate = feedbackAggregate({ ...entry.need, evidence: entry.evidence });
  return {
    id: entry.need.id,
    key: entry.need.key,
    title: entry.need.title,
    summary: entry.need.summary,
    status: entry.need.status,
    score: entry.breakdown.score,
    rank,
    evidenceCount: entry.evidence.length,
    platforms: Array.from(new Set(entry.evidence.map((record) => record.platform))).sort(),
    authors: new Set(
      entry.evidence.map((record) => (record.author ?? '').toLowerCase()).filter(Boolean),
    ).size,
    totalEngagement: entry.totalEngagement,
    signalKinds: Array.from(kinds).sort(),
    intentStrength: Math.round(intentStrength * 100) / 100,
    firstSeenAt: new Date(timestamps[0] ?? Date.now()).toISOString(),
    lastSeenAt: entry.lastSeenAt,
    breakdown: entry.breakdown,
    feedback: {
      relevant: aggregate.relevant + aggregate.needRelevant,
      irrelevant: aggregate.irrelevant + aggregate.needIrrelevant,
      willingnessToPay: aggregate.willingnessToPay,
      contacted: aggregate.contacted,
    },
  };
}

/**
 * Full need detail: the live score for the selected window, the persisted score history per
 * ranking-model version, the daily trend and every feedback entry that touched the need.
 */
export function getNeedDetail(
  workspaceId: string,
  needId: number,
  query: NeedsQuery,
): NeedDetail | null {
  const result = queryNeeds(workspaceId, { ...query, pageSize: 1_000, page: 1 });
  const summary = result.needs.find((need) => need.id === needId);
  if (!summary) return null;

  const graph = loadGraph(workspaceId);
  const need = graph.needs.find((candidate) => candidate.id === needId);
  if (!need) return null;

  const startIso = windowStartIso(query.window, query.now);
  const evidence: NeedEvidence[] = need.evidence
    .filter((record) => isWithinWindow(record.publishedAt, startIso))
    .map((record) => ({
      id: record.id,
      sourceRecordId: record.id,
      platform: record.platform,
      externalId: record.externalId,
      url: record.url,
      author: record.author,
      publishedAt: record.publishedAt,
      text: record.text,
      engagement: record.engagement,
      subreddit: record.subreddit,
      signals: record.signals.map((signal) => ({
        id: signal.id,
        workspaceId,
        sourceRecordId: record.id,
        kind: signal.kind,
        strength: signal.strength,
        matchedPhrase: signal.matchedPhrase,
        createdAt: record.publishedAt,
      })),
      feedback: need.feedback
        .filter((entry) => entry.sourceRecordId === record.id)
        .map((entry) => ({
          id: entry.id,
          targetType: entry.targetType,
          needId: entry.needId,
          sourceRecordId: entry.sourceRecordId,
          relevant: entry.relevant,
          willingnessToPay: entry.willingnessToPay,
          contacted: entry.contacted,
          note: entry.note,
          actorEmail: entry.actorEmail,
          createdAt: entry.createdAt,
        })),
    }));

  const history = listScoreHistory(workspaceId, needId).map((row) => ({
    version: row.model_version,
    score: row.score,
    rank: row.rank,
    createdAt: row.computed_at,
  }));

  return {
    ...summary,
    evidence,
    trend: buildTrend(evidence.map((entry) => entry.publishedAt), query),
    scoreHistory: history,
    feedbackHistory: need.feedback.map((entry) => ({
      id: entry.id,
      targetType: entry.targetType,
      needId: entry.needId,
      sourceRecordId: entry.sourceRecordId,
      relevant: entry.relevant,
      willingnessToPay: entry.willingnessToPay,
      contacted: entry.contacted,
      note: entry.note,
      actorEmail: entry.actorEmail,
      createdAt: entry.createdAt,
    })),
  };
}

/**
 * Buckets evidence timestamps for the trend chart.
 *
 * 24h → hourly buckets, 7d and 30d → daily buckets, all time → monthly buckets spanning the
 * oldest piece of evidence. Every bucket is pre-created with a zero count, so the chart always
 * has a stable x-axis even when a need has a single piece of evidence.
 */
export function buildTrend(publishedAt: string[], query: NeedsQuery): NeedTrendPoint[] {
  const now = query.now;
  const dates = publishedAt.map((iso) => new Date(iso)).sort((a, b) => a.getTime() - b.getTime());
  const buckets: NeedTrendPoint[] = [];
  const index = new Map<string, number>();

  const push = (key: string) => {
    if (index.has(key)) return;
    index.set(key, buckets.length);
    buckets.push({ date: key, count: 0 });
  };
  const add = (key: string) => {
    const at = index.get(key);
    if (at === undefined) return;
    buckets[at].count += 1;
  };

  if (query.window === 'all') {
    const oldest = dates.length ? dates[0] : now;
    const startYear = oldest.getUTCFullYear();
    const startMonth = oldest.getUTCMonth();
    const endYear = now.getUTCFullYear();
    const endMonth = now.getUTCMonth();
    let total = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    total = Math.min(Math.max(total, 1), 36);
    for (let offset = total - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(endYear, endMonth - offset, 1));
      push(date.toISOString().slice(0, 10));
    }
    for (const date of dates) {
      add(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`);
    }
    return buckets;
  }

  if (query.window === '24h') {
    for (let offset = 23; offset >= 0; offset -= 1) {
      push(new Date(now.getTime() - offset * 3_600_000).toISOString().slice(0, 13));
    }
    for (const date of dates) add(date.toISOString().slice(0, 13));
    return buckets;
  }

  const days = query.window === '7d' ? 7 : 30;
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    push(new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10));
  }
  for (const date of dates) add(date.toISOString().slice(0, 10));
  return buckets;
}

export function signalLabels(kinds: SignalKind[]): string[] {
  return kinds.map((kind) => SIGNAL_LABELS[kind]);
}

export { WINDOW_KEYS };
