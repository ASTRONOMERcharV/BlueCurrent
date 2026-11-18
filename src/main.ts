import './style.css';
import { PerspectiveCamera, Vector3 } from 'three';
import { SceneManager } from './rendering/SceneManager';
import type { RendererPerformanceStats, RockMaskCapture } from './rendering/SceneManager';
import type { CameraMode } from './rendering/CameraController';
import type { PredatorForwardSource, SchoolHeadingSource } from './rendering/cameraStability';
import { terrainHeightAt } from './rendering/terrain';
import type { DebugLayer, DebugVisibility } from './rendering/DebugVisualizer';
import type {
  CollisionDebugLayer,
  CollisionDebugVisibility,
  CollisionSelectedInfo,
} from './rendering/CollisionDebugVisualizer';
import { loadFishAsset, CLOWNFISH_CONTRACT } from './rendering/FishAsset';
import type { FishAsset } from './rendering/FishAsset';
import { loadPredatorAsset } from './rendering/PredatorAsset';
import type { PredatorAsset } from './rendering/PredatorAsset';
import { loadPredatorRigAsset } from './rendering/PredatorRigAsset';
import type { PredatorRigAsset } from './rendering/PredatorRigAsset';
import { SimulationWorld } from './simulation/SimulationWorld';
import type { NeighborSearchMode, SimulationConfig } from './simulation/SimulationConfig';
import type { CoralScatterMode } from './rendering/CoralScatter';
import type { RockDebugMode } from './rendering/Environment';
import type { RockDiagnosticsReport } from './rendering/lighting/RockDiagnostics';
import type { UnderwaterLightingMode } from './rendering/lighting/UnderwaterLightingConfig';
import type { WaterDebugLayer, WaterDebugState, WaterOpticsModel } from './rendering/UnderwaterMedium';
import { applyScenario, getScenario } from './simulation/Scenarios';
import {
  PredationEventTracker,
  type PredationEvent,
  type PredationObservation,
} from './ui/PredationEventTracker';
import {
  SchoolStructureTracker,
  type SchoolStructureState,
} from './ui/SchoolStructureTracker';
import type { FishMotionDiagnostics } from './rendering/fishMotion';
import type { ScenarioId } from './simulation/Scenarios';
import { buildReefProxySet, createReefProxyQueryResult } from './simulation/ReefCollisionProxy';
import type { ObstacleShapeMode } from './simulation/SimulationConfig';
import type { ReefObstacleMetricsSnapshot } from './simulation/ReefObstacleMetrics';
import type { PhaseEmaSnapshot } from './simulation/PerformanceTelemetry';
import { ControlPanel } from './ui/ControlPanel';
import type { ViewMode } from './ui/ControlPanel';
import { StatisticsPanel } from './ui/StatisticsPanel';
import { renderLayout } from './ui/layout';
import { DemoDirector } from './demo/DemoDirector';
import type { DemoPresentation, DemoState } from './demo/DemoDirector';

interface ReefSampleDiagnostics {
  id: string;
  label: string;
  anchorIndex: number;
  trianglesNear: number;
  trianglesMid: number;
  trianglesFar: number;
  height: number;
  width: number;
  depth: number;
  epibiontInstances: number;
  epibiontTriangles: number;
  epibiontMeshes: number;
  epibiontCoverage: number;
  apronTriangles: number;
  apronPieces: number;
  radius: number;
}

interface Diagnostics {
  ready: boolean;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraDistance: number;
  maxCameraDistance: number;
  fps: number;
  fpsFromSamples: number;
  renderMs: number;
  p95FrameMs: number;
  frameSampleCount: number;
  averageFrameMs: number;
  searchMode: NeighborSearchMode;
  predatorState: string;
  predatorPosition: [number, number, number];
  predatorVelocity: [number, number, number];
  predatorTargetIndex: number | null;
  predatorTargetPosition: [number, number, number] | null;
  schoolCenter: [number, number, number];
  occupiedCells: number | null;
  fishCount: number;
  simulationTime: number;
  totalSteps: number;
  captures: number;
  averageNeighbors: number;
  simulationMs: number;
  lastStepMs: number;
  candidatesExamined: number;
  threatenedCount: number;
  shelteredCount: number;
  schoolCount: number;
  droppedSteps: number;
  paused: boolean;
  timeScale: number;
  viewMode: ViewMode;
  scenarioId: ScenarioId;
  scenarioSeed: number;
  cameraMode: CameraMode;
  cameraLookTarget: [number, number, number];
  cameraQuaternion: [number, number, number, number];
  cameraUp: [number, number, number];
  cameraAngularChange: number;
  cameraTranslationSpeed: number;
  cameraTerrainClearance: number;
  schoolVisibleFraction: number;
  schoolScreenBounds: [number, number, number, number] | null;
  schoolFitScale: number;
  schoolFitRawScale: number;
  schoolFitPercentile: number;
  schoolFitSampleCount: number;
  schoolFitPredictedVisibleFraction: number;
  headingCoherence: number;
  headingReliability: number;
  headingSource: SchoolHeadingSource;
  predatorForwardSource: PredatorForwardSource;
  predatorTargetDistance: number | null;
  predatorScreenPosition: [number, number] | null;
  targetFishScreenPosition: [number, number] | null;
  waterEffects: boolean;
  waterDebug: WaterDebugState;
  waterOpticsModel: WaterOpticsModel;
  lightingMode: UnderwaterLightingMode;
  rockDebugMode: RockDebugMode;
  obstacleShapeMode: ObstacleShapeMode;
  reefProxyActive: boolean;
  reefProxyReefCount: number;
  obstacleMetrics: ReefObstacleMetricsSnapshot;
  collisionDebug: CollisionDebugVisibility;
  collisionSelected: CollisionSelectedInfo;
  lighting: ReturnType<SceneManager['getLightingDiagnostics']>;
  debugLayers: DebugVisibility;
  sampleFishIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  glbRocks: boolean;
  glbRockMode: 'off' | 'legacy' | 'set';
  glbRockInstances: { large: number; medium: number; debris: number; dune: number };
  glbRockTriangles: number;
  kelpModel: 'off' | 'blender';
  kelpInstances: { kelp_a: number; kelp_b: number };
  kelpTriangles: number;
  coralModel: CoralScatterMode | 'off';
  coralInstances: number;
  coralTriangles: number;
  reefSample: boolean;
  reefSampleStats: ReefSampleDiagnostics | null;
  reefSet: boolean;
  reefSetStats: ReefSampleDiagnostics[];
  seaweedModel: 'off' | 'blender';
  seaweedInstances: number;
  seaweedTriangles: number;
  terrainDecorInstances: { midground: number; far: number };
  fishModel: 'procedural' | 'blender';
  fishTriangles: number;
  fishWorldLength: [number, number];
  clownfishModel: 'off' | 'blender';
  clownfishCount: number;
  clownfishTriangles: number;
  clownfishWorldLength: [number, number] | null;
  clownfishCenter: [number, number, number];
  predatorModel: 'procedural' | 'blender';
  predatorRigged: boolean;
  predatorTriangles: number;
  predatorBank: number;
  predatorThrust: number;
  predatorTurn: number;
  predatorTailTurn: number;
  predatorPitch: number;
  drawCalls: number;
  renderTriangles: number;
  demo: DemoState | null;
}

interface FlockSnapshot {
  count: number;
  aliveCount: number;
  positions: number[];
  velocities: number[];
  alive: number[];
  fear: number[];
  checksum: string;
}

interface SimulationSnapshot {
  simulationTime: number;
  totalSteps: number;
  seed: number;
  fish: FlockSnapshot;
  clownfish: FlockSnapshot;
  captures: number;
  predatorState: string;
  predatorPosition: [number, number, number];
  predatorVelocity: [number, number, number];
  kelpRefugeEnabled: boolean;
  checksum: string;
}

interface PerformanceDiagnostics {
  simulation: PhaseEmaSnapshot;
  render: PhaseEmaSnapshot;
  renderer: RendererPerformanceStats;
  memory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
  droppedSteps: number;
  frameSampleCount: number;
  simulationMs: number;
  renderMs: number;
}

interface BlueCurrentDebug {
  readonly ready: boolean;
  getDiagnostics(): Diagnostics;
  getLightingDiagnostics(): ReturnType<SceneManager['getLightingDiagnostics']>;
  getRockDiagnostics(): RockDiagnosticsReport;
  captureRockMask(): RockMaskCapture;
  setRockDebugMode(mode: RockDebugMode): void;
  getSimulationSnapshot(): SimulationSnapshot;
  getPredationEvents(limit?: number): PredationEvent[];
  getSchoolStructure(limit?: number): SchoolStructureState;
  getFishMotionDiagnostics(): {
    school: FishMotionDiagnostics;
    clownfish: FishMotionDiagnostics | null;
  };
  getObstacleDiagnostics(): ReefObstacleMetricsSnapshot;
  setObstacleMetricsEnabled(enabled: boolean): void;
  getPerformanceDiagnostics(): PerformanceDiagnostics;
  setPerformanceTelemetryEnabled(enabled: boolean): void;
  getClownfishHabitatDiagnostics(): ReturnType<SimulationWorld['getClownfishHabitatDiagnostics']>;
  getSedimentDiagnostics(): ReturnType<SceneManager['getSedimentDiagnostics']>;
  advanceSediment(seconds: number): ReturnType<SceneManager['getSedimentDiagnostics']>;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  settleVisual(seconds?: number, frames?: number): Diagnostics;
  captureCameraSheet(
    poses: readonly CameraPose[],
    columns: number,
    rows: number,
    width?: number,
    height?: number,
  ): string;
  pause(): void;
  resume(): void;
  reset(): void;
  step(count?: number): Diagnostics;
  setFishCount(count: number): void;
  setClownfishCount(count: number): void;
  setSearchMode(mode: NeighborSearchMode): void;
  setObstacleShapeMode(mode: ObstacleShapeMode): void;
  updateConfig(patch: Partial<SimulationConfig>): void;
  setScenario(id: ScenarioId): void;
  setViewMode(mode: ViewMode): void;
  setCameraMode(mode: CameraMode): void;
  setCameraPose(position: readonly [number, number, number], target: readonly [number, number, number]): void;
  getDemoState(): DemoState | null;
  startDemo(): DemoState | null;
  restartDemo(): DemoState | null;
  stopDemo(): DemoState | null;
  seekDemo(seconds: number): DemoState | null;
  advanceVisualTime(seconds: number): Diagnostics;
  setVisualTime(seconds: number): Diagnostics;
  setGridVisible(visible: boolean): void;
  setDebugLayer(layer: DebugLayer, visible: boolean): void;
  setCollisionDebugLayer(layer: CollisionDebugLayer, visible: boolean): void;
  setCollisionDebugLayers(enabled: boolean): void;
  getCollisionDebugVisibility(): CollisionDebugVisibility;
  getCollisionSelectedInfo(): CollisionSelectedInfo;
  setDebugSampleFish(index: number): void;
  getFishProxyInfo(index: number): {
    reefId: string | null;
    signedDistance: number;
    clearance: number;
  } | null;
  setWaterEffects(enabled: boolean): void;
  setWaterDebugLayer(layer: WaterDebugLayer, enabled: boolean): void;
  setWaterDebugLayers(enabled: boolean): void;
  setWaterOpticsModel(model: WaterOpticsModel): void;
  setLightingMode(mode: UnderwaterLightingMode): void;
  setShadowMapEnabled(enabled: boolean): void;
  resetPerformanceSamples(): void;
  releasePredator(): void;
  regroupSchool(): void;
  loadGlbRocks(): Promise<boolean>;
  loadGlbRockSet(): Promise<boolean>;
  loadGlbKelp(): Promise<boolean>;
  loadGlbCorals(mode?: CoralScatterMode): Promise<boolean>;
  loadGlbSeaweed(): Promise<boolean>;
  loadReefSample(): Promise<boolean>;
  loadReefSet(): Promise<boolean>;
}

declare global {
  interface Window {
    __blueCurrent: BlueCurrentDebug;
  }
}

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app mount point.');
app.innerHTML = renderLayout();

const world = new SimulationWorld();
let paused = false;
let timeScale = 1;
let gridVisible = false;
let waterEffects = true;
let lightingMode: UnderwaterLightingMode = 'full';
let terrainMode: 'continuous' | 'legacy' = 'continuous';
let fishMotionMode: 'smooth' | 'legacy' = 'smooth';
let waterOpticsModel: WaterOpticsModel = 'clear';
let viewMode: ViewMode = 'observation';
let activeScenario: ScenarioId = 'encounter';
let obstacleMetricsRequested = false;
let scene: SceneManager;
let controls: ControlPanel;
let demoDirector: DemoDirector | null = null;

let lastFrame = performance.now();
let lastAlpha = 1;
let visualTime = 0;
let fps = 0;
let fpsFrames = 0;
let fpsElapsed = 0;
let renderMs = 0;
let statisticsElapsed = 1;
let collisionReadoutElapsed = 0;
let ready = false;
let droppedSteps = 0;
const frameTimes: number[] = [];

function updateConfig(patch: Partial<SimulationConfig>): void {
  Object.assign(world.config, patch);
}

function setPaused(next: boolean): void {
  paused = next;
  world.scheduler.reset();
  controls.setRunning(!paused);
}

function predationObservation(): PredationObservation {
  const metrics = world.metrics;
  return {
    simulationTime: metrics.simulationTime,
    totalSteps: metrics.totalSteps,
    predatorState: world.predator.state,
    targetIndex: world.predator.targetIndex,
    captures: world.predator.captures,
    captureSerial: world.predator.captureSerial,
    aliveCount: world.flock.aliveCount,
    schoolCount: metrics.schoolCount,
    radiusOfGyration: metrics.radiusOfGyration,
    threatenedCount: metrics.threatenedCount,
  };
}

function resetVisualState(): void {
  lastAlpha = 1;
  visualTime = 0;
  droppedSteps = 0;
  frameTimes.length = 0;
}

function reset(): void {
  world.reset();
  world.scheduler.reset();
  predationTracker.reset();
  schoolStructureTracker.reset();
  scene?.resetSediment();
  resetVisualState();
  controls.syncConfig(world.config, world.clownfishCount);
}

function setSearchMode(mode: NeighborSearchMode): void {
  world.setSearchMode(mode);
  scene.grid.setVisible(viewMode === 'laboratory' && gridVisible && mode === 'grid');
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  scene.setLaboratoryMode(mode === 'laboratory');
  scene.grid.setVisible(mode === 'laboratory' && gridVisible && world.boids.searchMode === 'grid');
  // The collider telemetry is a Laboratory instrument; an explicit URL request
  // keeps it on in Observation for automated captures.
  world.setObstacleMetricsEnabled(mode === 'laboratory' || obstacleMetricsRequested);
}

function setCameraMode(mode: CameraMode): void {
  scene.setCameraMode(mode);
  controls.syncCameraMode(mode);
}

function setDemoPresentation(mode: DemoPresentation | null): void {
  const root = document.querySelector<HTMLElement>('.observatory');
  if (!root) return;
  root.classList.toggle('demo-cinematic', mode === 'cinematic');
  root.classList.toggle('demo-technical', mode === 'technical');
  if (mode) {
    root.dataset.demoMode = mode;
    controls?.setPanelOpen(false);
  } else {
    delete root.dataset.demoMode;
  }
}

function setObstacleShapeMode(mode: ObstacleShapeMode): void {
  if (mode === 'reefProxy' && !world.obstacles.proxyActive) {
    const transforms = scene.getReefCollisionTransforms();
    if (transforms.length === 5) {
      world.setReefProxies(buildReefProxySet(transforms));
    } else {
      console.warn(
        `Cannot enable reef proxies: ${transforms.length}/5 reef transforms are loaded.`,
      );
    }
  }
  world.setObstacleShapeMode(mode);
  controls.syncConfig(world.config, world.clownfishCount);
}

function setCollisionDebugLayer(layer: CollisionDebugLayer, visible: boolean): void {
  scene.setCollisionDebugLayer(layer, visible);
  controls.syncCollisionDebug(scene.getCollisionDebugVisibility());
}

function setWaterEffectsEnabled(enabled: boolean): void {
  waterEffects = enabled;
  scene.setWaterEffects(enabled);
  byId<HTMLInputElement>('water-effects').checked = enabled;
}

function setWaterDebugLayer(layer: WaterDebugLayer, enabled: boolean): void {
  // The debug layer is authoritative while diagnosing: do not let the legacy
  // master switch hide a layer that the user just explicitly enabled.
  setWaterEffectsEnabled(true);
  scene.setWaterDebugLayer(layer, enabled);
  controls.syncWaterDebug(scene.getWaterDebugState());
}

function setWaterDebugLayers(enabled: boolean): void {
  setWaterEffectsEnabled(true);
  scene.setWaterDebugLayers(enabled);
  controls.syncWaterDebug(scene.getWaterDebugState());
}

function setWaterOptics(model: WaterOpticsModel): void {
  waterOpticsModel = model;
  scene.setWaterOpticsModel(model);
}

function resetPerformanceSamples(): void {
  frameTimes.length = 0;
  fps = 0;
  fpsFrames = 0;
  fpsElapsed = 0;
  renderMs = 0;
  droppedSteps = 0;
  statisticsElapsed = 1;
  collisionReadoutElapsed = 0;
  lastFrame = performance.now();
  world.resetPerformanceCounters();
  scene.resetRenderPerformanceCounters();
}

function setPerformanceTelemetryEnabled(enabled: boolean): void {
  world.setPerformanceTelemetryEnabled(enabled);
  scene.setPerformanceTelemetryEnabled(enabled);
}

function getPerformanceDiagnostics(): PerformanceDiagnostics {
  const heap = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  return {
    simulation: world.getPerformanceSnapshot(),
    render: scene.getRenderPerformanceSnapshot(),
    renderer: scene.getRendererStats(),
    memory: heap
      ? {
        usedJSHeapSize: heap.usedJSHeapSize,
        totalJSHeapSize: heap.totalJSHeapSize,
        jsHeapSizeLimit: heap.jsHeapSizeLimit,
      }
      : null,
    droppedSteps,
    frameSampleCount: frameTimes.length,
    simulationMs: world.metrics.averageStepMs,
    renderMs,
  };
}

function updateCollisionReadout(): void {
  const element = document.getElementById('collision-readout');
  if (!element) return;
  const info = scene.getCollisionSelectedInfo();
  const mode = world.config.obstacleShapeMode;
  const proxyCount = scene.getReefCollisionTransforms().length;
  if (!world.obstacles.proxyActive) {
    element.textContent = mode === 'reefProxy'
      ? `Collider: sphere fallback · ${proxyCount}/5 reef transforms`
      : 'Collider: sphere baseline · no proxy installed';
    return;
  }
  const status = mode === 'reefProxy' ? 'SDF reef proxy' : 'sphere (proxy available)';
  if (!info.active) {
    element.textContent = `Collider: ${status}\nPenetrating fish: ${info.penetratingFish}`;
    return;
  }
  const signed = info.signedDistance >= 0 ? '+' : '';
  const clearance = info.clearance >= 0 ? '+' : '';
  element.textContent =
    `Collider: ${status}\n`
    + `Reef ${info.reefId?.toUpperCase() ?? '—'} · SDF ${signed}${info.signedDistance.toFixed(2)} m\n`
    + `Clearance ${clearance}${info.clearance.toFixed(2)} m${info.inside ? ' · INSIDE' : ''}`
    + ` · penetrating ${info.penetratingFish}`;
}

function setScenario(id: ScenarioId): void {
  const scenario = applyScenario(world, id);
  activeScenario = id;
  timeScale = 1;
  gridVisible = false;
  world.scheduler.reset();
  predationTracker.reset();
  schoolStructureTracker.reset();
  scene?.resetSediment();
  resetVisualState();
  setSearchMode('grid');
  setCameraMode('overview');
  scene.grid.setVisible(false);
  controls.syncScenario(scenario);
  controls.syncConfig(world.config, world.clownfishCount);
  controls.syncSearchMode('grid');
  controls.syncTimeScale(1);
  controls.setRunning(!paused);
  statistics.resetCaptureNotifications(world);
  byId<HTMLInputElement>('grid-visible').checked = false;
}

function releasePredator(): void {
  world.releasePredator();
  controls.syncConfig(world.config, world.clownfishCount);
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element #${id}.`);
  return element as T;
}

const statistics = new StatisticsPanel();
const predationTracker = new PredationEventTracker();
const schoolStructureTracker = new SchoolStructureTracker();
const fishProxyQuery = createReefProxyQueryResult();

function getFishProxyInfo(index: number): {
  reefId: string | null;
  signedDistance: number;
  clearance: number;
} | null {
  if (index < 0 || index >= world.flock.count || world.flock.alive[index] === 0) return null;
  const offset = index * 3;
  const found = world.obstacles.queryNearestProxy(
    world.flock.positions[offset],
    world.flock.positions[offset + 1],
    world.flock.positions[offset + 2],
    fishProxyQuery,
  );
  if (!found) return null;
  return {
    reefId: fishProxyQuery.id,
    signedDistance: fishProxyQuery.distance,
    clearance: fishProxyQuery.distance - world.config.obstacleMargin,
  };
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const requestedDemo = params.get('demo');
  if (requestedDemo && requestedDemo !== '0' && requestedDemo !== 'off') {
    setDemoPresentation(requestedDemo === 'technical' ? 'technical' : 'cinematic');
  }
  lightingMode = params.get('lighting') === 'base' ? 'base' : 'full';
  obstacleMetricsRequested = params.get('obstacleMetrics') === '1'
    || params.get('obstacleMetrics') === 'true';
  if (obstacleMetricsRequested) world.setObstacleMetricsEnabled(true);
  const rockDebugParam = params.get('rockdebug');
  const requestedRockDebug: RockDebugMode =
    rockDebugParam === 'normal' || rockDebugParam === 'normals' ? 'normal' : 'off';
  terrainMode = params.get('terrain') === 'legacy' ? 'legacy' : 'continuous';
  fishMotionMode = params.get('fishMotion') === 'legacy' ? 'legacy' : 'smooth';
  world.setSchoolDynamicsEnabled(params.get('schoolDynamics') !== 'legacy');
  world.setClownfishHabitatMode(params.get('habitat') === 'legacy' ? 'legacy' : 'anemone');
  waterEffects = lightingMode === 'full';
  waterOpticsModel = params.get('water') === 'legacy' ? 'legacy-display' : 'clear';
  const requestedScenario = params.get('scenario') as ScenarioId | null;
  const scenario = requestedScenario && ['calm', 'encounter', 'obstacles'].includes(requestedScenario)
    ? getScenario(requestedScenario)
    : getScenario('encounter');
  applyScenario(world, scenario.id);
  activeScenario = scenario.id;

  const requestedFishCount = Number.parseInt(params.get('fishCount') ?? '', 10);
  if (Number.isFinite(requestedFishCount)) {
    world.setFishCount(Math.min(2000, Math.max(10, requestedFishCount)));
  }
  const fishParam = params.get('fish');
  let fishAsset: FishAsset | undefined;
  if (fishParam !== 'procedural') {
    try {
      fishAsset = await loadFishAsset('/models/fish_school.glb');
      const stats = fishAsset.stats;
      console.info(
        `Blender fish asset: ${stats.triangles} triangles, ${stats.materialCount} materials, ` +
        `length ${stats.lengthZ.toFixed(3)}`,
      );
    } catch (error) {
      console.warn('Could not load /models/fish_school.glb; using the procedural fish.', error);
    }
  }

  const clownfishParam = params.get('clownfish');
  let clownfishAsset: FishAsset | undefined;
  if (clownfishParam !== '0' && clownfishParam !== 'off') {
    try {
      clownfishAsset = await loadFishAsset('/models/clownfish_school.glb', CLOWNFISH_CONTRACT);
      const stats = clownfishAsset.stats;
      console.info(
        `Blender clownfish asset: ${stats.triangles} triangles, ${stats.materialCount} materials, ` +
        `length ${stats.lengthZ.toFixed(3)}`,
      );
    } catch (error) {
      console.warn('Could not load /models/clownfish_school.glb; the clownfish school stays off.', error);
    }
  }
  const requestedClownfishCount = Number.parseInt(clownfishParam ?? '', 10);
  if (!clownfishAsset) {
    world.setClownfishCount(0);
  } else if (Number.isFinite(requestedClownfishCount)) {
    world.setClownfishCount(requestedClownfishCount);
  }

  let predatorAsset: PredatorAsset | PredatorRigAsset | undefined;
  const predatorParam = params.get('predator');
  if (predatorParam !== 'procedural') {
    try {
      if (predatorParam === 'v2') {
        predatorAsset = await loadPredatorAsset('/models/predator_reef_shark.glb');
      } else if (predatorParam === 'shayu' || predatorParam === 'blender') {
        predatorAsset = await loadPredatorAsset('/models/predator_shayu.glb');
      } else {
        const rigUrl = '/models/predator_shayu_rigged.glb';
        try {
          predatorAsset = await loadPredatorRigAsset(rigUrl);
        } catch (rigError) {
          console.warn(
            'Rigged predator unavailable; falling back to the static shayu asset.',
            rigError,
          );
          predatorAsset = await loadPredatorAsset('/models/predator_shayu.glb');
        }
      }
      const stats = predatorAsset.stats;
      const rigInfo = 'boneCount' in stats ? `, ${stats.boneCount} bones` : '';
      console.info(
        `Blender predator asset: ${stats.triangles} triangles, ` +
        `${stats.materialCount} materials${rigInfo}, length ${stats.lengthZ.toFixed(3)}`,
      );
    } catch (error) {
      console.warn('Could not load the Blender predator; using the procedural predator.', error);
    }
  }

  try {
    scene = new SceneManager(
      document.getElementById('viewport')!,
      world,
      fishAsset,
      predatorAsset,
      { lightingMode, waterOpticsModel, clownfishAsset, terrainMode, fishMotionMode },
    );
    if (params.get('sediment') === '0') scene.setWaterDebugLayer('sediment', false);
    const perfTelemetryParam = params.get('perfTelemetry');
    if (perfTelemetryParam === '1' || perfTelemetryParam === 'true') {
      setPerformanceTelemetryEnabled(true);
    }
    controls = new ControlPanel({
      setPaused,
      reset,
      setFishCount: (count) => {
        world.setFishCount(count);
        resetVisualState();
        controls.syncConfig(world.config, world.clownfishCount);
      },
      setClownfishCount: (count) => {
        world.setClownfishCount(count);
        controls.syncClownfishCount(world.clownfishCount);
      },
      setTimeScale: (scale) => { timeScale = scale; },
      setSearchMode,
      setObstacleShapeMode,
      updateConfig,
      setCameraMode,
      setGridVisible: (visible) => {
        gridVisible = visible;
        scene.grid.setVisible(viewMode === 'laboratory' && visible && world.boids.searchMode === 'grid');
      },
      setViewMode,
      setScenario,
      setWaterEffects: setWaterEffectsEnabled,
      setWaterDebugLayer,
      setWaterDebugLayers,
      setDebugLayer: (layer, visible) => scene.setDebugLayer(layer, visible),
      setCollisionDebugLayer,
      toggleFullscreen: () => {
        const operation = document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
        void operation.catch((error) => console.warn('Fullscreen request was not accepted.', error));
      },
      releasePredator,
      regroupSchool: () => world.regroupSchool(),
    });
    controls.syncConfig(world.config, world.clownfishCount);
    controls.syncScenario(scenario);
    controls.syncSearchMode(world.boids.searchMode);
    controls.syncCameraMode('overview');
    byId<HTMLInputElement>('water-effects').checked = waterEffects;
    controls.syncWaterDebug(scene.getWaterDebugState());
    controls.setRunning(true);
    document.querySelectorAll<HTMLInputElement>('[data-debug]').forEach((input) => {
      scene.setDebugLayer(input.dataset.debug as DebugLayer, input.checked);
    });
    const collisionDebugParam = params.get('collisiondebug');
    if (collisionDebugParam === '1' || collisionDebugParam === 'true') {
      scene.setCollisionDebugLayers(true);
    }
    controls.syncCollisionDebug(scene.getCollisionDebugVisibility());

    demoDirector = new DemoDirector({
      setScenario,
      setCameraMode,
      setViewMode: (mode) => {
        setViewMode(mode);
        controls.syncViewMode(mode);
      },
      setSearchMode: (mode) => {
        setSearchMode(mode);
        controls.syncSearchMode(mode);
      },
      setGridVisible: (visible) => {
        gridVisible = visible;
        scene.grid.setVisible(
          viewMode === 'laboratory' && visible && world.boids.searchMode === 'grid',
        );
        byId<HTMLInputElement>('grid-visible').checked = visible;
      },
      setCollisionDebugLayers: (enabled) => {
        scene.setCollisionDebugLayers(enabled);
        controls.syncCollisionDebug(scene.getCollisionDebugVisibility());
      },
      setPresentation: setDemoPresentation,
      setPaused,
      setTimeScale: (scale) => {
        timeScale = scale;
        controls.syncTimeScale(scale);
      },
    });
    if (requestedDemo && requestedDemo !== '0' && requestedDemo !== 'off') {
      demoDirector.start();
    }

    const fullEnvironment = params.get('environment') !== 'bare';
    const loads: Promise<boolean>[] = [];
    const rocksParam = params.get('glbRocks');
    if (rocksParam === '1') loads.push(scene.loadGlbRocks());
    else if (rocksParam === '2' || (fullEnvironment && rocksParam !== '0')) loads.push(scene.loadGlbRockSet());

    const kelpParam = params.get('kelp');
    let kelpRequested = false;
    let kelpLoaded = false;
    if (kelpParam === '1' || kelpParam === 'blender' || (fullEnvironment && kelpParam !== '0')) {
      kelpRequested = true;
      loads.push(scene.loadGlbKelp(world.kelpLayout).then((loaded) => {
        kelpLoaded = loaded;
        return loaded;
      }));
    } else {
      world.kelpRefuge.enabled = false;
    }
    const coralParam = params.get('coral');
    let coralMode: CoralScatterMode | 'off';
    if (!fullEnvironment || coralParam === '0' || coralParam === 'off') {
      coralMode = 'off';
    } else if (coralParam === 'temperate' || coralParam === 'light') {
      coralMode = 'temperate';
    } else {
      // The richest visual tier is the default: 6 species / 48 colonies.
      coralMode = 'full';
    }
    if (coralMode !== 'off') loads.push(scene.loadGlbCorals(coralMode));
    const seaweedParam = params.get('seaweed');
    if (seaweedParam !== '0' && seaweedParam !== 'off') {
      // Detail seaweed is part of the default richest reef; the low-poly kelp
      // remains the separate, cheaper layer.
      loads.push(scene.loadGlbSeaweed());
    }
    await Promise.all(loads);
    if (kelpRequested) world.kelpRefuge.enabled = kelpLoaded;
    // The five-reef set is part of the default scene now. `?reef=off` keeps
    // the original large-rock visuals; `?reef=sample` loads only the hero.
    const reefParam = params.get('reef');
    if (fullEnvironment && scene.environment.glbRockMode === 'set') {
      if (reefParam === 'sample') await scene.loadReefSample();
      else if (reefParam !== 'off' && reefParam !== '0') await scene.loadReefSet();
    }

    // Experiment A: install the SDF colliders built from the real reef GLBs.
    // The mode stays 'sphere' unless explicitly requested; a partial reef set
    // (sample-only / reef=off) keeps the original collider instead of leaving
    // unproxied obstacles in the water.
    const requestedShape = params.get('obstacleShape');
    const reefTransforms = scene.getReefCollisionTransforms();
    if (reefTransforms.length === 5) {
      world.setReefProxies(buildReefProxySet(reefTransforms));
    }
    if (requestedShape === 'reefProxy') {
      if (reefTransforms.length === 5) {
        world.setObstacleShapeMode('reefProxy');
      } else {
        console.warn(
          `Reef proxy mode requested but ${reefTransforms.length}/5 reef transforms are loaded; ` +
          'keeping the sphere colliders.',
        );
      }
    } else if (requestedShape === 'sphere') {
      world.setObstacleShapeMode('sphere');
    }
    if (requestedRockDebug !== 'off') scene.setRockDebugMode(requestedRockDebug);
  } catch (error) {
    const loading = document.getElementById('loading-screen')!;
    loading.classList.add('error');
    loading.textContent = `The 3D view could not start. WebGL 2 and hardware acceleration are required. ${error instanceof Error ? error.message : ''}`;
    throw error;
  }

  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

function percentile95(): number {
  if (frameTimes.length === 0) return Number.NaN;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function averageFrameMs(): number {
  if (frameTimes.length === 0) return Number.NaN;
  return frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length;
}

function checksumFloats(hash: number, values: Float32Array): number {
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
  for (let offset = 0; offset < values.byteLength; offset += 4) {
    hash = Math.imul(hash ^ view.getUint32(offset, true), 0x01000193) >>> 0;
  }
  return hash;
}

function checksumFlock(
  flock: { count: number; aliveCount: number; positions: Float32Array; velocities: Float32Array; alive: Uint8Array },
): string {
  let hash = Math.imul(0x811c9dc5 ^ flock.count, 0x01000193) >>> 0;
  hash = Math.imul(hash ^ flock.aliveCount, 0x01000193) >>> 0;
  hash = checksumFloats(hash, flock.positions.subarray(0, flock.count * 3));
  hash = checksumFloats(hash, flock.velocities.subarray(0, flock.count * 3));
  for (let index = 0; index < flock.count; index += 1) {
    hash = Math.imul(hash ^ flock.alive[index], 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}`;
}

function snapshotFlock(flock: SimulationWorld['flock']): FlockSnapshot {
  const length = flock.count * 3;
  return {
    count: flock.count,
    aliveCount: flock.aliveCount,
    positions: Array.from(flock.positions.subarray(0, length)),
    velocities: Array.from(flock.velocities.subarray(0, length)),
    alive: Array.from(flock.alive.subarray(0, flock.count)),
    fear: Array.from(flock.fear.subarray(0, flock.count)),
    checksum: checksumFlock(flock),
  };
}

interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

function captureCameraSheet(
  poses: readonly CameraPose[],
  columns: number,
  rows: number,
  sheetWidth: number,
  sheetHeight: number,
): string {
  const renderer = scene.renderer;
  const camera = scene.camera;
  const previousPixelRatio = renderer.getPixelRatio();
  const tileWidth = Math.floor(sheetWidth / columns);
  const tileHeight = Math.floor(sheetHeight / rows);
  renderer.setPixelRatio(1);
  renderer.setSize(sheetWidth, sheetHeight, false);
  renderer.setScissorTest(true);
  camera.aspect = tileWidth / tileHeight;
  camera.updateProjectionMatrix();

  for (let index = 0; index < poses.length; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = column * tileWidth;
    const y = sheetHeight - (row + 1) * tileHeight;
    renderer.setViewport(x, y, tileWidth, tileHeight);
    renderer.setScissor(x, y, tileWidth, tileHeight);
    const pose = poses[index];
    scene.setCameraPose(pose.position, pose.target);
    renderer.render(scene.scene, camera);
  }

  const dataUrl = renderer.domElement.toDataURL('image/png');
  renderer.setScissorTest(false);
  renderer.setPixelRatio(previousPixelRatio);
  scene.resize();
  return dataUrl;
}

function getSimulationSnapshot(): SimulationSnapshot {
  const fish = snapshotFlock(world.flock);
  const clownfish = snapshotFlock(world.clownfishFlock);
  const predatorHash = world.predator.state
    .split('')
    .reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
  let combined = Math.imul(0x811c9dc5 ^ world.metrics.totalSteps, 0x01000193) >>> 0;
  combined = Math.imul(combined ^ world.metrics.captures, 0x01000193) >>> 0;
  combined = checksumFloats(combined, world.predator.position);
  combined = checksumFloats(combined, world.predator.velocity);
  combined = Math.imul(combined ^ predatorHash, 0x01000193) >>> 0;
  return {
    simulationTime: world.metrics.simulationTime,
    totalSteps: world.metrics.totalSteps,
    seed: world.config.seed,
    fish,
    clownfish,
    captures: world.metrics.captures,
    predatorState: world.predator.state,
    predatorPosition: [...world.predator.position] as [number, number, number],
    predatorVelocity: [...world.predator.velocity] as [number, number, number],
    kelpRefugeEnabled: world.kelpRefuge.enabled,
    checksum: `${fish.checksum}${clownfish.checksum}${(combined >>> 0).toString(16).padStart(8, '0')}`,
  };
}

const projectionScratch = new Vector3();
const screenScratch = { x: 0, y: 0 };

function projectToNdc(
  x: number,
  y: number,
  z: number,
  camera: PerspectiveCamera,
  out: { x: number; y: number },
): boolean {
  projectionScratch.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  if (!(projectionScratch.z < -0.05)) return false;
  projectionScratch.applyMatrix4(camera.projectionMatrix);
  if (!Number.isFinite(projectionScratch.x) || !Number.isFinite(projectionScratch.y)) return false;
  out.x = projectionScratch.x;
  out.y = projectionScratch.y;
  return true;
}

function getDiagnostics(): Diagnostics {
  const averageFrame = averageFrameMs();
  const camera = scene.camera;
  const controller = scene.cameraController;
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const schoolXs: number[] = [];
  const schoolYs: number[] = [];
  let schoolAlive = 0;
  let schoolVisible = 0;
  for (let index = 0; index < world.flock.count; index += 1) {
    if (world.flock.alive[index] === 0) continue;
    schoolAlive += 1;
    const offset = index * 3;
    if (!projectToNdc(
      world.flock.positions[offset],
      world.flock.positions[offset + 1],
      world.flock.positions[offset + 2],
      camera,
      screenScratch,
    )) continue;
    schoolXs.push(screenScratch.x);
    schoolYs.push(screenScratch.y);
    if (Math.abs(screenScratch.x) <= 1 && Math.abs(screenScratch.y) <= 1) schoolVisible += 1;
  }
  let schoolScreenBounds: [number, number, number, number] | null = null;
  if (schoolXs.length > 0) {
    schoolXs.sort((a, b) => a - b);
    schoolYs.sort((a, b) => a - b);
    const low = Math.floor((schoolXs.length - 1) * 0.05);
    const high = Math.ceil((schoolXs.length - 1) * 0.95);
    schoolScreenBounds = [schoolXs[low], schoolYs[low], schoolXs[high], schoolYs[high]];
  }
  const predatorScreenPosition: [number, number] | null = projectToNdc(
    world.predator.position[0],
    world.predator.position[1],
    world.predator.position[2],
    camera,
    screenScratch,
  ) ? [screenScratch.x, screenScratch.y] : null;
  const targetIndex = world.predator.targetIndex;
  const hasPredatorTarget = targetIndex >= 0
    && targetIndex < world.flock.count
    && world.flock.alive[targetIndex] === 1;
  const targetOffset = targetIndex * 3;
  const predatorTargetPosition = hasPredatorTarget
    ? Array.from(world.flock.positions.subarray(targetOffset, targetOffset + 3)) as [number, number, number]
    : null;
  const targetFishScreenPosition: [number, number] | null = predatorTargetPosition
    && projectToNdc(
      predatorTargetPosition[0],
      predatorTargetPosition[1],
      predatorTargetPosition[2],
      camera,
      screenScratch,
    ) ? [screenScratch.x, screenScratch.y] : null;
  return {
    ready,
    cameraPosition: [...scene.camera.position] as [number, number, number],
    cameraTarget: [...controller.controls.target] as [number, number, number],
    cameraLookTarget: [...controller.lookTarget] as [number, number, number],
    cameraQuaternion: [
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    ],
    cameraUp: [...controller.cameraUp] as [number, number, number],
    cameraDistance: scene.camera.position.distanceTo(controller.controls.target),
    maxCameraDistance: scene.cameraController.controls.maxDistance,
    cameraAngularChange: controller.cameraAngularChange,
    cameraTranslationSpeed: controller.cameraTranslationSpeed,
    cameraTerrainClearance: scene.camera.position.y
      - terrainHeightAt(scene.camera.position.x, scene.camera.position.z),
    schoolVisibleFraction: schoolAlive > 0 ? schoolVisible / schoolAlive : 0,
    schoolScreenBounds,
    schoolFitScale: controller.schoolFitScale,
    schoolFitRawScale: controller.schoolFitRaw,
    schoolFitPercentile: controller.schoolPercentileValue,
    schoolFitSampleCount: controller.schoolFitSampleCount,
    schoolFitPredictedVisibleFraction: controller.schoolVisibleFraction,
    headingCoherence: controller.headingCoherence,
    headingReliability: controller.headingReliability,
    headingSource: controller.headingSource,
    predatorForwardSource: controller.predatorForwardSource,
    predatorTargetDistance: controller.predatorTargetDistance,
    predatorScreenPosition,
    targetFishScreenPosition,
    fps,
    fpsFromSamples: 1000 / averageFrame,
    renderMs,
    p95FrameMs: percentile95(),
    frameSampleCount: frameTimes.length,
    averageFrameMs: averageFrame,
    searchMode: world.boids.searchMode,
    predatorState: world.config.predatorEnabled ? world.predator.state : 'standby',
    predatorPosition: [...world.predator.position] as [number, number, number],
    predatorVelocity: [...world.predator.velocity] as [number, number, number],
    predatorTargetIndex: hasPredatorTarget ? targetIndex : null,
    predatorTargetPosition,
    schoolCenter: [...world.center] as [number, number, number],
    occupiedCells: world.boids.searchMode === 'grid' ? world.boids.grid.occupiedCellCount : null,
    fishCount: world.metrics.fishCount,
    simulationTime: world.metrics.simulationTime,
    totalSteps: world.metrics.totalSteps,
    captures: world.metrics.captures,
    averageNeighbors: world.metrics.averageNeighbors,
    simulationMs: world.metrics.averageStepMs,
    lastStepMs: world.metrics.lastStepMs,
    candidatesExamined: world.boids.candidatesExamined,
    threatenedCount: world.metrics.threatenedCount,
    shelteredCount: world.metrics.shelteredCount,
    schoolCount: world.metrics.schoolCount,
    droppedSteps,
    paused,
    timeScale,
    viewMode,
    scenarioId: activeScenario,
    scenarioSeed: world.config.seed,
    cameraMode: scene.cameraController.mode,
    waterEffects,
    waterDebug: scene.getWaterDebugState(),
    waterOpticsModel,
    lightingMode,
    rockDebugMode: scene.rockDebugMode,
    obstacleShapeMode: world.config.obstacleShapeMode,
    reefProxyActive: world.obstacles.proxyActive,
    reefProxyReefCount: scene.getReefCollisionTransforms().length,
    obstacleMetrics: world.getObstacleDiagnostics(),
    collisionDebug: scene.getCollisionDebugVisibility(),
    collisionSelected: scene.getCollisionSelectedInfo(),
    lighting: scene.getLightingDiagnostics(),
    debugLayers: scene.debug.getLayerVisibility(),
    sampleFishIndex: scene.debug.getSampleIndex(),
    canvasWidth: scene.renderer.domElement.width,
    canvasHeight: scene.renderer.domElement.height,
    glbRocks: scene.environment.glbRocksEnabled,
    glbRockMode: scene.environment.glbRockMode,
    glbRockInstances: scene.environment.glbRockInstanceCounts,
    glbRockTriangles: scene.environment.glbRockStats?.triangles ?? 0,
    kelpModel: scene.environment.glbKelpMode,
    kelpInstances: scene.environment.glbKelpInstanceCounts,
    kelpTriangles: scene.environment.glbKelpStats?.triangles ?? 0,
    coralModel: scene.environment.glbCoralMode,
    coralInstances: scene.environment.glbCoralInstanceCount,
    coralTriangles: scene.environment.glbCoralStats?.triangles ?? 0,
    reefSample: scene.environment.reefSampleActive,
    reefSampleStats: scene.environment.reefSampleStats,
    reefSet: scene.environment.reefSetActive,
    reefSetStats: scene.environment.reefSetStats,
    seaweedModel: scene.environment.glbSeaweedMode,
    seaweedInstances: scene.environment.glbSeaweedInstanceCount,
    seaweedTriangles: scene.environment.glbSeaweedStats?.triangles ?? 0,
    terrainDecorInstances: scene.environment.terrainDecorInstanceCounts,
    fishModel: scene.fish.modelKind,
    fishTriangles: scene.fish.triangleCount,
    fishWorldLength: [scene.fish.worldLengthMin, scene.fish.worldLengthMax],
    clownfishModel: scene.clownfish ? 'blender' : 'off',
    clownfishCount: world.metrics.clownfishCount,
    clownfishTriangles: scene.clownfish?.triangleCount ?? 0,
    clownfishWorldLength: scene.clownfish
      ? [scene.clownfish.worldLengthMin, scene.clownfish.worldLengthMax]
      : null,
    clownfishCenter: world.getClownfishCenter(),
    predatorModel: scene.predator.modelKind,
    predatorRigged: scene.predator.rigged,
    predatorTriangles: scene.predator.triangleCount,
    predatorBank: scene.predator.bankAngle,
    predatorThrust: scene.predator.thrustFactor,
    predatorTurn: scene.predator.turnFactor,
    predatorTailTurn: scene.predator.tailTurnFactor,
    predatorPitch: scene.predator.pitchAngle,
    drawCalls: scene.renderer.info.render.calls,
    renderTriangles: scene.renderer.info.render.triangles,
    demo: demoDirector?.getState() ?? null,
  };
}

window.__blueCurrent = {
  get ready() { return ready; },
  getDiagnostics,
  getLightingDiagnostics: () => scene.getLightingDiagnostics(),
  getRockDiagnostics: () => scene.getRockDiagnostics(),
  captureRockMask: () => scene.captureRockMask(),
  setRockDebugMode: (mode) => scene.setRockDebugMode(mode),
  getSimulationSnapshot,
  getPredationEvents: (limit = 20) => {
    predationTracker.observe(predationObservation());
    schoolStructureTracker.observe(world.getSchoolStructureSnapshot());
    const events = predationTracker.all;
    const count = Math.max(0, Math.min(Math.floor(limit), events.length));
    return events.slice(events.length - count).map((event) => ({ ...event }));
  },
  getSchoolStructure: (limit = 20) => {
    const state = schoolStructureTracker.observe(world.getSchoolStructureSnapshot());
    const count = Math.max(0, Math.min(Math.floor(limit), state.events.length));
    return {
      ...state,
      events: state.events.slice(state.events.length - count).map((event) => ({ ...event })),
    };
  },
  getFishMotionDiagnostics: () => ({
    school: scene.fish.motionDiagnostics(),
    clownfish: scene.clownfish ? scene.clownfish.motionDiagnostics() : null,
  }),
  getObstacleDiagnostics: () => world.getObstacleDiagnostics(),
  getPerformanceDiagnostics,
  setPerformanceTelemetryEnabled,
  getClownfishHabitatDiagnostics: () => world.getClownfishHabitatDiagnostics(),
  getSedimentDiagnostics: () => scene.getSedimentDiagnostics(),
  advanceSediment: (seconds) => {
    scene.advanceSediment(world, Math.max(0, seconds), visualTime);
    return scene.getSedimentDiagnostics();
  },
  setObstacleMetricsEnabled: (enabled) => world.setObstacleMetricsEnabled(enabled),
  settleCamera: (seconds = 2.4, frames = 16) => {
    const count = Math.max(1, Math.min(120, Math.floor(frames)));
    const delta = Math.max(0, Math.min(0.15, seconds / count));
    for (let index = 0; index < count; index += 1) {
      scene.updateCamera(world, delta, lastAlpha);
    }
    return getDiagnostics();
  },
  settleVisual: (seconds = 1.2, frames = 12) => {
    scene.settleVisual(world, visualTime, seconds, frames);
    return getDiagnostics();
  },
  captureCameraSheet: (poses, columns, rows, width = 1920, height = 810) => (
    captureCameraSheet(poses, columns, rows, width, height)
  ),
  pause: () => setPaused(true),
  resume: () => setPaused(false),
  reset,
  step: (count = 1) => {
    for (let i = 0; i < Math.max(0, Math.floor(count)); i += 1) world.step();
    lastAlpha = 1;
    scene.update(world, 1, visualTime, 0, 0);
    return getDiagnostics();
  },
  setFishCount: (count) => {
    world.setFishCount(count);
    resetVisualState();
    controls.syncConfig(world.config, world.clownfishCount);
  },
  setClownfishCount: (count) => {
    world.setClownfishCount(count);
    controls.syncClownfishCount(world.clownfishCount);
  },
  setSearchMode: (mode) => {
    setSearchMode(mode);
    controls.syncSearchMode(mode);
  },
  setObstacleShapeMode: (mode) => setObstacleShapeMode(mode),
  updateConfig: (patch) => {
    updateConfig(patch);
    controls.syncConfig(world.config, world.clownfishCount);
  },
  setScenario,
  setViewMode: (mode) => {
    setViewMode(mode);
    controls.syncViewMode(mode);
  },
  setCameraMode,
  setCameraPose: (position, target) => {
    scene.setCameraPose(position, target);
    controls.syncCameraMode('free');
  },
  getDemoState: () => demoDirector?.getState() ?? null,
  startDemo: () => demoDirector?.start() ?? null,
  restartDemo: () => demoDirector?.restart() ?? null,
  stopDemo: () => demoDirector?.stop() ?? null,
  seekDemo: (seconds) => demoDirector?.seek(seconds) ?? null,
  advanceVisualTime: (seconds) => {
    // Render-only clock hook for deterministic temporal captures: advances the
    // visual clock (shafts, kelp, snow) without stepping the paused simulation.
    visualTime += Math.max(0, seconds);
    scene.update(world, lastAlpha, visualTime, 0, 0);
    return getDiagnostics();
  },
  setVisualTime: (seconds) => {
    // Absolute counterpart of advanceVisualTime: makes a capture run
    // reproducible regardless of how long the scene took to load.
    visualTime = Math.max(0, seconds);
    scene.update(world, lastAlpha, visualTime, 0, 0);
    return getDiagnostics();
  },
  setGridVisible: (visible) => {
    gridVisible = visible;
    scene.grid.setVisible(viewMode === 'laboratory' && visible && world.boids.searchMode === 'grid');
    byId<HTMLInputElement>('grid-visible').checked = visible;
  },
  setDebugLayer: (layer, visible) => {
    scene.setDebugLayer(layer, visible);
    const input = document.querySelector<HTMLInputElement>(`[data-debug="${layer}"]`);
    if (input) input.checked = visible;
  },
  setCollisionDebugLayer: (layer, visible) => setCollisionDebugLayer(layer, visible),
  setCollisionDebugLayers: (enabled) => {
    scene.setCollisionDebugLayers(enabled);
    controls.syncCollisionDebug(scene.getCollisionDebugVisibility());
  },
  getCollisionDebugVisibility: () => scene.getCollisionDebugVisibility(),
  getCollisionSelectedInfo: () => scene.getCollisionSelectedInfo(),
  setDebugSampleFish: (index) => scene.setDebugSampleFish(index),
  getFishProxyInfo,
  setWaterEffects: setWaterEffectsEnabled,
  setWaterDebugLayer,
  setWaterDebugLayers,
  setWaterOpticsModel: setWaterOptics,
  setLightingMode: (mode) => {
    lightingMode = mode;
    scene.setLightingMode(mode);
  },
  setShadowMapEnabled: (enabled) => scene.setShadowMapEnabled(enabled),
  resetPerformanceSamples,
  releasePredator,
  regroupSchool: () => world.regroupSchool(),
  loadGlbRocks: () => scene.loadGlbRocks(),
  loadGlbRockSet: () => scene.loadGlbRockSet(),
  loadGlbKelp: async () => {
    const loaded = await scene.loadGlbKelp(world.kelpLayout);
    world.kelpRefuge.enabled = loaded;
    return loaded;
  },
  loadGlbCorals: (mode = 'temperate') => scene.loadGlbCorals(mode),
  loadGlbSeaweed: () => scene.loadGlbSeaweed(),
  loadReefSample: () => scene.loadReefSample(),
  loadReefSet: () => scene.loadReefSet(),
};

function frame(now: number): void {
  const rawDelta = Math.max(0, (now - lastFrame) / 1000);
  lastFrame = now;
  const frameDelta = Math.min(rawDelta, 0.15);
  frameTimes.push(rawDelta * 1000);
  if (frameTimes.length > 240) frameTimes.shift();

  demoDirector?.update(rawDelta);

  let simulatedDelta = 0;
  if (!paused) {
    const result = world.scheduler.advance(frameDelta * timeScale, (delta) => world.step(delta));
    lastAlpha = result.alpha;
    droppedSteps += result.droppedSteps;
    visualTime += frameDelta * timeScale;
    // Feed the predator controller the time the simulation actually advanced,
    // not the variable frame delta; this keeps pose integration in lockstep
    // with the trajectory at low or irregular frame rates.
    simulatedDelta = result.steps * world.config.fixedDelta;
  }

  predationTracker.observe(predationObservation());
  schoolStructureTracker.observe(world.getSchoolStructureSnapshot());

  const renderStarted = performance.now();
  scene.update(
    world,
    lastAlpha,
    visualTime,
    frameDelta,
    paused ? 0 : frameDelta * timeScale,
    simulatedDelta,
  );
  renderMs = renderMs * 0.88 + (performance.now() - renderStarted) * 0.12;

  fpsFrames += 1;
  fpsElapsed += rawDelta;
  statisticsElapsed += rawDelta;
  if (fpsElapsed >= 0.5) {
    fps = fpsFrames / fpsElapsed;
    fpsFrames = 0;
    fpsElapsed = 0;
  }
  if (statisticsElapsed >= 0.25) {
    statistics.update(world, {
      fps,
      renderMs,
      p95FrameMs: percentile95(),
      droppedSteps,
      drawCalls: scene.renderer.info.render.calls,
    }, predationTracker.latest, schoolStructureTracker.latest);
    statisticsElapsed = 0;
  }
  collisionReadoutElapsed += rawDelta;
  if (viewMode === 'laboratory' && collisionReadoutElapsed >= 0.12) {
    collisionReadoutElapsed = 0;
    updateCollisionReadout();
  }

  if (!ready) {
    ready = true;
    document.getElementById('loading-screen')!.classList.add('hidden');
  }
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now();
  fpsFrames = 0;
  fpsElapsed = 0;
  frameTimes.length = 0;
  world.scheduler.reset();
});

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, button')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    setPaused(!paused);
  } else if (event.key.toLowerCase() === 'r') {
    reset();
  } else if (event.key.toLowerCase() === 'g') {
    controls.toggleGrid();
  }
});

void boot();
