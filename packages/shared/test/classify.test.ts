import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyText, intentStrength, CLASSIFICATION_RULES } from '../src/index.ts';

test('detects explicit buying intent', () => {
  const signals = classifyText(
    'I would happily pay for a tool that chases late invoices every week.',
  );
  const kinds = signals.map((signal) => signal.kind);
  assert.ok(kinds.includes('buying_intent'), `expected buying intent, got ${kinds.join(',')}`);
  assert.ok(intentStrength(signals) > 0.7);
});

test('detects a request for a tool', () => {
  const signals = classifyText('Does anyone have a tool to find prospects on Reddit?');
  assert.ok(signals.some((signal) => signal.kind === 'tool_request'));
});

test('detects the "I wish there was" form', () => {
  const signals = classifyText(
    'I wish there was a simple out-of-the-box solution for tracking AI chatbot usage.',
  );
  assert.ok(signals.some((signal) => signal.kind === 'tool_request'));
});

test('detects recurring workarounds', () => {
  const signals = classifyText(
    'We keep a Google Sheet and copy-pasting between tools, it is a workaround we built ourselves.',
  );
  assert.ok(signals.some((signal) => signal.kind === 'workaround'));
});

test('detects price complaints', () => {
  const signals = classifyText(
    'Every alternative is enterprise priced and way too expensive for a five person team.',
  );
  assert.ok(signals.some((signal) => signal.kind === 'price_complaint'));
});

test('detects repeated operational pain', () => {
  const signals = classifyText(
    'Reconciling payouts takes forever and it keeps happening every week. Over and over.',
  );
  assert.ok(signals.some((signal) => signal.kind === 'recurring_pain'));
});

test('a rule can only fire once per record', () => {
  const signals = classifyText('I wish there was a tool. I wish there was a tool. I wish there was a tool.');
  const toolRequests = signals.filter((signal) => signal.kind === 'tool_request');
  assert.equal(toolRequests.length, 1);
});

test('matchedPhrase always contains literal source text', () => {
  const text = 'Does anyone have a tool to find prospects on Reddit?';
  for (const signal of classifyText(text)) {
    assert.ok(
      text.toLowerCase().includes(signal.matchedPhrase.toLowerCase()),
      `"${signal.matchedPhrase}" is not part of the source text`,
    );
  }
});

test('neutral text produces no signals', () => {
  assert.deepEqual(classifyText('The deployment finished at 09:00 and nothing else happened.'), []);
  assert.equal(intentStrength(classifyText('Nothing to see here.')), 0);
});

test('classification is deterministic', () => {
  const text = 'I wish there was an app that tracks AI usage. Pricing is insane right now.';
  assert.deepEqual(classifyText(text), classifyText(text));
});

test('every rule declares a kind, a phrase and a strength in 0..1', () => {
  for (const rule of CLASSIFICATION_RULES) {
    assert.ok(rule.phrase.length > 0);
    assert.ok(rule.strength > 0 && rule.strength <= 1);
    assert.ok(
      ['buying_intent', 'tool_request', 'workaround', 'price_complaint', 'recurring_pain'].includes(
        rule.kind,
      ),
    );
  }
});
