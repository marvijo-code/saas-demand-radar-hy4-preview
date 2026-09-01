/**
 * Shared domain types for SaaS Demand Radar.
 * These types are used by the API, the web app and the tests.
 */

export type Platform = 'x' | 'reddit';

export const PLATFORMS: readonly Platform[] = ['x', 'reddit'];

export type SignalKind =
  | 'buying_intent'
  | 'tool_request'
  | 'workaround'
  | 'price_complaint'
  | 'recurring_pain';

export const SIGNAL_KINDS: readonly SignalKind[] = [
  'buying_intent',
  'tool_request',
  'workaround',
  'price_complaint',
  'recurring_pain',
];

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  buying_intent: 'Explicit buying intent',
  tool_request: 'Request for a tool',
  workaround: 'Recurring workaround',
  price_complaint: 'Price complaint',
  recurring_pain: 'Repeated operational pain',
};

export type NeedStatus = 'new' | 'reviewing' | 'validated' | 'dismissed';

export const NEED_STATUSES: readonly NeedStatus[] = ['new', 'reviewing', 'validated', 'dismissed'];

export type Role = 'admin' | 'member';

export type RunStatus = 'running' | 'success' | 'partial' | 'failed';

export type WindowKey = '24h' | '7d' | '30d' | 'all';

export const WINDOW_KEYS: readonly WindowKey[] = ['24h', '7d', '30d', 'all'];

export const WINDOW_LABELS: Record<WindowKey, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};

export type SortKey = 'score' | 'recency' | 'frequency' | 'engagement' | 'title';

export const SORT_KEYS: readonly SortKey[] = ['score', 'recency', 'frequency', 'engagement', 'title'];

/** Raw record as produced by a source adapter, before it is persisted. */
export interface RawSourceRecord {
  platform: Platform;
  externalId: string;
  url: string;
  author?: string | null;
  publishedAt: string;
  text: string;
  engagement?: EngagementCounts;
  subreddit?: string | null;
}

export interface EngagementCounts {
  likes?: number;
  replies?: number;
  reposts?: number;
  upvotes?: number;
  comments?: number;
  views?: number;
}

/** A source record as stored in the database. */
export interface SourceRecord {
  id: number;
  workspaceId: string;
  platform: Platform;
  externalId: string;
  url: string;
  author: string | null;
  publishedAt: string;
  text: string;
  engagement: EngagementCounts;
  subreddit: string | null;
  createdAt: string;
}

export interface DemandSignal {
  id: number;
  workspaceId: string;
  sourceRecordId: number;
  kind: SignalKind;
  strength: number;
  matchedPhrase: string;
  createdAt: string;
}

export type ScoreComponentKey =
  | 'frequency'
  | 'recency'
  | 'intent'
  | 'engagement'
  | 'diversity';

export interface ScoreComponent {
  key: ScoreComponentKey;
  label: string;
  /** Normalised 0..1 value of the raw measurement. */
  value: number;
  /** Model weight for this component. */
  weight: number;
  /** Points contributed to the final score (before multipliers). */
  points: number;
  /** Human readable description of the raw measurement. */
  detail: string;
}

export interface ScoreBreakdown {
  components: ScoreComponent[];
  /** Weighted points before multipliers (0..100). */
  basePoints: number;
  phraseMultiplier: number;
  sourceMultiplier: number;
  feedbackMultiplier: number;
  bonusPoints: number;
  /** Final score, clamped to 0..100. */
  score: number;
  explanation: string[];
}

export interface NeedTrendPoint {
  date: string;
  count: number;
}

export interface NeedScorePoint {
  version: number;
  score: number;
  rank: number | null;
  createdAt: string;
}

export interface NeedSummary {
  id: number;
  key: string;
  title: string;
  summary: string;
  status: NeedStatus;
  score: number;
  rank: number | null;
  evidenceCount: number;
  platforms: Platform[];
  authors: number;
  totalEngagement: number;
  signalKinds: SignalKind[];
  intentStrength: number;
  firstSeenAt: string;
  lastSeenAt: string;
  breakdown: ScoreBreakdown;
  feedback: {
    relevant: number;
    irrelevant: number;
    willingnessToPay: number;
    contacted: number;
  };
}

export interface NeedEvidence {
  id: number;
  sourceRecordId: number;
  platform: Platform;
  externalId: string;
  url: string;
  author: string | null;
  publishedAt: string;
  text: string;
  engagement: EngagementCounts;
  subreddit: string | null;
  signals: DemandSignal[];
  feedback: NeedFeedback[];
}

export interface NeedFeedback {
  id: number;
  targetType: 'need' | 'evidence';
  needId: number | null;
  sourceRecordId: number | null;
  relevant: boolean | null;
  willingnessToPay: boolean;
  contacted: boolean;
  note: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface NeedDetail extends NeedSummary {
  evidence: NeedEvidence[];
  trend: NeedTrendPoint[];
  scoreHistory: NeedScorePoint[];
  feedbackHistory: NeedFeedback[];
}

export interface RankingWeights {
  frequency: number;
  recency: number;
  intent: number;
  engagement: number;
  diversity: number;
  recencyHalfLifeDays: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  frequency: 0.22,
  recency: 0.2,
  intent: 0.28,
  engagement: 0.15,
  diversity: 0.15,
  recencyHalfLifeDays: 10,
};

export interface RankingModelVersion {
  id: number;
  workspaceId: string;
  version: number;
  weights: RankingWeights;
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  changeSummary: string[];
  feedbackIds: number[];
  createdByEmail: string | null;
  createdAt: string;
}

export interface RankChange {
  needId: number;
  title: string;
  previousScore: number | null;
  score: number;
  previousRank: number | null;
  rank: number | null;
  scoreDelta: number;
  rankDelta: number | null;
}
