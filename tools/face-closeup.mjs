// Close-up of a rival's face through photo mode (dev check).
//   node tools/face-closeup.mjs <out.png> [angle offset, radians]
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto('http://localhost:3000/');
await p.waitForTimeout(10000);
await p.evaluate(() => [...document.querySelectorAll('.r-scr.title .r-menu button')].find(b => /Begin|Continue/.test(b.textContent)).click());
await p.waitForTimeout(1500);
const side = Number(process.argv[3] ?? 0);
const r = await p.evaluate(async (side) => {
  const g = window.__RONIN_DEBUG__.game, s = window.__RONIN_DEBUG__.scene, d = s.getDirector();
  const c = s.getController(); c.object.position.set(-70, 1.7, 26);
  const dbg = window.__RONIN_DEBUG__;
  for (let i = 0; i < 30; i++) { d.input?.update(1/60); s.update(1/60); d.input?.postUpdate(); }
  const site = d.sites[0];
  const head = site.figure.getObjectByName('head');
  const v = head.getWorldPosition(head.position.clone().set(0, 0, 0));
  s.getAtmosphere().setTimeOfDay(0.4);
  g.openPhoto();
  const ph = g.photo, cam = g.camera;
  const fig = site.figure; const f = fig.getWorldDirection(v.clone());
  const a = Math.atan2(f.x, f.z) + side;
  const at = v.clone().add({ x: 0, y: 0.1, z: 0 });
  cam.position.set(at.x + Math.sin(a) * 0.55, at.y + 0.02, at.z + Math.cos(a) * 0.55);
  const dx = at.x - cam.position.x, dz = at.z - cam.position.z;
  ph.yaw = Math.atan2(-dx, -dz); ph.pitch = -0.03;
  cam.fov = 35; cam.updateProjectionMatrix();
  document.querySelector('#r-photo')?.classList.add('hide-card');
  return [v.x, v.y, v.z];
}, side);
await p.waitForTimeout(1200);
await p.screenshot({ path: process.argv[2] });
console.log(r);
await b.close();
