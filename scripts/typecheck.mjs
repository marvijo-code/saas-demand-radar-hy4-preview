#!/usr/bin/env node
/**
 * Type checks every workspace with the shared tsconfig.
 *
 * This is the repository's `lint` step as well: there is no ESLint dependency in the project,
 * so `tsc --noEmit` over all packages is the single source of truth for static correctness.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');

const targets = [
  { name: 'shared', args: ['-p', 'packages/shared/tsconfig.json'] },
  { name: 'api', args: ['-p', 'apps/api/tsconfig.json'] },
  { name: 'web', args: ['-p', 'apps/web/tsconfig.json'] },
];

let failed = 0;

for (const target of targets) {
  console.log(`==> typecheck ${target.name}`);
  const code = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [tsc, ...target.args], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (exitCode) => resolvePromise(exitCode ?? 1));
  });
  if (code !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`\ntypecheck failed for ${failed} package(s)`);
  process.exit(1);
}
console.log('\ntypecheck passed');
