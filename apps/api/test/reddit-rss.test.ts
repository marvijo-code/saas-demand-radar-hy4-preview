import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRedditAtom } from '../src/sources/reddit.ts';

test('public Reddit Atom entries become normalized source records', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <author><name>/u/example_user</name></author>
        <category term="SaaS" label="r/SaaS"/>
        <content type="html">&lt;p&gt;I need this work automated &amp;amp; tracked.&lt;/p&gt;</content>
        <id>t3_abc123</id>
        <link href="https://www.reddit.com/r/SaaS/comments/abc123/a_real_request/"/>
        <published>2026-09-01T20:00:00+00:00</published>
        <title>Is there a tool for this?</title>
      </entry>
    </feed>`;

  const result = parseRedditAtom(xml);

  assert.deepEqual(result.errors, []);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    platform: 'reddit',
    externalId: 'abc123',
    url: 'https://www.reddit.com/r/SaaS/comments/abc123/a_real_request/',
    author: 'example_user',
    publishedAt: '2026-09-01T20:00:00.000Z',
    text: 'Is there a tool for this?\n\nI need this work automated & tracked.',
    engagement: {},
    subreddit: 'r/SaaS',
  });
});

test('malformed Reddit Atom entries are reported and skipped', () => {
  const xml = '<feed><entry><id>t3_missing_everything</id></entry></feed>';
  const result = parseRedditAtom(xml);
  assert.equal(result.records.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /url/);
});
