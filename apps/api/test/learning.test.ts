import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, SNAPSHOT, ACME_ADMIN, BETA_ADMIN } from './helpers.ts';

async function setup() {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie });
  const list = await api.request('GET', '/api/needs?sort=score&pageSize=50', { cookie });
  return { api, cookie, needs: list.body.needs as { id: number; title: string; score: number }[] };
}

test('feedback is stored and immediately changes the score of the reviewed need', async () => {
  const { api, cookie, needs } = await setup();
  const top = needs[0];

  const created = await api.request('POST', `/api/needs/${top.id}/feedback`, {
    cookie,
    body: { relevant: true, willingnessToPay: true, contacted: true, note: 'strong signal' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.feedback.relevant, true);
  assert.equal(created.body.feedback.willingnessToPay, true);
  assert.equal(created.body.feedback.contacted, true);
  assert.equal(created.body.feedback.note, 'strong signal');
  assert.ok(Object.keys(created.body.weights.phraseWeights).length > 0);

  const after = await api.request('GET', '/api/needs?sort=score&pageSize=50', { cookie });
  const reviewed = after.body.needs.find((need: { id: number }) => need.id === top.id);
  assert.ok(reviewed.score > top.score, `${reviewed.score} should exceed ${top.score}`);
  assert.equal(reviewed.feedback.relevant, 1);
  assert.equal(reviewed.feedback.willingnessToPay, 1);
  assert.equal(reviewed.feedback.contacted, 1);
  assert.ok(reviewed.breakdown.bonusPoints > 0, 'willingness to pay adds an outcome bonus');
});

test('marking a need irrelevant pushes it down the ranking', async () => {
  const { api, cookie, needs } = await setup();
  const target = needs[0];
  await api.request('POST', `/api/needs/${target.id}/feedback`, {
    cookie,
    body: { relevant: false },
  });
  const after = await api.request('GET', '/api/needs?sort=score&pageSize=50', { cookie });
  const reviewed = after.body.needs.find((need: { id: number }) => need.id === target.id);
  assert.ok(reviewed.score < target.score, `${reviewed.score} should be below ${target.score}`);
  assert.ok(reviewed.breakdown.feedbackMultiplier < 1);
});

test('rescore creates a new version, records the change and reports rank movement', async () => {
  const { api, cookie, needs } = await setup();
  const lowest = needs[needs.length - 1];
  const rankingBeforeFeedback = await api.request('GET', '/api/needs?sort=score&pageSize=50', {
    cookie,
  });
  await api.request('POST', `/api/needs/${lowest.id}/feedback`, {
    cookie,
    body: { relevant: true, willingnessToPay: true },
  });

  const versionsBefore = await api.request('GET', '/api/ranking/versions', { cookie });
  const pendingBefore = (await api.request('GET', '/api/feedback', { cookie })).body.pendingCount;
  const before = await api.request('GET', '/api/needs?sort=score&pageSize=50', { cookie });
  const result = await api.request('POST', '/api/ranking/rescore', { cookie });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, versionsBefore.body.versions[0].version + 1);
  assert.equal(result.body.previousVersion, versionsBefore.body.versions[0].version);
  assert.ok(result.body.changes.length > 0);
  assert.ok(result.body.changeSummary.length > 0);
  assert.ok(
    result.body.changeSummary.some((line: string) =>
      line.includes(`Version ${result.body.version} created`),
    ),
    'the summary must name the new version',
  );
  assert.ok(
    result.body.changeSummary.some((line: string) => line.includes('feedback')),
    'the summary must cite the feedback that caused the change',
  );
  assert.equal(result.body.feedbackApplied.length, pendingBefore);

  const moved = result.body.changes.find(
    (change: { needId: number }) => change.needId === lowest.id,
  );
  assert.ok(moved, 'the reviewed need must appear in the change list');
  assert.ok(moved.scoreDelta > 0, `expected a score increase, got ${moved.scoreDelta}`);
  assert.ok(
    moved.rankDelta === null || moved.rankDelta > 0,
    `expected the need to climb, got ${moved.rankDelta}`,
  );

  const after = await api.request('GET', '/api/needs?sort=score&pageSize=50', { cookie });
  // Feedback is applied to the weights immediately, so the published ranking already moved
  // before the explicit re-score; compare against the ranking from before the review.
  const rankBefore = rankingBeforeFeedback.body.needs.findIndex(
    (need: { id: number }) => need.id === lowest.id,
  );
  const rankAfter = after.body.needs.findIndex((need: { id: number }) => need.id === lowest.id);
  assert.ok(rankAfter < rankBefore, `rank should improve: ${rankBefore} -> ${rankAfter}`);
  // The re-score itself must persist the improvement as a new version.
  assert.ok(moved.previousScore !== null);
  assert.ok(moved.score > moved.previousScore);
});

test('ranking versions keep full provenance of the feedback that produced them', async () => {
  const { api, cookie, needs } = await setup();
  await api.request('POST', `/api/needs/${needs[0].id}/feedback`, {
    cookie,
    body: { relevant: false, note: 'not a SaaS demand' },
  });
  const before = await api.request('GET', '/api/ranking/versions', { cookie });
  await api.request('POST', '/api/ranking/rescore', { cookie });

  const versions = await api.request('GET', '/api/ranking/versions', { cookie });
  assert.equal(versions.status, 200);
  assert.equal(versions.body.versions.length, before.body.versions.length + 1);
  const latest = versions.body.versions[0];
  assert.equal(latest.version, before.body.versions[0].version + 1);
  assert.equal(latest.createdByEmail, ACME_ADMIN.email);
  assert.equal(latest.feedback.length, 1);
  assert.equal(latest.feedback[0].relevant, false);
  assert.equal(latest.feedback[0].note, 'not a SaaS demand');
  assert.ok(Object.keys(latest.phraseWeights).length > 0);
  assert.ok(Object.keys(latest.sourceWeights).length >= 1);
  assert.ok(versions.body.versions[1].changeSummary.length > 0);
});

test('a second rescore without new feedback keeps weights stable but still versions', async () => {
  const { api, cookie } = await setup();
  const first = await api.request('POST', '/api/ranking/rescore', { cookie });
  const second = await api.request('POST', '/api/ranking/rescore', { cookie });
  assert.equal(second.body.version, first.body.version + 1);
  assert.deepEqual(second.body.feedbackApplied, []);
  assert.ok(
    second.body.changeSummary.some((line: string) => line.includes('No new reviewer feedback')),
  );
  assert.deepEqual(second.body.phraseWeights, first.body.phraseWeights);
});

test('evidence level feedback is linked to the need and changes its score', async () => {
  const { api, cookie, needs } = await setup();
  const detail = await api.request('GET', `/api/needs/${needs[0].id}`, { cookie });
  const evidence = detail.body.need.evidence[0];
  const response = await api.request(
    'POST',
    `/api/needs/${needs[0].id}/evidence/${evidence.sourceRecordId}/feedback`,
    { cookie, body: { relevant: false } },
  );
  assert.equal(response.status, 201);
  assert.equal(response.body.feedback.targetType, 'evidence');
  assert.equal(response.body.feedback.sourceRecordId, evidence.sourceRecordId);

  const after = await api.request('GET', `/api/needs/${needs[0].id}`, { cookie });
  assert.ok(after.body.need.feedbackHistory.length >= 1);
  assert.ok(
    after.body.need.evidence.some(
      (item: { sourceRecordId: number; feedback: unknown[] }) =>
        item.sourceRecordId === evidence.sourceRecordId && item.feedback.length >= 1,
    ),
    'evidence feedback must be visible on the evidence itself',
  );
});

test('feedback cannot be written against another workspace or missing targets', async () => {
  const { api, needs } = await setup();
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const foreign = await api.request('POST', `/api/needs/${needs[0].id}/feedback`, {
    cookie: beta,
    body: { relevant: true },
  });
  assert.equal(foreign.status, 404);

  const missing = await api.request('POST', '/api/needs/999999/feedback', {
    cookie: acme,
    body: { relevant: true },
  });
  assert.equal(missing.status, 404);

  const missingEvidence = await api.request(
    'POST',
    `/api/needs/${needs[0].id}/evidence/987654/feedback`,
    { cookie: acme, body: { relevant: true } },
  );
  assert.equal(missingEvidence.status, 404);
});

test('the learning view exposes every review with its phrases and applied versions', async () => {
  const { api, cookie, needs } = await setup();
  const countBefore = (await api.request('GET', '/api/feedback', { cookie })).body.feedback.length;
  await api.request('POST', `/api/needs/${needs[0].id}/feedback`, {
    cookie,
    body: { relevant: true, willingnessToPay: true, note: 'lead' },
  });
  const rescore = await api.request('POST', '/api/ranking/rescore', { cookie });

  const feedback = await api.request('GET', '/api/feedback', { cookie });
  assert.equal(feedback.status, 200);
  assert.equal(feedback.body.feedback.length, countBefore + 1);
  assert.equal(feedback.body.pendingCount, 0, 'the rescore consumed every pending review');
  const entry = feedback.body.feedback[0];
  assert.equal(entry.actorEmail, ACME_ADMIN.email);
  assert.deepEqual(entry.appliedInVersions, [rescore.body.version]);
  assert.ok(entry.phrases.length > 0);
  assert.equal(entry.needTitle, needs[0].title);
  assert.ok(['x', 'reddit'].includes(entry.platform), `unexpected platform ${entry.platform}`);
  assert.equal(feedback.body.modelVersion, rescore.body.version);
});

test('feedback is workspace scoped', async () => {
  const { api, needs } = await setup();
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.request('POST', `/api/needs/${needs[0].id}/feedback`, {
    cookie: acme,
    body: { relevant: true },
  });
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  const betaFeedback = await api.request('GET', '/api/feedback', { cookie: beta });
  assert.equal(betaFeedback.status, 200);
  const ids = betaFeedback.body.feedback.map((entry: { id: number }) => entry.id);
  assert.ok(!ids.includes(1) || betaFeedback.body.feedback.every((entry: { needId: number }) => {
    // Beta may have its own feedback, but never Acme's.
    return entry.needId !== needs[0].id;
  }));
});
