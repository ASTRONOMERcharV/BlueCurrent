import { UniformGrid3D } from '../spatial/UniformGrid3D';
import { KelpRefugeField } from '../environment/KelpRefugeField';
import { generateKelpLayout } from '../rendering/kelpPlacement';
import type { KelpPlacement } from '../rendering/kelpPlacement';
import { BoidSystem } from './BoidSystem';
import { FlockData } from './FlockData';
import { FixedStepScheduler } from './FixedStepScheduler';
import { ObstacleSystem } from './ObstacleSystem';
import { PredatorSystem } from './PredatorSystem';
import {
  CLOWNFISH_SPAWN,
  DEFAULT_CLOWNFISH_COUNT,
  MAX_CLOWNFISH_COUNT,
  createClownfishConfig,
  createDefaultConfig,
} from './SimulationConfig';
import type { NeighborSearchMode, ObstacleShapeMode, SimulationConfig } from './SimulationConfig';
import type { ReefProxySet } from './ReefCollisionProxy';
import { ReefObstacleMetrics, type ReefObstacleMetricsSnapshot } from './ReefObstacleMetrics';
import { SeededRandom } from './math';

export interface SimulationMetrics {
  simulationTime: number;
  totalSteps: number;
  fishCount: number;
  clownfishCount: number;
  captures: number;
  averageNeighbors: number;
  threatenedCount: number;
  shelteredCount: number;
  radiusOfGyration: number;
  polarization: number;
  schoolCount: number;
  largestSchool: number;
  lastStepMs: number;
  averageStepMs: number;
}

export class SimulationWorld {
  readonly config: SimulationConfig = createDefaultConfig();
  readonly flock: FlockData;
  /** Independent reef-dwelling school; it shares the predator and habitat fields. */
  readonly clownfishConfig: SimulationConfig = createClownfishConfig();
  readonly clownfishFlock: FlockData;
  readonly obstacles = new ObstacleSystem();
  /** Experiment telemetry; disabled by default and never feeds back into steering. */
  readonly obstacleMetrics = new ReefObstacleMetrics();
  /** One deterministic layout shared with the renderer; never regenerated per frame. */
  readonly kelpLayout: readonly KelpPlacement[];
  readonly kelpRefuge: KelpRefugeField;
  readonly predator: PredatorSystem;
  readonly boids: BoidSystem;
  readonly clownfishBoids: BoidSystem;
  readonly scheduler: FixedStepScheduler;
  readonly center = new Float32Array(3);
  detailedMetricsEnabled = true;

  readonly metrics: SimulationMetrics = {
    simulationTime: 0,
    totalSteps: 0,
    fishCount: 0,
    clownfishCount: 0,
    captures: 0,
    averageNeighbors: 0,
    threatenedCount: 0,
    shelteredCount: 0,
    radiusOfGyration: 0,
    polarization: 0,
    schoolCount: 0,
    largestSchool: 0,
    lastStepMs: 0,
    averageStepMs: 0,
  };

  private clownfishCountValue = DEFAULT_CLOWNFISH_COUNT;
  private readonly random = new SeededRandom(this.config.seed);
  private readonly clownfishRandom = new SeededRandom(this.config.seed ^ 0x6a09e667);
  private readonly metricsGrid: UniformGrid3D;
  private readonly metricsNeighbors: Int32Array;
  private readonly parents: Int32Array;
  private readonly componentSizes: Int32Array;

  constructor(kelpLayout?: readonly KelpPlacement[]) {
    this.flock = new FlockData(this.config.maxFishCount);
    this.clownfishFlock = new FlockData(this.config.maxFishCount);
    this.kelpLayout = kelpLayout ?? generateKelpLayout(this.obstacles.definitions);
    this.kelpRefuge = new KelpRefugeField(this.kelpLayout);
    this.predator = new PredatorSystem(this.config, this.obstacles, this.kelpRefuge);
    this.obstacles.setMetrics(this.obstacleMetrics);
    this.boids = new BoidSystem(
      this.flock,
      this.config,
      this.obstacles,
      this.kelpRefuge,
      this.obstacleMetrics,
    );
    this.clownfishBoids = new BoidSystem(
      this.clownfishFlock,
      this.clownfishConfig,
      this.obstacles,
      this.kelpRefuge,
      this.obstacleMetrics,
    );
    this.scheduler = new FixedStepScheduler(this.config.fixedDelta, this.config.maxSubSteps);
    this.metricsGrid = new UniformGrid3D(this.config, this.config.maxFishCount);
    this.metricsNeighbors = new Int32Array(this.config.maxFishCount);
    this.parents = new Int32Array(this.config.maxFishCount);
    this.componentSizes = new Int32Array(this.config.maxFishCount);
    this.obstacles.setShapeMode(this.config.obstacleShapeMode);
    this.reset();
  }

  /**
   * Install the compound SDF set built from the loaded reef geometry. Until
   * this is called, `reefProxy` mode safely falls back to the sphere collider.
   */
  setReefProxies(set: ReefProxySet | undefined): void {
    this.obstacles.setProxySet(set);
    this.obstacles.setShapeMode(this.config.obstacleShapeMode);
  }

  /** Explicit experiment switch; never changes the sphere collider data. */
  setObstacleShapeMode(mode: ObstacleShapeMode): void {
    this.config.obstacleShapeMode = mode;
    this.clownfishConfig.obstacleShapeMode = mode;
    this.obstacles.setShapeMode(mode);
  }

  /** Enable the read-only reef-collider telemetry (Laboratory/experiment). */
  setObstacleMetricsEnabled(enabled: boolean): void {
    this.obstacleMetrics.enabled = enabled;
  }

  getObstacleDiagnostics(): ReefObstacleMetricsSnapshot {
    return this.obstacleMetrics.snapshot(this.obstacles, this.config);
  }

  get clownfishCount(): number {
    return this.clownfishCountValue;
  }

  /** Centroid of the reef school, used by previews and visual acceptance. */
  getClownfishCenter(): [number, number, number] {
    const { positions, count } = this.clownfishFlock;
    if (count === 0) return [0, 0, 0];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < count; i += 1) {
      x += positions[i * 3];
      y += positions[i * 3 + 1];
      z += positions[i * 3 + 2];
    }
    return [x / count, y / count, z / count];
  }

  reset(): void {
    this.random.reset(this.config.seed);
    this.flock.initialize(this.config.initialFishCount, this.config, this.random);
    this.predator.reset(this.random);
    this.clownfishRandom.reset(this.config.seed ^ 0x6a09e667);
    this.clownfishFlock.initialize(
      this.clownfishCountValue,
      this.clownfishConfig,
      this.clownfishRandom,
      CLOWNFISH_SPAWN,
    );
    this.boids.setSearchMode(this.boids.searchMode);
    this.clownfishBoids.setSearchMode(this.clownfishBoids.searchMode);
    this.scheduler.reset();
    this.metrics.simulationTime = 0;
    this.metrics.totalSteps = 0;
    this.metrics.captures = 0;
    this.metrics.lastStepMs = 0;
    this.metrics.averageStepMs = 0;
    this.boids.averageNeighbors = 0;
    this.boids.threatenedCount = 0;
    this.boids.shelteredCount = 0;
    this.boids.shelterSeekingCount = 0;
    this.obstacleMetrics.reset();
    this.computeMetrics();
    this.syncMetrics();
  }

  setFishCount(count: number): void {
    this.config.initialFishCount = Math.max(10, Math.min(this.config.maxFishCount, Math.round(count)));
    this.reset();
  }

  setClownfishCount(count: number): void {
    this.clownfishCountValue = Math.max(0, Math.min(MAX_CLOWNFISH_COUNT, Math.round(count)));
    this.clownfishRandom.reset(this.config.seed ^ 0x6a09e667);
    this.clownfishFlock.initialize(
      this.clownfishCountValue,
      this.clownfishConfig,
      this.clownfishRandom,
      CLOWNFISH_SPAWN,
    );
    this.syncMetrics();
  }

  setSearchMode(mode: NeighborSearchMode): void {
    this.boids.setSearchMode(mode);
    this.clownfishBoids.setSearchMode(mode);
  }

  releasePredator(): void {
    this.config.predatorEnabled = true;
    this.computeMetrics();
    this.predator.releaseNearSchool(this.center);
  }

  regroupSchool(): void {
    this.predator.retreat();
  }

  step(delta = this.config.fixedDelta): void {
    const started = performance.now();
    this.obstacleMetrics.beginStep(delta, this.metrics.simulationTime);
    this.flock.beginStep();
    this.boids.update(delta, this.predator);
    // The reef school shares the live predator and obstacle toggles but keeps
    // its own neighbor radii, cruise speed and habitat anchor.
    this.clownfishConfig.predatorEnabled = this.config.predatorEnabled;
    this.clownfishConfig.obstaclesEnabled = this.config.obstaclesEnabled;
    this.clownfishConfig.obstacleShapeMode = this.config.obstacleShapeMode;
    this.clownfishFlock.beginStep();
    this.clownfishBoids.update(delta, this.predator);
    this.flock.swap();
    this.clownfishFlock.swap();
    this.predator.update(delta, this.flock);
    this.obstacleMetrics.endStep(
      this.flock,
      this.clownfishFlock,
      this.obstacles,
      this.config,
      this.clownfishConfig,
    );

    this.metrics.simulationTime += delta;
    this.metrics.totalSteps += 1;
    if (this.detailedMetricsEnabled && this.metrics.totalSteps % 30 === 0) this.computeMetrics();
    this.syncMetrics();

    const elapsed = performance.now() - started;
    this.metrics.lastStepMs = elapsed;
    this.metrics.averageStepMs = this.metrics.totalSteps === 1
      ? elapsed
      : this.metrics.averageStepMs * 0.92 + elapsed * 0.08;
  }

  private syncMetrics(): void {
    this.metrics.fishCount = this.flock.aliveCount;
    this.metrics.clownfishCount = this.clownfishFlock.aliveCount;
    this.metrics.captures = this.predator.captures;
    this.metrics.averageNeighbors = this.boids.averageNeighbors;
    this.metrics.threatenedCount = this.boids.threatenedCount;
    this.metrics.shelteredCount = this.boids.shelteredCount;
  }

  private computeMetrics(): void {
    const { positions, velocities, alive, count, aliveCount } = this.flock;
    if (aliveCount === 0) {
      this.center.set([0, 10, 0]);
      this.metrics.radiusOfGyration = 0;
      this.metrics.polarization = 0;
      this.metrics.schoolCount = 0;
      this.metrics.largestSchool = 0;
      return;
    }

    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;
    let directionX = 0;
    let directionY = 0;
    let directionZ = 0;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0) continue;
      const offset = i * 3;
      centerX += positions[offset];
      centerY += positions[offset + 1];
      centerZ += positions[offset + 2];
      const speed = Math.hypot(velocities[offset], velocities[offset + 1], velocities[offset + 2]);
      if (speed > 1e-5) {
        directionX += velocities[offset] / speed;
        directionY += velocities[offset + 1] / speed;
        directionZ += velocities[offset + 2] / speed;
      }
    }
    centerX /= aliveCount;
    centerY /= aliveCount;
    centerZ /= aliveCount;
    this.center.set([centerX, centerY, centerZ]);
    this.metrics.polarization = Math.hypot(directionX, directionY, directionZ) / aliveCount;

    let radiusSquaredSum = 0;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0) continue;
      const offset = i * 3;
      radiusSquaredSum +=
        (positions[offset] - centerX) ** 2 +
        (positions[offset + 1] - centerY) ** 2 +
        (positions[offset + 2] - centerZ) ** 2;
      this.parents[i] = i;
    }
    this.metrics.radiusOfGyration = Math.sqrt(radiusSquaredSum / aliveCount);

    this.metricsGrid.rebuild(this.flock, this.config.connectionRadius);
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0) continue;
      const found = this.metricsGrid.collect(i, this.config.connectionRadius, this.metricsNeighbors);
      for (let n = 0; n < found; n += 1) {
        const other = this.metricsNeighbors[n];
        if (other > i) this.union(i, other);
      }
    }
    this.componentSizes.fill(0);
    for (let i = 0; i < count; i += 1) {
      if (alive[i] !== 0) this.componentSizes[this.root(i)] += 1;
    }
    let schools = 0;
    let largest = 0;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0 || this.root(i) !== i) continue;
      const size = this.componentSizes[i];
      largest = Math.max(largest, size);
      if (size >= 5) schools += 1;
    }
    this.metrics.schoolCount = schools;
    this.metrics.largestSchool = largest;
  }

  private root(index: number): number {
    let root = index;
    while (this.parents[root] !== root) root = this.parents[root];
    while (this.parents[index] !== index) {
      const next = this.parents[index];
      this.parents[index] = root;
      index = next;
    }
    return root;
  }

  private union(a: number, b: number): void {
    const rootA = this.root(a);
    const rootB = this.root(b);
    if (rootA !== rootB) this.parents[rootB] = rootA;
  }
}
