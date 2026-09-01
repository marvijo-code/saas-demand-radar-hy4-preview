import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/passwords.ts';

test('hashPassword never stores the plain password', () => {
  const hash = hashPassword('AcmeAdmin!2026');
  assert.ok(!hash.includes('AcmeAdmin!2026'));
  assert.match(hash, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test('verifyPassword accepts the right password and rejects the wrong one', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('Correct horse battery staple', hash), false);
  assert.equal(verifyPassword('', hash), false);
});

test('each hash uses its own salt', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('same-password', a), true);
  assert.equal(verifyPassword('same-password', b), true);
});

test('verifyPassword rejects malformed hashes instead of throwing', () => {
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.equal(verifyPassword('x', 'md5$abc$def'), false);
});
