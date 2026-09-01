import {
  scoreNeed,
  type RankFeedbackInput,
  type RankInput,
} from '@sdr/shared';
import type { RankingWeights, ScoreBreakdown } from '@sdr/shared';
import type { GraphNeed } from './graph.ts';
import { engagementTotalOf, needPhrases } from './graph.ts';
import { saveScore } from '../repo/needs.ts';

export interface NeedScoreResult {
  needId: number;
  score: number;
  rank: number;
  breakdown: ScoreBreakdown;
}

export function feedbackAggregate(need: GraphNeed): RankFeedbackInput & {
  willingnessToPay: number;
  contacted: number;
} {
  let relevant = 0;
  let irrelevant = 0;
  let needRelevant = 0;
  let needIrrelevant = 0;
  let willingnessToPay = 0;
  let contacted = 0;
  for (const entry of need.feedback) {
    if (entry.relevant === true) {
      if (entry.targetType === 'need') needRelevant += 1;
      else relevant += 1;
    }
    if (entry.relevant === false) {
      if (entry.targetType === 'need') needIrrelevant += 1;
      else irrelevant += 1;
    }
    if (entry.willingnessToPay) willingnessToPay += 1;
    if (entry.contacted) contacted += 1;
  }
  return { relevant, irrelevant, needRelevant, needIrrelevant, willingnessToPay, contacted };
}

export function buildRankInput(need: GraphNeed, now: Date): RankInput {
  return {
    phrases: needPhrases(need),
    feedback: feedbackAggregate(need),
    now,
    evidence: need.evidence.map((record) => ({
      platform: record.platform,
      author: record.author,
      subreddit: record.subreddit,
      publishedAt: record.publishedAt,
      engagementTotal: engagementTotalOf(record.engagement),
      signals: record.signals,
    })),
  };
}

export function scoreNeedFromGraph(
  need: GraphNeed,
  options: {
    weights: RankingWeights;
    phraseWeights: Record<string, number>;
    sourceWeights: Record<string, number>;
    now: Date;
  },
): ScoreBreakdown {
  return scoreNeed(buildRankInput(need, options.now), options);
}

/**
 * Scores every need of a workspace, assigns ranks and persists one row per need
 * for the given ranking-model version.
 */
export function scoreWorkspace(
  workspaceId: string,
  needs: GraphNeed[],
  options: {
    modelVersion: number;
    weights: RankingWeights;
    phraseWeights: Record<string, number>;
    sourceWeights: Record<string, number>;
    now?: Date;
  },
): NeedScoreResult[] {
  const now = options.now ?? new Date();
  const scored = needs.map((need) => ({
    need,
    breakdown: scoreNeedFromGraph(need, {
      weights: options.weights,
      phraseWeights: options.phraseWeights,
      sourceWeights: options.sourceWeights,
      now,
    }),
  }));

  scored.sort((a, b) => {
    if (b.breakdown.score !== a.breakdown.score) return b.breakdown.score - a.breakdown.score;
    if (b.need.evidence.length !== a.need.evidence.length) {
      return b.need.evidence.length - a.need.evidence.length;
    }
    return a.need.id - b.need.id;
  });

  const results: NeedScoreResult[] = scored.map((entry, index) => {
    const rank = index + 1;
    saveScore({
      workspaceId,
      needId: entry.need.id,
      modelVersion: options.modelVersion,
      score: entry.breakdown.score,
      rank,
      breakdown: entry.breakdown,
    });
    return { needId: entry.need.id, score: entry.breakdown.score, rank, breakdown: entry.breakdown };
  });

  return results;
}
