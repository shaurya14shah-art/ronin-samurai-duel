import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Journal, JOURNAL_LIMIT, type JournalStorage } from './Journal';

function memory(): JournalStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

test('entries persist, newest first, and survive a reload', () => {
    const store = memory();
    let t = 1000;
    const j = new Journal(store, () => t);
    j.add('place', 'Came to the Evening Bell Shrine.');
    t += 120_000;
    j.add('rival', 'Ren of the Bell stood in the road.');
    const again = new Journal(store, () => t);
    assert.deepEqual(again.entries().map(e => e.kind), ['rival', 'place']);
});

test('the same event is written once, the log is bounded, and junk is ignored', () => {
    const store = memory();
    let t = 0;
    const j = new Journal(store, () => t);
    j.add('duel', 'Ren of the Bell did not rise.');
    t += 5000;
    j.add('duel', 'Ren of the Bell did not rise.');
    assert.equal(j.entries().length, 1);
    for (let i = 0; i < JOURNAL_LIMIT + 20; i++) { t += 61_000; j.add('place', `place ${i}`); }
    assert.equal(j.entries().length, JOURNAL_LIMIT);
    store.setItem('ronin.journal.v1', JSON.stringify([{ t: 1, kind: 'hack', text: 'x' }, { t: 2, kind: 'forge', text: 'A blade.' }, null]));
    assert.deepEqual(new Journal(store).entries().map(e => e.text), ['A blade.']);
});
