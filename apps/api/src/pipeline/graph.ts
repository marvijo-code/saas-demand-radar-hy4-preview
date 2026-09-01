import { keyPhrases } from '@sdr/shared';
import type { EngagementCounts, Platform, SignalKind } from '@sdr/shared';
import { listWorkspaceRecords, listSignals, parseEngagement } from '../repo/records.ts';
import { listNeedEvidence, listNeeds } from '../repo/needs.ts';
import { listWorkspaceFeedback } from '../repo/feedback.ts';
import type { FeedbackWithActor } from '../repo/feedback.ts';
import { listScores, listScoreHistory } from '../repo/needs.ts';
import { latestModel } from '../repo/ranking.ts';

export interface GraphSignal {
  id: number;
  kind: SignalKind;
  strength: number;
  matchedPhrase: string;
}

export interface GraphRecord {
  id: number;
  platform: Platform;
  externalId: string;
  url: string;
  author: string | null;
  publishedAt: string;
  text: string;
  engagement: EngagementCounts;
  subreddit: string | null;
  signals: GraphSignal[];
}

export interface GraphFeedback {
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

export interface GraphNeed {
  id: number;
  key: string;
  title: string;
  summary: string;
  status: 'new' | 'reviewing' | 'validated' | 'dismissed';
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: GraphRecord[];
  feedback: GraphFeedback[];
}

export interface WorkspaceGraph {
  workspaceId: string;
  records: GraphRecord[];
  recordById: Map<number, GraphRecord>;
  needs: GraphNeed[];
  feedback: GraphFeedback[];
  modelVersion: number;
}

/**
 * Loads every derived artefact of a workspace in one pass.
 * The whole graph is small enough to keep in memory, which keeps scoring, grouping and
 * learning in plain TypeScript that is easy to test deterministically.
 */
export function loadGraph(workspaceId: string): WorkspaceGraph {
  const recordRows = listWorkspaceRecords(workspaceId);
  const signals = listSignals(workspaceId);
  const signalsByRecord = new Map<number, GraphSignal[]>();
  for (const signal of signals) {
    const list = signalsByRecord.get(signal.source_record_id) ?? [];
    list.push({
      id: signal.id,
      kind: signal.kind,
      strength: signal.strength,
      matchedPhrase: signal.matched_phrase,
    });
    signalsByRecord.set(signal.source_record_id, list);
  }

  const records: GraphRecord[] = recordRows.map((row) => ({
    id: row.id,
    platform: row.platform,
    externalId: row.external_id,
    url: row.url,
    author: row.author,
    publishedAt: row.published_at,
    text: row.text,
    engagement: parseEngagement(row.engagement),
    subreddit: row.subreddit,
    signals: signalsByRecord.get(row.id) ?? [],
  }));
  const recordById = new Map(records.map((record) => [record.id, record]));

  const needRows = listNeeds(workspaceId);
  const evidenceRows = listNeedEvidence(workspaceId);
  const evidenceByNeed = new Map<number, GraphRecord[]>();
  for (const row of evidenceRows) {
    const record = recordById.get(row.record_id);
    if (!record) continue;
    const list = evidenceByNeed.get(row.need_id) ?? [];
    list.push(record);
    evidenceByNeed.set(row.need_id, list);
  }

  const feedback: GraphFeedback[] = listWorkspaceFeedback(workspaceId).map(mapFeedback);
  const feedbackByNeed = new Map<number, GraphFeedback[]>();
  const feedbackByRecord = new Map<number, GraphFeedback[]>();
  for (const entry of feedback) {
    // `targetType` decides the grouping so that evidence feedback linked to a need id is not
    // counted twice: once as need feedback and once through its evidence.
    if (entry.targetType === 'need' && entry.needId !== null) {
      const list = feedbackByNeed.get(entry.needId) ?? [];
      list.push(entry);
      feedbackByNeed.set(entry.needId, list);
    }
    if (entry.targetType === 'evidence' && entry.sourceRecordId !== null) {
      const list = feedbackByRecord.get(entry.sourceRecordId) ?? [];
      list.push(entry);
      feedbackByRecord.set(entry.sourceRecordId, list);
    }
  }

  const needs: GraphNeed[] = needRows.map((row) => {
    const evidence = [...(evidenceByNeed.get(row.id) ?? [])].sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id - b.id,
    );
    const ownFeedback = feedbackByNeed.get(row.id) ?? [];
    const evidenceFeedback = evidence.flatMap((record) => feedbackByRecord.get(record.id) ?? []);
    const combined = [...ownFeedback, ...evidenceFeedback].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    );
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      summary: row.summary,
      status: row.status,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      evidence,
      feedback: combined,
    };
  });

  const model = latestModel(workspaceId);

  return {
    workspaceId,
    records,
    recordById,
    needs,
    feedback,
    modelVersion: model?.version ?? 1,
  };
}

export function mapFeedback(row: FeedbackWithActor): GraphFeedback {
  return {
    id: row.id,
    targetType: row.target_type,
    needId: row.need_id,
    sourceRecordId: row.source_record_id,
    relevant: row.relevant === null ? null : row.relevant === 1,
    willingnessToPay: row.willingness_to_pay === 1,
    contacted: row.contacted === 1,
    note: row.note,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

export function engagementTotalOf(counts: EngagementCounts): number {
  return Object.values(counts).reduce(
    (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
    0,
  );
}

export function needPhrases(need: GraphNeed): string[] {
  const combined = need.evidence
    .slice()
    .sort((a, b) => engagementTotalOf(b.engagement) - engagementTotalOf(a.engagement))
    .map((record) => record.text)
    .join(' ');
  return keyPhrases(combined || need.title, 8);
}

export { listScores, listScoreHistory };
