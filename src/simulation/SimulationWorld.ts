import { UniformGrid3D } from '../spatial/UniformGrid3D';
import { KelpRefugeField } from '../environment/KelpRefugeField';
import { anemoneAnchors, nearestAnemoneAnchor } from '../environment/AnemoneHabitat';
import type { AnemoneAnchor } from '../environment/AnemoneHabitat';
import { generateKelpLayout } from '../rendering/kelpPlacement';
import type { KelpPlacement } from '../rendering/kelpPlacement';
import { BoidSystem } from './BoidSystem';
import { FlockData } from './FlockData';
import { FixedStepScheduler } from './FixedStepScheduler';
import { ObstacleSystem } from './ObstacleSystem';
import { PredatorSystem } from './PredatorSystem';
import { PhaseEmaRecorder, type PhaseEmaSnapshot } from './PerformanceTelemetry';
import {
  CLOWNFISH_SPAWN,
  DEFAULT_CLOWNFISH_COUNT,
  MAX_CLOWNFISH_COUNT,
  createClownfishConfig,
  createDefaultConfig,
} from './SimulationConfig';
import type { NeighborSearchMode, ObstacleShapeMode, SimulationConfig, Vec3Tuple } from './SimulationConfig';
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

export interface SchoolStructureSnapshot {
  /** Monotonic counter; the tracker skips snapshots it already consumed. */
  version: number;
  simulationTime: number;
  fishCount: number;
  aliveCount: number;
  /** roots[i] is the component root for alive fish i, -1 for dead slots. */
  roots: Int32Array;
  /** sizes[root] is the component size; zero for non-roots and dead slots. */
  sizes: Int32Array;
  schools: number;
  medianSchoolSize: number;
  largestSchool: number;
  largestPolarization: number;
  startleCount: number;
  startleCentroid: [number, number, number] | null;
  startleRadius: number;
  edgePressureCount: number;
}

export interface ClownfishHabitatSnapshot {
  mode: 'anemone' | 'legacy';
  anchorId: string | null;
  center: [number, number, number] | null;
  centroid: [number, number, number];
  distance: number | null;
  withinAttractRadius: number;
  withinCoreRadius: number;
  spread: number;
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
  readonly performance = new PhaseEmaRecorder({
    exclusivePhases: ['boidsMain', 'boidsClown', 'predator', 'metrics'],
  });
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
  private clownfishHabitatMode: 'anemone' | 'legacy' = 'anemone';
  private clownfishHabitatAnchor: AnemoneAnchor | null = null;
  private readonly random = new SeededRandom(this.config.seed);
  private readonly clownfishRandom = new SeededRandom(this.config.seed ^ 0x6a09e667);
  private readonly metricsGrid: UniformGrid3D;
  private readonly metricsNeighbors: Int32Array;
  private readonly parents: Int32Array;
  private readonly componentSizes: Int32Array;
  private structureVersion = 0;
  private readonly structureRoots: Int32Array;
  private readonly structureSizes: Int32Array;
  private structureSchools = 0;
  private structureMedian = 0;
  private structureLargestPolarization = 0;
  private structureStartleCount = 0;
  private structureStartleCentroid: [number, number, number] | null = null;
  private structureStartleRadius = 0;
  private structureEdgePressureCount = 0;

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
      this.performance,
    );
    this.clownfishBoids = new BoidSystem(
      this.clownfishFlock,
      this.clownfishConfig,
      this.obstacles,
      this.kelpRefuge,
      this.obstacleMetrics,
      this.performance,
    );
    this.scheduler = new FixedStepScheduler(this.config.fixedDelta, this.config.maxSubSteps);
    this.metricsGrid = new UniformGrid3D(this.config, this.config.maxFishCount);
    this.metricsNeighbors = new Int32Array(this.config.maxFishCount);
    this.parents = new Int32Array(this.config.maxFishCount);
    this.componentSizes = new Int32Array(this.config.maxFishCount);
    this.structureRoots = new Int32Array(this.config.maxFishCount);
    this.structureSizes = new Int32Array(this.config.maxFishCount);
    this.obstacles.setShapeMode(this.config.obstacleShapeMode);
    this.setClownfishHabitatMode('anemone');
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

  /** Phase F diagnostics; gated so the default step path is unchanged. */
  setPerformanceTelemetryEnabled(enabled: boolean): void {
    this.performance.setEnabled(enabled);
  }

  resetPerformanceCounters(): void {
    this.performance.reset();
  }

  getPerformanceSnapshot(): PhaseEmaSnapshot {
    return this.performance.snapshot();
  }

  /** Toggle the Phase E2 local-rule terms for both schools (same-version A/B). */
  setSchoolDynamicsEnabled(enabled: boolean): void {
    this.config.schoolDynamicsEnabled = enabled;
    this.clownfishConfig.schoolDynamicsEnabled = enabled;
  }

  /** Read-only school-component telemetry for the observation UI and captures. */
  getSchoolStructureSnapshot(): SchoolStructureSnapshot {
    const count = this.flock.count;
    return {
      version: this.structureVersion,
      simulationTime: this.metrics.simulationTime,
      fishCount: this.metrics.fishCount,
      aliveCount: this.flock.aliveCount,
      roots: this.structureRoots.slice(0, count),
      sizes: this.structureSizes.slice(0, count),
      schools: this.structureSchools,
      medianSchoolSize: this.structureMedian,
      largestSchool: this.metrics.largestSchool,
      largestPolarization: this.structureLargestPolarization,
      startleCount: this.structureStartleCount,
      startleCentroid: this.structureStartleCentroid
        ? [this.structureStartleCentroid[0], this.structureStartleCentroid[1], this.structureStartleCentroid[2]]
        : null,
      startleRadius: this.structureStartleRadius,
      edgePressureCount: this.structureEdgePressureCount,
    };
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

  /**
   * Same-version A/B for the E4 habitat. `legacy` falls back to the old point
   * home; `anemone` anchors the school above the nearest reef-base anemone.
   * Call before the next reset/scenario application.
   */
  setClownfishHabitatMode(mode: 'anemone' | 'legacy'): void {
    this.clownfishHabitatMode = mode;
    if (mode === 'legacy') {
      this.clownfishHabitatAnchor = null;
      delete this.clownfishConfig.habitatCenter;
      return;
    }
    const nearest = nearestAnemoneAnchor(
      anemoneAnchors(this.obstacles.definitions),
      CLOWNFISH_SPAWN.center,
    );
    this.clownfishHabitatAnchor = nearest;
    if (nearest) {
      this.clownfishConfig.habitatCenter = [
        nearest.hover[0],
        nearest.hover[1],
        nearest.hover[2],
      ] as Vec3Tuple;
    }
  }

  /** Read-only anemone-habitat telemetry from live clownfish positions. */
  getClownfishHabitatDiagnostics(): ClownfishHabitatSnapshot {
    const centroid = this.getClownfishCenter();
    const center = this.clownfishConfig.habitatCenter;
    const spread = this.clownfishSpread(centroid);
    if (!center) {
      return {
        mode: this.clownfishHabitatMode,
        anchorId: this.clownfishHabitatAnchor?.id ?? null,
        center: null,
        centroid,
        distance: null,
        withinAttractRadius: 0,
        withinCoreRadius: 0,
        spread,
      };
    }
    const dx = center[0] - centroid[0];
    const dy = center[1] - centroid[1];
    const dz = center[2] - centroid[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const attractRadius = this.clownfishConfig.habitatAttractRadius ?? 3.4;
    const coreRadius = this.clownfishConfig.habitatCoreRadius ?? 1.1;
    const { positions, count, alive } = this.clownfishFlock;
    let withinAttract = 0;
    let withinCore = 0;
    for (let index = 0; index < count; index += 1) {
      if (alive[index] === 0) continue;
      const offset = index * 3;
      const fx = positions[offset] - center[0];
      const fy = positions[offset + 1] - center[1];
      const fz = positions[offset + 2] - center[2];
      const fishDistance = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (fishDistance <= attractRadius) withinAttract += 1;
      if (fishDistance <= coreRadius) withinCore += 1;
    }
    return {
      mode: this.clownfishHabitatMode,
      anchorId: this.clownfishHabitatAnchor?.id ?? null,
      center: [center[0], center[1], center[2]],
      centroid,
      distance,
      withinAttractRadius: withinAttract,
      withinCoreRadius: withinCore,
      spread,
    };
  }

  private clownfishSpread(centroid: readonly [number, number, number]): number {
    const { positions, count, alive } = this.clownfishFlock;
    let total = 0;
    let aliveCount = 0;
    for (let index = 0; index < count; index += 1) {
      if (alive[index] === 0) continue;
      const offset = index * 3;
      total += (positions[offset] - centroid[0]) ** 2
        + (positions[offset + 1] - centroid[1]) ** 2
        + (positions[offset + 2] - centroid[2]) ** 2;
      aliveCount += 1;
    }
    return aliveCount > 0 ? Math.sqrt(total / aliveCount) : 0;
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
    this.performance.reset();
    this.metrics.schoolCount = 0;
    this.metrics.largestSchool = 0;
    this.structureVersion += 1;
    this.structureRoots.fill(-1);
    this.structureSizes.fill(0);
    this.structureSchools = 0;
    this.structureMedian = 0;
    this.structureLargestPolarization = 0;
    this.structureStartleCount = 0;
    this.structureStartleCentroid = null;
    this.structureStartleRadius = 0;
    this.structureEdgePressureCount = 0;
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
    this.performance.beginStep();
    this.obstacleMetrics.beginStep(delta, this.metrics.simulationTime);
    this.flock.beginStep();
    this.boids.update(delta, this.predator);
    this.performance.recordPhase('boidsMain');
    // The reef school shares the live predator and obstacle toggles but keeps
    // its own neighbor radii, cruise speed and habitat anchor.
    this.clownfishConfig.predatorEnabled = this.config.predatorEnabled;
    this.clownfishConfig.obstaclesEnabled = this.config.obstaclesEnabled;
    this.clownfishConfig.obstacleShapeMode = this.config.obstacleShapeMode;
    this.clownfishFlock.beginStep();
    this.clownfishBoids.update(delta, this.predator);
    this.performance.recordPhase('boidsClown');
    this.flock.swap();
    this.clownfishFlock.swap();
    this.predator.update(delta, this.flock);
    this.performance.recordPhase('predator');
    this.obstacleMetrics.endStep(
      this.flock,
      this.clownfishFlock,
      this.obstacles,
      this.config,
      this.clownfishConfig,
    );

    this.metrics.simulationTime += delta;
    this.metrics.totalSteps += 1;
    if (this.detailedMetricsEnabled && this.metrics.totalSteps % 30 === 0) {
      this.performance.beginPhase();
      this.computeMetrics();
      this.performance.recordPhase('metrics');
    }
    this.syncMetrics();

    const elapsed = performance.now() - started;
    this.performance.endStep(elapsed);
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
    const { positions, velocities, alive, count, aliveCount, fear } = this.flock;
    this.structureVersion += 1;
    if (aliveCount === 0) {
      this.center.set([0, 10, 0]);
      this.metrics.radiusOfGyration = 0;
      this.metrics.polarization = 0;
      this.metrics.schoolCount = 0;
      this.metrics.largestSchool = 0;
      this.structureRoots.fill(-1);
      this.structureSizes.fill(0);
      this.structureSchools = 0;
      this.structureMedian = 0;
      this.structureLargestPolarization = 0;
      this.structureStartleCount = 0;
      this.structureStartleCentroid = null;
      this.structureStartleRadius = 0;
      this.structureEdgePressureCount = 0;
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
    this.structureRoots.fill(-1);
    for (let i = 0; i < count; i += 1) {
      if (alive[i] !== 0) {
        const root = this.root(i);
        this.componentSizes[root] += 1;
        this.structureRoots[i] = root;
      }
    }
    const schoolSizes: number[] = [];
    let largest = 0;
    let largestRoot = -1;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0 || this.root(i) !== i) continue;
      const size = this.componentSizes[i];
      if (size > largest) {
        largest = size;
        largestRoot = i;
      }
      if (size >= 5) schoolSizes.push(size);
    }
    schoolSizes.sort((first, second) => first - second);
    const schools = schoolSizes.length;
    this.metrics.schoolCount = schools;
    this.metrics.largestSchool = largest;
    this.structureSchools = schools;
    this.structureMedian = schoolSizes.length > 0
      ? schoolSizes[Math.floor((schoolSizes.length - 1) / 2)]
      : 0;

    let largestDirectionX = 0;
    let largestDirectionY = 0;
    let largestDirectionZ = 0;
    if (largestRoot >= 0) {
      for (let i = 0; i < count; i += 1) {
        if (alive[i] === 0 || this.structureRoots[i] !== largestRoot) continue;
        const offset = i * 3;
        const speed = Math.hypot(
          velocities[offset], velocities[offset + 1], velocities[offset + 2],
        );
        if (speed > 1e-5) {
          largestDirectionX += velocities[offset] / speed;
          largestDirectionY += velocities[offset + 1] / speed;
          largestDirectionZ += velocities[offset + 2] / speed;
        }
      }
    }
    this.structureLargestPolarization = largest > 0
      ? Math.hypot(largestDirectionX, largestDirectionY, largestDirectionZ) / largest
      : 0;

    let startleCount = 0;
    let startleX = 0;
    let startleY = 0;
    let startleZ = 0;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0 || fear[i] < 0.35) continue;
      const offset = i * 3;
      startleCount += 1;
      startleX += positions[offset];
      startleY += positions[offset + 1];
      startleZ += positions[offset + 2];
    }
    this.structureStartleCount = startleCount;
    if (startleCount > 0) {
      startleX /= startleCount;
      startleY /= startleCount;
      startleZ /= startleCount;
      let startleRadiusSquared = 0;
      for (let i = 0; i < count; i += 1) {
        if (alive[i] === 0 || fear[i] < 0.35) continue;
        const offset = i * 3;
        startleRadiusSquared +=
          (positions[offset] - startleX) ** 2 +
          (positions[offset + 1] - startleY) ** 2 +
          (positions[offset + 2] - startleZ) ** 2;
      }
      this.structureStartleCentroid = [startleX, startleY, startleZ];
      this.structureStartleRadius = Math.sqrt(startleRadiusSquared / startleCount);
    } else {
      this.structureStartleCentroid = null;
      this.structureStartleRadius = 0;
    }

    const bounds = this.config.bounds;
    const marginX = Math.min(
      this.config.boundaryMargin, (bounds.max[0] - bounds.min[0]) * 0.45,
    );
    const marginY = Math.min(
      this.config.boundaryMargin, (bounds.max[1] - bounds.min[1]) * 0.45,
    );
    const marginZ = Math.min(
      this.config.boundaryMargin, (bounds.max[2] - bounds.min[2]) * 0.45,
    );
    let edgePressure = 0;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0) continue;
      const offset = i * 3;
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      if (
        x - bounds.min[0] < marginX || bounds.max[0] - x < marginX
        || y - bounds.min[1] < marginY || bounds.max[1] - y < marginY
        || z - bounds.min[2] < marginZ || bounds.max[2] - z < marginZ
      ) {
        edgePressure += 1;
      }
    }
    this.structureEdgePressureCount = edgePressure;
    for (let i = 0; i < count; i += 1) {
      this.structureSizes[i] = alive[i] === 0 ? 0 : this.componentSizes[this.structureRoots[i]];
    }
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
