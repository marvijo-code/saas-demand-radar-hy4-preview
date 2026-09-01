import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const dbDir = mkdtempSync(join(tmpdir(), `sdr-rlread-${randomUUID()}-`));

// Only the read budget is tight here so the guard can be observed on its own.
process.env.SDR_DATABASE_PATH = join(dbDir, 'ratelimit-read.sqlite');
process.env.SDR_SCHEDULER_ENABLED = '0';
process.env.SDR_SNAPSHOT_PATH = join(repoRoot, 'source-snapshot.json');
process.env.RATE_LOGIN_MAX = '1000';
process.env.RATE_MUTATION_MAX = '1000';
process.env.RATE_READ_MAX = '5';
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

async function call(method: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, { method });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, any>) : null,
    headers: response.headers,
  };
}

test('read routes are rate limited and the error body leaks nothing', async () => {
  let sawTooMany = false;
  let ok = 0;
  let limited: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await call('GET', '/api/health');
    if (response.status === 429) {
      sawTooMany = true;
      limited = response.body;
      break;
    }
    assert.equal(response.status, 200);
    ok += 1;
  }
  assert.ok(sawTooMany, 'the read guard never triggered');
  assert.ok(ok >= 3, `expected a real read budget before limiting, got ${ok}`);
  assert.ok(limited);
  assert.deepEqual(Object.keys(limited), ['error'], 'the response must only carry an error');
  for (const key of Object.keys(limited.error)) {
    assert.ok(['code', 'message', 'details'].includes(key), `unexpected error field ${key}`);
  }
  assert.equal(limited.error.code, 'rate_limited');
  const serialised = JSON.stringify(limited);
  assert.ok(!serialised.includes('password'));
  assert.ok(!serialised.includes('sdr_session'));
});

process.on('exit', () => {
  try {
    closeDb();
  } catch {
    /* already closed */
  }
  rmSync(dbDir, { recursive: true, force: true });
});
