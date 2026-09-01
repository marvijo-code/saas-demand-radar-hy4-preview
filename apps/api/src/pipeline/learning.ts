import { keyPhrases } from '@sdr/shared';
import type { GraphFeedback, GraphRecord, WorkspaceGraph } from './graph.ts';
import { engagementTotalOf } from './graph.ts';
import { loadGraph } from './graph.ts';
import {
  insertModel,
  latestModel,
  listModels,
  replacePhraseWeights,
  replaceSourceWeights,
  type RankingModel,
} from '../repo/ranking.ts';
import { listScores } from '../repo/needs.ts';
import { scoreWorkspace } from './scoring.ts';
import type { RankChange } from '@sdr/shared';

/** Weight is clamped so one noisy reviewer click can never drown a need completely. */
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.8;
const RELEVANT_STEP = 0.18;
const IRRELEVANT_STEP = 0.25;

export interface LearningContribution {
  feedbackId: number;
  actorEmail: string | null;
  targetType: 'need' | 'evidence';
  relevant: boolean | null;
  phrases: string[];
  platform: string | null;
  createdAt: string;
}

/**
 * Turns every reviewer decision into phrase and platform weight adjustments.
 *
 * A "relevant" decision raises the weight of the phrases that describe the need (and of the
 * platform it was found on); an "irrelevant" decision lowers them. Weights are recomputed
 * from the full feedback history on every pass, so the result never depends on the order in
 * which the reviewer clicked.
 */
export function computeWeightsFromFeedback(graph: WorkspaceGraph): {
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  contributions: LearningContribution[];
} {
  const phraseDeltas = new Map<string, { relevant: number; irrelevant: number }>();
  const sourceDeltas = new Map<string, { relevant: number; irrelevant: number }>();
  const contributions: LearningContribution[] = [];

  const recordById: Map<number, GraphRecord> = new Map(
    graph.records.map((record) => [record.id, record]),
  );
  const evidenceByNeed: Map<number, GraphRecord[]> = new Map(
    graph.needs.map((need) => [need.id, need.evidence] as const),
  );

  for (const entry of graph.feedback) {
    const phrases = phrasesForFeedback(entry, recordById, evidenceByNeed);
    const platform = platformForFeedback(entry, recordById, evidenceByNeed);
    const contribution: LearningContribution = {
      feedbackId: entry.id,
      actorEmail: entry.actorEmail,
      targetType: entry.targetType,
      relevant: entry.relevant,
      phrases,
      platform,
      createdAt: entry.createdAt,
    };
    contributions.push(contribution);
    if (entry.relevant === null) continue;
    for (const phrase of phrases) {
      const delta = phraseDeltas.get(phrase) ?? { relevant: 0, irrelevant: 0 };
      if (entry.relevant) delta.relevant += 1;
      else delta.irrelevant += 1;
      phraseDeltas.set(phrase, delta);
    }
    if (platform) {
      const delta = sourceDeltas.get(platform) ?? { relevant: 0, irrelevant: 0 };
      if (entry.relevant) delta.relevant += 1;
      else delta.irrelevant += 1;
      sourceDeltas.set(platform, delta);
    }
  }

  const phraseWeights: Record<string, number> = {};
  for (const [phrase, delta] of [...phraseDeltas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const weight = 1 + delta.relevant * RELEVANT_STEP - delta.irrelevant * IRRELEVANT_STEP;
    phraseWeights[phrase] = round(clamp(weight, MIN_WEIGHT, MAX_WEIGHT));
  }

  const sourceWeights: Record<string, number> = {};
  for (const [platform, delta] of [...sourceDeltas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const weight = 1 + delta.relevant * RELEVANT_STEP - delta.irrelevant * IRRELEVANT_STEP;
    sourceWeights[platform] = round(clamp(weight, MIN_WEIGHT, MAX_WEIGHT));
  }

  return { phraseWeights, sourceWeights, contributions };
}

function phrasesForFeedback(
  feedback: GraphFeedback,
  recordById: Map<number, GraphRecord>,
  evidenceByNeed: Map<number, GraphRecord[]>,
): string[] {
  const texts: string[] = [];
  if (feedback.sourceRecordId !== null) {
    const record = recordById.get(feedback.sourceRecordId);
    if (record) texts.push(record.text);
  }
  if (!texts.length && feedback.needId !== null) {
    const evidence = evidenceByNeed.get(feedback.needId) ?? [];
    for (const record of [...evidence].sort(
      (a, b) => engagementTotalOf(b.engagement) - engagementTotalOf(a.engagement),
    )) {
      texts.push(record.text);
    }
  }
  return texts.length ? keyPhrases(texts.join(' '), 8) : [];
}

function platformForFeedback(
  feedback: GraphFeedback,
  recordById: Map<number, GraphRecord>,
  evidenceByNeed: Map<number, GraphRecord[]>,
): string | null {
  if (feedback.sourceRecordId !== null) {
    return recordById.get(feedback.sourceRecordId)?.platform ?? null;
  }
  if (feedback.needId !== null) {
    const evidence = evidenceByNeed.get(feedback.needId) ?? [];
    return evidence.length ? (evidence[0].platform ?? null) : null;
  }
  return null;
}

export interface RescoreResult {
  version: number;
  model: RankingModel;
  previousVersion: number | null;
  changes: RankChange[];
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  contributions: LearningContribution[];
  feedbackApplied: number[];
}

/**
 * Creates a new ranking-model version from the feedback recorded since the last version.
 *
 * The version stores the weights *and* the ids of the feedback rows that produced them, which
 * is exactly the provenance the "feedback learning" screen has to show.
 */
export function rescoreWorkspace(
  workspaceId: string,
  actor: { userId: string | null; email: string | null },
): RescoreResult {
  const previous: RankingModel | null = latestModel(workspaceId);
  const previousVersion = previous?.version ?? null;

  const graph = loadGraph(workspaceId);
  const { phraseWeights, sourceWeights, contributions } = computeWeightsFromFeedback(graph);

  const usedFeedbackIds = new Set<number>();
  for (const model of listModels(workspaceId)) {
    for (const id of model.feedbackIds) usedFeedbackIds.add(id);
  }
  const newFeedbackIds = graph.feedback
    .map((entry) => entry.id)
    .filter((id) => !usedFeedbackIds.has(id));

  replacePhraseWeights(workspaceId, phraseWeights);
  replaceSourceWeights(workspaceId, sourceWeights);

  const previousScores = new Map<number, { score: number; rank: number | null }>();
  if (previous) {
    const rows = listScoresFor(workspaceId, previous.version);
    for (const row of rows) {
      previousScores.set(row.need_id, { score: row.score, rank: row.rank });
    }
  }

  const version = (previous?.version ?? 0) + 1;
  const weights = previous?.weights ?? {
    frequency: 0.22,
    recency: 0.2,
    intent: 0.28,
    engagement: 0.15,
    diversity: 0.15,
    recencyHalfLifeDays: 10,
  };

  const scored = scoreWorkspace(workspaceId, graph.needs, {
    modelVersion: version,
    weights,
    phraseWeights,
    sourceWeights,
  });

  const changeSummary = buildChangeSummary({
    version,
    previous,
    previousScores,
    scored,
    graph,
    phraseWeights,
    sourceWeights,
    newFeedbackIds,
  });

  const model = insertModel({
    workspaceId,
    version,
    weights,
    phraseWeights,
    sourceWeights,
    changeSummary,
    feedbackIds: newFeedbackIds,
    createdBy: actor.userId,
  });

  const changes: RankChange[] = scored
    .map((entry) => {
      const before = previousScores.get(entry.needId) ?? null;
      const need = graph.needs.find((candidate) => candidate.id === entry.needId);
      const previousScore = before ? round(before.score) : null;
      const previousRank = before && before.rank !== null ? before.rank : null;
      return {
        needId: entry.needId,
        title: need?.title ?? `Need #${entry.needId}`,
        previousScore,
        score: round(entry.score),
        previousRank,
        rank: entry.rank,
        scoreDelta: round(entry.score - (before?.score ?? entry.score)),
        rankDelta:
          previousRank !== null && entry.rank !== null ? previousRank - entry.rank : null,
      };
    })
    .sort((a, b) => {
      if (b.rank !== null && a.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
      return Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta);
    });

  return {
    version,
    model,
    previousVersion,
    changes,
    phraseWeights,
    sourceWeights,
    contributions: contributions.filter((entry) => newFeedbackIds.includes(entry.feedbackId)),
    feedbackApplied: newFeedbackIds,
  };
}

function buildChangeSummary(input: {
  version: number;
  previous: RankingModel | null;
  previousScores: Map<number, { score: number; rank: number | null }>;
  scored: { needId: number; score: number; rank: number }[];
  graph: WorkspaceGraph;
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  newFeedbackIds: number[];
}): string[] {
  const summary: string[] = [];
  summary.push(
    input.previous
      ? `Version ${input.version} created from version ${input.previous.version}.`
      : `Version ${input.version} created from the default weights.`,
  );

  if (!input.newFeedbackIds.length) {
    summary.push('No new reviewer feedback since the previous version: weights are unchanged.');
  } else {
    summary.push(
      `Applied ${input.newFeedbackIds.length} new feedback entr${input.newFeedbackIds.length === 1 ? 'y' : 'ies'} (ids: ${input.newFeedbackIds.join(', ')}).`,
    );
    const before = input.previous?.phraseWeights ?? {};
    for (const [phrase, weight] of Object.entries(input.phraseWeights)) {
      const previousWeight = before[phrase] ?? 1;
      if (Math.abs(previousWeight - weight) < 0.001) continue;
      summary.push(
        `Phrase "${phrase}" weight ${round(previousWeight)} → ${round(weight)} from reviewer feedback.`,
      );
    }
    const beforeSources = input.previous?.sourceWeights ?? {};
    for (const [platform, weight] of Object.entries(input.sourceWeights)) {
      const previousWeight = beforeSources[platform] ?? 1;
      if (Math.abs(previousWeight - weight) < 0.001) continue;
      summary.push(
        `Source "${platform}" weight ${round(previousWeight)} → ${round(weight)} from reviewer feedback.`,
      );
    }
  }

  const movers = input.scored
    .map((entry) => {
      const before = input.previousScores.get(entry.needId);
      const rankDelta = before?.rank != null ? before.rank - entry.rank : null;
      const scoreDelta = entry.score - (before?.score ?? entry.score);
      return { entry, rankDelta, scoreDelta };
    })
    .filter((mover) => Math.abs(mover.scoreDelta) >= 0.05 || (mover.rankDelta ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta));

  if (!movers.length) {
    summary.push('Scores and ranks were unchanged: the evidence did not move.');
  } else {
    for (const mover of movers.slice(0, 5)) {
      const need = input.graph.needs.find((candidate) => candidate.id === mover.entry.needId);
      const title = need?.title ?? `Need #${mover.entry.needId}`;
      const rankText =
        mover.rankDelta && mover.rankDelta !== 0
          ? `, rank ${mover.rankDelta > 0 ? `+${mover.rankDelta}` : mover.rankDelta}`
          : '';
      summary.push(
        `${title}: score ${round(mover.scoreDelta, 1) >= 0 ? '+' : ''}${round(mover.scoreDelta, 1)}${rankText}.`,
      );
    }
  }

  return summary;
}

function listScoresFor(workspaceId: string, version: number) {
  return listScores(workspaceId, version).map((row) => ({
    need_id: row.need_id,
    score: row.score,
    rank: row.rank,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Recomputes the learned weights immediately after feedback is stored.
 *
 * This makes the effect of a review visible in the needs list straight away, while the
 * *versioned* model history is only advanced by an explicit re-score.
 */
export function refreshLearnedWeights(workspaceId: string): {
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
} {
  const graph = loadGraph(workspaceId);
  const { phraseWeights, sourceWeights } = computeWeightsFromFeedback(graph);
  replacePhraseWeights(workspaceId, phraseWeights);
  replaceSourceWeights(workspaceId, sourceWeights);
  return { phraseWeights, sourceWeights };
}
