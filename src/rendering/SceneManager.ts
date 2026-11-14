import {
  ACESFilmicToneMapping,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  type InstancedBufferAttribute,
  type Material,
  type Object3D,
} from 'three';
import type { SimulationWorld } from '../simulation/SimulationWorld';
import { CameraController, OVERVIEW_CAMERA_POSITION } from './CameraController';
import type { CameraMode } from './CameraController';
import { Environment } from './Environment';
import type { RockDebugMode } from './Environment';
import type { KelpPlacement } from './kelpPlacement';
import type { CoralScatterMode } from './CoralScatter';
import { FishRenderer, CLOWNFISH_RENDER_OPTIONS } from './FishRenderer';
import type { FishAsset, FishAssetStats } from './FishAsset';
import type { PredatorAsset } from './PredatorAsset';
import type { PredatorRigAsset } from './PredatorRigAsset';
import { PredatorRenderer } from './PredatorRenderer';
import { GridVisualizer } from './GridVisualizer';
import { DebugVisualizer } from './DebugVisualizer';
import type { DebugLayer } from './DebugVisualizer';
import {
  CollisionDebugVisualizer,
  type CollisionDebugLayer,
  type CollisionDebugVisibility,
  type CollisionSelectedInfo,
} from './CollisionDebugVisualizer';
import { createUnderwaterEnvironment } from './UnderwaterEnvironment';
import {
  createWaterDebugState,
  installUnderwaterMedium,
  UNDERWATER_MEDIUM_CONFIG,
  UnderwaterMedium,
  type WaterDebugLayer,
  type WaterDebugState,
  type WaterOpticsModel,
} from './UnderwaterMedium';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';
import type { UnderwaterLightingMode } from './lighting/UnderwaterLightingConfig';
import { auditMaterialColorSpaces } from './lighting/MaterialColorSpace';
import type { RockDiagnosticsReport } from './lighting/RockDiagnostics';
import type { ReefWorldTransform } from '../simulation/ReefCollisionProxy';
import { PhaseEmaRecorder, type PhaseEmaSnapshot } from '../simulation/PerformanceTelemetry';
import { GpuTimer, type GpuTimerSnapshot } from './GpuTimer';

/**
 * Camera layer reserved for the rock-mask pass. Nothing else in the project
 * uses extra layers, so normal rendering still sees every object on layer 0.
 */
const ROCK_MASK_LAYER = 7;

export interface RockMaskCapture {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
}

export interface SceneManagerOptions {
  readonly lightingMode?: UnderwaterLightingMode;
  readonly waterOpticsModel?: WaterOpticsModel;
  readonly clownfishAsset?: FishAsset;
  readonly terrainMode?: 'continuous' | 'legacy';
  /** Same-version E1 comparison path; `legacy` disables pitch smoothing and turn bend. */
  readonly fishMotionMode?: 'smooth' | 'legacy';
}

export interface RendererPerformanceStats {
  readonly memory: { readonly geometries: number; readonly textures: number } | null;
  readonly programs: number | null;
  readonly gpuTimer: GpuTimerSnapshot;
}

export class SceneManager {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(48, 1, 0.1, 400);
  readonly renderer: WebGLRenderer;
  readonly renderPerformance = new PhaseEmaRecorder({
    exclusivePhases: ['fish', 'clownfish', 'predator', 'debug', 'camera', 'environment', 'draw'],
  });
  private readonly gpuTimer: GpuTimer;
  readonly cameraController: CameraController;
  readonly environment: Environment;
  readonly fish: FishRenderer;
  readonly clownfish: FishRenderer | null;
  readonly fishAssetInfo: FishAssetStats | null;
  readonly clownfishAssetInfo: FishAssetStats | null;
  readonly predator: PredatorRenderer;
  readonly grid: GridVisualizer;
  readonly debug: DebugVisualizer;
  readonly collisionDebug: CollisionDebugVisualizer;
  readonly medium: UnderwaterMedium;
  private readonly waterDebug = createWaterDebugState();
  private readonly resizeObserver: ResizeObserver;
  private readonly rockMaskBlack = new MeshBasicMaterial({
    color: 0x000000,
    toneMapped: false,
    fog: false,
  });
  private readonly rockMaskWhite = new MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    fog: false,
    depthWrite: false,
  });
  private rockMaskTarget?: WebGLRenderTarget;

  constructor(
    private readonly container: HTMLElement,
    world: SimulationWorld,
    fishAsset?: FishAsset,
    predatorAsset?: PredatorAsset | PredatorRigAsset,
    options: SceneManagerOptions = {},
  ) {
    installUnderwaterMedium();
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gpuTimer = new GpuTimer(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = UNDERWATER_LIGHTING_CONFIG.renderer.exposure;
    // The sun and reef casters are static. Render the map once, then invalidate
    // it only when an asset or obstacle visibility actually changes.
    this.renderer.shadowMap.enabled = UNDERWATER_LIGHTING_CONFIG.sun.shadow.enabled;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.environment = createUnderwaterEnvironment(this.renderer);
    this.scene.environmentIntensity = UNDERWATER_LIGHTING_CONFIG.renderer.environmentIntensity;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D fish school simulation');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);

    this.camera.position.fromArray(OVERVIEW_CAMERA_POSITION);
    this.cameraController = new CameraController(this.camera, this.renderer.domElement);
    if (options.terrainMode === 'legacy') {
      this.camera.far = 180;
      this.camera.updateProjectionMatrix();
    }
    this.environment = new Environment(
      this.scene,
      world.obstacles,
      world.config,
      options.lightingMode ?? 'full',
      options.terrainMode ?? 'continuous',
    );
    const fishMotionOptions = options.fishMotionMode
      ? { motionMode: options.fishMotionMode }
      : {};
    this.fish = new FishRenderer(this.scene, world.flock, fishAsset, fishMotionOptions);
    this.fishAssetInfo = fishAsset?.stats ?? null;
    this.clownfish = options.clownfishAsset
      ? new FishRenderer(
        this.scene,
        world.clownfishFlock,
        options.clownfishAsset,
        { ...CLOWNFISH_RENDER_OPTIONS, ...fishMotionOptions },
      )
      : null;
    this.clownfishAssetInfo = options.clownfishAsset?.stats ?? null;
    this.predator = new PredatorRenderer(this.scene, world.predator, predatorAsset);
    this.grid = new GridVisualizer(this.scene);
    this.debug = new DebugVisualizer(this.scene);
    this.collisionDebug = new CollisionDebugVisualizer(this.scene);
    this.medium = new UnderwaterMedium(options.waterOpticsModel ?? 'clear');
    this.medium.attach(this.scene);
    this.syncMediumLightingMode();
    if (this.medium.opticsModel === 'legacy-display') {
      this.environment.setWaterScatteringVisible(false);
    }
    this.environment.setLaboratoryMode(false);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraController.setMode(mode);
  }

  setLaboratoryMode(enabled: boolean): void {
    this.environment.setLaboratoryMode(enabled);
    this.debug.setLaboratoryMode(enabled);
    this.collisionDebug.setLaboratoryMode(enabled);
  }

  setDebugLayer(layer: DebugLayer, visible: boolean): void {
    this.debug.setLayer(layer, visible);
  }

  setCollisionDebugLayer(layer: CollisionDebugLayer, visible: boolean): void {
    this.collisionDebug.setLayer(layer, visible);
  }

  setCollisionDebugLayers(enabled: boolean): void {
    const layers: readonly CollisionDebugLayer[] = ['proxy', 'margin', 'sdf', 'penetration'];
    for (const layer of layers) this.collisionDebug.setLayer(layer, enabled);
  }

  getCollisionDebugVisibility(): CollisionDebugVisibility {
    return this.collisionDebug.getLayerVisibility();
  }

  getCollisionSelectedInfo(): CollisionSelectedInfo {
    return this.collisionDebug.getSelectedInfo();
  }

  setDebugSampleFish(index: number): void {
    this.debug.setManualSampleIndex(index);
  }

  setWaterEffects(enabled: boolean): void {
    this.environment.setWaterEffects(enabled);
  }

  setWaterDebugLayer(layer: WaterDebugLayer, enabled: boolean): void {
    this.waterDebug[layer] = enabled;
    if (layer === 'sceneFog' || layer === 'waterAttenuation' || layer === 'volumetricScattering') {
      this.medium.setLayer(layer, enabled && this.environment.lightingMode === 'full');
      if (layer === 'volumetricScattering') {
        this.environment.setWaterScatteringVisible(
          enabled && this.waterOpticsModel === 'clear',
        );
      }
    } else {
      this.environment.setWaterDebugLayer(layer, enabled);
    }
  }

  setWaterDebugLayers(enabled: boolean): void {
    const layers: readonly WaterDebugLayer[] = [
      'sceneFog',
      'waterAttenuation',
      'volumetricScattering',
      'marineParticles',
      'lightShafts',
      'caustics',
      'surfaceLight',
    ];
    for (const layer of layers) this.setWaterDebugLayer(layer, enabled);
  }

  getWaterDebugState(): WaterDebugState {
    return { ...this.waterDebug };
  }

  setWaterOpticsModel(model: WaterOpticsModel): void {
    this.medium.setOpticsModel(model);
    this.environment.setWaterScatteringVisible(
      model === 'clear' && this.waterDebug.volumetricScattering,
    );
  }

  get waterOpticsModel(): WaterOpticsModel {
    return this.medium.opticsModel;
  }

  setCameraPose(position: readonly [number, number, number], target: readonly [number, number, number]): void {
    this.cameraController.setPose(position, target);
  }

  setLightingMode(mode: UnderwaterLightingMode): void {
    this.environment.setLightingMode(mode);
    this.syncMediumLightingMode();
  }

  /** Diagnostic hook for isolating shadow-map edges from terrain shading. */
  setShadowMapEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.renderer.shadowMap.needsUpdate = true;
  }

  getRockDiagnostics(): RockDiagnosticsReport {
    return this.environment.getRockDiagnostics();
  }

  get rockDebugMode(): RockDebugMode {
    return this.environment.rockDebugMode;
  }

  /** `?rockdebug=normal` material override; no effect on the default path. */
  setRockDebugMode(mode: RockDebugMode): void {
    this.environment.setRockDebugMode(mode);
  }

  /**
   * Render a binary visible-rock mask through the current camera.
   *
   * Pass 1 draws the opaque scene black so the depth buffer keeps real
   * occluders (terrain, fish, kelp); pass 2 draws only rock meshes white with
   * the same depth test. The mask therefore contains only rock pixels that are
   * actually visible in the final image, not rocks hidden behind terrain.
   * Transparent/effect geometry (water surface, shafts, snow, contact decals)
   * is hidden for both passes so it cannot punch holes or add false coverage.
   */
  captureRockMask(): RockMaskCapture {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.max(1, Math.floor(size.x));
    const height = Math.max(1, Math.floor(size.y));
    if (!this.rockMaskTarget
      || this.rockMaskTarget.width !== width
      || this.rockMaskTarget.height !== height) {
      this.rockMaskTarget?.dispose();
      this.rockMaskTarget = new WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
      });
    }
    const target = this.rockMaskTarget;
    const camera = this.camera;
    const savedLayers = camera.layers.mask;
    const savedAutoClear = this.renderer.autoClear;
    const savedOverride = this.scene.overrideMaterial;
    const savedBackground = this.scene.background;
    const savedClearColor = this.renderer.getClearColor(new Color()).clone();
    const savedClearAlpha = this.renderer.getClearAlpha();
    const hidden: Object3D[] = [];
    const rockMeshes = this.environment.getRockMeshes();
    const savedRockLayers = rockMeshes.map((mesh) => mesh.layers.mask);
    const detachedInstanceColors: Array<{
      mesh: InstancedMesh;
      color: InstancedBufferAttribute;
    }> = [];

    try {
      this.scene.traverse((object) => {
        const renderable = object as Object3D & { material?: Material | Material[] };
        if (!renderable.material || !object.visible) return;
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material];
        const nonOccluder = materials.some(
          (material) => material.transparent || !material.depthWrite || !material.depthTest,
        );
        if (nonOccluder) {
          hidden.push(object);
          object.visible = false;
        }
      });

      // Pass 1: opaque black plate, depth only (the colour stays black).
      this.scene.background = null;
      this.scene.overrideMaterial = this.rockMaskBlack;
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.autoClear = true;
      this.renderer.clear(true, true, false);
      camera.layers.mask = savedLayers;
      this.renderer.render(this.scene, camera);

      // Pass 2: white rock coverage with the depth buffer from pass 1.
      // Instance tints multiply the override material too, so detach them for
      // the mask pass; otherwise pale blue instances would fall below the
      // binary coverage threshold and silently shrink the mask.
      for (const mesh of rockMeshes) {
        if (mesh instanceof InstancedMesh && mesh.instanceColor) {
          detachedInstanceColors.push({ mesh, color: mesh.instanceColor });
          mesh.instanceColor = null;
        }
      }
      for (const mesh of rockMeshes) mesh.layers.enable(ROCK_MASK_LAYER);
      camera.layers.set(ROCK_MASK_LAYER);
      this.scene.overrideMaterial = this.rockMaskWhite;
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, camera);

      const pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      let coveredPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] > 127 && pixels[offset + 3] > 127) coveredPixels += 1;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the rock-mask 2D canvas.');
      const image = context.createImageData(width, height);
      const rowBytes = width * 4;
      for (let row = 0; row < height; row += 1) {
        const source = (height - 1 - row) * rowBytes;
        image.data.set(pixels.subarray(source, source + rowBytes), row * rowBytes);
      }
      context.putImageData(image, 0, 0);

      return {
        dataUrl: canvas.toDataURL('image/png'),
        width,
        height,
        coveredPixels,
      };
    } finally {
      this.renderer.setRenderTarget(null);
      this.scene.overrideMaterial = savedOverride;
      this.scene.background = savedBackground;
      this.renderer.setClearColor(savedClearColor, savedClearAlpha);
      this.renderer.autoClear = savedAutoClear;
      camera.layers.mask = savedLayers;
      for (let index = 0; index < rockMeshes.length; index += 1) {
        rockMeshes[index].layers.mask = savedRockLayers[index];
      }
      for (const { mesh, color } of detachedInstanceColors) {
        mesh.instanceColor = color;
      }
      for (const object of hidden) object.visible = true;
    }
  }

  private syncMediumLightingMode(): void {
    const mediumLayers = [
      'sceneFog',
      'waterAttenuation',
      'volumetricScattering',
    ] as const;
    for (const layer of mediumLayers) {
      this.medium.setLayer(
        layer,
        this.environment.lightingMode === 'full' && this.waterDebug[layer],
      );
    }
  }

  getLightingDiagnostics() {
    return {
      mode: this.environment.lightingMode,
      terrainMode: this.environment.terrainMode,
      outputColorSpace: this.renderer.outputColorSpace,
      toneMapping: this.renderer.toneMapping,
      exposure: this.renderer.toneMappingExposure,
      environmentIntensity: this.scene.environmentIntensity,
      postProcessing: false,
      lights: this.environment.lightingSnapshot,
      observationGridVisible: this.environment.observationGridVisible,
      waterEffectsVisible: this.environment.waterEffectsVisible,
      waterMediumActive: this.environment.lightingMode === 'full' && this.waterDebug.sceneFog,
      waterDebug: this.getWaterDebugState(),
      waterOpticsModel: this.waterOpticsModel,
      waterScattering: {
        model: 'layered-lit-v1',
        nearColor: UNDERWATER_MEDIUM_CONFIG.scatterNearColor,
        farColor: UNDERWATER_MEDIUM_CONFIG.scatterFarColor,
        colorDistance: UNDERWATER_MEDIUM_CONFIG.scatterColorDistance,
        surfaceColor: UNDERWATER_MEDIUM_CONFIG.surfaceScatterColor,
        surfaceStrength: UNDERWATER_MEDIUM_CONFIG.surfaceScatterStrength,
        sunColor: UNDERWATER_MEDIUM_CONFIG.sunScatterColor,
        sunStrength: UNDERWATER_MEDIUM_CONFIG.sunScatterStrength,
        anisotropy: UNDERWATER_MEDIUM_CONFIG.scatteringAnisotropy,
        domeLit: this.environment.domeScatteringActive,
      },
      caustics: {
        strength: UNDERWATER_LIGHTING_CONFIG.water.caustics.strength,
        // The live uniform: forced to 0 by ?lighting=base, Water Effects off,
        // or the Caustics debug layer off.
        effectiveStrength: this.environment.causticStrengthValue,
        color: UNDERWATER_LIGHTING_CONFIG.water.caustics.color,
        pattern: UNDERWATER_LIGHTING_CONFIG.water.caustics.pattern,
        distanceFade: UNDERWATER_LIGHTING_CONFIG.water.caustics.distanceFade,
        surfaces: UNDERWATER_LIGHTING_CONFIG.water.caustics.surfaces,
      },
      lightShafts: {
        config: UNDERWATER_LIGHTING_CONFIG.water.shafts,
        // Live gate: ?lighting=base, Water Effects off and the Light Shafts
        // debug layer off all hide the group.
        effectiveVisible: this.environment.waterEffectsVisible,
      },
      shadowMapAutoUpdate: this.renderer.shadowMap.autoUpdate,
      colorSpaceIssues: auditMaterialColorSpaces(this.scene),
      rockDebugMode: this.environment.rockDebugMode,
    };
  }

  loadGlbRocks(): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadGlbRocks());
  }

  loadGlbRockSet(): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadGlbRockSet());
  }

  loadGlbKelp(placements: readonly KelpPlacement[]): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadGlbKelp(placements));
  }

  loadGlbCorals(mode?: CoralScatterMode): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadGlbCorals(mode));
  }

  loadReefSample(): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadReefSample());
  }

  loadReefSet(): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadReefSet());
  }

  /** Actual world transforms of the loaded reef GLBs (empty before load). */
  getReefCollisionTransforms(): ReefWorldTransform[] {
    return this.environment.getReefCollisionTransforms();
  }

  loadGlbSeaweed(): Promise<boolean> {
    return this.attachAfterLoad(this.environment.loadGlbSeaweed());
  }

  private async attachAfterLoad(operation: Promise<boolean>): Promise<boolean> {
    const loaded = await operation;
    this.medium.attach(this.scene);
    return loaded;
  }

  /** Phase F render-side diagnostics; disabled by default. */
  setPerformanceTelemetryEnabled(enabled: boolean): void {
    this.renderPerformance.setEnabled(enabled);
    this.gpuTimer.setEnabled(enabled);
  }

  resetRenderPerformanceCounters(): void {
    this.renderPerformance.reset();
    this.gpuTimer.reset();
  }

  getRenderPerformanceSnapshot(): PhaseEmaSnapshot {
    return this.renderPerformance.snapshot();
  }

  /**
   * Real renderer memory/program counts and a GPU timer-query capability probe.
   * Time is never inferred: `frameMs` stays null until a disjoint query is
   * actually implemented and validated.
   */
  getRendererStats(): RendererPerformanceStats {
    const memory = this.renderer.info.memory;
    return {
      memory: memory
        ? { geometries: memory.geometries, textures: memory.textures }
        : null,
      programs: this.renderer.info.programs?.length ?? null,
      gpuTimer: this.gpuTimer.snapshot(),
    };
  }

  update(
    world: SimulationWorld,
    alpha: number,
    time: number,
    frameDelta: number,
    visualDelta = frameDelta,
    predatorDelta = visualDelta,
  ): void {
    const timings = this.renderPerformance;
    timings.beginStep();
    this.environment.setObstaclesVisible(world.config.obstaclesEnabled);
    this.fish.update(alpha, time, world.config.maxSpeed);
    timings.recordPhase('fish');
    this.clownfish?.update(alpha, time, world.clownfishConfig.maxSpeed);
    timings.recordPhase('clownfish');
    // predatorDelta is the simulated time actually stepped (steps * fixedDelta),
    // so the swim controller integrates in lockstep with the trajectory even
    // when the frame delta and the simulation step count disagree.
    this.predator.update(alpha, predatorDelta, world.config.predatorEnabled);
    timings.recordPhase('predator');
    this.grid.update(world.boids.grid);
    this.debug.update(world, alpha);
    this.collisionDebug.setMargin(world.config.obstacleMargin);
    this.collisionDebug.update(world, alpha);
    timings.recordPhase('debug');
    this.cameraController.update(world, frameDelta, alpha);
    timings.recordPhase('camera');
    this.environment.update(
      time,
      frameDelta,
      this.camera,
      this.cameraController.controls.target,
      visualDelta,
    );
    this.environment.updateSediment(world, visualDelta, time);
    if (this.environment.consumeShadowMapDirty()) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    timings.recordPhase('environment');
    this.gpuTimer.begin();
    this.renderer.render(this.scene, this.camera);
    this.gpuTimer.end();
    timings.recordPhase('draw');
    timings.endStep();
  }

  /**
   * Advance preset camera damping without drawing. Used by deterministic
   * capture automation so a settled camera costs no extra SwiftShader frames.
   */
  updateCamera(world: SimulationWorld, delta: number, alpha = 1): void {
    this.cameraController.update(world, delta, alpha);
  }

  /** Deterministic visual-clock step for the sediment capture path. */
  advanceSediment(world: SimulationWorld, delta: number, time: number): void {
    this.environment.updateSediment(world, delta, time);
  }

  resetSediment(): void {
    this.environment.resetSediment();
  }

  getSedimentDiagnostics(): ReturnType<Environment['getSedimentDiagnostics']> {
    return this.environment.getSedimentDiagnostics();
  }

  /**
   * Settle camera and camera-relative lighting together without rendering.
   * Deterministic captures switch presets instantly; without this the shared
   * rim light would still point at the previous pose for the first frame.
   */
  settleVisual(world: SimulationWorld, time: number, seconds = 1.2, frames = 12): void {
    const count = Math.max(1, Math.min(120, Math.floor(frames)));
    const delta = Math.max(0, Math.min(0.15, seconds / count));
    for (let index = 0; index < count; index += 1) {
      this.cameraController.update(world, delta, 1);
      this.environment.update(
        time,
        delta,
        this.camera,
        this.cameraController.controls.target,
        delta,
      );
    }
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
