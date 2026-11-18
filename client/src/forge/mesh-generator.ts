import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BladeGeometry } from "./physics";
import { BlendedMetallurgy } from "./materials";

// A katana built from its real anatomy. Frame: blade along +z from the habaki (z = 0) to the
// tip, cutting edge toward -y, spine toward +y, thickness along x; the tsuka runs toward -z.
//
// Blade: shinogi-zukuri. Each station's cross-section is edge (ha) → flat (hira, slightly
// convex: niku) → ridge line (shinogi) → upper flat (shinogi-ji) → peaked spine (iori-mune),
// mirrored. Faces keep their own vertices so the ridges stay crisp. The point (kissaki) is cut
// off by the yokote; its edge sweeps up to meet the spine in a curve (fukura).
//
// One material for the whole blade (the forge heats it through its emissive), with its regions
// painted into the textures: frosted temper line and edge (hamon, nioi), folded grain in the
// steel above it (hada), mirror-burnished shinogi-ji and mune.

const SEG = 90;
// Unrolled cross-section in texture u: hira L | shinogi-ji L | mune L | mune R | shinogi-ji R | hira R.
const U = { hiraL: [0, 0.3], jiL: [0.3, 0.42], muneL: [0.42, 0.5], muneR: [0.5, 0.58], jiR: [0.58, 0.7], hiraR: [0.7, 1] } as const;
const YOKOTE = 0.93;

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Height of the temper line above the edge, as a fraction of the hira, at v (0 habaki → 1 tip). */
function hamonLine(pattern: BladeGeometry["hamonPattern"], v: number): number {
  const x = v * 60;
  let w: number;
  switch (pattern) {
    case "gunome": w = 0.36 + Math.abs(Math.sin(x * 0.9)) * 0.16 + Math.sin(x * 2.7) * 0.02; break;
    case "notare": w = 0.4 + Math.sin(x * 0.35) * 0.1; break;
    case "choji": w = 0.34 + (Math.sin(x * 0.8) > 0.2 ? 0.2 : 0.06) + Math.cos(x * 1.9) * 0.04; break;
    case "midare": w = 0.38 + Math.sin(x * 0.5) * 0.1 + Math.sin(x * 1.37) * 0.08 + Math.cos(x * 3.1) * 0.03; break;
    default: w = 0.33 + Math.sin(x * 1.3) * 0.012;
  }
  // The hamon narrows at the machi and turns back (boshi) in the point.
  if (v < 0.04) w *= 0.6 + v * 10;
  if (v > YOKOTE) w = 0.45 + (v - YOKOTE) * 2;
  return w;
}

function bladeTextures(pattern: BladeGeometry["hamonPattern"], baseColor: string, folds: number, grain: string): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const W = 256, H = 1024;
  const color = document.createElement("canvas"); color.width = W; color.height = H;
  const rough = document.createElement("canvas"); rough.width = W; rough.height = H;
  const c = color.getContext("2d")!, r = rough.getContext("2d")!;
  const img = c.createImageData(W, H), rim = r.createImageData(W, H);
  const base = new THREE.Color(baseColor);
  const rnd = rand(folds * 7919 + grain.length);
  // Folded-steel grain: long wavy streaks along the blade (itame/masame), stronger with folds.
  const streaks: { u: number; amp: number; f: number; ph: number; s: number }[] = [];
  for (let i = 0; i < 40 + folds * 2; i++) streaks.push({ u: rnd(), amp: 0.01 + rnd() * 0.03, f: 2 + rnd() * 12, ph: rnd() * 6.28, s: (rnd() - 0.5) * 0.08 });
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H; // canvas top is the tip (flipY)
    const line = hamonLine(pattern, v);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // Which face, and how far from the edge across the hira (0 at the edge, 1 at the shinogi).
      let region: "hira" | "ji" | "mune", across = 0;
      if (u < U.hiraL[1]) { region = "hira"; across = u / U.hiraL[1]; }
      else if (u >= U.hiraR[0]) { region = "hira"; across = (1 - u) / (1 - U.hiraR[0]); }
      else if (u < U.jiL[1] || u >= U.jiR[0]) region = "ji";
      else region = "mune";
      let lum: number, roughness: number, tint = 0;
      if (region === "hira") {
        const hada = streaks.reduce((acc, s) => acc + Math.exp(-((across - s.u - Math.sin(v * s.f + s.ph) * s.amp - v * s.s) ** 2) / 0.00012) * 0.5, 0);
        const inHamon = across < line;
        // Nioi: a soft bright mist along the boundary; nie: fine sparkles at it.
        const edgeDist = Math.abs(across - line);
        const nioi = Math.exp(-(edgeDist * edgeDist) / 0.0009);
        const nie = edgeDist < 0.05 && rnd() > 0.985 ? 0.25 : 0;
        if (inHamon) { lum = 0.88 + nioi * 0.08 + nie; roughness = 0.42 - nioi * 0.1; }
        else { lum = 0.56 - Math.min(hada, 1) * 0.12 + nioi * 0.25 + nie; roughness = 0.16 + Math.min(hada, 1) * 0.06; tint = 0.03; }
        // The yokote: a crisp line where the point is ground.
        if (Math.abs(v - YOKOTE) < 0.0025) { lum *= 0.7; roughness = 0.1; }
      } else {
        // Burnished mirror (migaki): dark, near-perfect reflection.
        lum = region === "ji" ? 0.38 : 0.42;
        roughness = 0.07;
      }
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, base.r * lum * 255);
      img.data[i + 1] = Math.min(255, base.g * lum * 255);
      img.data[i + 2] = Math.min(255, (base.b * lum + tint) * 255);
      img.data[i + 3] = 255;
      rim.data[i] = rim.data[i + 1] = rim.data[i + 2] = Math.round(roughness * 255);
      rim.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  r.putImageData(rim, 0, 0);
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const roughnessMap = new THREE.CanvasTexture(rough);
  roughnessMap.anisotropy = 8;
  return { map, roughnessMap };
}

/** The blade surface, faces kept separate so its ridges stay sharp. */
function bladeGeometry(geo: BladeGeometry): THREE.BufferGeometry {
  const L = geo.bladeLength / 100, sori = geo.curvature / 100;
  const w0 = geo.baseWidth / 100, w1 = geo.tipWidth / 100;
  const t0 = geo.baseThickness / 100, t1 = geo.tipThickness / 100;
  // Section at s ∈ [0,1]: points as [x, y]. Width runs edge (y<0) to spine (y>0).
  const section = (s: number) => {
    const bend = sori * Math.sin(Math.min(1, s) * Math.PI * 0.92) * (1 - s * 0.15);
    let width = w0 + (w1 - w0) * s;
    const thick = t0 + (t1 - t0) * s;
    let edge = -width * 0.62, spine = width * 0.38;
    let ridgeAt = -width * 0.62 + width * 0.74; // shinogi line height
    let scale = 1;
    if (s > YOKOTE) {
      // Kissaki: the edge curves up (fukura) to meet the spine at the tip.
      const k = (s - YOKOTE) / (1 - YOKOTE);
      const fukura = 1 - Math.sqrt(Math.max(0, 1 - k * k));
      edge = edge + (spine - edge) * fukura;
      ridgeAt = ridgeAt + (spine - ridgeAt) * k;
      scale = Math.max(0.02, 1 - k * 0.95);
      width = spine - edge;
    }
    const tS = thick * 0.5 * scale;            // half-thickness at the shinogi
    const tM = thick * 0.34 * scale;           // half-thickness at the mune shoulders
    const muneShoulder = spine - Math.min(width * 0.06, 0.003);
    return {
      bend,
      edge: [0, edge + bend] as const,
      ridge: [tS, ridgeAt + bend] as const,
      shoulder: [tM, muneShoulder + bend] as const,
      peak: [0, spine + bend] as const,
      niku: tS * 0.1,
    };
  };
  // Strip between two profile curves along the blade; `sub` interior points per station
  // (for the convex hira). side: -1 left (x<0), +1 right.
  const strip = (pick: (sec: ReturnType<typeof section>) => [readonly [number, number], readonly [number, number]], side: number, u0: number, u1: number, convex = 0, sub = 1) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const cols = sub + 1;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      const sec = section(s);
      const [a, b] = pick(sec);
      for (let j = 0; j <= sub; j++) {
        const f = j / sub;
        let x = a[0] + (b[0] - a[0]) * f;
        const y = a[1] + (b[1] - a[1]) * f;
        x += Math.sin(Math.PI * f) * convex * sec.niku * 10;
        pos.push(side * x, y, s * L);
        uv.push(u0 + (u1 - u0) * f, s);
      }
      if (i > 0) for (let j = 0; j < sub; j++) {
        const p = (i - 1) * cols + j, q = i * cols + j;
        if (side > 0) idx.push(p, q, p + 1, p + 1, q, q + 1); else idx.push(p, p + 1, q, p + 1, q + 1, q);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const hira = side < 0 ? U.hiraL : U.hiraR, ji = side < 0 ? U.jiL : U.jiR, mune = side < 0 ? U.muneL : U.muneR;
    // u runs edge→spine on the left, spine→edge on the right, so the atlas stays continuous.
    const uv = (r: readonly [number, number]) => (side < 0 ? r : ([r[1], r[0]] as const));
    const h = uv(hira), j = uv(ji), m = uv(mune);
    parts.push(strip(s => [s.edge, s.ridge], side, h[0], h[1], 1, 6));
    parts.push(strip(s => [s.ridge, s.shoulder], side, j[0], j[1]));
    parts.push(strip(s => [s.shoulder, s.peak], side, m[0], m[1]));
  }
  // The habaki end is hidden inside the habaki; the tip closes to a point.
  return mergeGeometries(parts.map(p => p.toNonIndexed()))!;
}

/** A small hammered-iron texture (normal-ish relief) for the tsuba and kashira. */
function ironTexture(): THREE.CanvasTexture {
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a332e"; g.fillRect(0, 0, S, S);
  const rnd = rand(31);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 6;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${90 + rnd() * 40},${70 + rnd() * 30},${55},0.35)`);
    grd.addColorStop(1, "rgba(20,16,14,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Tsuka-ito over same: diagonal silk bands crossing in diamonds, white rayskin showing between. */
function tsukaTexture(wrap: string): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const W = 256, H = 512;
  const make = (fill: (g: CanvasRenderingContext2D) => void) => { const c = document.createElement("canvas"); c.width = W; c.height = H; fill(c.getContext("2d")!); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const diamonds = 6, period = H / diamonds;
  const bands = (g: CanvasRenderingContext2D, silk: string, shade: string, same: string, nodule: string) => {
    g.fillStyle = same; g.fillRect(0, 0, W, H);
    const rnd = rand(5);
    for (let i = 0; i < 2200; i++) { g.fillStyle = nodule; const r = 0.6 + rnd() * 1.6; g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); g.fill(); }
    // Two bands cross per period, leaving a diamond window in the middle of each face.
    for (let k = -1; k <= diamonds; k++) {
      for (const dir of [1, -1]) {
        g.save();
        g.translate(W / 2, k * period + period / 2);
        g.transform(1, dir * (period / W), 0, 1, 0, 0);
        const grd = g.createLinearGradient(0, -period * 0.32, 0, period * 0.32);
        grd.addColorStop(0, shade); grd.addColorStop(0.5, silk); grd.addColorStop(1, shade);
        g.fillStyle = grd;
        g.fillRect(-W, -period * 0.32, W * 2, period * 0.64);
        // Fine twist lines in the silk.
        g.strokeStyle = shade; g.globalAlpha = 0.35; g.lineWidth = 1;
        for (let l = -W; l < W; l += 5) { g.beginPath(); g.moveTo(l, -period * 0.32); g.lineTo(l + 6, period * 0.32); g.stroke(); }
        g.globalAlpha = 1;
        g.restore();
      }
    }
  };
  const silk = new THREE.Color(wrap);
  const css = (c: THREE.Color, k: number) => `rgb(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)})`;
  const map = make(g => bands(g, css(silk, 1.25), css(silk, 0.55), "#e8e2d4", "#fbf8f0"));
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = make(g => bands(g, "#ffffff", "#808080", "#202020", "#3a3a3a"));
  return { map, bumpMap };
}

export function createProceduralSwordMesh(
  geo: BladeGeometry,
  metal: BlendedMetallurgy
): THREE.Group {
  const swordGroup = new THREE.Group();
  swordGroup.name = "CustomForgedSword";
  const browser = typeof document !== "undefined";

  const tsukaLengthM = geo.tsukaLength / 100;
  const w0 = geo.baseWidth / 100, t0 = geo.baseThickness / 100;

  // 1. Blade (children[0]: the forge heats this mesh's material).
  const tex = browser ? bladeTextures(geo.hamonPattern, metal.baseColor, metal.foldCount ?? 10, metal.grainTexture ?? "folded") : null;
  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: tex?.map ?? null,
    roughnessMap: tex?.roughnessMap ?? null,
    metalness: 1,
    roughness: 1,
    envMapIntensity: 1.6,
    clearcoat: 0.3,
    clearcoatRoughness: 0.08,
  });
  if (!tex) bladeMat.color.set(metal.baseColor);
  const bladeMesh = new THREE.Mesh(bladeGeometry(geo), bladeMat);
  bladeMesh.castShadow = true;
  bladeMesh.receiveShadow = true;
  swordGroup.add(bladeMesh);

  // 2. Habaki: a brass collar wrapping the base of the blade, file-marked.
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xc08a3e, metalness: 1, roughness: 0.32, clearcoat: 0.4 });
  const habakiShape = new THREE.Shape();
  const hw = w0 * 0.6, ht = t0 * 0.9 + 0.0015;
  habakiShape.moveTo(-ht, -hw); habakiShape.lineTo(ht, -hw); habakiShape.lineTo(ht * 1.15, hw * 0.75);
  habakiShape.quadraticCurveTo(0, hw * 1.05, -ht * 1.15, hw * 0.75); habakiShape.closePath();
  const habakiGeo = new THREE.ExtrudeGeometry(habakiShape, { depth: 0.028, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 2 });
  habakiGeo.translate(0, -w0 * 0.12, -0.002);
  swordGroup.add(new THREE.Mesh(habakiGeo, brass));

  // 3. Seppa (copper spacers) either side of the tsuba, and the tsuba itself.
  const copper = new THREE.MeshPhysicalMaterial({ color: 0xb06a3b, metalness: 1, roughness: 0.38 });
  for (const z of [-0.0035, -0.0115]) {
    const seppa = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.0018, 40), copper);
    seppa.rotation.x = Math.PI / 2; seppa.scale.set(0.7, 1, 1.08); seppa.position.z = z;
    swordGroup.add(seppa);
  }
  const iron = new THREE.MeshPhysicalMaterial({ color: 0x8a7f76, map: browser ? ironTexture() : null, metalness: 0.85, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 });
  const tsubaShape = new THREE.Shape();
  const lobes = geo.tsubaStyle === "iron_mokko" ? 4 : geo.tsubaStyle === "octagonal" ? 8 : 0;
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    let r = 0.038;
    if (lobes === 4) r *= 1 - 0.07 * Math.pow(Math.abs(Math.cos(a * 2)), 0.5) + 0.02;
    if (lobes === 8) r /= Math.cos(((a + Math.PI / 8) % (Math.PI / 4)) - Math.PI / 8);
    const x = Math.cos(a) * r * 0.86, y = Math.sin(a) * r;
    if (i === 0) tsubaShape.moveTo(x, y); else tsubaShape.lineTo(x, y);
  }
  // Nakago-ana: the slot the tang passes through.
  const hole = new THREE.Path();
  hole.moveTo(-0.004, -0.012); hole.lineTo(0.004, -0.012); hole.lineTo(0.004, 0.009); hole.quadraticCurveTo(0, 0.013, -0.004, 0.009); hole.closePath();
  tsubaShape.holes.push(hole);
  if (geo.tsubaStyle === "sukashi_crane") {
    for (const s of [-1, 1]) { const p = new THREE.Path(); p.absellipse(s * 0.02, 0.006, 0.006, 0.012, 0, Math.PI * 2, false, s * 0.5); tsubaShape.holes.push(p); }
  }
  const tsubaGeo = new THREE.ExtrudeGeometry(tsubaShape, { depth: 0.005, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.001, bevelSegments: 3, curveSegments: 24 });
  const tsuba = new THREE.Mesh(tsubaGeo, iron);
  tsuba.position.z = -0.0105;
  swordGroup.add(tsuba);

  // 4. Fuchi (collar), tsuka (wrapped), menuki under the wrap, kashira (pommel cap).
  const darkMetal = new THREE.MeshPhysicalMaterial({ color: 0x2b2622, map: iron.map, metalness: 0.9, roughness: 0.4, clearcoat: 0.3 });
  const oval = (g: THREE.BufferGeometry) => { g.scale(0.78, 1, 1); return g; };
  const fuchi = new THREE.Mesh(oval(new THREE.CylinderGeometry(0.0165, 0.0165, 0.012, 40)), darkMetal);
  fuchi.rotation.x = Math.PI / 2; fuchi.position.z = -0.019;
  swordGroup.add(fuchi);
  const wrapHex = geo.tsukaWrapColor === "crimson" ? "#7a1e1a" : geo.tsukaWrapColor === "indigo" ? "#25285a" : geo.tsukaWrapColor === "leather" ? "#4a2a14" : geo.tsukaWrapColor === "unbleached" ? "#cfc6b4" : "#1b1a1c";
  const wrap = browser ? tsukaTexture(wrapHex) : null;
  // A slight hourglass waist, as real tsuka are shaped.
  const len = tsukaLengthM - 0.025;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; profile.push(new THREE.Vector2(0.0158 - 0.0012 * Math.sin(t * Math.PI), t * len)); }
  const tsukaGeo = oval(new THREE.LatheGeometry(profile, 48));
  if (wrap) { wrap.map.repeat.set(2, len / 0.15); wrap.bumpMap.repeat.copy(wrap.map.repeat); }
  const tsukaMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: wrap?.map ?? null, bumpMap: wrap?.bumpMap ?? null, bumpScale: 2.5, roughness: 0.78, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(wrapHex).multiplyScalar(1.6) });
  if (!wrap) tsukaMat.color.set(wrapHex);
  const tsuka = new THREE.Mesh(tsukaGeo, tsukaMat);
  tsuka.rotation.x = -Math.PI / 2;
  tsuka.position.z = -0.025;
  swordGroup.add(tsuka);
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const menuki = new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.018, 4, 10), gold);
    menuki.rotation.x = Math.PI / 2;
    menuki.position.set(s * 0.0122, 0, -0.025 - len * (s > 0 ? 0.42 : 0.58));
    swordGroup.add(menuki);
  }
  const kashira = new THREE.Mesh(oval(new THREE.SphereGeometry(0.0166, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2)), darkMetal);
  kashira.rotation.x = -Math.PI / 2;
  kashira.scale.set(0.78, 0.55, 1);
  kashira.position.z = -tsukaLengthM;
  swordGroup.add(kashira);

  return swordGroup;
}
