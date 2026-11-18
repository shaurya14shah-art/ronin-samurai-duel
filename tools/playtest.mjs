#!/usr/bin/env node
// Playtest: duels against a real rival in a visible browser, fought through the real input
// path: trusted keyboard and mouse events, real pointer lock, PlayerIntent → sim. Only aiming
// (camera yaw) and the walk to the rival's ground are set directly, because synthetic mouse
// moves cannot accumulate turning under pointer lock. The bot reacts every ~150 ms to what a
// player can see (the rival's stance, motion and distance), not to the AI's internals.
//   (client dev server on :3000)   node tools/playtest.mjs [duels=3] [rival index 0-4]
import { chromium } from 'playwright';

const DUELS = Number(process.argv[2] ?? 3);
const RIVAL = Number(process.argv[3] ?? 0);
const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.env.RONIN_URL ?? 'http://localhost:3000/');
await page.waitForFunction(() => [...document.querySelectorAll('.r-scr.title .r-menu button')].length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('.r-scr.title .r-menu button', { hasText: /Begin the road|Continue/ }).first().click();
await page.waitForTimeout(800);
await page.mouse.click(640, 400); // a click on the world takes the pointer
await page.waitForTimeout(400);
const locked = await page.evaluate(() => !!document.pointerLockElement);
console.log('pointer lock granted by the browser:', locked);
// An automated window is not OS-active, so the browser refuses pointer capture. The capture is
// the only thing simulated; every action below is a trusted browser event through PlayerIntent.
const simulateLock = () => page.evaluate(() => {
  const dbg = window.__RONIN_DEBUG__, d = dbg.scene.getDirector();
  d.input.setSimulatedLock(true);
  dbg.game.pause.close(); dbg.game.playing = true;
  return document.body.dataset.ui;
});
if (!locked) console.log('ui after simulated capture:', await simulateLock());

const look = () => page.evaluate(i => {
  const s = window.__RONIN_DEBUG__.scene, d = s.getDirector(), c = s.getController();
  const site = d.sites[i], r = d.duel.get(site.id), me = d.player;
  if (!r || !me) return null;
  const dist = Math.hypot(r.pos.x - me.pos.x, r.pos.z - me.pos.z);
  // Aim: turn the view onto the rival, as a player's mouse would.
  const yaw = Math.atan2(-(r.pos.x - me.pos.x), -(r.pos.z - me.pos.z));
  c.yaw = yaw; c.object.rotation.y = yaw;
  return { dist, me: { phase: me.phase, vit: me.vitality, sta: me.stamina, drawn: me.drawn }, rival: { phase: r.phase, vit: r.vitality, name: site.rivalName }, locked: !!document.pointerLockElement, dead: me.phase === 'dead' || r.phase === 'dead', outcome: document.body.dataset.ui };
}, RIVAL);

const place = () => page.evaluate(i => {
  const s = window.__RONIN_DEBUG__.scene, d = s.getDirector(), c = s.getController();
  const site = d.sites[i];
  c.object.position.set(site.x, c.object.position.y, site.z + 9);
}, RIVAL);

const key = async (k, ms = 60) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
const flickAndCut = async () => {
  // A short flick before the click picks the arc (PlayerIntent reads the gesture).
  const dirs = [[0, -60], [-50, -40], [50, -40], [-70, 0], [70, 0]];
  const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
  await page.mouse.move(640 + dx / 2, 400 + dy / 2, { steps: 2 });
  await page.mouse.move(640 + dx, 400 + dy, { steps: 2 });
  await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
  await page.mouse.move(640, 400, { steps: 6 });
};

const results = [];
for (let n = 0; n < DUELS; n++) {
  await place();
  await page.waitForTimeout(300);
  if (!locked) await simulateLock();
  const stats = { cuts: 0, guards: 0, parries: 0, steps: 0, ticks: 0, start: Date.now() };
  let s = await look();
  if (s && !s.me.drawn) await key('KeyX');
  let guarding = false, moving = null, last = s;
  while (Date.now() - stats.start < 120_000) {
    s = await look();
    if (!s) break;
    stats.ticks++;
    if (s.dead || s.outcome === 'death') break;
    // Distance: hold one step out; close when the rival is spent.
    const want = s.rival.phase === 'recover' || s.rival.phase === 'stagger' ? 1.6 : 2.3;
    const next = s.dist > want + 0.4 ? 'KeyW' : s.dist < want - 0.5 ? 'KeyS' : null;
    if (next !== moving) { if (moving) await page.keyboard.up(moving); if (next) await page.keyboard.down(next); moving = next; }
    const threat = s.rival.phase === 'windup' || s.rival.phase === 'active';
    if (threat && s.dist < 3.2) {
      if (Math.random() < 0.3 && s.rival.phase === 'windup') { await key('KeyT', 40); stats.parries++; }
      else if (!guarding) { await page.keyboard.down('KeyF'); guarding = true; stats.guards++; }
      if (Math.random() < 0.15) { await key('KeyQ', 40); stats.steps++; }
    } else {
      if (guarding) { await page.keyboard.up('KeyF'); guarding = false; }
      const open = ['recover', 'stagger', 'ready', 'stance_change'].includes(s.rival.phase);
      if (open && s.dist < 2.6 && s.me.sta > 25 && s.me.phase === 'ready' && Math.random() < 0.6) { await flickAndCut(); stats.cuts++; }
    }
    last = s;
    await page.waitForTimeout(150);
  }
  if (moving) await page.keyboard.up(moving);
  if (guarding) await page.keyboard.up('KeyF');
  const end = (await look()) ?? last;
  const won = end.rival.phase === 'dead';
  const lost = end.me.phase === 'dead' || end.outcome === 'death';
  results.push({ duel: n + 1, rival: end.rival.name, outcome: won ? 'won' : lost ? 'lost' : 'timeout', seconds: Math.round((Date.now() - stats.start) / 1000), myVitality: Math.round(end.me.vit), rivalVitality: Math.round(end.rival.vit), cuts: stats.cuts, guards: stats.guards, parries: stats.parries, steps: stats.steps });
  console.log(JSON.stringify(results[results.length - 1]));
  if (lost) {
    // Rise again at the forge, through the death screen's own button.
    await page.waitForTimeout(3500);
    const rise = page.locator('button', { hasText: /Rise|Again|Continue/i }).first();
    if (await rise.count()) await rise.click().catch(() => {});
    await page.waitForTimeout(1500);
    if (!locked) await simulateLock(); else await page.mouse.click(640, 400);
  } else {
    await page.waitForTimeout(6000);
  }
}
await page.screenshot({ path: process.env.SHOT ?? '/tmp/ronin-playtest.png' }).catch(() => {});
console.log('errors', errors.slice(0, 5));
await browser.close();
