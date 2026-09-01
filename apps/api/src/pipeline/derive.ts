import { classifyText, groupRecords, SIGNAL_LABELS } from '@sdr/shared';
import type { GroupableRecord } from '@sdr/shared';
import type { EngagementCounts, SignalKind } from '@sdr/shared';
import { run } from '../db/connection.ts';
import { listWorkspaceRecords } from '../repo/records.ts';
import { deleteNeedsWithoutEvidence, linkEvidence, upsertNeed } from '../repo/needs.ts';
import { engagementTotalOf, loadGraph, type GraphRecord } from './graph.ts';
import { scoreWorkspace } from './scoring.ts';
import {
  ensureInitialModel,
  latestModel,
  listPhraseWeights,
  listSourceWeights,
  type RankingModel,
} from '../repo/ranking.ts';

export interface DeriveResult {
  recordsSeen: number;
  signalsCreated: number;
  signalsRemoved: number;
  needsCreated: number;
  needsUpdated: number;
  needsRemoved: number;
  modelVersion: number;
}

/**
 * Re-classifies every source record and stores one demand signal per (record, kind, phrase).
 * Inserting is idempotent thanks to the UNIQUE constraint, and signals whose rule no longer
 * fires are removed, so a re-run always converges on the same set of signals.
 */
export function deriveSignals(workspaceId: string): { created: number; removed: number } {
  const records = listWorkspaceRecords(workspaceId);
  let created = 0;
  let removed = 0;
  for (const record of records) {
    const signals = classifyText(record.text, record.platform);
    const keptByKind = new Map<SignalKind, string[]>();
    for (const signal of signals) {
      const result = run(
        `INSERT OR IGNORE INTO demand_signals
           (workspace_id, source_record_id, kind, strength, matched_phrase, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        workspaceId,
        record.id,
        signal.kind,
        signal.strength,
        signal.matchedPhrase,
        new Date().toISOString(),
      );
      created += result.changes;
      keptByKind.set(signal.kind, [
        ...(keptByKind.get(signal.kind) ?? []),
        signal.matchedPhrase,
      ]);
    }
    for (const [kind, phrases] of keptByKind) {
      const placeholders = phrases.map(() => '?').join(', ');
      removed += run(
        `DELETE FROM demand_signals
         WHERE workspace_id = ? AND source_record_id = ? AND kind = ?
           AND matched_phrase NOT IN (${placeholders})`,
        workspaceId,
        record.id,
        kind,
        ...phrases,
      ).changes;
    }
    if (!keptByKind.size) {
      removed += run(
        'DELETE FROM demand_signals WHERE workspace_id = ? AND source_record_id = ?',
        workspaceId,
        record.id,
      ).changes;
    }
  }
  return { created, removed };
}

/**
 * Groups the workspace records into needs, then (re)links the evidence.
 * Grouping is deterministic, so re-running ingestion on unchanged data yields the same needs,
 * the same evidence links and therefore no duplicate records, signals or needs.
 */
export function deriveNeeds(
  workspaceId: string,
  records: GroupableRecord[],
  recordById: Map<number, GraphRecord>,
): { created: number; updated: number; removed: number } {
  const clusters = groupRecords(records);
  let created = 0;
  let updated = 0;

  for (const cluster of clusters) {
    const members = cluster.memberRecordIds
      .map((id) => recordById.get(id))
      .filter((record): record is GraphRecord => Boolean(record));
    if (!members.length) continue;
    const timestamps = members.map((record) => Date.parse(record.publishedAt)).sort((a, b) => a - b);
    const firstSeenAt = new Date(timestamps[0] ?? Date.now()).toISOString();
    const lastSeenAt = new Date(timestamps[timestamps.length - 1] ?? Date.now()).toISOString();
    const { need, created: isNew } = upsertNeed({
      workspaceId,
      key: cluster.key,
      title: cluster.title,
      summary: buildSummary(members),
      firstSeenAt,
      lastSeenAt,
    });
    if (isNew) created += 1;
    else updated += 1;
    for (const member of members) {
      linkEvidence(workspaceId, need.id, member.id);
    }
    const keep = new Set(members.map((member) => member.id));
    pruneOrphans(workspaceId, need.id, keep);
  }

  const removed = deleteNeedsWithoutEvidence(workspaceId);
  return { created, updated, removed };
}

function pruneOrphans(workspaceId: string, needId: number, keep: Set<number>): void {
  run('DELETE FROM need_evidence WHERE need_id = ? AND workspace_id = ?', needId, workspaceId);
  for (const recordId of keep) {
    run(
      `INSERT OR IGNORE INTO need_evidence (workspace_id, need_id, source_record_id, added_at)
       VALUES (?, ?, ?, ?)`,
      workspaceId,
      needId,
      recordId,
      new Date().toISOString(),
    );
  }
}

function buildSummary(members: GraphRecord[]): string {
  if (!members.length) return 'No evidence linked yet.';
  const platforms = new Set(members.map((record) => record.platform));
  const kinds = new Map<SignalKind, number>();
  for (const record of members) {
    for (const signal of record.signals) {
      kinds.set(signal.kind, (kinds.get(signal.kind) ?? 0) + 1);
    }
  }
  const kindText = Array.from(kinds.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => `${SIGNAL_LABELS[kind]} (${count})`)
    .join(', ');
  const engagement = members.reduce(
    (sum, record) => sum + engagementTotalOf(record.engagement as EngagementCounts),
    0,
  );
  return [
    `${members.length} public record${members.length === 1 ? '' : 's'}`,
    `on ${Array.from(platforms).join(' and ')}`,
    kindText ? `signals: ${kindText}` : 'no strong demand signals detected',
    `${engagement} total engagement`,
  ].join(' · ');
}

/** Recomputes signals, needs and scores for a workspace. Called after every ingestion. */
export function recomputeWorkspace(
  workspaceId: string,
  options: { actorUserId?: string | null } = {},
): DeriveResult {
  const model = ensureInitialModel(workspaceId, options.actorUserId ?? null);

  const signals = deriveSignals(workspaceId);

  const graph = loadGraph(workspaceId);
  const needs = deriveNeeds(
    workspaceId,
    graph.records.map((record) => ({
      recordId: record.id,
      platform: record.platform,
      externalId: record.externalId,
      publishedAt: record.publishedAt,
      text: record.text,
      engagementTotal: engagementTotalOf(record.engagement),
    })),
    graph.recordById,
  );

  const refreshed = loadGraph(workspaceId);
  scoreWorkspace(workspaceId, refreshed.needs, {
    modelVersion: model.version,
    weights: model.weights,
    phraseWeights: listPhraseWeights(workspaceId),
    sourceWeights: listSourceWeights(workspaceId),
  });

  return {
    recordsSeen: refreshed.records.length,
    signalsCreated: signals.created,
    signalsRemoved: signals.removed,
    needsCreated: needs.created,
    needsUpdated: needs.updated,
    needsRemoved: needs.removed,
    modelVersion: latestModel(workspaceId)?.version ?? model.version,
  };
}

export function currentModel(workspaceId: string, actorUserId?: string | null): RankingModel {
  return ensureInitialModel(workspaceId, actorUserId ?? null);
}
