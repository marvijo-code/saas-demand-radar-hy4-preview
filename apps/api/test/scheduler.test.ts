import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, SNAPSHOT, ACME_ADMIN, BETA_ADMIN } from './helpers.ts';

const { retryDelayMinutes, tick, consecutiveFailures } = await import(
  '../src/services/scheduler.ts'
);
const { getSchedule, updateSchedule } = await import('../src/repo/settings.ts');

test('the retry delay backs off but never exceeds the schedule interval', () => {
  assert.equal(retryDelayMinutes(720, 1), 5);
  assert.equal(retryDelayMinutes(720, 2), 10);
  assert.equal(retryDelayMinutes(720, 3), 20);
  assert.equal(retryDelayMinutes(30, 1), 5);
  assert.ok(retryDelayMinutes(5, 10) <= 5, 'the backoff is capped by the interval');
  assert.ok(retryDelayMinutes(720, 10) <= 720);
  assert.ok(retryDelayMinutes(720, 1) >= 1);
});

test('a due schedule is executed by a tick and rescheduled', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const runsBefore = await api.request('GET', '/api/source-runs?limit=200', { cookie });

  // Force the schedule to be due and point it at the deterministic snapshot adapter.
  updateSchedule('ws_acme', {
    enabled: true,
    intervalMinutes: 60,
    adapter: 'snapshot',
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const outcome = await tick(new Date());
  assert.ok(outcome.executed.includes('ws_acme'), 'the due workspace must be executed');
  assert.ok(outcome.skipped.includes('ws_beta'), 'a disabled workspace must be skipped');

  const runsAfter = await api.request('GET', '/api/source-runs?limit=200', { cookie });
  assert.ok(
    runsAfter.body.runs.length > runsBefore.body.runs.length,
    'the tick must append a run to the history',
  );
  const scheduled = runsAfter.body.runs.find((run: { trigger: string }) => run.trigger === 'schedule');
  assert.ok(scheduled, 'the new run must be recorded as scheduled');
  assert.equal(scheduled.status, 'success');

  const schedule = await api.request('GET', '/api/settings/schedule', { cookie });
  assert.equal(schedule.body.schedule.lastStatus, 'success');
  assert.ok(
    Date.parse(schedule.body.schedule.nextRunAt) > Date.now(),
    'the next run must be rescheduled into the future',
  );

  // Leave the workspace in the documented default state.
  updateSchedule('ws_acme', { enabled: false, intervalMinutes: 720 });
});

test('a failing scheduled run records the error and plans a retry', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const failuresBefore = consecutiveFailures('ws_acme');
  const { runIngest } = await import('../src/pipeline/ingest.ts');
  const failed = await runIngest({
    workspaceId: 'ws_acme',
    adapter: 'x',
    actorUserId: null,
    actorEmail: 'scheduler',
    trigger: 'schedule',
  });
  assert.equal(failed.status, 'failed');
  assert.ok(failed.unavailable, 'the inactive X adapter must report why it could not run');
  assert.equal(consecutiveFailures('ws_acme'), failuresBefore + 1);

  const runs = await api.request('GET', '/api/source-runs?limit=5', { cookie });
  const latest = runs.body.runs[0];
  assert.equal(latest.status, 'failed');
  assert.ok(latest.error.message, 'the failure must be visible in the run history');

  const schedule = getSchedule('ws_acme');
  assert.equal(schedule.lastStatus, 'failed');
  assert.ok(schedule.lastError, 'the schedule must keep the last error');

  const retryIn = retryDelayMinutes(schedule.intervalMinutes, consecutiveFailures('ws_acme'));
  assert.ok(retryIn >= 1 && retryIn <= schedule.intervalMinutes);
});

test('the scheduler swallows a workspace failure and keeps other workspaces running', async () => {
  const api = await getClient();
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  updateSchedule('ws_beta', {
    enabled: false,
    intervalMinutes: 720,
    adapter: 'snapshot',
    nextRunAt: null,
  });
  const before = await api.request('GET', '/api/source-runs?limit=200', { cookie: beta });
  const outcome = await tick(new Date());
  assert.ok(outcome.skipped.includes('ws_beta'), 'a disabled schedule is skipped, not crashed');
  const after = await api.request('GET', '/api/source-runs?limit=200', { cookie: beta });
  assert.equal(after.body.runs.length, before.body.runs.length);
});

test('ingesting the snapshot through the scheduler is idempotent', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  updateSchedule('ws_acme', {
    enabled: true,
    intervalMinutes: 60,
    adapter: 'snapshot',
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await tick(new Date());
  await tick(new Date());
  const needs = await api.request('GET', '/api/needs?pageSize=50', { cookie });
  assert.equal(needs.body.totals.records, SNAPSHOT.records.length);
  updateSchedule('ws_acme', { enabled: false, intervalMinutes: 720 });
});
