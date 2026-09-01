import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const dbDir = mkdtempSync(join(tmpdir(), `sdr-rlm-${randomUUID()}-`));

// Deliberately tight limits so the guard can be exercised without a long loop.
process.env.SDR_DATABASE_PATH = join(dbDir, 'ratelimit-mutation.sqlite');
process.env.SDR_SCHEDULER_ENABLED = '0';
process.env.SDR_SNAPSHOT_PATH = join(repoRoot, 'source-snapshot.json');
process.env.RATE_LOGIN_MAX = '1000';
process.env.RATE_LOGIN_WINDOW_MS = '60000';
process.env.RATE_MUTATION_MAX = '20';
process.env.RATE_MUTATION_WINDOW_MS = '60000';
process.env.RATE_READ_MAX = '10000';
process.env.RATE_READ_WINDOW_MS = '60000';

const { migrate } = await import('../src/db/migrate.ts');
const { seedUsers } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/connection.ts');

migrate();
seedUsers();
const server = createApp().listen(0, '127.0.0.1');
server.unref();
await new Promise((resolvePromise) => server.on('listening', resolvePromise));
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, any>) : null,
    headers: response.headers,
  };
}

test('mutation routes are rate limited after the configured budget', async () => {
  // Re-scoring is Admin-only, so this suite drives it with the admin account.
  const login = await call('POST', '/api/auth/login', {
    body: { email: 'admin@acme.test', password: 'AcmeAdmin!2026' },
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  let sawTooMany = false;
  let succeeded = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await call('POST', '/api/ranking/rescore', { cookie });
    if (response.status === 429) {
      sawTooMany = true;
      assert.ok(response.body, 'a rate limited response must carry a JSON body');
      assert.equal(response.body.error.code, 'rate_limited');
      assert.equal(response.body.error.details.retryAfterSeconds > 0, true);
      break;
    }
    assert.equal(response.status, 200);
    succeeded += 1;
  }
  assert.ok(sawTooMany, 'the mutation guard never triggered');
  assert.ok(succeeded >= 5, `expected a real budget before limiting, got ${succeeded}`);
});

process.on('exit', () => {
  try {
    closeDb();
  } catch {
    /* already closed */
  }
  rmSync(dbDir, { recursive: true, force: true });
});
