import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecords } from '../src/group.ts';
import type { GroupableRecord } from '../src/group.ts';

function record(
  recordId: number,
  platform: 'x' | 'reddit',
  externalId: string,
  publishedAt: string,
  text: string,
  engagementTotal = 0,
): GroupableRecord {
  return { recordId, platform, externalId, publishedAt, text, engagementTotal };
}

test('groups related records about the same demanded thing into one need', () => {
  const clusters = groupRecords([
    record(1, 'reddit', 'a1', '2026-06-01T00:00:00Z', 'I wish there was a tool to chase late invoices.'),
    record(2, 'reddit', 'a2', '2026-06-02T00:00:00Z', 'Is there a tool that chases overdue invoices automatically?'),
    record(3, 'x', 'a3', '2026-06-03T00:00:00Z', 'Need an app for invoice chasing. I would pay for it.'),
  ]);
  assert.equal(clusters.length, 1, 'all three records describe the same need');
  assert.deepEqual(clusters[0].memberRecordIds, [1, 2, 3]);
});

test('keeps genuinely different demands apart', () => {
  const clusters = groupRecords([
    record(1, 'reddit', 'b1', '2026-06-01T00:00:00Z', 'I wish there was a newsletter for data engineering news.'),
    record(2, 'reddit', 'b2', '2026-06-02T00:00:00Z', 'I wish there was a way to set per app privacy levels.'),
  ]);
  assert.equal(clusters.length, 2);
});

test('the cluster key is stable across repeated runs', () => {
  const input = [
    record(7, 'x', 'c1', '2026-05-01T00:00:00Z', 'I wish there was an app that tracks AI chatbot usage.', 9),
    record(8, 'reddit', 'c2', '2026-05-05T00:00:00Z', 'Is there a tool for tracking AI chatbot usage?', 2),
  ];
  const first = groupRecords(input);
  const second = groupRecords([...input].reverse());
  assert.equal(first[0].key, second[0].key);
  assert.deepEqual(first[0].memberRecordIds, second[0].memberRecordIds);
});

test('the representative is the highest engagement record', () => {
  const clusters = groupRecords([
    record(1, 'reddit', 'd1', '2026-06-01T00:00:00Z', 'I wish there was a tool to chase late invoices.', 1),
    record(2, 'x', 'd2', '2026-06-02T00:00:00Z', 'Need an app for invoice chasing.', 42),
  ]);
  assert.equal(clusters[0].representativeRecordId, 2);
  assert.equal(clusters[0].key, 'x-d2');
});

test('phrases are derived from the combined evidence', () => {
  const clusters = groupRecords([
    record(1, 'reddit', 'e1', '2026-06-01T00:00:00Z', 'I wish there was a tool to chase late invoices.'),
    record(2, 'reddit', 'e2', '2026-06-02T00:00:00Z', 'Is there a tool that chases overdue invoices?'),
  ]);
  assert.ok(clusters[0].phrases.includes('invoic'));
});

test('an empty input yields no clusters', () => {
  assert.deepEqual(groupRecords([]), []);
});

test('the six snapshot records stay separate because they describe different products', () => {
  const snapshot = [
    record(1, 'x', '1904651944968302909', '2025-03-25T00:00:00Z', 'I wish there was an app where you could take a photo of what you have in your fridge and then it would give you recipe ideas.'),
    record(2, 'reddit', '1u5ivq4', '2026-06-14T00:00:00Z', 'Does anyone have a tool to find prospects on Reddit? I run a cold email agency and want that work automated.'),
    record(3, 'reddit', '1s41rmh', '2026-03-26T00:00:00Z', 'Finding the right software for a specific situation takes forever. Search results are often dead, enterprise-priced, or not a fit.'),
    record(4, 'reddit', '1u36nlj', '2026-06-10T00:00:00Z', 'I wish there was a simple out-of-the-box solution for tracking AI chatbot usage across company devices.'),
    record(5, 'reddit', '1s24xnu', '2026-03-19T00:00:00Z', 'I wish there was a way to set different privacy levels for different apps instead of one global level.'),
    record(6, 'reddit', '1in6lce', '2025-02-10T00:00:00Z', 'I wish there was a newsletter that gives useful updates about new data-engineering technology, features, and tools.'),
  ];
  const clusters = groupRecords(snapshot);
  assert.equal(
    clusters.length,
    6,
    'forcing unrelated demands into one cluster would misrepresent the evidence',
  );
});
