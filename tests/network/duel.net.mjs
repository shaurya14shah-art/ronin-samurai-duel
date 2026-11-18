// End-to-end check of the server-authoritative duel, against a running server:
//   npm run dev:server   (ws://localhost:2567)
//   node tests/network/duel.net.mjs
//
// Two real clients join one room. The server must: list a public duel that is waiting, seat
// them, run the sim, resolve a cut it was asked for by intent only, ignore a client claiming
// damage or teleporting, report state to both sides, record the result against each side's
// identity, and give a dropped player their seat back.

import { Client } from 'colyseus.js';
import assert from 'node:assert/strict';

const url = process.env.RONIN_SERVER ?? 'ws://localhost:2567';
const http = url.replace(/^ws/, 'http');
const wait = ms => new Promise(r => setTimeout(r, ms));
const idA = crypto.randomUUID(), idB = crypto.randomUUID();

function track(room) {
  const s = { you: null, snap: null, events: [], results: [] };
  room.onMessage('welcome', m => { s.you = m.you; s.records = m.records; });
  room.onMessage('snap', m => { s.snap = m; s.events.push(...m.events); });
  room.onMessage('result', m => s.results.push(m));
  room.onMessage('joined', () => {});
  room.onMessage('left', () => {});
  room.onMessage('pong', () => {});
  return s;
}

// A public duel with one fighter waiting is listed; a private one is not.
const lone = await new Client(url).create('duel', { name: 'Lone Tester' });
await wait(200);
let open = await (await fetch(`${http}/duels`)).json();
assert.ok(open.some(d => d.code === lone.roomId && d.host === 'Lone Tester'), 'a waiting public duel is listed');
await lone.leave();

const a = await new Client(url).create('duel', { name: 'Tester A', private: true, identity: idA });
const sa = track(a);
await wait(200);
open = await (await fetch(`${http}/duels`)).json();
assert.ok(!open.some(d => d.code === a.roomId), 'a private duel is not listed');
const clientB = new Client(url);
let b = await clientB.joinById(a.roomId, { name: 'Tester B', identity: idB });
let sb = track(b);
await wait(400);
assert.ok(sa.you && sb.you && sa.you !== sb.you, 'both seated in different slots');

const me = () => sa.snap.state.fighters.find(f => f.id === sa.you);
const foe = () => sa.snap.state.fighters.find(f => f.id === sb.you);
const facingTo = (p, q) => Math.atan2(q.pos.x - p.pos.x, q.pos.z - p.pos.z);

// Close the distance: A walks toward B while both draw.
a.send('input', { facing: facingTo(me(), foe()), move: { x: 0, z: 0 }, draw: true });
b.send('input', { facing: facingTo(foe(), me()), move: { x: 0, z: 0 }, draw: true });
await wait(700);
for (let i = 0; i < 90; i++) {
  const d = Math.hypot(me().pos.x - foe().pos.x, me().pos.z - foe().pos.z);
  a.send('input', { facing: facingTo(me(), foe()), move: { x: 0, z: d > 1.5 ? 1 : 0 } });
  b.send('input', { facing: facingTo(foe(), me()), move: { x: 0, z: 0 } });
  await wait(1000 / 30);
  if (d <= 1.5) break;
}
const vitBefore = foe().vitality;

// A cheat: claim damage, teleport, absurd speed. The server must ignore all of it.
b.send('input', { facing: 0, damage: 999, vitality: 1000, pos: { x: 500, z: 500 }, move: { x: 0, z: 0 } });
a.send('input', { facing: facingTo(me(), foe()), kill: true, hp: 0 });

// An honest cut from A, by intent only.
a.send('input', { facing: facingTo(me(), foe()), move: { x: 0, z: 0 }, attack: { dir: 'diag_l', committed: false } });
for (let i = 0; i < 40; i++) {
  a.send('input', { facing: facingTo(me(), foe()), move: { x: 0, z: 0 } });
  b.send('input', { facing: facingTo(foe(), me()), move: { x: 0, z: 0 } });
  await wait(1000 / 30);
}

const hit = sa.events.find(e => e.type === 'hit' && e.a === sa.you);
assert.ok(hit, 'the server resolved the cut');
assert.ok(foe().vitality < vitBefore, 'damage was applied by the server');
assert.ok(Math.hypot(foe().pos.x, foe().pos.z - -20) < 10, 'the teleport claim was ignored');
assert.ok(sb.events.some(e => e.type === 'hit'), 'the struck client saw it too');
assert.equal(JSON.stringify(sa.snap.state.fighters.map(f => f.vitality)), JSON.stringify(sb.snap.state.fighters.map(f => f.vitality)), 'both clients agree');

const cut = hit.contact, dealt = (vitBefore - foe().vitality).toFixed(1);
assert.deepEqual(sa.records[sa.you], { wins: 0, losses: 0 }, 'a new identity starts with no record');

// B drops without saying goodbye; the seat is held and B takes it back.
const token = b.reconnectionToken;
b.connection.close(3000, 'network drop'); // not 4000: that code means a consented leave
await wait(500);
b = await clientB.reconnect(token);
sb = track(b);
sb.you = 'p1';
await wait(300);
assert.ok(sb.snap && sb.snap.state.fighters.some(f => f.id === sb.you), 'the reconnected player is still in the duel');

// Finish the duel: A cuts until the server declares a result; it is recorded for both identities.
for (let i = 0; i < 400 && !sa.results.length; i++) {
  const shot = i % 50 === 0 ? { attack: { dir: 'diag_l', committed: false } } : {};
  a.send('input', { facing: facingTo(me(), foe()), move: { x: 0, z: 0 }, ...shot });
  b.send('input', { facing: facingTo(foe(), me()), move: { x: 0, z: 0 } });
  await wait(1000 / 30);
}
const result = sa.results[0];
assert.ok(result, 'the duel ended');
assert.equal(result.winner, sa.you);
assert.deepEqual(result.records[sa.you], { wins: 1, losses: 0 }, 'the winner is recorded');
assert.deepEqual(result.records[sb.you], { wins: 0, losses: 1 }, 'the loser is recorded');

await a.leave();
await b.leave();

// Accounts: register, sign in, play as the account (its name, not the one sent), record under it.
const post = (path, body, token) => fetch(`${http}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
const tag = Math.random().toString(36).slice(2, 7);
const ra = await post('/auth/register', { name: `Kensei ${tag}`, password: 'a long passphrase' });
assert.equal(ra.status, 200, ra.error);
assert.equal((await post('/auth/register', { name: `kensei ${tag}`, password: 'another one!' })).status, 409, 'names are unique');
assert.equal((await post('/auth/login', { name: `Kensei ${tag}`, password: 'wrong guess!' })).status, 401);
const la = await post('/auth/login', { name: `Kensei ${tag}`, password: 'a long passphrase' });
assert.ok(la.token, 'signed in');
const who = await fetch(`${http}/auth/me`, { headers: { Authorization: `Bearer ${la.token}` } }).then(r => r.json());
assert.equal(who.account.name, `Kensei ${tag}`);
await assert.rejects(new Client(url).create('duel', { name: 'x', token: 'forged-token', private: true }), 'a bad token is refused, not played as a guest');
const c = await new Client(url).create('duel', { name: 'Someone Else', token: la.token, private: true });
const sc = track(c);
const d = await new Client(url).joinById(c.roomId, { name: `Kensei ${tag}` });
const sd = track(d);
await wait(400);
assert.equal(sc.snap.names[sc.you], `Kensei ${tag}`, 'the account name is used, not the one sent');
assert.equal(sd.snap.names[sd.you], `Kensei ${tag} (guest)`, 'a guest cannot pass as an account');
await c.leave();
await d.leave();
await post('/auth/logout', {}, la.token);
assert.equal((await fetch(`${http}/auth/me`, { headers: { Authorization: `Bearer ${la.token}` } })).status, 401, 'signed out');

console.log(`ok · accounts · listed, ${cut} cut, ${dealt} vitality, cheat ignored, clients agree, reconnected, result recorded`);
process.exit(0);
