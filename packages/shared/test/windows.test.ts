import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinWindow, parseWindow, resolveNow, windowStartIso } from '../src/windows.ts';

const NOW = new Date('2026-09-01T12:00:00Z');
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

test('parseWindow accepts only the four documented windows', () => {
  assert.equal(parseWindow('24h'), '24h');
  assert.equal(parseWindow('7d'), '7d');
  assert.equal(parseWindow('30d'), '30d');
  assert.equal(parseWindow('all'), 'all');
  assert.equal(parseWindow('bogus'), 'all');
  assert.equal(parseWindow(undefined), 'all');
});

test('windowStartIso is null for all time and correct otherwise', () => {
  assert.equal(windowStartIso('all', NOW), null);
  assert.equal(windowStartIso('24h', NOW), iso(24));
  assert.equal(windowStartIso('7d', NOW), iso(24 * 7));
  assert.equal(windowStartIso('30d', NOW), iso(24 * 30));
});

test('isWithinWindow filters older records', () => {
  const start = windowStartIso('7d', NOW);
  assert.equal(isWithinWindow(iso(1), start), true);
  assert.equal(isWithinWindow(iso(24 * 6), start), true);
  assert.equal(isWithinWindow(iso(24 * 8), start), false);
  assert.equal(isWithinWindow('not-a-date', start), false);
});

test('everything is inside the all-time window', () => {
  assert.equal(isWithinWindow('1999-01-01T00:00:00Z', null), true);
});

test('resolveNow pins the clock when a deterministic value is supplied', () => {
  const pinned = '2026-01-02T03:04:05.000Z';
  assert.equal(resolveNow(pinned).toISOString(), pinned);
  assert.equal(resolveNow(Date.parse(pinned)).toISOString(), pinned);
  const fallback = resolveNow(undefined);
  assert.ok(Math.abs(fallback.getTime() - Date.now()) < 5_000);
});
