import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreNeed,
  feedbackMultiplierFor,
  phraseMultiplierFor,
  sourceMultiplierFor,
} from '../src/rank.ts';
import { DEFAULT_WEIGHTS } from '../src/types.ts';
import type { RankInput, RankOptions } from '../src/rank.ts';

const NOW = new Date('2026-09-01T12:00:00Z');
const iso = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function options(overrides: Partial<RankOptions> = {}): RankOptions {
  return {
    weights: DEFAULT_WEIGHTS,
    phraseWeights: {},
    sourceWeights: {},
    ...overrides,
  };
}

function input(overrides: Partial<RankInput> = {}): RankInput {
  return {
    phrases: ['invoic', 'chase'],
    feedback: {
      relevant: 0,
      irrelevant: 0,
      needRelevant: 0,
      needIrrelevant: 0,
      willingnessToPay: 0,
      contacted: 0,
    },
    now: NOW,
    evidence: [
      {
        platform: 'reddit',
        author: 'ana',
        subreddit: 'r/SaaS',
        publishedAt: iso(2),
        engagementTotal: 12,
        signals: [{ kind: 'tool_request', strength: 0.9 }],
      },
    ],
    ...overrides,
  };
}

test('scores are clamped to 0..100 and explained line by line', () => {
  const breakdown = scoreNeed(input(), options());
  assert.ok(breakdown.score >= 0 && breakdown.score <= 100);
  assert.equal(breakdown.components.length, 5);
  assert.ok(breakdown.explanation.length >= 5);
  assert.ok(breakdown.explanation.at(-1)?.includes('Final score'));
});

test('component points add up to the weighted base score', () => {
  const breakdown = scoreNeed(input(), options());
  const sum = breakdown.components.reduce((total, component) => total + component.points, 0);
  assert.ok(Math.abs(sum - breakdown.basePoints) < 0.05, `${sum} vs ${breakdown.basePoints}`);
});

test('more evidence raises the frequency component', () => {
  const single = scoreNeed(input(), options());
  const many = scoreNeed(
    input({
      evidence: Array.from({ length: 6 }, (_, index) => ({
        platform: index % 2 === 0 ? ('reddit' as const) : ('x' as const),
        author: `author-${index}`,
        subreddit: index % 2 === 0 ? 'r/SaaS' : null,
        publishedAt: iso(1 + index),
        engagementTotal: 8,
        signals: [{ kind: 'tool_request' as const, strength: 0.9 }],
      })),
    }),
    options(),
  );
  const frequencyOf = (breakdown: ReturnType<typeof scoreNeed>) =>
    breakdown.components.find((component) => component.key === 'frequency')?.value ?? 0;
  assert.ok(frequencyOf(many) > frequencyOf(single));
  assert.ok(many.score > single.score);
});

test('recency decays: fresh evidence outranks old evidence', () => {
  const fresh = scoreNeed(input(), options());
  const stale = scoreNeed(
    input({
      evidence: [
        {
          platform: 'reddit',
          author: 'ana',
          subreddit: 'r/SaaS',
          publishedAt: iso(400),
          engagementTotal: 12,
          signals: [{ kind: 'tool_request', strength: 0.9 }],
        },
      ],
    }),
    options(),
  );
  const recencyOf = (breakdown: ReturnType<typeof scoreNeed>) =>
    breakdown.components.find((component) => component.key === 'recency')?.value ?? 0;
  assert.ok(recencyOf(fresh) > recencyOf(stale));
  assert.ok(fresh.score > stale.score);
});

test('cross-source diversity is rewarded', () => {
  const single = scoreNeed(input(), options());
  const diverse = scoreNeed(
    input({
      evidence: [
        {
          platform: 'reddit',
          author: 'ana',
          subreddit: 'r/SaaS',
          publishedAt: iso(2),
          engagementTotal: 12,
          signals: [{ kind: 'tool_request', strength: 0.9 }],
        },
        {
          platform: 'x',
          author: 'bo',
          subreddit: null,
          publishedAt: iso(3),
          engagementTotal: 12,
          signals: [{ kind: 'tool_request', strength: 0.9 }],
        },
      ],
    }),
    options(),
  );
  const diversityOf = (breakdown: ReturnType<typeof scoreNeed>) =>
    breakdown.components.find((component) => component.key === 'diversity')?.value ?? 0;
  assert.ok(diversityOf(diverse) > diversityOf(single));
});

test('willingness to pay and contacted add an outcome bonus', () => {
  const plain = scoreNeed(input(), options());
  const bonus = scoreNeed(
    input({
      feedback: {
        relevant: 0,
        irrelevant: 0,
        needRelevant: 0,
        needIrrelevant: 0,
        willingnessToPay: 1,
        contacted: 1,
      },
    }),
    options(),
  );
  assert.equal(plain.bonusPoints, 0);
  assert.equal(bonus.bonusPoints, 17);
  assert.ok(bonus.score > plain.score);
});

test('irrelevant feedback lowers the score and relevant feedback raises it', () => {
  const base = scoreNeed(input(), options());
  const down = scoreNeed(
    input({
      feedback: {
        relevant: 0,
        irrelevant: 0,
        needRelevant: 0,
        needIrrelevant: 2,
        willingnessToPay: 0,
        contacted: 0,
      },
    }),
    options(),
  );
  const up = scoreNeed(
    input({
      feedback: {
        relevant: 0,
        irrelevant: 0,
        needRelevant: 2,
        needIrrelevant: 0,
        willingnessToPay: 0,
        contacted: 0,
      },
    }),
    options(),
  );
  assert.ok(down.score < base.score, 'irrelevant reviews must push a need down');
  assert.ok(up.score > base.score, 'relevant reviews must push a need up');
});

test('learned phrase and source multipliers are applied and clamped', () => {
  assert.equal(phraseMultiplierFor(['invoic'], {}), 1);
  assert.equal(phraseMultiplierFor(['invoic'], { invoic: 1.18 }), 1.18);
  assert.equal(phraseMultiplierFor(['invoic'], { invoic: 99 }), 1.8);
  assert.equal(phraseMultiplierFor(['invoic'], { invoic: 0 }), 0.4);
  assert.equal(
    sourceMultiplierFor(
      [
        {
          platform: 'reddit',
          author: null,
          subreddit: null,
          publishedAt: iso(1),
          engagementTotal: 1,
          signals: [],
        },
      ],
      { reddit: 0.75 },
    ),
    0.75,
  );
});

test('the feedback multiplier is bounded', () => {
  const neutral = feedbackMultiplierFor({
    relevant: 0,
    irrelevant: 0,
    needRelevant: 0,
    needIrrelevant: 0,
    willingnessToPay: 0,
    contacted: 0,
  });
  assert.equal(neutral, 1);
  assert.ok(feedbackMultiplierFor({
    relevant: 50,
    irrelevant: 0,
    needRelevant: 0,
    needIrrelevant: 0,
    willingnessToPay: 0,
    contacted: 0,
  }) <= 2.2);
  assert.ok(feedbackMultiplierFor({
    relevant: 0,
    irrelevant: 50,
    needRelevant: 0,
    needIrrelevant: 0,
    willingnessToPay: 0,
    contacted: 0,
  }) >= 0.2);
});

test('a need with no evidence scores zero', () => {
  const breakdown = scoreNeed(input({ evidence: [], phrases: [] }), options());
  assert.equal(breakdown.score, 0);
  assert.equal(breakdown.basePoints, 0);
});
