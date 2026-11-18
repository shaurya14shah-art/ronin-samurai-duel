#!/usr/bin/env node
// Runs the in-game frame bench (`?bench`) in a visible Chromium window at 1920×1080, so frames
// are paced like a real session (headless timings are unreliable; see docs/PERFORMANCE.md).
//   (client dev server on :3000)   node tools/bench-real.mjs [out.png]
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1180'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:3000/?bench');
await page.waitForFunction(() => !!window.__RONIN_BENCH__, null, { timeout: 180000, polling: 1000 });
const r = await page.evaluate(() => window.__RONIN_BENCH__);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
const f = v => v.toFixed(2);
console.log(`gpu timer: ${r.gpu}  dpr ${r.dpr}  ${r.rows[0].width}×${r.rows[0].height}`);
for (const row of r.rows) console.log(`${row.name.padEnd(16)} frame ${f(row.interval.median)} (p95 ${f(row.interval.p95)})  cpu ${f(row.cpu.median)} (p95 ${f(row.cpu.p95)})  gpu ${row.gpu ? `${f(row.gpu.median)} (p95 ${f(row.gpu.p95)})` : 'n/a'}  slow ${(row.overBudget * 100).toFixed(1)}%`);
await browser.close();
