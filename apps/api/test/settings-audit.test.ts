import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, SNAPSHOT, ACME_ADMIN, BETA_ADMIN } from './helpers.ts';

test('the schedule can be read and updated', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const initial = await api.request('GET', '/api/settings/schedule', { cookie });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.schedule.enabled, false);
  assert.equal(initial.body.schedule.adapter, 'snapshot');
  assert.equal(initial.body.schedule.intervalMinutes, 720);
  assert.ok(initial.body.schedule.availableAdapters.includes('snapshot'));

  const updated = await api.request('PUT', '/api/settings/schedule', {
    cookie,
    body: {
      enabled: true,
      intervalMinutes: 60,
      adapter: 'snapshot',
      keywords: ['I wish there was', 'is there a tool'],
      subreddits: ['SaaS', 'Entrepreneur'],
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.schedule.enabled, true);
  assert.equal(updated.body.schedule.intervalMinutes, 60);
  assert.deepEqual(updated.body.schedule.keywords, ['I wish there was', 'is there a tool']);
  assert.deepEqual(updated.body.schedule.subreddits, ['SaaS', 'Entrepreneur']);
  assert.ok(updated.body.schedule.nextRunAt, 'changing the schedule must reschedule the next run');

  const reread = await api.request('GET', '/api/settings/schedule', { cookie });
  assert.equal(reread.body.schedule.enabled, true);
  assert.equal(reread.body.schedule.intervalMinutes, 60);
});

test('schedule updates are validated and audited', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const badInterval = await api.request('PUT', '/api/settings/schedule', {
    cookie,
    body: { intervalMinutes: 1 },
  });
  assert.equal(badInterval.status, 422);

  const badAdapter = await api.request('PUT', '/api/settings/schedule', {
    cookie,
    body: { adapter: 'linkedin' },
  });
  assert.equal(badAdapter.status, 422);

  const badEnabled = await api.request('PUT', '/api/settings/schedule', {
    cookie,
    body: { enabled: 'yes-please' },
  });
  assert.equal(badEnabled.status, 422);

  await api.request('PUT', '/api/settings/schedule', {
    cookie,
    body: { enabled: true, intervalMinutes: 90 },
  });
  const audit = await api.request('GET', '/api/audit?action=schedule.updated', { cookie });
  assert.ok(audit.body.events.length >= 1);
  assert.match(audit.body.events[0].summary, /scheduled ingestion/);
});

test('the schedule is workspace scoped', async () => {
  const api = await getClient();
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  await api.request('PUT', '/api/settings/schedule', {
    cookie: acme,
    body: { enabled: true, intervalMinutes: 45 },
  });
  const betaSchedule = await api.request('GET', '/api/settings/schedule', { cookie: beta });
  assert.notEqual(betaSchedule.body.schedule.intervalMinutes, 45);
});

test('the overview always has the documented shape, even with no data', async () => {
  const api = await getClient();
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  const overview = await api.request('GET', '/api/overview', { cookie: beta });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.workspace.id, 'ws_beta');
  for (const key of ['records', 'needs', 'signals', 'engagement', 'feedback', 'runs']) {
    assert.equal(typeof overview.body.counts[key], 'number', `counts.${key} must be a number`);
    assert.ok(overview.body.counts[key] >= 0);
  }
  assert.deepEqual(Object.keys(overview.body.platforms).sort(), ['reddit', 'x']);
  assert.ok(Array.isArray(overview.body.signalBreakdown));
  assert.ok(Array.isArray(overview.body.topNeeds));
  assert.ok(Array.isArray(overview.body.recentActivity));
  assert.ok(overview.body.schedule && 'enabled' in overview.body.schedule);
});

test('the overview reflects real ingested data', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie });
  const overview = await api.request('GET', '/api/overview', { cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.counts.records, SNAPSHOT.records.length);
  assert.ok(overview.body.counts.needs > 0);
  assert.ok(overview.body.counts.signals > 0);
  assert.equal(overview.body.platforms.x + overview.body.platforms.reddit, SNAPSHOT.records.length);
  assert.ok(overview.body.signalBreakdown.length > 0);
  assert.ok(overview.body.latestRun, 'the last run must be summarised');
  assert.equal(overview.body.latestRun.status, 'success');
  assert.ok(overview.body.recentActivity.length > 0);
  assert.ok(overview.body.model.version >= 1);
});

test('the audit trail records ingestion, feedback, rescore and auth events', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie });
  const needs = await api.request('GET', '/api/needs?pageSize=1', { cookie });
  await api.request('POST', `/api/needs/${needs.body.needs[0].id}/feedback`, {
    cookie,
    body: { relevant: true },
  });
  await api.request('POST', '/api/ranking/rescore', { cookie });

  const audit = await api.request('GET', '/api/audit?limit=200', { cookie });
  assert.equal(audit.status, 200);
  const actions = new Set(audit.body.events.map((event: { action: string }) => event.action));
  for (const expected of [
    'auth.login',
    'source_run.completed',
    'feedback.created',
    'ranking.rescored',
  ]) {
    assert.ok(actions.has(expected), `missing audit action ${expected}`);
  }
  assert.ok(audit.body.actions.length >= 4);
  for (const event of audit.body.events) {
    assert.equal(typeof event.summary, 'string');
    assert.ok(event.summary.length > 0);
    assert.ok(!Number.isNaN(Date.parse(event.createdAt)));
  }
});

test('the audit trail supports filtering by action and clamped limits', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const filtered = await api.request('GET', '/api/audit?action=auth.login&limit=5', { cookie });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.events.length <= 5);
  for (const event of filtered.body.events) assert.equal(event.action, 'auth.login');

  const huge = await api.request('GET', '/api/audit?limit=99999', { cookie });
  assert.equal(huge.status, 200);
  assert.ok(huge.body.events.length <= 500);
});
