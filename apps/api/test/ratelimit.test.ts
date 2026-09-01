import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const dbDir = mkdtempSync(join(tmpdir(), `sdr-rl-${randomUUID()}-`));

// Deliberately tight limits so the guard can be exercised without a long loop.
process.env.SDR_DATABASE_PATH = join(dbDir, 'ratelimit.sqlite');
process.env.SDR_SCHEDULER_ENABLED = '0';
process.env.SDR_SNAPSHOT_PATH = join(repoRoot, 'source-snapshot.json');
process.env.RATE_LOGIN_MAX = '3';
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

test('sign-in is rate limited after the configured number of attempts', async () => {
  let limited: { status: number; body: Record<string, any> } | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await call('POST', '/api/auth/login', {
      body: { email: 'admin@acme.test', password: 'wrong-password' },
    });
    if (response.status === 429) {
      limited = response as { status: number; body: Record<string, any> };
      break;
    }
    assert.equal(response.status, 401, 'early attempts must be normal 401s');
  }
  assert.ok(limited, 'the login guard never triggered');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'rate_limited');
  assert.match(limited.body.error.message, /Too many requests/);
});

process.on('exit', () => {
  try {
    closeDb();
  } catch {
    /* already closed */
  }
  rmSync(dbDir, { recursive: true, force: true });
});
