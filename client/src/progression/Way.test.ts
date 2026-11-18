import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASTERY_USES, WIN_AGAIN, WIN_FIRST, earnWin, freshWay, learn, mastery, recordUse, toTraining, validateWay, type WayState } from './Way';

const rich = (insight: number): WayState => ({ ...freshWay(), insight, earned: insight });

test('ranks cost 1, 2, 3 and stop at 3; insight cannot be overspent', () => {
    let s = rich(6);
    for (let i = 0; i < 3; i++) { const r = learn(s, 'strength'); assert.equal(typeof r, 'object'); s = r as WayState; }
    assert.equal(s.ranks.strength, 3);
    assert.equal(s.insight, 0);
    assert.equal(learn(s, 'strength'), 'Fully trained');
    assert.match(String(learn(rich(0), 'endurance')), /Needs 1 insight/);
});

test('techniques need their physical grounding first', () => {
    const s = rich(10);
    assert.match(String(learn(s, 'kesa_giri')), /Needs Strength I/);
    const strong = learn(s, 'strength') as WayState;
    const k = learn(strong, 'kesa_giri') as WayState;
    assert.ok(k.known.includes('kesa_giri'));
    assert.equal(k.insight, 10 - 1 - 3);
    assert.equal(learn(k, 'kesa_giri'), 'Known');
});

test('a first win over a rival teaches more than beating them again', () => {
    const a = earnWin(freshWay(), 'shrine');
    const b = earnWin(a.state, 'shrine');
    assert.equal(a.gained, WIN_FIRST);
    assert.equal(b.gained, WIN_AGAIN);
    assert.equal(b.state.insight, WIN_FIRST + WIN_AGAIN);
});

test('mastery comes only from use, and reaches the sim', () => {
    let s = learn(learn(rich(4), 'strength') as WayState, 'kesa_giri') as WayState;
    for (let i = 0; i < MASTERY_USES / 2; i++) s = recordUse(s, 'kesa_giri');
    assert.equal(mastery(s, 'kesa_giri'), 0.5);
    assert.equal(recordUse(s, 'void_step'), s, 'an unknown technique is not practised');
    const t = toTraining(s);
    assert.equal(t.strength, 1);
    assert.ok(t.known.includes('kesa_giri'));
    assert.equal(t.mastery.kesa_giri, 0.5);
});

test('a saved Way cannot claim more than it earned', () => {
    const forged = validateWay({ insight: 500, earned: 3, ranks: { strength: 3, defence: 9 }, known: ['kesa_giri', 'teleport'], uses: { kesa_giri: 1e9 } });
    assert.equal(forged.ranks.defence, 3, 'clamped');
    assert.ok(!forged.known.includes('teleport' as never));
    assert.ok(forged.known.includes('wind_step'), 'the passing step is always known');
    const spent = 6 + 6 + 3;
    assert.equal(forged.earned, spent, 'earned is at least what was spent');
    assert.equal(forged.insight, 0, 'no unspent insight appears from nowhere');
    assert.equal(forged.uses.kesa_giri, 999);
});
