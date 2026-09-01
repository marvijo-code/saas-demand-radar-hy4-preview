import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const dbDir = mkdtempSync(join(tmpdir(), `sdr-api-${randomUUID()}-`));

// Configured before the database module is imported so every test file gets its own file.
process.env.SDR_DATABASE_PATH = join(dbDir, 'api.sqlite');
process.env.SDR_SCHEDULER_ENABLED = '0';
process.env.SDR_SNAPSHOT_PATH = join(repoRoot, 'source-snapshot.json');
process.env.RATE_LOGIN_MAX = '100000';
process.env.RATE_MUTATION_MAX = '100000';
process.env.RATE_READ_MAX = '1000000';

const { migrate } = await import('../src/db/migrate.ts');
const { seedUsers } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/db/connection.ts');
const snapshotFile = JSON.parse(
  readFileSync(join(repoRoot, 'source-snapshot.json'), 'utf8'),
) as { schemaVersion: number; capturedAt: string; records: Record<string, unknown>[] };

export interface Response {
  status: number;
  body: any;
  headers: Headers;
}

export interface TestClient {
  baseUrl: string;
  request(
    method: string,
    path: string,
    options?: { body?: unknown; cookie?: string; headers?: Record<string, string> },
  ): Promise<Response>;
  signIn(email: string, password: string): Promise<string>;
  ingest(
    records: unknown[],
    options?: { adapter?: string; cookie?: string },
  ): Promise<any>;
  close(): Promise<void>;
}

let server: Server | null = null;
let baseUrl = '';
let clientPromise: Promise<TestClient> | null = null;

async function boot(): Promise<TestClient> {
  migrate();
  seedUsers();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server = createApp().listen(0, '127.0.0.1');
    server.on('listening', () => {
      const address = server?.address();
      if (address && typeof address === 'object') baseUrl = `http://127.0.0.1:${address.port}`;
      resolvePromise();
    });
    server.on('error', rejectPromise);
  });
  // The listening socket must not keep the test process alive once the suite finishes.
  server?.unref();

  const client: TestClient = {
    baseUrl,
    request: async (method, path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.headers ?? {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
      }
      return { status: response.status, body, headers: response.headers };
    },
    signIn: async (email, password) => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(response.status, 200, `login failed for ${email}`);
      const setCookie = response.headers.get('set-cookie') ?? '';
      const cookie = setCookie.split(';')[0];
      assert.ok(cookie.startsWith('sdr_session='), 'session cookie missing');
      assert.ok(/HttpOnly/i.test(setCookie), 'cookie must be HTTP-only');
      assert.ok(/SameSite=Lax/i.test(setCookie), 'cookie must be SameSite=Lax');
      return cookie;
    },
    ingest: async (records, options = {}) => {
      const cookie = options.cookie ?? (await client.signIn(ACME_ADMIN.email, ACME_ADMIN.password));
      const response = await client.request('POST', '/api/sources/ingest', {
        cookie,
        body: { adapter: options.adapter ?? 'snapshot', records },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.run as Record<string, unknown>;
    },
    close: async () => {
      /* the shared server is closed on process exit */
    },
  };
  return client;
}

/** Lazily boots one API instance per test process. */
export function getClient(): Promise<TestClient> {
  if (!clientPromise) clientPromise = boot();
  return clientPromise;
}

export const SNAPSHOT = snapshotFile;

export const ACME_ADMIN = { email: 'admin@acme.test', password: 'AcmeAdmin!2026' };
export const ACME_MEMBER = { email: 'member@acme.test', password: 'AcmeMember!2026' };
export const BETA_ADMIN = { email: 'admin@beta.test', password: 'BetaAdmin!2026' };

async function shutdown(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolvePromise) => {
    server?.close(() => resolvePromise());
  });
  closeDb();
  rmSync(dbDir, { recursive: true, force: true });
}

process.on('exit', () => {
  try {
    closeDb();
  } catch {
    /* already closed */
  }
  rmSync(dbDir, { recursive: true, force: true });
});

test('test harness boots the API on an ephemeral port', async () => {
  const api = await getClient();
  const response = await api.request('GET', '/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  void shutdown;
});
