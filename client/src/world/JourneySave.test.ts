import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJourney } from './JourneySave';

test('old saves load without levels, experience, base stats or skill points', () => {
    const old = {
        version: 1, position: { x: 3, y: 1.7, z: 9 }, time: 0.4, totalWorldTime: 10,
        stats: { base: { strength: 40, agility: 10, vitality: 90, endurance: 10 }, level: 7, experience: 20, hp: 150, stamina: 80, composure: 100 },
        skills: { unlocked: ['iron_body'], points: 2 }, weapons: [], activeIndex: 0, rivals: {},
    };
    const j = validateJourney(old)!;
    assert.ok(j, 'the save is accepted');
    assert.deepEqual(j.stats, { hp: 150, stamina: 80, composure: 100 });
    assert.equal((j as unknown as Record<string, unknown>).skills, undefined, 'no skill points survive');
    assert.equal(j.position.x, 3);
});
