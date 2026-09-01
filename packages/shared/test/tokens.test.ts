import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyText,
  intentStrength,
  keyPhrases,
  slugify,
  stripIntentPrefix,
  titleFromText,
  tokenize,
  topicTokens,
  jaccard,
} from '../src/index.ts';

test('tokenize removes urls, stopwords and normalises synonyms', () => {
  const tokens = tokenize('I wish there was an app for https://example.com/x tracking invoices');
  assert.ok(!tokens.includes('app'), 'app should be normalised to software');
  assert.ok(tokens.includes('software'));
  assert.ok(tokens.includes('track'));
  assert.ok(tokens.includes('invoic'));
  assert.ok(!tokens.some((token) => token.includes('http')));
});

test('topicTokens strips the leading intent clause', () => {
  const tokens = topicTokens('I wish there was a tool to schedule client follow-ups');
  assert.ok(!tokens.includes('wish'), 'the intent verb must not survive');
  assert.ok(!tokens.includes('ther'), 'the filler "there" must not survive');
  assert.ok(tokens.includes('software'), '"tool" is normalised to "software"');
  assert.deepEqual(tokens, ['software', 'schedule', 'client', 'follow', 'ups']);
});

test('stripIntentPrefix handles the common asking forms', () => {
  assert.equal(stripIntentPrefix('I wish there was a way to export invoices'), 'A way to export invoices');
  assert.equal(stripIntentPrefix('Is there a tool for invoice chasing?'), 'Tool for invoice chasing?');
  assert.equal(stripIntentPrefix('Does anyone have a tool that tracks AI usage?'), 'Tool that tracks AI usage?');
  assert.equal(stripIntentPrefix('Looking for a newsletter about data tooling'), 'Newsletter about data tooling');
});

test('titleFromText keeps the first sentence and truncates long text', () => {
  assert.equal(
    titleFromText('I wish there was a newsletter for data engineering news. It should be weekly.'),
    'A newsletter for data engineering news',
  );
  const long = `I wish there was ${'a very long description '.repeat(20)}`;
  const title = titleFromText(long);
  assert.ok(title.length <= 111, `title too long: ${title.length}`);
  assert.ok(title.endsWith('…'));
});

test('slugify produces a stable key', () => {
  assert.equal(slugify('A Newsletter for Data Engineering!'), 'a-newsletter-for-data-engineering');
});

test('keyPhrases ranks tokens by frequency and is deterministic', () => {
  const text = 'invoices invoices invoices chasing chasing payment';
  assert.deepEqual(keyPhrases(text, 3), ['invoic', 'chas', 'payment']);
});

test('jaccard is symmetric and 1 for identical sets', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a', 'b'], ['b', 'a']), 1);
  assert.equal(jaccard(['a'], ['b']), 0);
  assert.equal(jaccard(['a', 'b', 'c'], ['b', 'c', 'd']), 0.5);
});
