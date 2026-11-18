// Dev-only (/hand.html): the first-person hand and sword in isolation, four views at once.
// ?view=n shows one view full-size.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { makeHand, skinMaterial, WRIST } from '../duel/Hand';
import { createProceduralSwordMesh } from '../forge/mesh-generator';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30333a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff0dd, 2.4);
sun.position.set(1, 2, 1.5);
scene.add(sun, new THREE.HemisphereLight(0xbfd0ff, 0x403020, 0.6));

const sword = createProceduralSwordMesh(
    { bladeLength: 74, curvature: 1.8, baseWidth: 3.2, tipWidth: 2.2, baseThickness: 0.75, tipThickness: 0.45, tsukaLength: 26, balanceShift: 0, hamonPattern: 'gunome', tsubaStyle: 'iron_mokko', tsukaWrapColor: 'charcoal' },
    { density: 7.85, carbonContent: 0.75, tensileStrength: 1250, toughness: 80, hardnessHRC: 62, resonanceDampening: 78, baseColor: '#dce4ed', luster: 0.85, grainTexture: 'folded', foldCount: 10, effectiveLayers: 1024 },
);
scene.add(sword);
if (new URLSearchParams(location.search).has('nosword')) sword.visible = false;
const skin = skinMaterial(0xb68466);
const right = makeHand(skin);
right.position.set(0, 0, -0.045);
const left = makeHand(skin);
left.scale.set(-1, 1, 1);
left.position.set(0, 0, -0.21);
scene.add(right, left);
const wristMark = new THREE.Mesh(new THREE.SphereGeometry(0.004), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
wristMark.position.copy(WRIST).add(right.position);
scene.add(wristMark);

const views: [THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(0.25, 0.28, -0.35), new THREE.Vector3(0, 0, -0.1)],   // over the shoulder, as the player sees
    [new THREE.Vector3(0.32, 0.02, -0.08), new THREE.Vector3(0, 0, -0.1)],   // side (flat of the blade)
    [new THREE.Vector3(0, 0.3, -0.1), new THREE.Vector3(0, 0, -0.1)],        // from above (spine side)
    [new THREE.Vector3(0.12, 0.1, 0.45), new THREE.Vector3(0, 0.0, 0.25)],   // the blade
];
const only = Number(new URLSearchParams(location.search).get('view'));
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
const render = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setScissorTest(true);
    const list = Number.isFinite(only) && new URLSearchParams(location.search).has('view') ? [only] : [0, 1, 2, 3];
    list.forEach((v, i) => {
        const cols = list.length === 1 ? 1 : 2;
        const vw = w / cols, vh = list.length === 1 ? h : h / 2;
        const x = (i % cols) * vw, y = list.length === 1 ? 0 : (1 - Math.floor(i / cols)) * vh;
        renderer.setViewport(x, y, vw, vh); renderer.setScissor(x, y, vw, vh);
        camera.aspect = vw / vh; camera.updateProjectionMatrix();
        camera.position.copy(views[v][0]); camera.up.set(0, 1, 0); camera.lookAt(views[v][1]);
        renderer.render(scene, camera);
    });
};
renderer.setAnimationLoop(render);
(window as unknown as { __ready: boolean }).__ready = true;
