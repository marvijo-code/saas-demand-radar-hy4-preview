#!/usr/bin/env node
/**
 * Stops the API and web processes started by `npm start` or `npm run dev`.
 *
 * The ports are fixed by the interoperability contract (4173 web, 4174 API), so this resolves
 * the listeners through `ss` and terminates exactly those processes.
 */
import { execSync } from 'node:child_process';

const ports = [Number(process.env.WEB_PORT ?? 4173), Number(process.env.PORT ?? 4174)];

function pidsFor(port) {
  try {
    const output = execSync(`ss -ltnpH 'sport = :${port}' 2>/dev/null || true`, {
      encoding: 'utf8',
    });
    const pids = new Set();
    for (const match of output.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
    return [...pids];
  } catch {
    return [];
  }
}

let stopped = 0;
for (const port of ports) {
  for (const pid of pidsFor(port)) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`stopped pid ${pid} listening on ${port}`);
      stopped += 1;
    } catch (error) {
      console.log(`could not stop pid ${pid}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

if (stopped === 0) console.log('nothing was running on ports ' + ports.join(', '));
