// Dev-only model lab (/lab.html): look at characters and poses in isolation.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createDuelist, buildAttack, type AttackKind } from '@ronin/combat';
import { Swordsman, loadSwordsmanAssets } from '../characters/Swordsman';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2d33);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x5a5245, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(sun, ground);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.3, 4.2);
camera.lookAt(0, 1.0, 0);

const assets = await loadSwordsmanAssets();
const man = new Swordsman(assets, { kimono: 0x2a3346, hakama: 0x3a3a40, obi: 0x1a1410 });
scene.add(man);
const d = createDuelist('lab', { x: 0, z: 0 }, 0, { drawn: true });
const lab: any = (window as any).lab = { THREE, scene, camera, man, d, renderer, paused: false };
lab.pose = (phase: string, kind?: AttackKind, t = 1, extra: object = {}) => {
    d.phase = phase as any; d.phaseDur = 1; d.phaseTime = t;
    d.attack = kind ? buildAttack(d, kind, false) : null;
    Object.assign(d, extra);
    for (let i = 0; i < 20; i++) man.sync(d, 0, 1 / 60);
    renderer.render(scene, camera);
};
lab.view = (yaw: number) => { camera.position.set(Math.sin(yaw) * 4.2, 1.3, Math.cos(yaw) * 4.2); camera.lookAt(0, 1, 0); };
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => { const dt = clock.getDelta(); if (!lab.paused) man.sync(d, 0, dt); renderer.render(scene, camera); });
