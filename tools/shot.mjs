#!/usr/bin/env node
// Headless visual check: open the running dev server, optionally run a script in the page,
// step the world a few frames, and save a screenshot.
//
//   node tools/shot.mjs <out.png> [--url http://localhost:3000/] [--wait 9000] [--js "<page script>"]
//
// The page script runs after load; `__step(n)` advances the world n frames at 60 Hz and renders.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const url = opt('--url', 'http://localhost:3000/');
const wait = Number(opt('--wait', '9000'));
const js = opt('--js', '');
const size = opt('--size', '1280x800').split('x').map(Number);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(wait);
await page.evaluate(() => {
  const dbg = window.__RONIN_DEBUG__;
  if (!dbg) return;
  window.__step = (n = 1) => {
    const s = dbg.scene, d = s.getDirector?.(), i = d?.input;
    for (let k = 0; k < n; k++) { i?.update(1 / 60); s.update(1 / 60); dbg.game?.portrait?.update(d.player, 1 / 60); i?.postUpdate(); }
  };
});
if (js) {
  const result = await page.evaluate(js);
  if (result !== undefined) console.log('js:', JSON.stringify(result));
  await page.waitForTimeout(Number(opt("--after", "600")));
}
await page.screenshot({ path: out });
if (errors.length) console.log('errors:', errors.slice(0, 5).join('\n'));
await browser.close();
