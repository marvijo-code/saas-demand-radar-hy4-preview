import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, SNAPSHOT, ACME_ADMIN, BETA_ADMIN } from './helpers.ts';

test('ingesting the snapshot stores every record and derives signals and needs', async () => {
  const api = await getClient();
  const run = await api.ingest(SNAPSHOT.records);
  assert.equal(run.status, 'success');
  assert.equal(run.recordsSeen, SNAPSHOT.records.length);
  assert.equal(run.recordsCreated, SNAPSHOT.records.length);
  assert.equal(run.recordsFailed, 0);
  assert.ok(run.signalsCreated > 0);
  assert.ok(run.needsCreated > 0);

  const needs = await api.request('GET', '/api/needs?pageSize=50', {
    cookie: await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password),
  });
  assert.equal(needs.status, 200);
  assert.equal(needs.body.totals.records, SNAPSHOT.records.length);
  assert.ok(needs.body.needs.length > 0);
});

test('ingestion is idempotent: a repeat run creates no duplicates', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const before = await api.request('GET', '/api/needs?pageSize=1', { cookie });
  const first = await api.ingest(SNAPSHOT.records, { cookie });
  const second = await api.ingest(SNAPSHOT.records, { cookie });
  const third = await api.ingest(SNAPSHOT.records, { cookie });

  // The first run of the very first test in this process creates the records; every later
  // run of the same corpus must be a no-op.
  assert.equal(
    first.recordsCreated,
    before.body.totals.records === 0 ? SNAPSHOT.records.length : 0,
  );
  assert.equal(second.recordsCreated, 0, 'the second run must not create records');
  assert.equal(second.recordsUpdated, 0, 'unchanged records must not be rewritten');
  assert.equal(second.signalsCreated, 0, 'the second run must not create new signals');
  assert.equal(second.needsCreated, 0, 'the second run must not create new needs');
  assert.equal(third.recordsCreated, 0);

  const needs = await api.request('GET', '/api/needs?pageSize=50', { cookie });
  assert.equal(needs.body.totals.records, SNAPSHOT.records.length);

  const runs = await api.request('GET', '/api/source-runs', { cookie });
  assert.ok(runs.body.runs.length >= 3);
  for (const run of runs.body.runs) {
    assert.ok(['success', 'partial'].includes(run.status));
  }
});

test('every persisted record keeps its platform, external id, url, author, timestamp and counts', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie });
  const detail = await api.request('GET', '/api/needs?pageSize=50', { cookie });
  const first = detail.body.needs[0];
  const full = await api.request('GET', `/api/needs/${first.id}`, { cookie });
  assert.equal(full.status, 200);

  const evidence = full.body.need.evidence;
  assert.ok(evidence.length > 0);
  for (const item of evidence) {
    assert.ok(['x', 'reddit'].includes(item.platform));
    assert.ok(item.externalId.length > 0);
    assert.match(item.url, /^https?:\/\//);
    assert.ok(typeof item.publishedAt === 'string' && !Number.isNaN(Date.parse(item.publishedAt)));
    assert.ok(item.text.length > 0);
    assert.ok(item.engagement && typeof item.engagement === 'object');
  }

  // The snapshot facts are preserved exactly, nothing invented.
  const byExternalId = new Map(
    SNAPSHOT.records.map((record) => [record.externalId, record as Record<string, any>]),
  );
  for (const item of evidence) {
    const source = byExternalId.get(item.externalId);
    assert.ok(source, `evidence ${item.externalId} is not from the snapshot`);
    assert.equal(item.text, source.text);
    assert.equal(item.url, source.url);
    assert.equal(item.author, source.author ?? null);
    assert.deepEqual(item.engagement, source.engagement);
  }
});

test('malformed records are reported instead of stored', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const response = await api.request('POST', '/api/sources/ingest', {
    cookie,
    body: {
      adapter: 'snapshot',
      records: [
        { ...SNAPSHOT.records[0] },
        { platform: 'nope', externalId: 'x1', url: 'http://a.test', publishedAt: '2026-01-01T00:00:00Z', text: 'hi' },
        { platform: 'reddit', externalId: '', url: 'http://a.test', publishedAt: '2026-01-01T00:00:00Z', text: 'hi' },
        { platform: 'reddit', externalId: 'x3', url: 'not-a-url', publishedAt: '2026-01-01T00:00:00Z', text: 'hi' },
        { platform: 'reddit', externalId: 'x4', url: 'http://a.test', publishedAt: 'not-a-date', text: 'hi' },
        { platform: 'reddit', externalId: 'x5', url: 'http://a.test', publishedAt: '2026-01-01T00:00:00Z', text: '' },
        { platform: 'reddit', externalId: 'x6', url: 'http://a.test', publishedAt: '2026-01-01T00:00:00Z', text: 'hi', engagement: { upvotes: -4 } },
      ],
    },
  });
  assert.equal(response.status, 422, JSON.stringify(response.body));
  const run = response.body.run;
  assert.equal(run.recordsFailed, 6);
  assert.equal(run.status, 'failed');
  const messages = run.errors.map((entry: { message: string }) => entry.message).join('\n');
  assert.match(messages, /platform must be one of/);
  assert.match(messages, /externalId/);
  assert.match(messages, /url must be an http\(s\) URL/);
  assert.match(messages, /publishedAt must be an ISO-8601 date/);
  assert.match(messages, /engagement\.upvotes` must be a non-negative number/);
});

test('an unknown adapter is rejected and an unconfigured one answers 503 with a hint', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const unknown = await api.request('POST', '/api/sources/ingest', {
    cookie,
    body: { adapter: 'bogus', records: [] },
  });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.error.code, 'validation_failed');

  const x = await api.request('POST', '/api/sources/ingest', {
    cookie,
    body: { adapter: 'x' },
  });
  assert.equal(x.status, 503);
  assert.equal(x.body.error.code, 'adapter_unavailable');
  assert.match(x.body.error.message, /X adapter is inactive/);
  assert.ok(x.body.error.details.hint.includes('X_BEARER_TOKEN'));

  const recorded = await api.request('GET', '/api/source-runs', { cookie });
  const failedRun = recorded.body.runs.find((run: { adapter: string }) => run.adapter === 'x');
  assert.ok(failedRun, 'the failed run must be visible in the history');
  assert.equal(failedRun.status, 'failed');
  assert.ok(failedRun.error.message);
});

test('ingestion without records reads the snapshot file', async () => {
  const api = await getClient();
  const cookie = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  const run = await api.ingest(undefined as unknown as unknown[], { cookie });
  assert.equal(run.recordsCreated, SNAPSHOT.records.length);
  assert.ok(run.notes.some((note: string) => note.includes('source-snapshot.json')));
});

test('source runs are scoped to the workspace that created them', async () => {
  const api = await getClient();
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie: acme });
  await api.ingest(SNAPSHOT.records, { cookie: beta });

  const acmeRuns = await api.request('GET', '/api/source-runs', { cookie: acme });
  const betaRuns = await api.request('GET', '/api/source-runs', { cookie: beta });
  const acmeIds = new Set(acmeRuns.body.runs.map((run: { id: string }) => run.id));
  for (const run of betaRuns.body.runs) {
    assert.ok(!acmeIds.has(run.id), 'a run from one workspace leaked into another');
  }

  const foreign = await api.request('GET', `/api/source-runs/${acmeRuns.body.runs[0].id}`, {
    cookie: beta,
  });
  assert.equal(foreign.status, 404);
});

test('a failed run can be retried and the retry is recorded', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.request('POST', '/api/sources/ingest', { cookie, body: { adapter: 'x' } });
  const runs = await api.request('GET', '/api/source-runs', { cookie });
  const failed = runs.body.runs.find((run: { status: string }) => run.status === 'failed');
  const retried = await api.request('POST', `/api/source-runs/${failed.id}/retry`, { cookie });
  assert.equal(retried.status, 503, 'the X adapter is still inactive, so the retry reports it');
  assert.equal(retried.body.run.adapter, 'x');
  const after = await api.request('GET', '/api/source-runs', { cookie });
  assert.ok(after.body.runs.length > runs.body.runs.length);
});
