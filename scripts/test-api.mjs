#!/usr/bin/env node
/**
 * API test runner.
 *
 * Each test file gets its own process and its own temporary SQLite file, so the suites are
 * independent and never touch the development database.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dbDir = mkdtempSync(join(tmpdir(), 'sdr-api-test-'));

const child = spawn(
  'node',
  ['--test', '--test-concurrency=1', '--test-reporter=spec', 'apps/api/test/*.test.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SDR_DATABASE_PATH: join(dbDir, 'test.sqlite'),
      SDR_SCHEDULER_ENABLED: '0',
      SDR_SNAPSHOT_PATH: 'source-snapshot.json',
      RATE_LOGIN_MAX: '10000',
      RATE_MUTATION_MAX: '10000',
      RATE_READ_MAX: '100000',
    },
  },
);

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
