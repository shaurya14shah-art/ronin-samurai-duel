// Checks movement direction and the dash in a real page: W/S along the view, Space dash exploring and in a duel.
//   (client dev server on :3000)   node tools/movement-check.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto('http://localhost:3000/');
await p.waitForFunction(() => [...document.querySelectorAll('.r-scr.title .r-menu button')].length > 0, null, { timeout: 30000 });
await p.waitForTimeout(1500);
await p.locator('.r-scr.title .r-menu button', { hasText: /Begin the road|Continue/ }).first().click();
await p.waitForTimeout(800);
const prep = () => p.evaluate(() => { const g = window.__RONIN_DEBUG__.game, d = g.world.getDirector(); d.input.setSimulatedLock(true); g.pause.close(); g.playing = true; });
await prep();
const measure = async (label, key) => {
  const a = await p.evaluate(() => { const c = window.__RONIN_DEBUG__.scene.getController(); const f = c.getForward ? c.getForward() : null; return { x: c.object.position.x, z: c.object.position.z, yaw: c.getYaw(), f: f && [f.x, f.z] }; });
  await p.keyboard.down(key); await p.waitForTimeout(1000); await p.keyboard.up(key); await p.waitForTimeout(300);
  const bb = await p.evaluate(() => { const c = window.__RONIN_DEBUG__.scene.getController(); return { x: c.object.position.x, z: c.object.position.z }; });
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const along = (bb.x - a.x) * fx + (bb.z - a.z) * fz;
  console.log(label, key, 'moved along view', along.toFixed(2), 'm', 'ownsPlayer', await p.evaluate(() => window.__RONIN_DEBUG__.scene.getDirector().ownsPlayer));
};
await measure('sheathed', 'KeyW'); await measure('sheathed', 'KeyS');
await p.keyboard.press('KeyX'); await p.waitForTimeout(1200);
await measure('drawn', 'KeyW'); await measure('drawn', 'KeyS');
const dashTest = async label => {
  const a = await p.evaluate(() => { const c = window.__RONIN_DEBUG__.scene.getController(); return { x: c.object.position.x, z: c.object.position.z, yaw: c.getYaw() }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(500);
  const bb = await p.evaluate(() => { const c = window.__RONIN_DEBUG__.scene.getController(); return { x: c.object.position.x, z: c.object.position.z, owns: window.__RONIN_DEBUG__.scene.getDirector().ownsPlayer }; });
  console.log(label, 'Space dash along view', ((bb.x - a.x) * -Math.sin(a.yaw) + (bb.z - a.z) * -Math.cos(a.yaw)).toFixed(2), 'm; sim owns body:', bb.owns);
};
await dashTest('exploring');
// Into a duel: stand in front of a rival until it engages.
await p.evaluate(() => { const s = window.__RONIN_DEBUG__.scene, d = s.getDirector(), c = s.getController(), site = d.sites[0]; c.object.position.set(site.x, c.object.position.y, site.z + 3.2); const yaw = 0; c.yaw = yaw; c.object.rotation.y = yaw; });
await p.waitForTimeout(3500);
await dashTest('in a duel');
await b.close();
