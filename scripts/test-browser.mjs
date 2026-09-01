#!/usr/bin/env node
/**
 * Browser test runner.
 *
 * Owns the whole lifecycle: build the bundle, boot the API and the static web server on
 * dedicated test ports, seed the deterministic snapshot, run Playwright, then shut everything
 * down. Using separate ports keeps the test run from colliding with `npm start`.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const playwright = resolve(root, 'node_modules/@playwright/test/cli.js');
const webPort = Number(process.env.SDR_TEST_WEB_PORT ?? 4273);
const apiPort = Number(process.env.SDR_TEST_API_PORT ?? 4274);
const dataDir = mkdtempSync(join(tmpdir(), 'sdr-browser-'));

const children = [];
let shuttingDown = false;

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const prefix = `[${name}] `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  // Set the exit status up front: the force-kill timer below is unref'd, so it must never be
  // the only thing that decides whether a failing suite is reported as a failure.
  process.exitCode = code;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill('SIGKILL');
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(code);
  }, 1_200).unref();
}

async function waitFor(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

function run(command, args, env = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function main() {
  console.log('==> building the web bundle for the browser tests');
  await run('node', ['scripts/build.mjs']);

  console.log('==> migrating and seeding the test database');
  await run('node', ['apps/api/src/db/migrate-cli.ts'], {
    SDR_DATABASE_PATH: join(dataDir, 'browser.sqlite'),
  });

  console.log(`==> starting API on ${apiPort} and web on ${webPort}`);
  start('api', 'node', ['apps/api/src/index.ts'], {
    PORT: String(apiPort),
    WEB_PORT: String(webPort),
    WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    SDR_CORS_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    SDR_DATABASE_PATH: join(dataDir, 'browser.sqlite'),
    SDR_SCHEDULER_ENABLED: '0',
    RATE_LOGIN_MAX: '100000',
    RATE_MUTATION_MAX: '100000',
    RATE_READ_MAX: '1000000',
  });
  start('web', 'node', ['apps/web/server.mjs'], {
    WEB_PORT: String(webPort),
    API_ORIGIN: `http://127.0.0.1:${apiPort}`,
  });

  const apiUp = await waitFor(`http://127.0.0.1:${apiPort}/api/health`);
  const webUp = await waitFor(`http://127.0.0.1:${webPort}/`);
  if (!apiUp || !webUp) {
    throw new Error(`test servers did not start (api=${apiUp}, web=${webUp})`);
  }

  // Deterministic fixture: the six records from source-snapshot.json, nothing invented.
  const snapshot = JSON.parse(
    await (await import('node:fs/promises')).readFile(join(root, 'source-snapshot.json'), 'utf8'),
  );
  for (const [index, email] of ['admin@acme.test', 'admin@beta.test'].entries()) {
    const password = index === 0 ? 'AcmeAdmin!2026' : 'BetaAdmin!2026';
    const login = await fetch(`http://127.0.0.1:${apiPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    if (email === 'admin@acme.test') {
      await fetch(`http://127.0.0.1:${apiPort}/api/sources/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ adapter: 'snapshot', records: snapshot.records }),
      });
    }
  }
  console.log('==> seeded the deterministic snapshot for Acme');

  const args = [
    'test',
    '--config',
    'apps/web/playwright.config.ts',
    ...process.argv.slice(2),
  ];
  const code = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [playwright, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        SDR_WEB_URL: `http://127.0.0.1:${webPort}`,
        SDR_API_URL: `http://127.0.0.1:${apiPort}`,
      },
    });
    child.on('exit', (exitCode) => resolvePromise(exitCode ?? 1));
  });

  shutdown(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
