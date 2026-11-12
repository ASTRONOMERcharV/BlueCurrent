import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadSeaweedAsset, type SeaweedAsset, type SeaweedAssetStats } from '../rendering/SeaweedAsset';
import { SeaweedScatter } from '../rendering/SeaweedScatter';
import type { SeaweedPlacement } from '../rendering/seaweedPlacement';

interface SeaweedPreviewDiagnostics {
  readonly ready: boolean;
  readonly assetCount: number;
  readonly instanceCount: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly fps: number;
  readonly swayTime: number;
  readonly maps: number;
}

interface SeaweedPreviewDebug {
  readonly ready: boolean;
  getDiagnostics(): SeaweedPreviewDiagnostics;
  getAssetStats(): SeaweedAssetStats[];
}

declare global {
  interface Window {
    __seaweedPreview: SeaweedPreviewDebug;
  }
}

const viewport = document.getElementById('preview-viewport')!;
const statsElement = document.getElementById('stats')!;
const loading = document.getElementById('preview-loading')!;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x082b3a);
scene.fog = new FogExp2(0x082b3a, 0.045);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(4.6, 3.4, 7.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.5;
controls.maxDistance = 26;
controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new HemisphereLight(0x9fd0f0, 0x18342f, 1.25));
const sun = new DirectionalLight(0xfff0d4, 1.95);
sun.position.set(6, 11, 4);
scene.add(sun);
const fill = new DirectionalLight(0x3fb6c9, 0.6);
fill.position.set(-6, 3.5, -4);
scene.add(fill);

// Gentle dune plane.
const seabedGeometry = new PlaneGeometry(60, 60, 64, 64);
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

function buildPreviewLayout(): SeaweedPlacement[] {
  const spots: Array<[number, number, number, number]> = [
    // x, z, yaw, scale
    [-1.75, 0.55, 0.4, 2.02],
    [0.05, -1.15, 2.1, 1.92],
    [1.75, 0.5, 4.2, 1.86],
    [-0.8, 1.55, 1.2, 1.78],
    [1.0, 1.6, 3.3, 1.82],
  ];
  return spots.map(([x, z, yaw, scale], index) => ({
    x,
    y: -0.02,
    z,
    yaw,
    tiltX: (index % 2 === 0 ? 1 : -1) * 0.02,
    tiltZ: (index % 3 === 0 ? 1 : -1) * 0.02,
    scale,
    phase: (index * 2.17 + 0.6) % (Math.PI * 2),
    frequency: 0.85 + (index % 3) * 0.1,
    amplitude: 0.85 + (index % 2) * 0.12,
    tint: index % 3,
  }));
}

let ready = false;
let asset: SeaweedAsset | undefined;
let seaweed: SeaweedScatter | undefined;
let fps = 0;

function updateHud(): void {
  if (!seaweed || !asset) return;
  const rows: Array<[string, string]> = [
    ['status', ready ? 'ready' : 'loading'],
    ['assets', '1 / 1'],
    ['instances', String(seaweed.instanceCount)],
    ['triangles', renderer.info.render.triangles.toLocaleString()],
    ['draw calls', String(renderer.info.render.calls)],
    ['maps', String(asset.stats.maps)],
    ['fps', String(fps)],
    ['sway', `${seaweed.swayTime.toFixed(1)} s`],
  ];
  statsElement.innerHTML = rows
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join('');
}

async function boot(): Promise<void> {
  try {
    asset = await loadSeaweedAsset();
    seaweed = new SeaweedScatter(asset, buildPreviewLayout());
    scene.add(seaweed.group);
    ready = true;
    loading.classList.add('hidden');
    updateHud();
    console.log(
      `seaweed preview ready: ${seaweed.instanceCount} instances, ` +
      `${seaweed.triangleCount} triangles, ${asset.stats.maps} maps`,
    );
  } catch (error) {
    loading.textContent = `Detail seaweed preview failed: ${(error as Error).message}`;
    loading.classList.add('error');
    console.error(error);
  }
}

window.__seaweedPreview = {
  get ready() {
    return ready;
  },
  getDiagnostics: () => ({
    ready,
    assetCount: asset ? 1 : 0,
    instanceCount: seaweed?.instanceCount ?? 0,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    fps,
    swayTime: seaweed?.swayTime ?? 0,
    maps: asset?.stats.maps ?? 0,
  }),
  getAssetStats: () => (asset ? [{ ...asset.stats }] : []),
};

const clock = new Clock();
let frames = 0;
let fpsWindow = performance.now();

function animate(): void {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();
  if (seaweed) seaweed.update(time);
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
