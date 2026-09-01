#!/usr/bin/env node
/** Builds the web bundle with Vite. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vite = resolve(root, 'apps/web/node_modules/vite/bin/vite.js');

const child = spawn(process.execPath, [vite, 'build', '--config', 'apps/web/vite.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
