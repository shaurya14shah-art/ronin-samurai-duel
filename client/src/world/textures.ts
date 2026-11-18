import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Procedural texture factory. Everything is painted on canvas so the
 *  whole game ships as a single self-contained file with zero AI photos.
 *  Safeguarded for Node.js unit testing environments.
 * ------------------------------------------------------------------ */

function canvas2d(size: number) {
  if (typeof document === 'undefined') {
    return { c: null as any, ctx: null as any };
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

/** deterministic PRNG so the world looks consistent */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** tileable value-noise field sampled from a grid */
function valueNoise(size: number, cells: number, rand: () => number) {
  const g = cells + 1;
  const grid = new Float32Array(g * g);
  for (let i = 0; i < g * g; i++) grid[i] = rand();
  const out = new Float32Array(size * size);
  const s = cells / size;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * s,
        fy = y * s;
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy);
      const tx = smooth(fx - x0),
        ty = smooth(fy - y0);
      const x1 = (x0 + 1) % g,
        y1 = (y0 + 1) % g;
      const a = grid[y0 * g + x0],
        b = grid[y0 * g + x1];
      const c = grid[y1 * g + x0],
        d = grid[y1 * g + x1];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fbm(size: number, rand: () => number, octaves = 5, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 1,
    total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base * Math.pow(2, o), rand);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export interface GroundMaps {
  map: THREE.Texture;
  rough: THREE.Texture;
  normal: THREE.Texture;
}

/** wet forest floor: mud, standing water puddles, scattered leaves */
export function makeGroundMaps(seed = 7): GroundMaps {
  if (typeof document === 'undefined') {
    return {
      map: new THREE.Texture(),
      rough: new THREE.Texture(),
      normal: new THREE.Texture(),
    };
  }

  const S = 1024;
  const rand = mulberry(seed);
  const field = fbm(S, rand, 6, 3);
  const detail = fbm(S, mulberry(seed + 91), 4, 24);

  const { c, ctx } = canvas2d(S);
  const { c: rc, ctx: rctx } = canvas2d(S);
  const { c: nc, ctx: nctx } = canvas2d(S);

  const img = ctx.createImageData(S, S);
  const rimg = rctx.createImageData(S, S);
  const nimg = nctx.createImageData(S, S);

  for (let i = 0; i < S * S; i++) {
    const f = field[i];
    const d = detail[i];
    const puddle = Math.max(0, Math.min(1, (0.36 - f) / 0.16));
    const wet = Math.max(puddle, Math.max(0, (0.44 - f) / 0.3) * 0.5);

    let r = 24 + f * 20 + d * 15;
    let g = 28 + f * 22 + d * 14;
    let b = 32 + f * 18 + d * 12;

    r = r * (1 - puddle) + 12 * puddle;
    g = g * (1 - puddle) + 16 * puddle;
    b = b * (1 - puddle) + 22 * puddle;

    const moss = Math.max(0, (d - 0.55) * wet * 1.4);
    g += moss * 25;
    b += moss * 10;

    img.data[i * 4] = Math.min(255, Math.floor(r));
    img.data[i * 4 + 1] = Math.min(255, Math.floor(g));
    img.data[i * 4 + 2] = Math.min(255, Math.floor(b));
    img.data[i * 4 + 3] = 255;

    const rough = 0.98 - wet * 0.9;
    const rv = Math.floor(rough * 255);
    rimg.data[i * 4] = rv;
    rimg.data[i * 4 + 1] = rv;
    rimg.data[i * 4 + 2] = rv;
    rimg.data[i * 4 + 3] = 255;

    const x = i % S;
    const dx = field[i] - field[i - (x > 0 ? 1 : 0)];
    const dy = field[i] - field[i - (i > S ? S : 0)];
    nimg.data[i * 4] = 128 + dx * 900;
    nimg.data[i * 4 + 1] = 128 + dy * 900;
    nimg.data[i * 4 + 2] = 255;
    nimg.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);

  // fallen dark bamboo leaves
  for (let i = 0; i < 1400; i++) {
    const x = rand() * S,
      y = rand() * S;
    const a = rand() * Math.PI * 2;
    const w = 3 + rand() * 9,
      h = 2 + rand() * 5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = `rgba(32,40,24,${0.25 + rand() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(rc);
  const normal = new THREE.CanvasTexture(nc);
  for (const t of [map, rough, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, rough, normal };
}


/** woven cloth for hakama / kimono */
export function makeClothTexture(base: string, dark: string): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();

  const S = 256;
  const { c, ctx } = canvas2d(S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const rand = mulberry(11);
  for (let i = 0; i < S; i += 2) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    ctx.fillRect(i, 0, 1, S);
    ctx.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.04})`;
    ctx.fillRect(0, i, S, 1);
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.14})`;
    ctx.fillRect(rand() * S, rand() * S, 1 + rand() * 5, 1 + rand() * 5);
  }
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(0, S * 0.62, S, S * 0.38);
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** procedural inky midnight sky dome */
export function makeSkyTexture(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();

  const W = 16,
    H = 256;
  const { c, ctx } = canvas2d(W);
  c.height = H;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#040609');
  g.addColorStop(0.35, '#090e15');
  g.addColorStop(0.62, '#121a24');
  g.addColorStop(0.85, '#1e2833');
  g.addColorStop(1, '#2c3742');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
