#!/usr/bin/env node
// Two headless players duel through the real UI and the real server.
//   (client on :3000 and server on :2567 running)   node tools/two-player.mjs <outdir> [--lag ms]
// With --lag, player A runs with that much added latency each way and the run also checks
// that A's own fighter answers at once (prediction) while the server catches up.
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const lagAt = process.argv.indexOf('--lag');
const lag = lagAt > 0 ? Number(process.argv[lagAt + 1]) : 0;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const open = async (q = '') => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${process.env.RONIN_URL ?? 'http://localhost:3000/'}${q}`);
  await page.waitForFunction(() => !!document.querySelector('#r-mp') && [...document.querySelectorAll('.r-scr.title .r-menu button')].length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { page, errors };
};
const clickText = (page, scope, text) => page.evaluate(([scope, text]) => {
  const b = [...document.querySelectorAll(`${scope} button`)].find(x => x.textContent.trim().toLowerCase() === text.toLowerCase());
  if (!b) throw new Error(`no button "${text}" in ${scope}`);
  b.click();
}, [scope, text]);

const A = await open(lag ? `?lag=${lag}` : '');
const B = await open();
await A.page.evaluate(() => { localStorage.setItem('ronin.name.v1', 'Musashi of Tests'); });
await B.page.evaluate(() => { localStorage.setItem('ronin.name.v1', 'Kojiro of Tests'); });
for (const p of [A.page, B.page]) await clickText(p, '.r-scr.title', 'Multiplayer');
await A.page.fill('#r-mp input', 'Musashi of Tests');
await B.page.fill('#r-mp input', 'Kojiro of Tests');
await clickText(A.page, '#r-mp', 'Host a private duel');
await A.page.waitForSelector('#r-mp .code', { timeout: 10000 });
const code = await A.page.textContent('#r-mp .code');
await clickText(B.page, '#r-mp', 'Join by code');
await B.page.fill('#r-mp .joinrow input', code);
await clickText(B.page, '#r-mp', 'Join');
await A.page.waitForFunction(() => document.querySelector('#r-mp .status')?.textContent.includes('Matched'), null, { timeout: 10000 });
await A.page.screenshot({ path: `${out}/mp-matched.png` });
for (const p of [A.page, B.page]) await clickText(p, '#r-mp', 'Enter the ring');

// Simulated pointer lock, then a scripted exchange: both draw, A closes the distance and cuts.
const prep = async page => page.evaluate(() => {
  const s = window.__RONIN_DEBUG__.scene, d = s.getDirector();
  d.input.setSimulatedLock(true);
  window.__key = c => { window.dispatchEvent(new KeyboardEvent('keydown', { code: c })); window.dispatchEvent(new KeyboardEvent('keyup', { code: c })); };
  window.__face = () => {
    const me = d.player, net = d.online, foe = net && net.opponentId ? d.duel.get(net.opponentId) : null;
    if (!foe) return 99;
    const yaw = Math.atan2(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z) - Math.PI;
    s.getController().yaw = yaw;
    return Math.hypot(foe.pos.x - me.pos.x, foe.pos.z - me.pos.z);
  };
  return d.online?.you;
});
console.log('seats', await prep(A.page), await prep(B.page), 'code', code);
await A.page.waitForTimeout(800);
if (lag) {
  // Walk for a moment: the predicted fighter moves now; the server's copy only after the round trip.
  const probe = await A.page.evaluate(async () => {
    const d = window.__RONIN_DEBUG__.scene.getDirector(), net = d.online;
    const pos = () => ({ ...d.player.pos }), srv = () => ({ ...net.latest.state.fighters.find(f => f.id === net.you).pos });
    const p0 = pos(), s0 = srv();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await new Promise(r => setTimeout(r, 120));
    const p1 = pos(), s1 = srv();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    await new Promise(r => setTimeout(r, 1500));
    const p2 = pos(), s2 = srv();
    const h = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    return { predictedAfter120ms: h(p0, p1), serverAfter120ms: h(s0, s1), settledGap: h(p2, s2), ping: net.pingMs };
  });
  console.log('prediction', JSON.stringify(probe));
  if (!(probe.predictedAfter120ms > 0.05 && probe.serverAfter120ms < probe.predictedAfter120ms && probe.settledGap < 0.01)) { console.log('PREDICTION FAILED'); process.exitCode = 1; }
}
for (const p of [A.page, B.page]) await p.evaluate(() => { window.__face(); window.__key('KeyX'); });
await A.page.waitForTimeout(1200);
for (let i = 0; i < 80; i++) {
  const d = await A.page.evaluate(() => { const dist = window.__face(); const w = dist > 1.6; window.dispatchEvent(new KeyboardEvent(w ? 'keydown' : 'keyup', { code: 'KeyW' })); return dist; });
  await B.page.evaluate(() => window.__face());
  if (d <= 1.6) break;
  await A.page.waitForTimeout(50);
}
await A.page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); window.__face(); window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); });
await A.page.waitForTimeout(450);
await A.page.screenshot({ path: `${out}/mp-a.png` });
await B.page.screenshot({ path: `${out}/mp-b.png` });
await A.page.waitForTimeout(600);
const state = await B.page.evaluate(() => { const d = window.__RONIN_DEBUG__.scene.getDirector(); return d.duel.fighters.map(f => [f.id, Math.round(f.vitality), f.phase]); });
console.log('B sees', JSON.stringify(state));
console.log('errors', [...A.errors, ...B.errors].slice(0, 4));
await browser.close();
