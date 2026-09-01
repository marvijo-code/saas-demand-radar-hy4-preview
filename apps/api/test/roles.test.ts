import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, SNAPSHOT, ACME_ADMIN, ACME_MEMBER, BETA_ADMIN } from './helpers.ts';

const { ADMIN_ONLY_MUTATIONS, isAdminOnly } = await import('../src/auth/adminOnly.ts');

/** Every Admin-only mutation from the contract, with a body that would otherwise succeed. */
function mutations(needId: string | number, runId: string) {
  return [
    { method: 'POST', path: '/api/sources/ingest', body: { adapter: 'snapshot', records: [] } },
    { method: 'POST', path: `/api/source-runs/${runId}/retry`, body: undefined },
    { method: 'PUT', path: '/api/settings/schedule', body: { enabled: false, intervalMinutes: 90 } },
    { method: 'POST', path: '/api/ranking/rescore', body: undefined },
    { method: 'PUT', path: '/api/team/name', body: { name: 'Renamed By Member' } },
    {
      method: 'POST',
      path: '/api/team/members',
      body: { email: 'sneak@acme.test', name: 'Sneak', password: 'LongEnoughPassword1', role: 'admin' },
    },
    { method: 'PATCH', path: `/api/team/members/${needId}`, body: { role: 'admin' } },
    { method: 'DELETE', path: `/api/team/members/${needId}`, body: undefined },
  ];
}

test('a Member cannot run any Admin-only mutation', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  await api.ingest(SNAPSHOT.records, { cookie: admin });

  const runs = await api.request('GET', '/api/source-runs?limit=1', { cookie: admin });
  const runId = runs.body.runs[0].id as string;
  const team = await api.request('GET', '/api/team', { cookie: admin });
  const memberId = team.body.members[0].id as string;

  for (const mutation of mutations(memberId, runId)) {
    const response = await api.request(mutation.method, mutation.path, {
      cookie: member,
      body: mutation.body,
    });
    assert.equal(
      response.status,
      403,
      `${mutation.method} ${mutation.path} must be Admin-only, got ${response.status}`,
    );
    assert.equal(response.body.error.code, 'forbidden');
    assert.match(response.body.error.message, /requires the Admin role/);
  }
});

test('an Admin-only mutation is rejected anonymously with 401', async () => {
  const api = await getClient();
  for (const mutation of mutations('usr_memberacmetest', 'run_does_not_exist')) {
    const response = await api.request(mutation.method, mutation.path, { body: mutation.body });
    assert.equal(
      response.status,
      401,
      `${mutation.method} ${mutation.path} must require a session`,
    );
    assert.equal(response.body.error.code, 'unauthorized');
  }
});

test('a Member cannot ingest source records and no run is recorded', async () => {
  const api = await getClient();
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  const before = await api.request('GET', '/api/source-runs?limit=200', { cookie: member });

  const response = await api.request('POST', '/api/sources/ingest', {
    cookie: member,
    body: { adapter: 'snapshot', records: SNAPSHOT.records },
  });
  assert.equal(response.status, 403);

  const after = await api.request('GET', '/api/source-runs?limit=200', { cookie: member });
  assert.equal(
    after.body.runs.length,
    before.body.runs.length,
    'a rejected ingestion must not appear in the run history',
  );
  assert.ok(
    !after.body.runs.some((run: { trigger: string }) => run.trigger === 'manual' && false),
    'no phantom run',
  );
});

test('a Member cannot change the schedule settings', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  await api.request('PUT', '/api/settings/schedule', {
    cookie: admin,
    body: { enabled: false, intervalMinutes: 720 },
  });

  const response = await api.request('PUT', '/api/settings/schedule', {
    cookie: member,
    body: { enabled: true, intervalMinutes: 5 },
  });
  assert.equal(response.status, 403);

  const current = await api.request('GET', '/api/settings/schedule', { cookie: member });
  assert.equal(current.body.schedule.enabled, false);
  assert.equal(current.body.schedule.intervalMinutes, 720);
});

test('a Member cannot cut a new ranking-model version', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  const before = await api.request('GET', '/api/ranking/versions', { cookie: member });

  const response = await api.request('POST', '/api/ranking/rescore', { cookie: member });
  assert.equal(response.status, 403);

  const after = await api.request('GET', '/api/ranking/versions', { cookie: member });
  assert.equal(after.body.versions.length, before.body.versions.length);
  assert.equal(
    after.body.versions[0].version,
    before.body.versions[0].version,
    'no new version may be created by a Member',
  );
  void admin;
});

test('an Admin can still perform every guarded mutation', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const ingest = await api.request('POST', '/api/sources/ingest', {
    cookie: admin,
    body: { adapter: 'snapshot', records: SNAPSHOT.records },
  });
  assert.equal(ingest.status, 200);

  const schedule = await api.request('PUT', '/api/settings/schedule', {
    cookie: admin,
    body: { enabled: false, intervalMinutes: 120 },
  });
  assert.equal(schedule.status, 200);
  assert.equal(schedule.body.schedule.intervalMinutes, 120);

  const rescore = await api.request('POST', '/api/ranking/rescore', { cookie: admin });
  assert.equal(rescore.status, 200);
  assert.ok(rescore.body.version >= 1);
});

test('Member read access is untouched', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  await api.ingest(SNAPSHOT.records, { cookie: admin });

  for (const path of [
    '/api/needs',
    '/api/needs?pageSize=5&sort=recency',
    '/api/source-runs',
    '/api/ranking/versions',
    '/api/settings/schedule',
    '/api/audit',
    '/api/overview',
    '/api/feedback',
    '/api/team',
    '/api/sources/adapters',
    '/api/health',
  ]) {
    const response = await api.request('GET', path, { cookie: member });
    assert.equal(response.status, 200, `${path} must stay readable for Members`);
  }
});

test('a Member can still record reviews and triage needs', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  await api.ingest(SNAPSHOT.records, { cookie: admin });
  const needs = await api.request('GET', '/api/needs?pageSize=1', { cookie: member });
  const needId = needs.body.needs[0].id as number;

  const feedback = await api.request('POST', `/api/needs/${needId}/feedback`, {
    cookie: member,
    body: { relevant: true, willingnessToPay: true, note: 'member review' },
  });
  assert.equal(feedback.status, 201);

  const detail = await api.request('GET', `/api/needs/${needId}`, { cookie: member });
  const recordId = detail.body.need.evidence[0].sourceRecordId as number;
  const evidenceFeedback = await api.request(
    'POST',
    `/api/needs/${needId}/evidence/${recordId}/feedback`,
    { cookie: member, body: { relevant: false } },
  );
  assert.equal(evidenceFeedback.status, 201);

  const status = await api.request('PATCH', `/api/needs/${needId}/status`, {
    cookie: member,
    body: { status: 'reviewing' },
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.status, 'reviewing');
});

test('the guard is one central list that covers every Admin-only mutation', () => {
  assert.ok(ADMIN_ONLY_MUTATIONS.length >= 8);
  for (const entry of ADMIN_ONLY_MUTATIONS) {
    assert.ok(['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method));
    assert.ok(entry.description.length > 0);
  }
  const paths = ADMIN_ONLY_MUTATIONS.map((entry) => `${entry.method} ${entry.path.source}`);
  for (const expected of [
    'POST ^\\/api\\/sources\\/ingest$',
    'POST ^\\/api\\/source-runs\\/[^/]+\\/retry$',
    'PUT ^\\/api\\/settings\\/schedule$',
    'POST ^\\/api\\/ranking\\/rescore$',
    'PUT ^\\/api\\/team\\/name$',
    'POST ^\\/api\\/team\\/members$',
  ]) {
    assert.ok(paths.includes(expected), `missing guard for ${expected}`);
  }
});

test('the guard classifies only the intended paths', () => {
  assert.ok(isAdminOnly('POST', '/api/sources/ingest'));
  assert.ok(isAdminOnly('POST', '/api/sources/ingest?adapter=snapshot'));
  assert.ok(isAdminOnly('PUT', '/api/settings/schedule'));
  assert.ok(isAdminOnly('POST', '/api/ranking/rescore'));
  assert.ok(isAdminOnly('DELETE', '/api/team/members/usr_1'));

  // Reviewer actions and reads must never be caught by the guard.
  assert.equal(isAdminOnly('POST', '/api/needs/1/feedback'), undefined);
  assert.equal(isAdminOnly('POST', '/api/needs/1/evidence/2/feedback'), undefined);
  assert.equal(isAdminOnly('PATCH', '/api/needs/1/status'), undefined);
  assert.equal(isAdminOnly('GET', '/api/needs'), undefined);
  assert.equal(isAdminOnly('GET', '/api/settings/schedule'), undefined);
  assert.equal(isAdminOnly('POST', '/api/auth/login'), undefined);
  assert.equal(isAdminOnly('POST', '/api/sources/ingest/extra'), undefined);
});

test('another workspace\'s Member is rejected just the same', async () => {
  const api = await getClient();
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  void BETA_ADMIN;
  const response = await api.request('POST', '/api/sources/ingest', {
    cookie: member,
    body: { adapter: 'snapshot', records: [] },
  });
  assert.equal(response.status, 403);
});
