import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  KELP_SPECS,
  loadKelpAssets,
  type KelpAsset,
  type KelpAssetStats,
} from '../rendering/KelpAsset';
import { KelpScatter } from '../rendering/KelpScatter';
import type { KelpName, KelpPlacement } from '../rendering/kelpPlacement';

interface KelpPreviewDiagnostics {
  readonly ready: boolean;
  readonly assetCount: number;
  readonly instanceCount: number;
  readonly kelpCounts: Record<KelpName, number>;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly fps: number;
  readonly swayTime: number;
}

interface KelpPreviewDebug {
  readonly ready: boolean;
  getDiagnostics(): KelpPreviewDiagnostics;
  getAssetStats(): KelpAssetStats[];
}

declare global {
  interface Window {
    __kelpPreview: KelpPreviewDebug;
  }
}

const viewport = document.getElementById('preview-viewport')!;
const statsElement = document.getElementById('stats')!;
const loading = document.getElementById('preview-loading')!;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x062d39);
scene.fog = new FogExp2(0x062d39, 0.05);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0.2, 4.4, 13.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.55, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new HemisphereLight(0x9fd0f0, 0x18342f, 1.20);
scene.add(hemi);
const sun = new DirectionalLight(0xfff0d4, 1.85);
sun.position.set(6, 11, 4);
scene.add(sun);
const fill = new DirectionalLight(0x3fb6c9, 0.55);
fill.position.set(-6, 3.5, -4);
scene.add(fill);

// Gentle dune plane; kelp bases sit slightly below zero so no gap shows.
const seabedGeometry = new PlaneGeometry(90, 90, 72, 72);
const seabedPositions = seabedGeometry.getAttribute('position');
for (let index = 0; index < seabedPositions.count; index += 1) {
  const x = seabedPositions.getX(index);
  const y = seabedPositions.getY(index);
  const dune = 0.055 * Math.sin(x * 0.34) * Math.cos(y * 0.27)
    + 0.025 * Math.sin(x * 1.1 + y * 0.6);
  seabedPositions.setZ(index, dune);
}
seabedGeometry.computeVertexNormals();
const seabed = new Mesh(
  seabedGeometry,
  new MeshStandardMaterial({ color: 0x1b3532, roughness: 0.98, metalness: 0 }),
);
seabed.rotation.x = -Math.PI / 2;
seabed.position.y = -0.03;
scene.add(seabed);

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPreviewLayout(): KelpPlacement[] {
  const rng = mulberry32(20261109);
  const placements: KelpPlacement[] = [];
  const rows: Array<{ name: KelpName; x: number; count: number; scaleMin: number; scaleMax: number }> = [
    { name: 'kelp_a', x: -2.5, count: 7, scaleMin: 0.94, scaleMax: 1.12 },
    { name: 'kelp_b', x: 2.5, count: 8, scaleMin: 0.98, scaleMax: 1.16 },
  ];
  for (const row of rows) {
    for (let index = 0; index < row.count; index += 1) {
      const x = row.x + (rng() - 0.5) * 1.5;
      const z = (index - (row.count - 1) / 2) * 0.86 + (rng() - 0.5) * 0.5;
      placements.push({
        name: row.name,
        band: 'foreground',
        side: row.x < 0 ? 'left' : 'right',
        x,
        y: -0.02,
        z,
        yaw: rng() * Math.PI * 2,
        tiltX: (rng() - 0.5) * 0.06,
        tiltZ: (rng() - 0.5) * 0.06,
        scale: MathUtils.lerp(row.scaleMin, row.scaleMax, rng()),
        phase: rng() * Math.PI * 2,
        frequency: 0.82 + rng() * 0.36,
        amplitude: 0.82 + rng() * 0.36,
        tint: Math.floor(rng() * 3),
      });
    }
  }
  return placements;
}

let ready = false;
let assets: KelpAsset[] = [];
let kelp: KelpScatter | undefined;
let fps = 0;

function updateHud(): void {
  if (!kelp) return;
  const counts = kelp.counts;
  const rows: Array<[string, string]> = [
    ['status', ready ? 'ready' : 'loading'],
    ['assets', `${assets.length} / ${KELP_SPECS.length}`],
    ['instances', `${counts.kelp_a} + ${counts.kelp_b}`],
    ['triangles', renderer.info.render.triangles.toLocaleString()],
    ['draw calls', String(renderer.info.render.calls)],
    ['fps', String(fps)],
    ['sway', `${kelp.swayTime.toFixed(1)} s`],
  ];
  statsElement.innerHTML = rows
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join('');
}

async function boot(): Promise<void> {
  try {
    assets = await loadKelpAssets();
    const layout = buildPreviewLayout();
    kelp = new KelpScatter(assets, layout);
    scene.add(kelp.group);
    ready = true;
    loading.classList.add('hidden');
    updateHud();
    console.log(
      `kelp preview ready: ${assets.length} assets, ${layout.length} instances, ` +
      `${kelp.triangleCount} triangles`,
    );
  } catch (error) {
    loading.textContent = `Kelp preview failed: ${(error as Error).message}`;
    loading.classList.add('error');
    console.error(error);
  }
}

window.__kelpPreview = {
  get ready() {
    return ready;
  },
  getDiagnostics: () => ({
    ready,
    assetCount: assets.length,
    instanceCount: kelp ? kelp.counts.kelp_a + kelp.counts.kelp_b : 0,
    kelpCounts: kelp?.counts ?? { kelp_a: 0, kelp_b: 0 },
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    fps,
    swayTime: kelp?.swayTime ?? 0,
  }),
  getAssetStats: () => assets.map((asset) => ({ ...asset.stats })),
};

const clock = new Clock();
let frames = 0;
let fpsWindow = performance.now();

function animate(): void {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();
  if (kelp) kelp.update(time);
  controls.update();
  renderer.render(scene, camera);

  frames += 1;
  const now = performance.now();
  if (now - fpsWindow > 500) {
    fps = Math.round((frames * 1000) / (now - fpsWindow));
    frames = 0;
    fpsWindow = now;
    if (ready) updateHud();
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

void boot();
requestAnimationFrame(animate);
