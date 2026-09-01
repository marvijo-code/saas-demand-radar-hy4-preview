#!/usr/bin/env node
/**
 * Runs the whole suite: shared unit tests, API tests and browser tests.
 * Separate commands exist for every part (see package.json).
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const only = process.argv.slice(2);

const suites = [
  { name: 'unit', script: 'scripts/test-unit.mjs', skipEnv: 'SDR_SKIP_UNIT' },
  { name: 'api', script: 'scripts/test-api.mjs', skipEnv: 'SDR_SKIP_API' },
  { name: 'browser', script: 'scripts/test-browser.mjs', skipEnv: 'SDR_SKIP_BROWSER' },
].filter((suite) => (only.length ? only.includes(suite.name) : true));

function run(script) {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [script], { cwd: root, stdio: 'inherit', env: process.env });
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

let failed = 0;
for (const suite of suites) {
  if (process.env[suite.skipEnv] === '1') {
    console.log(`\n=== skipping ${suite.name} (${suite.skipEnv}=1)`);
    continue;
  }
  console.log(`\n=== ${suite.name} tests ===`);
  const code = await run(suite.script);
  if (code !== 0) {
    failed += 1;
    console.error(`\n${suite.name} tests failed (exit ${code})`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} suite(s) failed`);
  process.exit(1);
}
console.log('\nall test suites passed');
