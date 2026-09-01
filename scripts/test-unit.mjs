#!/usr/bin/env node
/** Shared package unit tests (pure functions, no I/O). */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const child = spawn(
  'node',
  ['--test', '--test-reporter=spec', 'packages/shared/test/*.test.ts'],
  { cwd: root, stdio: 'inherit', env: process.env },
);

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
