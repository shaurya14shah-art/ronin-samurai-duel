import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts, AuthError, SESSION_DAYS } from './accounts.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'ronin-acct-')), 'accounts.json');
const fails = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof AuthError && e.status === status);

test('register, sign in, and a session token identifies the account', () => {
  const a = new Accounts(null);
  const r = a.register('Musashi', 'correct horse');
  assert.equal(a.verify(r.token)?.name, 'Musashi');
  const l = a.login('musashi', 'correct horse');
  assert.equal(l.account.id, r.account.id, 'names are matched without case');
  assert.notEqual(l.token, r.token);
  a.logout(l.token);
  assert.equal(a.verify(l.token), null, 'signed out');
  assert.equal(a.verify('made-up'), null);
});

test('bad names, short passwords, taken names and wrong passwords are refused', () => {
  const a = new Accounts(null);
  a.register('Kojiro', 'long enough');
  fails(() => a.register('<script>', 'long enough'), 400);
  fails(() => a.register('Ko', 'long enough'), 400);
  fails(() => a.register('Ren', 'short'), 400);
  fails(() => a.register('KOJIRO', 'long enough'), 409);
  fails(() => a.login('Kojiro', 'wrong password'), 401);
  fails(() => a.login('Nobody', 'whatever1'), 401);
});

test('repeated wrong passwords lock the name for a minute', () => {
  let t = 0;
  const a = new Accounts(null, () => t);
  a.register('Aya', 'the right one');
  for (let i = 0; i < 5; i++) fails(() => a.login('Aya', 'wrong one!'), 401);
  fails(() => a.login('Aya', 'the right one'), 429);
  t += 61_000;
  assert.equal(a.login('Aya', 'the right one').account.name, 'Aya');
});

test('sessions expire, and the file holds no passwords or usable tokens', () => {
  let t = 0;
  const f = file();
  const a = new Accounts(f, () => t);
  const { token } = a.register('Jiro', 'secret phrase');
  a.flush();
  const raw = readFileSync(f, 'utf8');
  assert.ok(!raw.includes('secret phrase') && !raw.includes(token), 'only hashes on disk');
  const b = new Accounts(f, () => t);
  assert.equal(b.verify(token)?.name, 'Jiro', 'survives a restart');
  t += (SESSION_DAYS + 1) * 86_400_000;
  assert.equal(b.verify(token), null, 'expired');
});
