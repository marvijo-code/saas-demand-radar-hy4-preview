import type {
  Platform,
  RankingWeights,
  ScoreBreakdown,
  ScoreComponent,
  SignalKind,
} from './types.ts';
import { DEFAULT_WEIGHTS, SIGNAL_LABELS } from './types.ts';

export interface RankEvidenceInput {
  platform: Platform;
  author: string | null;
  subreddit: string | null;
  publishedAt: string;
  engagementTotal: number;
  signals: { kind: SignalKind; strength: number }[];
}

export interface RankFeedbackInput {
  relevant: number;
  irrelevant: number;
  willingnessToPay: number;
  contacted: number;
  /** Feedback left directly on this need. */
  needRelevant: number;
  needIrrelevant: number;
}

export interface RankInput {
  evidence: RankEvidenceInput[];
  phrases: string[];
  feedback: RankFeedbackInput;
  /** Current time used for the recency component. */
  now: Date;
}

export interface RankOptions {
  weights: RankingWeights;
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
}

const COMPONENT_LABELS: Record<string, string> = {
  frequency: 'Frequency',
  recency: 'Recency',
  intent: 'Intent strength',
  engagement: 'Engagement',
  diversity: 'Cross-source diversity',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function logNormalise(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return clamp(Math.log2(1 + value) / Math.log2(1 + ceiling), 0, 1);
}

/**
 * Computes the demand score of a single need (0..100) together with a full explanation.
 *
 * score = (Σ weight_c × component_c) × 100 × phraseMultiplier × sourceMultiplier
 *         × feedbackMultiplier + bonusPoints
 *
 * - the five components are normalised measurements (0..1) taken from the public evidence
 * - the multipliers come from persisted reviewer feedback (see `learning.ts` in the API)
 * - bonus points reward evidence where a person said they would pay or became a lead
 */
export function scoreNeed(input: RankInput, options: RankOptions): ScoreBreakdown {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const evidence = input.evidence;
  const nowMs = input.now.getTime();

  const frequencyRaw = evidence.length;
  const frequency = logNormalise(frequencyRaw, 8);

  let recencySum = 0;
  let newest = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (const item of evidence) {
    const published = Date.parse(item.publishedAt);
    if (Number.isNaN(published)) continue;
    const ageDays = Math.max(0, (nowMs - published) / 86_400_000);
    recencySum += Math.exp(-ageDays / Math.max(1, weights.recencyHalfLifeDays));
    newest = Math.max(newest, published);
    oldest = Math.min(oldest, published);
  }
  const recency = evidence.length ? clamp(recencySum / evidence.length, 0, 1) : 0;

  const strengths: number[] = [];
  for (const item of evidence) {
    for (const signal of item.signals) {
      if (signal.kind === 'buying_intent' || signal.kind === 'tool_request') {
        strengths.push(signal.strength);
      } else {
        // Supporting signals (workarounds, price pain, recurring pain) still indicate real
        // demand, but they are weaker evidence than an explicit request to buy.
        strengths.push(signal.strength * 0.55);
      }
    }
  }
  strengths.sort((a, b) => b - a);
  const topStrengths = strengths.slice(0, 3);
  const intent = topStrengths.length
    ? clamp(topStrengths.reduce((sum, value) => sum + value, 0) / topStrengths.length, 0, 1)
    : 0;

  const totalEngagement = evidence.reduce((sum, item) => sum + Math.max(0, item.engagementTotal), 0);
  const engagement = logNormalise(totalEngagement, 50);

  const platforms = new Set(evidence.map((item) => item.platform));
  const authors = new Set(
    evidence.map((item) => (item.author ?? '').toLowerCase()).filter((value) => value.length > 0),
  );
  const subreddits = new Set(
    evidence.map((item) => (item.subreddit ?? '').toLowerCase()).filter((value) => value.length > 0),
  );
  const diversity = clamp(
    0.6 * Math.min(1, platforms.size / 2) +
      0.3 * Math.min(1, authors.size / 3) +
      0.1 * Math.min(1, subreddits.size / 2),
    0,
    1,
  );

  const rawComponents: Record<string, { value: number; detail: string }> = {
    frequency: {
      value: frequency,
      detail: `${frequencyRaw} source record${frequencyRaw === 1 ? '' : 's'} grouped into this need`,
    },
    recency: {
      value: recency,
      detail: evidence.length
        ? `Newest evidence ${formatAge(nowMs - newest)}, oldest ${formatAge(nowMs - oldest)}`
        : 'No evidence',
    },
    intent: {
      value: intent,
      detail: topStrengths.length
        ? `Strongest signals average ${round(intent * 100, 0)}% confidence`
        : 'No buying-intent or tool-request language detected',
    },
    engagement: {
      value: engagement,
      detail: `${totalEngagement} total likes, comments, reposts and upvotes`,
    },
    diversity: {
      value: diversity,
      detail: `${platforms.size} platform${platforms.size === 1 ? '' : 's'}, ${authors.size} author${authors.size === 1 ? '' : 's'}${subreddits.size ? `, ${subreddits.size} subreddit${subreddits.size === 1 ? '' : 's'}` : ''}`,
    },
  };

  const weightSum =
    weights.frequency + weights.recency + weights.intent + weights.engagement + weights.diversity ||
    1;

  const components: ScoreComponent[] = (
    ['frequency', 'recency', 'intent', 'engagement', 'diversity'] as const
  ).map((key) => {
    const weight = round(weights[key] / weightSum, 4);
    const value = round(rawComponents[key].value, 4);
    return {
      key,
      label: COMPONENT_LABELS[key],
      value,
      weight,
      points: round(value * weight * 100, 2),
      detail: rawComponents[key].detail,
    };
  });

  const basePoints = round(
    components.reduce((sum, component) => sum + component.points, 0),
    2,
  );

  const phraseMultiplier = round(phraseMultiplierFor(input.phrases, options.phraseWeights), 3);
  const sourceMultiplier = round(sourceMultiplierFor(evidence, options.sourceWeights), 3);
  const feedbackMultiplier = round(feedbackMultiplierFor(input.feedback), 3);

  let bonusPoints = 0;
  if (input.feedback.willingnessToPay > 0) bonusPoints += 12;
  if (input.feedback.contacted > 0) bonusPoints += 5;
  bonusPoints = round(bonusPoints, 2);

  const score = clamp(
    round(basePoints * phraseMultiplier * sourceMultiplier * feedbackMultiplier + bonusPoints, 1),
    0,
    100,
  );

  const explanation: string[] = [];
  for (const component of components) {
    explanation.push(
      `${component.label}: ${round(component.value * 100)}% measured × ${round(component.weight * 100)}% weight = ${round(component.points, 1)} points (${component.detail})`,
    );
  }
  explanation.push(`Weighted base score: ${basePoints} / 100.`);
  if (phraseMultiplier !== 1) {
    explanation.push(`Learned phrase weight multiplier: ×${phraseMultiplier}.`);
  }
  if (sourceMultiplier !== 1) {
    explanation.push(`Learned source weight multiplier: ×${sourceMultiplier}.`);
  }
  if (feedbackMultiplier !== 1) {
    explanation.push(
      `Reviewer feedback multiplier: ×${feedbackMultiplier} (${input.feedback.relevant} relevant, ${input.feedback.irrelevant} irrelevant).`,
    );
  }
  if (bonusPoints > 0) {
    explanation.push(
      `Outcome bonus: +${bonusPoints} points for ${input.feedback.willingnessToPay} willingness-to-pay and ${input.feedback.contacted} contacted outcome(s).`,
    );
  }
  explanation.push(`Final score: ${score} / 100.`);

  return {
    components,
    basePoints,
    phraseMultiplier,
    sourceMultiplier,
    feedbackMultiplier,
    bonusPoints,
    score,
    explanation,
  };
}

export function phraseMultiplierFor(
  phrases: string[],
  phraseWeights: Record<string, number>,
): number {
  const usable = phrases
    .map((phrase) => phraseWeights[phrase])
    .filter((weight): weight is number => typeof weight === 'number' && Number.isFinite(weight));
  if (!usable.length) return 1;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  return clamp(mean, 0.4, 1.8);
}

export function sourceMultiplierFor(
  evidence: RankEvidenceInput[],
  sourceWeights: Record<string, number>,
): number {
  const usable = evidence
    .map((item) => sourceWeights[item.platform])
    .filter((weight): weight is number => typeof weight === 'number' && Number.isFinite(weight));
  if (!usable.length) return 1;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  return clamp(mean, 0.4, 1.8);
}

export function feedbackMultiplierFor(feedback: RankFeedbackInput): number {
  const irrelevant = feedback.needIrrelevant + feedback.irrelevant;
  const relevant = feedback.needRelevant + feedback.relevant;
  let multiplier = 1;
  multiplier *= Math.pow(0.62, Math.min(3, irrelevant));
  multiplier *= Math.pow(1.18, Math.min(3, relevant));
  return clamp(multiplier, 0.2, 2.2);
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

export function signalLabel(kind: SignalKind): string {
  return SIGNAL_LABELS[kind];
}
