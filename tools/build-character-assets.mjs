#!/usr/bin/env node
// Build the character assets the client loads from client/public/models/.
//
// Source: Mesh2Motion (https://github.com/Mesh2Motion/mesh2motion-app), art assets CC0 1.0.
//   static/models-variation/human/male.glb          skinned human, 66-bone rig
//   static/animations/human-base-animations.glb     clip library on the same rig
//   static/animations/human-addon-animations.glb    more clips on the same rig
//
// The libraries are ~11 MB together; the duel drives a few clips. This keeps those clips,
// drops the library meshes/textures (clips bind to the body's bones by name), and prunes.
//
//   node tools/build-character-assets.mjs <dir with the three source files>

import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = new Set([
  'Idle_Sword', 'Sword_Attack', 'Sword_Block', 'Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C',
  'Walk', 'Walk_Backwards', 'Strafe_left', 'Strafe_right', 'Dodge_back', 'Dodge_left', 'Dodge_right',
  'Hit_Chest', 'Hit_Head', 'Hit_Knockback', 'Death_A', 'Death_B', 'Idle_A', 'Idle_Subtle', 'Fighting Idle',
  'Defend', 'Meditate', 'Bow', 'Kneeling Tired', 'Tired Hunched', 'Jog',
]);

const src = process.argv[2];
if (!src) { console.error('usage: build-character-assets.mjs <source dir>'); process.exit(1); }
const out = new URL('../client/public/models/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const io = new NodeIO();
const merged = await io.read(join(src, 'human-base-animations.glb'));
const addon = await io.read(join(src, 'human-addon-animations.glb'));

// Pull the addon clips we want onto the base document's bones (same names).
const nodesByName = new Map(merged.getRoot().listNodes().map(n => [n.getName(), n]));
const buffer = merged.getRoot().listBuffers()[0];
for (const anim of addon.getRoot().listAnimations()) {
  if (!KEEP.has(anim.getName())) continue;
  const copy = merged.createAnimation(anim.getName());
  for (const ch of anim.listChannels()) {
    const target = nodesByName.get(ch.getTargetNode()?.getName() ?? '');
    if (!target) continue;
    const s = ch.getSampler();
    const input = merged.createAccessor().setType(s.getInput().getType()).setArray(s.getInput().getArray().slice()).setBuffer(buffer);
    const output = merged.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buffer);
    const sampler = merged.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
    copy.addSampler(sampler).addChannel(merged.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
  }
}
for (const anim of merged.getRoot().listAnimations()) if (!KEEP.has(anim.getName())) anim.dispose();
// Clips only: the library's own mesh and texture are not needed.
for (const mesh of merged.getRoot().listMeshes()) mesh.dispose();
for (const tex of merged.getRoot().listTextures()) tex.dispose();
for (const mat of merged.getRoot().listMaterials()) mat.dispose();
await merged.transform(resample({ tolerance: 1e-3 }), prune(), dedup());
await io.write(join(out, 'swordsman-anims.glb'), merged);

copyFileSync(join(src, 'male.glb'), join(out, 'swordsman.glb'));
for (const f of ['swordsman.glb', 'swordsman-anims.glb']) {
  console.log(f, Math.round(statSync(join(out, f)).size / 1024), 'KB');
}
console.log('clips:', merged.getRoot().listAnimations().map(a => a.getName()).join(', '));
