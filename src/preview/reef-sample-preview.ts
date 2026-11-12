import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCoralAtlas, createCoralMaterial } from '../rendering/CoralAsset';
import { loadEpibiontAssets } from '../rendering/EpibiontAsset';
import { loadReefSampleAssets } from '../rendering/ReefSampleAsset';
import { ReefSample } from '../rendering/ReefSample';
import { loadRockAssets } from '../rendering/RockAsset';
import { floorHeightAt } from '../rendering/rockPlacement';

interface ReefPreviewDiagnostics {
  readonly ready: boolean;
  readonly trianglesNear: number;
  readonly trianglesMid: number;
  readonly trianglesFar: number;
  readonly epibiontInstances: number;
  readonly epibiontTriangles: number;
  readonly epibiontMeshes: number;
  readonly epibiontClusters: number;
  readonly epibiontCoverage: number;
  readonly apronPieces: number;
  readonly apronTriangles: number;
  readonly drawCalls: number;
  readonly fps: number;
  readonly cameraDistance: number;
}

interface ReefPreviewDebug {
  readonly ready: boolean;
  getDiagnostics(): ReefPreviewDiagnostics;
  setCameraPose(position: [number, number, number], target: [number, number, number]): ReefPreviewDiagnostics;
  setEpibiontsVisible(visible: boolean): void;
  setSilhouette(enabled: boolean): void;
  setEpibiontsCountVisible(enabled: boolean): void;
}

declare global {
  interface Window {
    __reefSamplePreview: ReefPreviewDebug;
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
scene.background = new Color(0x0a2b32);
scene.fog = new FogExp2(0x0a2b32, 0.018);

const camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(7.5, 4.2, 9.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.7, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.5;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

scene.add(new HemisphereLight(0xbfe6df, 0x081d1c, 1.15));
const sun = new DirectionalLight(0xfff2df, 2.4);
sun.position.set(8, 13, 6);
scene.add(sun);
const fill = new DirectionalLight(0x52b8c9, 0.75);
fill.position.set(-9, 5, -7);
scene.add(fill);

const floorGeometry = new PlaneGeometry(80, 80, 90, 90);
floorGeometry.rotateX(-Math.PI / 2);
const floorPositions = floorGeometry.getAttribute('position');
for (let index = 0; index < floorPositions.count; index += 1) {
  const x = floorPositions.getX(index);
  const z = floorPositions.getZ(index);
  floorPositions.setY(index, floorHeightAt(x, z));
}
floorGeometry.computeVertexNormals();
const floor = new Mesh(floorGeometry, new MeshStandardMaterial({
  color: 0x2a4642,
  roughness: 0.97,
  metalness: 0,
}));
floor.name = 'previewSeabed';
scene.add(floor);

let sample: ReefSample | null = null;
let ready = false;
let frameCount = 0;
let fpsTime = 0;
let fps = 0;
const silhouetteMaterial = new MeshBasicMaterial({ color: 0x050708 });
let silhouette = false;
let epibiontsVisible = true;

function applySilhouette(): void {
  scene.overrideMaterial = silhouette ? silhouetteMaterial : null;
  floor.visible = !silhouette;
  scene.fog = silhouette ? null : new FogExp2(0x0a2b32, 0.018);
  scene.background = new Color(silhouette ? 0xf2f4f1 : 0x0a2b32);
  if (sample) {
    sample.apron.visible = !silhouette && sample.isVisible;
    sample.epibionts.setVisible(epibiontsVisible);
  }
}

function renderStats(): void {
  if (!sample) return;
  const stats = sample.stats;
  const rows = [
    ['near LOD', `${stats.trianglesNear.toLocaleString()} tris`],
    ['mid LOD', `${stats.trianglesMid.toLocaleString()} tris`],
    ['far LOD', `${stats.trianglesFar.toLocaleString()} tris`],
    ['epibionts', `${stats.epibiontInstances} in ${sample.plan.clusters.length} clusters`],
    ['epibiont tris', stats.epibiontTriangles.toLocaleString()],
    ['estimated cover', `${(stats.epibiontCoverage * 100).toFixed(1)}%`],
    ['rubble apron', `${stats.apronPieces} pieces · ${stats.apronTriangles} tris`],
  ];
  statsElement.innerHTML = rows
    .map(([label, value]) => `<li><code>${label}</code><span>${value}</span></li>`)
    .join('');
}

async function boot(): Promise<void> {
  try {
    const [reefAssets, epibiontAssets, coralAtlas, rockAssets] = await Promise.all([
      loadReefSampleAssets(),
      loadEpibiontAssets(),
      loadCoralAtlas(),
      loadRockAssets(),
    ]);
    const coralMaterial = createCoralMaterial(coralAtlas);
    coralMaterial.normalScale.set(0.85, 0.85);
    const apronMaterial = new MeshStandardMaterial({
      map: rockAssets.rockMaterial.map,
      normalMap: rockAssets.rockMaterial.normalMap,
      aoMap: rockAssets.rockMaterial.aoMap,
      roughness: 0.95,
      metalness: 0,
      color: 0x6f8480,
    });
    sample = new ReefSample(
      reefAssets,
      epibiontAssets,
      coralMaterial,
      rockAssets,
      { center: [0, 0, 0], radius: 2.45, variant: 2 },
      { apronMaterial },
    );
    scene.add(sample.group);
    scene.add(sample.apron);
    scene.add(sample.contact);
    renderStats();
    loading.classList.add('hidden');
    ready = true;
  } catch (error) {
    loading.classList.add('error');
    loading.textContent = `Could not load the reef sample. ${error instanceof Error ? error.message : ''}`;
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
  sample?.update(camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function diagnostics(): ReefPreviewDiagnostics {
  const distance = camera.position.distanceTo(new Vector3(0, 1.7, 0));
  return {
    ready,
    trianglesNear: sample?.stats.trianglesNear ?? 0,
    trianglesMid: sample?.stats.trianglesMid ?? 0,
    trianglesFar: sample?.stats.trianglesFar ?? 0,
    epibiontInstances: sample?.stats.epibiontInstances ?? 0,
    epibiontTriangles: sample?.stats.epibiontTriangles ?? 0,
    epibiontMeshes: sample?.stats.epibiontMeshes ?? 0,
    epibiontClusters: sample?.plan.clusters.length ?? 0,
    epibiontCoverage: sample?.stats.epibiontCoverage ?? 0,
    apronPieces: sample?.stats.apronPieces ?? 0,
    apronTriangles: sample?.stats.apronTriangles ?? 0,
    drawCalls: renderer.info.render.calls,
    fps,
    cameraDistance: distance,
  };
}

window.__reefSamplePreview = {
  get ready() { return ready; },
  getDiagnostics: diagnostics,
  setCameraPose: (position, target) => {
    camera.position.set(...position);
    controls.target.set(...target);
    controls.update();
    return diagnostics();
  },
  setEpibiontsVisible: (visible) => {
    epibiontsVisible = visible;
    sample?.epibionts.setVisible(visible);
  },
  setSilhouette: (enabled) => {
    silhouette = enabled;
    applySilhouette();
  },
  setEpibiontsCountVisible: (enabled) => {
    epibiontsVisible = enabled;
    sample?.epibionts.setVisible(enabled);
  },
};

void boot();
requestAnimationFrame(frame);
