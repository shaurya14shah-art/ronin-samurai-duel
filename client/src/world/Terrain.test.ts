import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from './Terrain';

test('sampler is deterministic for a given seed', () => {
    const a = new Terrain(4242);
    const b = new Terrain(4242);
    for (const [x, z] of [[3, 7], [-15, 22], [40, -60], [123.4, -99.8]]) {
        assert.equal(a.sampleHeight(x, z), b.sampleHeight(x, z));
    }
});

test('different seeds produce different terrain', () => {
    const a = new Terrain(1);
    const b = new Terrain(2);
    let differs = false;
    for (let x = 20; x < 200; x += 8) {
        if (Math.abs(a.sampleHeight(x, -30) - b.sampleHeight(x, -30)) > 0.01) { differs = true; break; }
    }
    assert.ok(differs);
});

test('courtyard interior is exactly flat', () => {
    const terrain = new Terrain(7);
    for (let x = -11; x <= 11; x += 2.2) {
        for (let z = -11; z <= 11; z += 2.2) {
            if (Math.hypot(x, z) < 11.9) assert.equal(terrain.sampleHeight(x, z), 0);
        }
    }
});

test('heights are continuous across the courtyard blend ring', () => {
    const terrain = new Terrain(7);
    let maxStep = 0;
    for (let r = 11; r < 21; r += 0.1) {
        for (const [x, z] of [[r, 0], [0, r], [-r, 0], [0, -r], [r * 0.7071, r * 0.7071]]) {
            const h1 = terrain.sampleHeight(x, z);
            const h2 = terrain.sampleHeight(x + 0.1, z);
            const h3 = terrain.sampleHeight(x, z + 0.1);
            maxStep = Math.max(maxStep, Math.abs(h2 - h1), Math.abs(h3 - h1));
        }
    }
    assert.ok(maxStep < 0.35, `max step ${maxStep}`);
});

test('heights stay walkable outside the ring', () => {
    const terrain = new Terrain(9);
    for (let i = 0; i < 500; i++) {
        const x = (i * 37.7) % 240 - 120;
        const z = (i * 61.3) % 240 - 120;
        const h = terrain.sampleHeight(x, z);
        assert.ok(Number.isFinite(h), `non-finite at ${x},${z}`);
        assert.ok(Math.abs(h) < 20, `too steep at ${x},${z}: ${h}`);
    }
});
