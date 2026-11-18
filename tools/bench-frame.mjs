#!/usr/bin/env node
// Frame cost at 1920×1080 in headless Chromium (GPU via ANGLE/Metal), at several places.
// Times world update (CPU) and render + gl.finish (CPU submit + GPU) separately.
//   (client dev server on :3000)   node tools/bench-frame.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/');
await page.waitForTimeout(10000);
await page.evaluate(() => [...document.querySelectorAll('.r-scr.title .r-menu button')].find(b => /Begin|Continue/.test(b.textContent)).click());
await page.waitForTimeout(1500);
const spots = [['Courtyard', 0, 6, 0], ['Bamboo grove', 3, -55, 0], ['Shrine approach', -70, 30, 0], ['Hamlet', 55, -36, 0], ['Bridge', 66, 22, 0]];
for (const [name, x, z] of spots) {
  const r = await page.evaluate(([x, z]) => {
    const dbg = window.__RONIN_DEBUG__, s = dbg.scene, g = dbg.game, d = s.getDirector();
    const c = s.getController();
    c.object.position.set(x, c.object.position.y, z);
    const gl = g.renderer.getContext();
    const step = () => { d.input?.update(1 / 60); s.update(1 / 60); d.input?.postUpdate(); };
    for (let i = 0; i < 90; i++) { step(); g.renderFrameNow(); }
    gl.finish();
    const up = [], rd = [];
    for (let i = 0; i < 120; i++) {
      let t = performance.now(); step(); up.push(performance.now() - t);
      t = performance.now(); g.renderFrameNow(); gl.finish(); rd.push(performance.now() - t);
    }
    const q = (a, p) => [...a].sort((m, n) => m - n)[Math.floor(a.length * p)];
    g.renderer.info.autoReset = false; g.renderer.info.reset(); g.renderFrameNow(); gl.finish();
    const info = { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };
    // Where the time goes: scene alone (no post), and scene without shadows.
    const time = fn => { const a = []; for (let i = 0; i < 40; i++) { const t = performance.now(); fn(); gl.finish(); a.push(performance.now() - t); } return q(a, 0.5); };
    const sceneOnly = time(() => g.renderer.render(g.scene, g.camera));
    const sm = g.renderer.shadowMap.enabled; g.renderer.shadowMap.autoUpdate = false;
    const noShadowUpdate = time(() => g.renderer.render(g.scene, g.camera));
    g.renderer.shadowMap.autoUpdate = true; g.renderer.info.autoReset = true;
    return { update: q(up, 0.5), update95: q(up, 0.95), render: q(rd, 0.5), render95: q(rd, 0.95), calls: info.calls, tris: info.triangles, sceneOnly, noShadowUpdate };
  }, [x, z]);
  console.log(`${name.padEnd(16)} update ${r.update.toFixed(2)} ms (p95 ${r.update95.toFixed(2)})  render ${r.render.toFixed(2)} ms (p95 ${r.render95.toFixed(2)})  draws ${r.calls}  tris ${(r.tris / 1000).toFixed(0)}k  | scene w/o post ${r.sceneOnly.toFixed(1)}  w/o shadow pass ${r.noShadowUpdate.toFixed(1)}`);
}
await browser.close();
