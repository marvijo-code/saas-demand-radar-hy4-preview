/**
 * Browser API client.
 *
 * Everything talks to the API with `credentials: 'include'` so the HTTP-only session cookie
 * is sent by the browser and never readable from JavaScript. No secret is ever stored here.
 */

import type { EngagementCounts, NeedTrendPoint } from '@sdr/shared';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? `Request failed with ${response.status}.`,
      error?.details,
    );
  }
  return payload as T;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  workspaceId: string;
}

export interface PublicWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt?: string;
  lastSeenAt: string | null;
}

export interface AuthSession {
  user: PublicUser;
  workspace: PublicWorkspace | null;
  members: Member[];
}

export interface ScoreComponent {
  key:
    | 'frequency'
    | 'recency'
    | 'intent'
    | 'engagement'
    | 'diversity';
  label: string;
  value: number;
  weight: number;
  points: number;
  detail: string;
}

export interface ScoreBreakdown {
  components: ScoreComponent[];
  basePoints: number;
  phraseMultiplier: number;
  sourceMultiplier: number;
  feedbackMultiplier: number;
  bonusPoints: number;
  score: number;
  explanation: string[];
}

export interface Signal {
  id: number;
  kind: string;
  strength: number;
  matchedPhrase: string;
}

export interface FeedbackEntry {
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

export interface NeedEvidenceItem {
  id: number;
  sourceRecordId: number;
  platform: 'x' | 'reddit';
  externalId: string;
  url: string;
  author: string | null;
  publishedAt: string;
  text: string;
  engagement: EngagementCounts;
  subreddit: string | null;
  signals: Signal[];
  feedback: FeedbackEntry[];
}

export interface NeedSummary {
  id: number;
  key: string;
  title: string;
  summary: string;
  status: 'new' | 'reviewing' | 'validated' | 'dismissed';
  score: number;
  rank: number | null;
  evidenceCount: number;
  platforms: ('x' | 'reddit')[];
  authors: number;
  totalEngagement: number;
  signalKinds: string[];
  intentStrength: number;
  firstSeenAt: string;
  lastSeenAt: string;
  breakdown: ScoreBreakdown;
  feedback: { relevant: number; irrelevant: number; willingnessToPay: number; contacted: number };
}

export interface NeedDetail extends NeedSummary {
  evidence: NeedEvidenceItem[];
  trend: NeedTrendPoint[];
  scoreHistory: { version: number; score: number; rank: number | null; createdAt: string }[];
  feedbackHistory: FeedbackEntry[];
}

export interface NeedsResponse {
  needs: NeedSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  window: string;
  sort: string;
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

export interface SourceRunItem {
  id: string;
  adapter: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  signalsCreated?: number;
  needsCreated?: number;
  notes?: string[];
  errors?: { platform?: string | null; externalId?: string | null; message: string }[];
  error?: { message: string; detail?: string } | null;
}

export interface SourceRunsResponse {
  runs: SourceRunItem[];
  lastSuccessAt: string | null;
  schedule: {
    enabled: boolean;
    intervalMinutes: number;
    adapter: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  };
}

export interface ScheduleSettings {
  enabled: boolean;
  intervalMinutes: number;
  adapter: string;
  keywords: string[];
  subreddits: string[];
  snapshotPath?: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: string;
  schedulerEnabled?: boolean;
  availableAdapters?: string[];
}

export interface AuditEvent {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RankingVersion {
  version: number;
  weights: Record<string, number>;
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  changeSummary: string[];
  createdByEmail: string | null;
  createdAt: string;
  feedback: (FeedbackEntry & { missing?: boolean })[];
}

export interface OverviewResponse {
  workspace: PublicWorkspace;
  counts: {
    records: number;
    needs: number;
    signals: number;
    engagement: number;
    feedback: number;
    runs: number;
  };
  platforms: { x: number; reddit: number };
  signalBreakdown: { kind: string; label: string; count: number }[];
  topNeeds: {
    id: number;
    title: string;
    status: string;
    evidenceCount: number;
    platforms: string[];
    lastSeenAt: string;
  }[];
  latestRun: {
    id: string;
    adapter: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    recordsCreated: number;
    error: { message: string; detail?: string } | null;
  } | null;
  schedule: ScheduleSettings;
  model: { version: number; createdAt: string; createdByEmail: string | null } | null;
  recentActivity: { id: number; action: string; summary: string; actorEmail: string | null; createdAt: string }[];
}

export interface FeedbackListItem extends FeedbackEntry {
  needTitle: string | null;
  evidencePreview: string | null;
  phrases: string[];
  platform: string | null;
  appliedInVersions: number[];
}

export interface FeedbackResponse {
  feedback: FeedbackListItem[];
  weights: {
    phraseWeights: Record<string, number>;
    sourceWeights: Record<string, number>;
  };
  modelVersion: number;
  pendingCount: number;
}

export interface TeamResponse {
  workspace: PublicWorkspace;
  viewer: { id: string; role: 'admin' | 'member'; email: string };
  members: Member[];
  stats: { admins: number; total: number };
}

export interface NeedsQueryParams {
  window?: string;
  search?: string;
  platform?: string;
  status?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  now?: string;
  [key: string]: string | number | undefined;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  login: (email: string, password: string) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<AuthSession>('/auth/me'),
  overview: () => request<OverviewResponse>('/overview'),
  needs: (params: NeedsQueryParams = {}) =>
    request<NeedsResponse>(`/needs${toQuery(params)}`),
  need: (id: number | string, params: NeedsQueryParams = {}) =>
    request<{ need: NeedDetail; window: string }>(`/needs/${id}${toQuery(params)}`),
  needStatus: (id: number | string, status: string) =>
    request<{ id: number; status: string }>(`/needs/${id}/status`, {
      method: 'PATCH',
      body: { status },
    }),
  needFeedback: (
    id: number | string,
    body: {
      relevant?: boolean | null;
      willingnessToPay?: boolean;
      contacted?: boolean;
      note?: string | null;
    },
  ) => request<{ feedback: FeedbackEntry }>(`/needs/${id}/feedback`, { method: 'POST', body }),
  evidenceFeedback: (
    needId: number | string,
    recordId: number,
    body: {
      relevant?: boolean | null;
      willingnessToPay?: boolean;
      contacted?: boolean;
      note?: string | null;
    },
  ) =>
    request<{ feedback: FeedbackEntry }>(`/needs/${needId}/evidence/${recordId}/feedback`, {
      method: 'POST',
      body,
    }),
  evidence: () => request<{ records: NeedEvidenceItem[] }>('/needs/evidence/all'),
  sourceRuns: (limit = 50) => request<SourceRunsResponse>(`/source-runs${toQuery({ limit })}`),
  retryRun: (id: string) => request<{ run: SourceRunItem }>(`/source-runs/${id}/retry`, { method: 'POST' }),
  ingest: (body: {
    adapter?: string;
    records?: unknown[];
    snapshotPath?: string;
    keywords?: string[];
    subreddits?: string[];
  }) => request<{ run: SourceRunItem }>('/sources/ingest', { method: 'POST', body }),
  adapters: () =>
    request<{
      adapters: { id: string; label: string; ready: boolean; limits: string[] }[];
    }>('/sources/adapters'),
  rescore: () =>
    request<{
      version: number;
      previousVersion: number | null;
      changes: {
        needId: number;
        title: string;
        previousScore: number | null;
        score: number;
        previousRank: number | null;
        rank: number | null;
        scoreDelta: number;
        rankDelta: number | null;
      }[];
      changeSummary: string[];
      feedbackApplied: number[];
    }>('/ranking/rescore', { method: 'POST' }),
  rankingVersions: () =>
    request<{
      versions: RankingVersion[];
      current: { phraseWeights: Record<string, number>; sourceWeights: Record<string, number> };
    }>('/ranking/versions'),
  schedule: () => request<{ schedule: ScheduleSettings }>('/settings/schedule'),
  updateSchedule: (patch: Partial<ScheduleSettings>) =>
    request<{ schedule: ScheduleSettings }>('/settings/schedule', { method: 'PUT', body: patch }),
  audit: (params: { limit?: number; action?: string } = {}) =>
    request<{ events: AuditEvent[]; total: number; actions: string[] }>(`/audit${toQuery(params)}`),
  feedback: () => request<FeedbackResponse>('/feedback'),
  team: () => request<TeamResponse>('/team'),
  renameWorkspace: (name: string) =>
    request<{ name: string }>('/team/name', { method: 'PUT', body: { name } }),
  createMember: (body: { email: string; name: string; password: string; role: string }) =>
    request<{ members: Member[] }>('/team/members', { method: 'POST', body }),
  updateMemberRole: (id: string, role: string) =>
    request<{ members: Member[] }>(`/team/members/${id}`, { method: 'PATCH', body: { role } }),
  deleteMember: (id: string) => request<{ members: Member[] }>(`/team/members/${id}`, { method: 'DELETE' }),
};

export { API_BASE };
