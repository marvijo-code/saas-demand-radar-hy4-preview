import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getClient,
  SNAPSHOT,
  ACME_ADMIN,
  ACME_MEMBER,
  BETA_ADMIN,
} from './helpers.ts';

const READ_ROUTES = [
  '/api/needs',
  '/api/needs/1',
  '/api/source-runs',
  '/api/ranking/versions',
  '/api/settings/schedule',
  '/api/audit',
  '/api/overview',
  '/api/feedback',
  '/api/team',
];

test('one workspace can never read another workspace\'s data', async () => {
  const api = await getClient();
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie: acme });

  const acmeNeeds = await api.request('GET', '/api/needs?pageSize=50', { cookie: acme });
  const betaNeeds = await api.request('GET', '/api/needs?pageSize=50', { cookie: beta });
  assert.ok(acmeNeeds.body.total > 0, 'Acme ingested the snapshot');

  // Beta has its own ingestion only if a previous test in this process ran it; what matters
  // is that no Acme id is visible to Beta.
  const acmeIds = new Set(acmeNeeds.body.needs.map((need: { id: number }) => need.id));
  for (const need of betaNeeds.body.needs) {
    assert.ok(!acmeIds.has(need.id), `need ${need.id} leaked across workspaces`);
  }

  for (const route of READ_ROUTES) {
    const response = await api.request('GET', route, { cookie: beta });
    assert.notEqual(response.status, 500, `${route} must not crash for a foreign workspace`);
  }
});

test('audits, runs, feedback and versions are all workspace scoped', async () => {
  const api = await getClient();
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie: acme });

  const acmeAudit = await api.request('GET', '/api/audit?limit=200', { cookie: acme });
  const betaAudit = await api.request('GET', '/api/audit?limit=200', { cookie: beta });
  const acmeAuditIds = new Set(acmeAudit.body.events.map((event: { id: number }) => event.id));
  for (const event of betaAudit.body.events) {
    assert.ok(!acmeAuditIds.has(event.id), `audit event ${event.id} leaked`);
    assert.ok(
      !event.summary.includes('ws_acme'),
      `audit event mentions the wrong workspace: ${event.summary}`,
    );
  }

  const acmeVersions = await api.request('GET', '/api/ranking/versions', { cookie: acme });
  const betaVersions = await api.request('GET', '/api/ranking/versions', { cookie: beta });
  assert.ok(acmeVersions.body.versions.length >= 1);
  for (const version of betaVersions.body.versions) {
    assert.ok(
      !acmeVersions.body.versions.some(
        (other: { createdAt: string; version: number }) =>
          other.version === version.version && other.createdAt === version.createdAt,
      ) || betaVersions.body.versions.length === 0,
      'model versions must not be shared',
    );
  }
});

test('members cannot perform admin-only team actions', async () => {
  const api = await getClient();
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const team = await api.request('GET', '/api/team', { cookie: admin });
  const otherMember = team.body.members.find(
    (entry: { id: string }) => entry.id !== team.body.viewer.id,
  );

  const rename = await api.request('PUT', '/api/team/name', {
    cookie: member,
    body: { name: 'Hijacked' },
  });
  assert.equal(rename.status, 403);

  const invite = await api.request('POST', '/api/team/members', {
    cookie: member,
    body: { email: 'new@acme.test', name: 'New', password: 'LongEnoughPassword1', role: 'admin' },
  });
  assert.equal(invite.status, 403);

  const role = await api.request('PATCH', `/api/team/members/${otherMember.id}`, {
    cookie: member,
    body: { role: 'admin' },
  });
  assert.equal(role.status, 403);

  const remove = await api.request('DELETE', `/api/team/members/${otherMember.id}`, {
    cookie: member,
  });
  assert.equal(remove.status, 403);

  const stillThere = await api.request('GET', '/api/team', { cookie: admin });
  assert.equal(stillThere.body.workspace.name, 'Acme Growth');
});

test('an admin can rename the workspace and manage members', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);

  const renamed = await api.request('PUT', '/api/team/name', {
    cookie: admin,
    body: { name: 'Acme Growth Team' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Acme Growth Team');

  const invited = await api.request('POST', '/api/team/members', {
    cookie: admin,
    body: {
      email: 'analyst@acme.test',
      name: 'Analyst Ana',
      password: 'TemporaryPass!2026',
      role: 'member',
    },
  });
  assert.equal(invited.status, 201);
  const created = invited.body.members.find(
    (entry: { email: string }) => entry.email === 'analyst@acme.test',
  );
  assert.ok(created, 'the new member must be returned');
  assert.equal(created.role, 'member');

  const signIn = await api.request('POST', '/api/auth/login', {
    body: { email: 'analyst@acme.test', password: 'TemporaryPass!2026' },
  });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.body.user.workspaceId, 'ws_acme', 'the invite joins the admin workspace');

  const promoted = await api.request('PATCH', `/api/team/members/${created.id}`, {
    cookie: admin,
    body: { role: 'admin' },
  });
  assert.equal(promoted.status, 200);

  const removed = await api.request('DELETE', `/api/team/members/${created.id}`, { cookie: admin });
  assert.equal(removed.status, 200);
  assert.ok(
    !removed.body.members.some((entry: { email: string }) => entry.email === 'analyst@acme.test'),
  );

  await api.request('PUT', '/api/team/name', { cookie: admin, body: { name: 'Acme Growth' } });
});

test('an admin cannot remove the last admin or themselves', async () => {
  const api = await getClient();
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  const team = await api.request('GET', '/api/team', { cookie: beta });
  const self = team.body.members.find((entry: { id: string }) => entry.id === team.body.viewer.id);
  const removed = await api.request('DELETE', `/api/team/members/${self.id}`, { cookie: beta });
  assert.equal(removed.status, 409);

  const demoted = await api.request('PATCH', `/api/team/members/${self.id}`, {
    cookie: beta,
    body: { role: 'member' },
  });
  assert.equal(demoted.status, 409);
});

test('team mutations are audited', async () => {
  const api = await getClient();
  const admin = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.request('PUT', '/api/team/name', { cookie: admin, body: { name: 'Acme Audited' } });
  const audit = await api.request('GET', '/api/audit?action=workspace.renamed', { cookie: admin });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.events.length >= 1);
  assert.equal(audit.body.events[0].actorEmail, ACME_ADMIN.email);
  assert.match(audit.body.events[0].summary, /renamed the workspace/);
  await api.request('PUT', '/api/team/name', { cookie: admin, body: { name: 'Acme Growth' } });
});
