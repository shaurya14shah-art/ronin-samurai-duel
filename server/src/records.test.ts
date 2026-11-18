import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Records, identity } from './records.js';

const A = '0b6f1a2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const B = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a';

test('identities must be UUIDs; anything else duels anonymously', () => {
  assert.equal(identity(A.toUpperCase()), A);
  assert.equal(identity('admin'), null);
  assert.equal(identity({ wins: 99 }), null);
});

test('results are counted, persisted, and cannot be farmed against yourself', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ronin-')), 'records.json');
  const r = new Records(file);
  r.result(A, B);
  r.result(A, B);
  r.result(B, A);
  r.result(A, A);
  r.result(A, null);
  r.flush();
  const again = new Records(file);
  assert.deepEqual(again.get(A), { wins: 3, losses: 1 });
  assert.deepEqual(again.get(B), { wins: 1, losses: 2 });
  assert.deepEqual(again.get(null), { wins: 0, losses: 0 });
});
