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
import {
  applyPredatorSwimShader,
  createProceduralPredator,
} from '../rendering/PredatorRenderer';
import type { PredatorSwimUniforms } from '../rendering/PredatorRenderer';
import { loadPredatorAsset } from '../rendering/PredatorAsset';
import type { PredatorAsset, PredatorAssetStats } from '../rendering/PredatorAsset';
import { loadFishAsset } from '../rendering/FishAsset';
import type { FishAsset } from '../rendering/FishAsset';
import { SimulationWorld } from '../simulation/SimulationWorld';

type PreviewMode = 'hero' | 'close' | 'chase';

interface PreviewDiagnostics {
  fps: number;
  drawCalls: number;
  triangles: number;
  fishCount: number;
  predatorState: string;
  captures: number;
}

interface PredatorPreviewDebug {
  readonly ready: boolean;
  readonly mode: PreviewMode;
  readonly predatorModel: 'procedural' | 'blender';
  getDiagnostics(): PreviewDiagnostics;
  getAssetStats(): PredatorAssetStats | null;
  focusPredator(distance?: number): void;
}

declare global {
  interface Window {
    __predatorPreview: PredatorPreviewDebug;
  }
}

const params = new URLSearchParams(window.location.search);
const mode: PreviewMode = params.get('mode') === 'chase'
  ? 'chase'
  : params.get('mode') === 'close' ? 'close' : 'hero';
type PredatorVariant = 'procedural' | 'shayu' | 'v2' | 'phase2';
const predatorParam = params.get('predator');
const requestedVariant: PredatorVariant = predatorParam === 'procedural'
  ? 'procedural'
  : predatorParam === 'v2'
    ? 'v2'
    : predatorParam === 'phase2' ? 'phase2' : 'shayu';
const requestedPhase2 = requestedVariant === 'phase2';
const requestedBlender = requestedVariant !== 'procedural';
const requestedFishBlender = params.get('fish') === 'blender';
const jawOverride = params.get('jaw');
const poseTimeParam = Number(params.get('poseTime'));
const fixedPoseTime = params.has('poseTime') && Number.isFinite(poseTimeParam)
  ? MathUtils.clamp(poseTimeParam, 0, 60)
  : null;
const topInspectionView = params.get('view') === 'top';
const predatorAssetUrl = requestedVariant === 'v2'
  ? '/models/predator_reef_shark.glb'
  : requestedVariant === 'phase2'
    ? '/models/predator_v3_phase2.glb'
    : '/models/predator_shayu.glb';

const viewport = document.getElementById('preview-viewport')!;
const statsList = document.getElementById('stats')!;
const loading = document.getElementById('preview-loading')!;
const nav = document.getElementById('preview-nav')!;

let ready = false;
let fps = 0;
let drawCalls = 0;
let triangleCount = 0;
let fishCount = 0;
let predatorState = 'static';
let captures = 0;
let assetStats: PredatorAssetStats | null = null;
let predatorModel: 'procedural' | 'blender' = 'procedural';
let focusPredatorImpl: (distance?: number) => void = () => {};

function setNav(): void {
  const predator = requestedVariant;
  const otherPredator = requestedBlender ? 'procedural' : 'shayu';
  const fish = requestedFishBlender ? 'blender' : 'procedural';
  nav.innerHTML = `
    <a href="?mode=hero&predator=${predator}&fish=${fish}" ${mode === 'hero' ? 'aria-current="true"' : ''}>Hero</a>
    <a href="?mode=close&predator=${predator}&fish=${fish}" ${mode === 'close' ? 'aria-current="true"' : ''}>Close-up</a>
    <a href="?mode=chase&predator=${predator}&fish=${fish}" ${mode === 'chase' ? 'aria-current="true"' : ''}>Chase</a>
    <a href="?mode=${mode}&predator=${otherPredator}&fish=${fish}">Use ${otherPredator}</a>
    <a href="?mode=${mode}&predator=shayu&fish=${fish}" ${requestedVariant === 'shayu' ? 'aria-current="true"' : ''}>Shayu</a>
    <a href="?mode=${mode}&predator=v2&fish=${fish}" ${requestedVariant === 'v2' ? 'aria-current="true"' : ''}>V2</a>
    <a href="?mode=${mode}&predator=phase2&fish=${fish}" ${requestedPhase2 ? 'aria-current="true"' : ''}>Phase 2</a>
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

window.__predatorPreview = {
  get ready() { return ready; },
  get mode() { return mode; },
  get predatorModel() { return predatorModel; },
  getDiagnostics: () => ({ fps, drawCalls, triangles: triangleCount, fishCount, predatorState, captures }),
  getAssetStats: () => assetStats,
  focusPredator: (distance?: number) => focusPredatorImpl(distance),
};

async function loadOptionalPredator(): Promise<{ asset?: PredatorAsset; error?: string }> {
  if (!requestedBlender) return {};
  try {
    const asset = await loadPredatorAsset(predatorAssetUrl);
    return { asset };
  } catch (error) {
    console.warn('Blender predator asset unavailable; falling back to the procedural predator.', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadOptionalFish(): Promise<FishAsset | undefined> {
  if (!requestedFishBlender) return undefined;
  try {
    return await loadFishAsset('/models/fish_school.glb');
  } catch (error) {
    console.warn('Blender fish asset unavailable; chase mode uses procedural fish.', error);
    return undefined;
  }
}

function startShowcase(asset: PredatorAsset | undefined, loadError: string | undefined): void {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  viewport.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x062d39);
  scene.fog = new FogExp2(0x062d39, 0.020);
  scene.environment = createUnderwaterEnvironment(renderer);
  scene.environmentIntensity = 0.60;
  scene.add(new HemisphereLight(0x9de8e0, 0x04161c, 1.35));
  const key = new DirectionalLight(0xd9fff5, 3.0);
  key.position.set(3.5, 5.5, 4.2);
  scene.add(key);
  const rim = new DirectionalLight(0x2a7d93, 1.5);
  rim.position.set(-4.5, 1.5, -3.8);
  scene.add(rim);

  const floor = new Mesh(
    new PlaneGeometry(60, 60),
    new MeshStandardMaterial({ color: 0x0a2a31, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.05;
  scene.add(floor);

  const turntable = new Group();
  scene.add(turntable);
  const model = new Group();
  turntable.add(model);
  let tailPivot: Group | null = null;
  let swimUniforms: PredatorSwimUniforms | null = null;
  if (asset) {
    predatorModel = 'blender';
    assetStats = asset.stats;
    triangleCount = asset.stats.triangles;
    const hasTailWeights = Boolean(asset.geometry.getAttribute('aTailWeight'));
    const hasJawWeights = Boolean(asset.geometry.getAttribute('aJawWeight'));
    swimUniforms = {
      phase: { value: 0 },
      speed: { value: 0.35 },
      attack: { value: 0 },
      thrust: { value: 0 },
      turn: { value: 0 },
      turnLag: { value: 0 },
      jaw: { value: 0 },
    };
    for (const material of asset.materials) {
      applyPredatorSwimShader(material, hasTailWeights, swimUniforms, hasJawWeights);
      material.flatShading = false;
      material.needsUpdate = true;
    }
    model.add(new Mesh(asset.geometry, asset.materials));
  } else {
    predatorModel = 'procedural';
    const procedural = createProceduralPredator();
    triangleCount = procedural.triangles;
    tailPivot = procedural.tailPivot;
    model.add(procedural.group);
  }

  const shayu = requestedVariant === 'shayu';
  const camera = new PerspectiveCamera(37, 1, 0.05, 120);
  if (topInspectionView) {
    camera.position.set(0.01, 11.5, 2.5);
  } else if (mode === 'close') {
    camera.position.set(shayu ? 3.5 : 3.6, shayu ? 1.0 : 1.6, shayu ? 5.0 : 5.4);
  } else {
    camera.position.set(9.0, 2.6, 9.0);
  }
  const controls = new OrbitControls(camera, renderer.domElement);
  // The fixed HUD occupies the left side; aim slightly left of the shark so
  // the model sits in the unobstructed right half of the viewport.
  controls.target.set(
    topInspectionView ? 0 : mode === 'close' ? (shayu ? -0.9 : 0) : shayu ? -1.6 : -2.2,
    0.2,
    mode === 'close' && !topInspectionView ? (shayu ? 1.95 : 1.45) : 0,
  );
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = mode === 'close' ? 1.2 : 3.5;
  controls.maxDistance = 24;
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
  let swimPhase = 0;

  const updateHud = (): void => {
    const rows: Array<[string, string, string?]> = [
      ['mode', mode === 'close' ? 'close-up turntable' : 'hero turntable'],
      ['model', predatorModel === 'blender' ? 'Blender GLB' : 'procedural', predatorModel === 'blender' ? 'ok' : ''],
      ['asset', asset
        ? (requestedVariant === 'phase2'
          ? 'phase 2 staging'
          : requestedVariant === 'v2' ? 'v2 great white' : 'shayu (user GLB)')
        : '—'],
      ['triangles', `${Math.round(triangleCount)}`, triangleCount <= 20000 ? 'ok' : 'bad'],
      ['materials', asset ? String(asset.stats.materialCount) : '1'],
      ['length Z', asset ? asset.stats.lengthZ.toFixed(3) : '—'],
      ['tail attr', asset ? (asset.stats.hasTailWeights ? 'present' : 'missing') : '—', asset ? (asset.stats.hasTailWeights ? 'ok' : 'bad') : ''],
      ['jaw attr', asset ? (asset.stats.hasJawWeights ? 'present' : '—') : '—', asset?.stats.hasJawWeights ? 'ok' : ''],
      ['maps', asset ? `${asset.stats.hasBaseColorMap ? 'BC' : '—'} / ${asset.stats.hasNormalMap ? 'N' : '—'} / ${asset.stats.hasRoughnessMap ? 'R' : '—'}` : '—'],
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
    swimPhase = fixedPoseTime === null ? swimPhase + rawDelta * 3.4 : fixedPoseTime * 3.4;
    const animationTime = fixedPoseTime ?? visualTime;
    const turn = Math.sin(animationTime * 0.55) * 0.85;
    const thrust = Math.sin(animationTime * 0.9 + 1.2) * 0.7;
    const jawOpen = jawOverride === 'open'
      ? 0.42
      : jawOverride === 'closed'
        ? 0.012
        : 0.012 + 0.34 * Math.max(0, Math.sin(animationTime * 1.05 - 1.1)) ** 3;
    if (swimUniforms) {
      swimUniforms.phase.value = swimPhase;
      swimUniforms.speed.value = 0.35 + 0.45 * Math.max(0, thrust);
      swimUniforms.thrust.value = thrust;
      swimUniforms.turn.value = turn;
      swimUniforms.turnLag.value = Math.sin((animationTime - 0.30) * 0.55) * 0.85;
      swimUniforms.jaw.value = jawOpen;
    }
    if (tailPivot) tailPivot.rotation.y = Math.sin(swimPhase) * 0.30;
    model.rotation.z = topInspectionView ? 0 : -turn * 0.30;
    turntable.rotation.y = topInspectionView
      ? 0
      : (mode === 'close' ? -0.42 : -0.55) + (mode === 'close' ? 0 : animationTime * 0.10);
    turntable.position.y = Math.sin(animationTime * 0.8) * 0.015;
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

function startChase(asset: PredatorAsset | undefined, fishAsset: FishAsset | undefined, loadError: string | undefined): void {
  const world = new SimulationWorld();
  world.detailedMetricsEnabled = false;
  world.setFishCount(400);
  world.releasePredator();

  const manager = new SceneManager(viewport, world, fishAsset, asset);
  manager.setCameraMode('predator');
  manager.cameraController.targetOffset.set(-3.0, 0, 0);
  manager.cameraController.controls.minDistance = 4;
  manager.cameraController.controls.maxDistance = 60;

  focusPredatorImpl = (distance = 11): void => {
    const [x, y, z] = world.predator.position;
    const unit = MathUtils.clamp(distance, 4, 50) / Math.hypot(0.62, 0.35, 0.70);
    // Keep the predator right of the fixed HUD panel.
    const targetX = x - 3.0;
    manager.cameraController.controls.target.set(targetX, y, z);
    manager.camera.position.set(targetX + 0.62 * unit, y + 0.35 * unit, z + 0.70 * unit);
    manager.cameraController.controls.update();
  };
  focusPredatorImpl(12);

  if (asset) {
    predatorModel = 'blender';
    assetStats = asset.stats;
    triangleCount = asset.stats.triangles;
  } else {
    predatorModel = 'procedural';
    triangleCount = manager.predator.triangleCount;
  }

  let last = performance.now();
  let frames = 0;
  let elapsed = 0;
  let visualTime = 0;
  let alpha = 0;

  const updateHud = (): void => {
    const rows: Array<[string, string, string?]> = [
      ['mode', 'real predator chase'],
      ['model', predatorModel === 'blender' ? 'Blender GLB' : 'procedural', predatorModel === 'blender' ? 'ok' : ''],
      ['triangles', `${Math.round(triangleCount)}`, triangleCount <= 20000 ? 'ok' : 'bad'],
      ['fish (alive)', `${world.metrics.fishCount} / ${world.flock.count}`],
      ['predator state', world.predator.state],
      ['captures', String(world.metrics.captures)],
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
    predatorState = world.predator.state;
    captures = world.metrics.captures;

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
    const { asset, error } = await loadOptionalPredator();
    if (mode === 'chase') {
      const fishAsset = await loadOptionalFish();
      startChase(asset, fishAsset, error);
    } else {
      startShowcase(asset, error);
    }
  } catch (error) {
    showFatal(error);
  }
}

void main();
