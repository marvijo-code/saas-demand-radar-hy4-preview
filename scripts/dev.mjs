#!/usr/bin/env node
/**
 * Development mode: Vite dev server with hot reload on 4173 proxying /api to the API on 4174.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
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
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${prefix}exited (${code ?? signal}).`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1_500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const apiPort = Number(process.env.PORT ?? 4174);
const webPort = Number(process.env.WEB_PORT ?? 4173);

console.log('==> migrating and seeding the database');
const migrate = spawn('node', ['apps/api/src/db/migrate-cli.ts'], { cwd: root, stdio: 'inherit' });
migrate.on('exit', (code) => {
  if (code !== 0) {
    console.error('migration failed');
    process.exit(code ?? 1);
    return;
  }
  start('api', 'node', ['apps/api/src/index.ts'], {
    PORT: String(apiPort),
    WEB_PORT: String(webPort),
    WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    SDR_CORS_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    SDR_SCHEDULER_ENABLED: process.env.SDR_SCHEDULER_ENABLED ?? '1',
  });
  start('web', 'npx', ['vite', '--config', 'apps/web/vite.config.ts'], {
    WEB_PORT: String(webPort),
    API_ORIGIN: `http://127.0.0.1:${apiPort}`,
  });
  console.log(`==> web (dev) http://127.0.0.1:${webPort} · api http://127.0.0.1:${apiPort}`);
});
