#!/usr/bin/env node
/**
 * Starts the whole product with one command.
 *
 * 1. installs workspace dependencies (unless SDR_SKIP_INSTALL=1)
 * 2. migrates and seeds SQLite
 * 3. builds the web bundle if it is missing or stale
 * 4. starts the API on 127.0.0.1:4174 and the web server on 127.0.0.1:4173
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...(options.env ?? {}) },
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'signal'}`));
    });
  });
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const prefix = `[${name}] `;
  const pipe = (stream, target) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
    stream.on('end', () => {
      if (buffer) target.write(prefix + buffer + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // eslint-disable-next-line no-console
    console.error(`${prefix}exited (code ${code ?? signal}). Shutting down.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 2_000).unref();
}

async function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

async function waitForWeb(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

function webBundleIsStale() {
  const dist = join(root, 'apps', 'web', 'dist', 'index.html');
  if (!existsSync(dist)) return true;
  const sourceDir = join(root, 'apps', 'web', 'src');
  const distTime = statSync(dist).mtimeMs;
  for (const entry of ['App.tsx', 'main.tsx', 'styles.css']) {
    const file = join(sourceDir, entry);
    if (existsSync(file) && statSync(file).mtimeMs > distTime) return true;
  }
  return false;
}

async function main() {
  if (process.env.SDR_SKIP_INSTALL !== '1') {
    console.log('==> installing dependencies');
    await run('npm', ['install', '--no-audit', '--no-fund']);
  }

  console.log('==> migrating and seeding the database');
  await run('node', ['apps/api/src/db/migrate-cli.ts']);

  if (process.env.SDR_SKIP_BUILD !== '1' && webBundleIsStale()) {
    console.log('==> building the web bundle');
    await run('node', ['scripts/build.mjs']);
  } else {
    console.log('==> web bundle is up to date');
  }

  const apiPort = Number(process.env.PORT ?? 4174);
  const webPort = Number(process.env.WEB_PORT ?? 4173);

  console.log(`==> starting API on http://127.0.0.1:${apiPort}`);
  start('api', 'node', ['apps/api/src/index.ts'], {
    PORT: String(apiPort),
    WEB_PORT: String(webPort),
    WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    SDR_CORS_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
  });

  console.log(`==> starting web on http://127.0.0.1:${webPort}`);
  start('web', 'node', ['apps/web/server.mjs'], {
    WEB_PORT: String(webPort),
    API_ORIGIN: `http://127.0.0.1:${apiPort}`,
  });

  const [apiUp, webUp] = await Promise.all([waitForPort(apiPort), waitForWeb(webPort)]);
  if (!apiUp) throw new Error(`API did not become healthy on port ${apiPort}.`);
  if (!webUp) throw new Error(`Web server did not become healthy on port ${webPort}.`);

  console.log('');
  console.log(`    Web  http://127.0.0.1:${webPort}`);
  console.log(`    API  http://127.0.0.1:${apiPort}/api/health`);
  console.log('    Sign in with admin@acme.test / AcmeAdmin!2026');
  console.log('    Press Ctrl+C to stop.');
  console.log('');
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
