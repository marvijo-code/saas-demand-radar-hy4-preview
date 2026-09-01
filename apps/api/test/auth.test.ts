import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, ACME_ADMIN, ACME_MEMBER, BETA_ADMIN } from './helpers.ts';

test('GET /api/health answers ok without authentication', async () => {
  const api = await getClient();
  const response = await api.request('GET', '/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('sign-in sets an HTTP-only cookie and returns the user and workspace', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const me = await api.request('GET', '/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, ACME_ADMIN.email);
  assert.equal(me.body.user.role, 'admin');
  assert.equal(me.body.workspace.id, 'ws_acme');
  assert.ok(Array.isArray(me.body.members));
  assert.equal(me.body.members.length, 2, 'Acme has an admin and a member');
  assert.ok(!('password_hash' in me.body.user), 'password hashes must never leave the server');
});

test('the seed created all three contract accounts with the right tenants', async () => {
  const api = await getClient();
  const acmeAdmin = await api.request('GET', '/api/auth/me', {
    cookie: await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password),
  });
  const acmeMember = await api.request('GET', '/api/auth/me', {
    cookie: await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password),
  });
  const betaAdmin = await api.request('GET', '/api/auth/me', {
    cookie: await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password),
  });
  assert.equal(acmeAdmin.body.workspace.id, 'ws_acme');
  assert.equal(acmeMember.body.workspace.id, 'ws_acme');
  assert.equal(betaAdmin.body.workspace.id, 'ws_beta');
  assert.equal(acmeMember.body.user.role, 'member');
  assert.equal(betaAdmin.body.members.length, 1);
});

test('wrong passwords and unknown emails both answer 401 with the same message', async () => {
  const api = await getClient();
  for (const body of [
    { email: ACME_ADMIN.email, password: 'nope' },
    { email: 'ghost@acme.test', password: 'whatever1234' },
    { email: ACME_ADMIN.email, password: 'AcmeAdmin!2026 ' },
  ]) {
    const response = await api.request('POST', '/api/auth/login', { body });
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(response.body.error.code, 'invalid_credentials');
    assert.equal(
      response.body.error.message,
      'Email or password is incorrect.',
      'the message must not leak whether the account exists',
    );
  }
});

test('session secrets are never exposed to the browser', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  assert.ok(!cookie.includes('ws_acme'));
  assert.ok(!cookie.includes('admin@acme.test'));
  assert.ok(/^sdr_session=[0-9a-f]{64}$/.test(cookie));
});

test('logout ends the session', async () => {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const out = await api.request('POST', '/api/auth/logout', { cookie });
  assert.equal(out.status, 200);
  const me = await api.request('GET', '/api/auth/me', { cookie });
  assert.equal(me.status, 401, 'the old cookie must stop working');
});

test('protected routes reject anonymous callers', async () => {
  const api = await getClient();
  for (const path of [
    '/api/needs',
    '/api/source-runs',
    '/api/ranking/versions',
    '/api/settings/schedule',
    '/api/audit',
    '/api/overview',
    '/api/feedback',
    '/api/team',
  ]) {
    const response = await api.request('GET', path);
    assert.equal(response.status, 401, `${path} must require a session`);
  }
});

test('a forged session cookie is rejected', async () => {
  const api = await getClient();
  const response = await api.request('GET', '/api/auth/me', {
    cookie: 'sdr_session=' + 'f'.repeat(64),
  });
  assert.equal(response.status, 401);
});

test('input validation rejects malformed login bodies', async () => {
  const api = await getClient();
  const cases: { body: unknown; expected: number; code: string }[] = [
    { body: {}, expected: 422, code: 'validation_failed' },
    { body: { email: 'not-an-email', password: 'x' }, expected: 422, code: 'validation_failed' },
    { body: { email: 'admin@acme.test' }, expected: 422, code: 'validation_failed' },
    { body: { email: 42, password: 42 }, expected: 422, code: 'validation_failed' },
    { body: { email: 'admin@acme.test', password: '' }, expected: 422, code: 'validation_failed' },
    // A JSON document that is not an object is rejected by the body parser itself.
    { body: 'string-body', expected: 400, code: 'bad_request' },
  ];
  for (const entry of cases) {
    const response = await api.request('POST', '/api/auth/login', { body: entry.body });
    assert.equal(response.status, entry.expected, JSON.stringify(entry.body));
    assert.equal(response.body.error.code, entry.code, JSON.stringify(entry.body));
  }
});
