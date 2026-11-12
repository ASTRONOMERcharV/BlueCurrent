import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
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
import { SceneManager } from '../rendering/SceneManager';
import { createUnderwaterEnvironment } from '../rendering/UnderwaterEnvironment';
import { createFishGeometry } from '../rendering/Environment';
import { loadFishAsset } from '../rendering/FishAsset';
import type { FishAsset, FishAssetStats } from '../rendering/FishAsset';
import { SimulationWorld } from '../simulation/SimulationWorld';

type PreviewMode = 'hero' | 'school';

interface PreviewDiagnostics {
  fps: number;
  drawCalls: number;
  fishCount: number;
  triangles: number;
}

interface FishPreviewDebug {
  readonly ready: boolean;
  readonly mode: PreviewMode;
  readonly fishModel: 'procedural' | 'blender';
  getDiagnostics(): PreviewDiagnostics;
  getAssetStats(): FishAssetStats | null;
  focusSchool(distance?: number): void;
}

declare global {
  interface Window {
    __fishPreview: FishPreviewDebug;
  }
}

const params = new URLSearchParams(window.location.search);
const mode: PreviewMode = params.get('mode') === 'school' ? 'school' : 'hero';
const requestedBlender = params.get('fish') !== 'procedural';
const requestedCount = MathUtils.clamp(
  Number.parseInt(params.get('count') ?? '500', 10) || 500,
  10,
  2000,
);
const closeup = params.get('close') === '1';

const viewport = document.getElementById('preview-viewport')!;
const statsList = document.getElementById('stats')!;
const loading = document.getElementById('preview-loading')!;
const nav = document.getElementById('preview-nav')!;

let ready = false;
let fps = 0;
let drawCalls = 0;
let fishCount = 0;
let triangleCount = 0;
let assetStats: FishAssetStats | null = null;
let fishModel: 'procedural' | 'blender' = 'procedural';
let focusSchoolImpl: (distance?: number) => void = () => {};

function setNav(): void {
  const fish = requestedBlender ? 'blender' : 'procedural';
  const otherFish = requestedBlender ? 'procedural' : 'blender';
  nav.innerHTML = `
    <a href="?mode=hero&fish=${fish}" ${mode === 'hero' ? 'aria-current="true"' : ''}>Hero</a>
    <a href="?mode=school&fish=${fish}&count=${requestedCount}" ${mode === 'school' ? 'aria-current="true"' : ''}>School</a>
    <a href="?mode=school&fish=${fish}&count=${requestedCount}&close=1" ${closeup ? 'aria-current="true"' : ''}>Close-up</a>
    <a href="?mode=${mode}&fish=${otherFish}&count=${requestedCount}">Use ${otherFish}</a>
    <a href="/coral-preview.html">Coral</a>
  `;
}

function renderStats(entries: ReadonlyArray<readonly [string, string, string?]>): void {
  statsList.innerHTML = entries
    .map(([label, value, tone]) =>
      `<dt>${label}</dt><dd class="${tone ?? ''}">${value}</dd>`)
    .join('');
}

function setLoadingDone(): void {
  loading.classList.add('hidden');
  ready = true;
}

function showFatal(error: unknown): void {
  loading.classList.remove('hidden');
  loading.classList.add('error');
  loading.textContent = `Preview failed: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
}

window.__fishPreview = {
  get ready() { return ready; },
  get mode() { return mode; },
  get fishModel() { return fishModel; },
  getDiagnostics: () => ({ fps, drawCalls, fishCount, triangles: triangleCount }),
  getAssetStats: () => assetStats,
  focusSchool: (distance?: number) => focusSchoolImpl(distance),
};

async function loadOptionalAsset(): Promise<{ asset?: FishAsset; error?: string }> {
  if (!requestedBlender) return {};
  try {
    const asset = await loadFishAsset('/models/fish_school.glb');
    return { asset };
  } catch (error) {
    console.warn('Blender fish asset unavailable; falling back to the procedural fish.', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function startHero(asset: FishAsset | undefined, loadError: string | undefined): void {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  viewport.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x062d39);
  scene.fog = new FogExp2(0x062d39, 0.032);
  scene.environment = createUnderwaterEnvironment(renderer);
  scene.environmentIntensity = 0.60;
  scene.add(new HemisphereLight(0x9de8e0, 0x04161c, 1.35));
  const key = new DirectionalLight(0xd9fff5, 3.0);
  key.position.set(2.8, 4.2, 3.4);
  scene.add(key);
  const rim = new DirectionalLight(0x2a7d93, 1.5);
  rim.position.set(-3.5, 1.2, -2.8);
  scene.add(rim);

  const floor = new Mesh(
    new PlaneGeometry(40, 40),
    new MeshStandardMaterial({ color: 0x0a2a31, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.72;
  scene.add(floor);

  const turntable = new Group();
  turntable.rotation.y = -0.95;
  scene.add(turntable);
  let mesh: Mesh;
  if (asset) {
    fishModel = 'blender';
    assetStats = asset.stats;
    mesh = new Mesh(asset.geometry, asset.materials);
    triangleCount = asset.stats.triangles;
  } else {
    fishModel = 'procedural';
    const geometry = createFishGeometry();
    const material = new MeshStandardMaterial({
      color: 0x72b8c3,
      roughness: 0.52,
      metalness: 0.12,
      flatShading: true,
    });
    mesh = new Mesh(geometry, material);
    triangleCount = geometry.getAttribute('position').count / 3;
  }
  turntable.add(mesh);

  const camera = new PerspectiveCamera(38, 1, 0.01, 100);
  camera.position.set(2.2, 0.8, 2.15);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.02, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 1.6;
  controls.maxDistance = 9;
  controls.update();

  const resize = (): void => {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let frames = 0;
  let elapsed = 0;
  let last = performance.now();
  let visualTime = 0;

  const updateHud = (): void => {
    const rows: Array<[string, string, string?]> = [
      ['mode', 'hero turntable'],
      ['model', fishModel === 'blender' ? 'Blender GLB' : 'procedural', fishModel === 'blender' ? 'ok' : ''],
      ['triangles', `${Math.round(triangleCount)}`, triangleCount <= 1500 ? 'ok' : 'bad'],
      ['materials', asset ? String(asset.stats.materialCount) : '1'],
      ['length Z', asset ? asset.stats.lengthZ.toFixed(3) : '—'],
      ['tail attr', asset ? (asset.stats.hasTailWeights ? 'present' : 'missing') : '—', asset ? (asset.stats.hasTailWeights ? 'ok' : 'bad') : ''],
      ['draw calls', String(drawCalls)],
      ['fps', fps.toFixed(0)],
    ];
    if (asset) {
      rows.push(['GLB size', asset.stats.bytes ? `${Math.round(asset.stats.bytes / 1024)} KB` : '—']);
    }
    if (loadError) rows.push(['asset error', 'fallback', 'bad']);
    renderStats(rows);
  };

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const rawDelta = Math.min(0.15, (now - last) / 1000);
    last = now;
    visualTime += rawDelta;
    turntable.rotation.y = -0.95 + visualTime * 0.15;
    turntable.position.y = Math.sin(visualTime * 0.8) * 0.015;
    controls.update();
    renderer.render(scene, camera);
    drawCalls = renderer.info.render.calls;

    frames += 1;
    elapsed += rawDelta;
    if (elapsed >= 0.5) {
      fps = frames / elapsed;
      frames = 0;
      elapsed = 0;
    }
    updateHud();
    if (!ready) setLoadingDone();
  };
  requestAnimationFrame(frame);
}

function startSchool(asset: FishAsset | undefined, loadError: string | undefined): void {
  const world = new SimulationWorld();
  world.detailedMetricsEnabled = false;
  world.config.predatorEnabled = false;
  // Hero/school preview shows the main school only; the reef school has its own
  // preview and would otherwise run invisibly.
  world.setClownfishCount(0);
  if (requestedCount !== world.config.initialFishCount) world.setFishCount(requestedCount);
  world.scheduler.reset();

  const manager = new SceneManager(viewport, world, asset);
  manager.setCameraMode('school');
  manager.camera.position.set(12, 15, 16);
  manager.cameraController.controls.minDistance = 4;
  manager.cameraController.controls.target.set(-2, 9, 0);
  manager.cameraController.controls.update();

  focusSchoolImpl = (distance = 6): void => {
    const [x, y, z] = world.center;
    const unit = MathUtils.clamp(distance, 3.5, 40) / Math.hypot(0.55, 0.28, 0.78);
    manager.cameraController.controls.target.set(x, y, z);
    manager.camera.position.set(x + 0.55 * unit, y + 0.28 * unit, z + 0.78 * unit);
    manager.cameraController.controls.update();
  };
  if (closeup) setTimeout(() => focusSchoolImpl(6), 900);

  if (asset) {
    fishModel = 'blender';
    assetStats = asset.stats;
    triangleCount = asset.stats.triangles;
  } else {
    fishModel = 'procedural';
    triangleCount = manager.fish.triangleCount;
  }
  fishCount = world.metrics.fishCount;

  let last = performance.now();
  let frames = 0;
  let elapsed = 0;
  let visualTime = 0;
  let alpha = 0;

  const updateHud = (): void => {
    const rows: Array<[string, string, string?]> = [
      ['mode', 'live school'],
      ['model', fishModel === 'blender' ? 'Blender GLB' : 'procedural', fishModel === 'blender' ? 'ok' : ''],
      ['triangles / fish', `${Math.round(triangleCount)}`, triangleCount <= 1500 ? 'ok' : 'bad'],
      ['fish (alive)', `${world.metrics.fishCount} / ${world.flock.count}`],
      ['predator', 'disabled (preview)'],
      ['draw calls', String(drawCalls)],
      ['fps', fps.toFixed(0)],
      ['sim step', `${world.metrics.averageStepMs.toFixed(2)} ms`],
    ];
    if (loadError) rows.push(['asset error', 'fallback', 'bad']);
    renderStats(rows);
  };

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const rawDelta = Math.min(0.15, (now - last) / 1000);
    last = now;
    const result = world.scheduler.advance(rawDelta, (delta) => world.step(delta));
    alpha = result.alpha;
    visualTime += rawDelta;
    manager.update(world, alpha, visualTime, rawDelta, rawDelta, result.steps * world.config.fixedDelta);
    drawCalls = manager.renderer.info.render.calls;
    fishCount = world.metrics.fishCount;

    frames += 1;
    elapsed += rawDelta;
    if (elapsed >= 0.5) {
      fps = frames / elapsed;
      frames = 0;
      elapsed = 0;
    }
    updateHud();
    if (!ready) setLoadingDone();
  };
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  setNav();
  try {
    const { asset, error } = await loadOptionalAsset();
    if (mode === 'hero') startHero(asset, error);
    else startSchool(asset, error);
  } catch (error) {
    showFatal(error);
  }
}

void main();
