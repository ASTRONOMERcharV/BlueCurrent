import {
  ACESFilmicToneMapping,
  Box3,
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
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadRockAssets, type RockAssets } from '../rendering/RockAsset';
import {
  DEBRIS_ASSET_ORDER,
  DUNE_ASSET_ORDER,
  LARGE_ASSET_ORDER,
  MEDIUM_ASSET_ORDER,
  ROCK_DIMENSIONS,
  ROCK_NAMES,
  type RockName,
} from '../rendering/rockPlacement';

interface RockPreviewDiagnostics {
  readonly ready: boolean;
  readonly assetCount: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly fps: number;
  readonly focus: string | null;
}

interface RockPreviewStats {
  name: RockName;
  triangles: number;
  height: number;
}

interface RockPreviewDebug {
  readonly ready: boolean;
  getDiagnostics(): RockPreviewDiagnostics;
  getAssetStats(): RockPreviewStats[];
}

declare global {
  interface Window {
    __rocksPreview: RockPreviewDebug;
  }
}

const viewport = document.getElementById('app')!;
const statsElement = document.getElementById('stats')!;
const loading = document.getElementById('loading')!;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x07242f);
scene.fog = new FogExp2(0x07242f, 0.028);

const camera = new PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 10.5, 23);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 1.6);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new HemisphereLight(0xa8e0d8, 0x0d2723, 1.15));
const sun = new DirectionalLight(0xfff1d0, 2.3);
sun.position.set(9, 15, 7);
scene.add(sun);
const fill = new DirectionalLight(0x3fb6c9, 0.7);
fill.position.set(-8, 5, -6);
scene.add(fill);

// Subtle seabed so the assets cast shadows visually and have a ground plane.
const seabedGeometry = new PlaneGeometry(120, 120, 80, 80);
const seabedPositions = seabedGeometry.getAttribute('position');
for (let index = 0; index < seabedPositions.count; index += 1) {
  const x = seabedPositions.getX(index);
  const y = seabedPositions.getY(index);
  const wave = 0.05 * Math.sin(x * 0.34) * Math.cos(y * 0.27)
    + 0.02 * Math.sin(x * 1.1 + y * 0.6);
  seabedPositions.setZ(index, wave - 0.04);
}
seabedGeometry.computeVertexNormals();
const seabed = new Mesh(
  seabedGeometry,
  new MeshStandardMaterial({ color: 0x1b3532, roughness: 0.98, metalness: 0 }),
);
seabed.rotation.x = -Math.PI / 2;
scene.add(seabed);

const ROWS: { names: readonly RockName[]; z: number; spacing: number }[] = [
  { names: LARGE_ASSET_ORDER, z: -7.4, spacing: 3.4 },
  { names: MEDIUM_ASSET_ORDER, z: -2.2, spacing: 2.6 },
  { names: DEBRIS_ASSET_ORDER, z: 0.9, spacing: 1.9 },
  { names: DUNE_ASSET_ORDER, z: 6.8, spacing: 8.6 },
];

const meshes = new Map<RockName, Mesh>();
const trianglesByName = new Map<RockName, number>();
let assets: RockAssets | undefined;
let ready = false;
let frameCount = 0;
let fpsTime = 0;
let fps = 0;
const focus = new URLSearchParams(window.location.search).get('focus');

function placeRows(): void {
  for (const row of ROWS) {
    row.names.forEach((name, index) => {
      const mesh = meshes.get(name);
      if (!mesh) return;
      mesh.position.set((index - (row.names.length - 1) / 2) * row.spacing, 0, row.z);
    });
  }
}

function focusAsset(name: RockName): void {
  const mesh = meshes.get(name);
  if (!mesh) return;
  for (const [otherName, other] of meshes) {
    other.visible = otherName === name;
  }
  mesh.position.set(0, 0, 0);
  const bounds = new Box3().setFromObject(mesh);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z);
  controls.target.copy(center);
  camera.position.set(center.x + radius * 1.1, center.y + radius * 0.85, center.z + radius * 2.1);
  controls.minDistance = radius * 0.6;
  controls.maxDistance = radius * 6;
  controls.update();
}

function renderStats(): void {
  const rows = ROCK_NAMES.map((name) => {
    const size = ROCK_DIMENSIONS[name];
    return `<li><code>${name}</code><span>${trianglesByName.get(name) ?? 0} tris · h ${size.height.toFixed(2)} m</span></li>`;
  }).join('');
  statsElement.innerHTML = rows;
}

async function boot(): Promise<void> {
  try {
    assets = await loadRockAssets();
    for (const name of ROCK_NAMES) {
      const geometry = assets.geometries.get(name);
      if (!geometry) continue;
      const dimensions = ROCK_DIMENSIONS[name];
      const material = dimensions.kind === 'dune' ? assets.duneMaterial : assets.rockMaterial;
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      scene.add(mesh);
      meshes.set(name, mesh);
      trianglesByName.set(name, geometry.index ? geometry.index.count / 3 : 0);
    }
    placeRows();
    if (focus && meshes.has(focus as RockName)) {
      focusAsset(focus as RockName);
    }
    renderStats();
    loading.classList.add('hidden');
    ready = true;
  } catch (error) {
    loading.classList.add('error');
    loading.textContent = `Could not load the rock assets. ${error instanceof Error ? error.message : ''}`;
    throw error;
  }
}

let lastTime = performance.now();

function frame(now: number): void {
  const delta = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  fpsTime += delta;
  frameCount += 1;
  if (fpsTime >= 0.5) {
    fps = frameCount / fpsTime;
    frameCount = 0;
    fpsTime = 0;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__rocksPreview = {
  get ready() { return ready; },
  getDiagnostics: () => ({
    ready,
    assetCount: meshes.size,
    triangles: [...trianglesByName.values()].reduce((total, value) => total + value, 0),
    drawCalls: renderer.info.render.calls,
    fps,
    focus,
  }),
  getAssetStats: () => ROCK_NAMES.map((name) => ({
    name,
    triangles: trianglesByName.get(name) ?? 0,
    height: ROCK_DIMENSIONS[name].height,
  })),
};

void boot();
requestAnimationFrame(frame);
