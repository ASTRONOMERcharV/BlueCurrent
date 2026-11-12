import type { ObstacleDefinition, ObstacleSystem } from './ObstacleSystem';
import type { FlockData } from './FlockData';
import type { ObstacleShapeMode, SimulationConfig } from './SimulationConfig';
import { REEF_PROXY_SPECS } from './reefCollisionProxySpecs';
import { createReefProxyQueryResult } from './ReefCollisionProxy';

/**
 * Read-only experiment telemetry for the reef colliders.
 *
 * Everything here observes the simulation; nothing feeds back into steering,
 * forces, positions or the fixed-step checksum. `obstacleQueryTime` is CPU time
 * spent inside the obstacle queries, never a GPU frame-time claim.
 *
 * Definitions:
 * - proxyPenetrationCount: fish whose pre-projection position was inside a
 *   collider at the end of a step (the safety projection then pushes them out).
 * - deepPenetrationDuration: fish-seconds with pre-projection depth < −0.25 m.
 * - falseAvoidanceCount: avoidance force applied to a fish whose true reef
 *   proxy surface distance is already beyond obstacleMargin. Expected zero in
 *   reefProxy mode; exposes the sphere over-coverage in sphere mode.
 * - average/p95ObstacleForce: magnitude of the per-reef avoidance contribution
 *   before the global acceleration clamp, sampled per fish per step.
 * - passageThroughput: gate crossings per simulated minute for the four main
 *   channels between neighbouring reefs.
 * - stuckFishCount: fish with speed < 0.5 m/s inside a margin band for > 2 s.
 */

const REEF_COUNT = 5;
const FORCE_BIN_COUNT = 64;
const FORCE_BIN_MAX = 40;
const FORCE_BIN_WIDTH = FORCE_BIN_MAX / FORCE_BIN_COUNT;
const DEEP_PENETRATION_DEPTH = 0.25;
const STUCK_SPEED = 0.5;
const STUCK_DURATION = 2;

export interface ReefObstacleReefMetrics {
  readonly id: string;
  readonly label: string;
  readonly anchorIndex: number;
  readonly proxyPenetrationCount: number;
  readonly deepPenetrationDuration: number;
  readonly falseAvoidanceCount: number;
  readonly averageObstacleForce: number;
  readonly p95ObstacleForce: number;
  readonly stuckFishCount: number;
  readonly forceSampleCount: number;
  /** Minimum post-step signed distance to this reef over the run. */
  readonly minFishClearance: number;
}

export interface ReefPassageMetrics {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly perMinute: number;
}

export interface ReefObstacleMetricsSnapshot {
  readonly enabled: boolean;
  readonly shapeMode: ObstacleShapeMode;
  readonly proxyAvailable: boolean;
  readonly simulationTime: number;
  readonly reefs: ReefObstacleReefMetrics[];
  readonly totals: {
    readonly proxyPenetrationCount: number;
    readonly deepPenetrationDuration: number;
    readonly falseAvoidanceCount: number;
    readonly averageObstacleForce: number;
    readonly p95ObstacleForce: number;
    readonly stuckFishCount: number;
    readonly forceSampleCount: number;
  };
  readonly passages: ReefPassageMetrics[];
  readonly obstacleQueryTime: {
    readonly lastStepMs: number;
    readonly averageStepMs: number;
    readonly totalMs: number;
  };
  readonly schools: {
    readonly schoolStuckFishCount: number;
    readonly clownfishStuckFishCount: number;
  };
}

interface PassageGate {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly midX: number;
  readonly midY: number;
  readonly midZ: number;
  readonly axisX: number;
  readonly axisZ: number;
  readonly lateralX: number;
  readonly lateralZ: number;
  readonly halfWidth: number;
  readonly minY: number;
  readonly maxY: number;
}

function percentileFromBins(bins: Uint32Array, total: number, offset: number): number {
  if (total === 0) return Number.NaN;
  const target = Math.ceil(total * 0.95);
  let cumulative = 0;
  for (let bin = 0; bin < FORCE_BIN_COUNT; bin += 1) {
    cumulative += bins[offset + bin];
    if (cumulative >= target) {
      return Math.min(FORCE_BIN_MAX, (bin + 1) * FORCE_BIN_WIDTH);
    }
  }
  return FORCE_BIN_MAX;
}

export class ReefObstacleMetrics {
  enabled = false;
  private readonly reefIds = REEF_PROXY_SPECS.map((spec) => spec.id);
  private readonly reefLabels = REEF_PROXY_SPECS.map((spec) => spec.label);
  private readonly penetration = new Uint32Array(REEF_COUNT);
  private readonly deepSeconds = new Float64Array(REEF_COUNT);
  private readonly falseAvoidance = new Uint32Array(REEF_COUNT);
  private readonly forceCounts = new Uint32Array(REEF_COUNT);
  private readonly forceSums = new Float64Array(REEF_COUNT);
  private readonly forceBins = new Uint32Array(REEF_COUNT * FORCE_BIN_COUNT);
  private readonly stuckNow = new Uint32Array(REEF_COUNT);
  private readonly minClearance = new Float64Array(REEF_COUNT);
  private readonly gates: PassageGate[] = [];
  private passageCounts = new Uint32Array(0);
  private schoolStuckTimers = new Float32Array(0);
  private clownfishStuckTimers = new Float32Array(0);
  private schoolStuckCount = 0;
  private clownfishStuckCount = 0;
  private stepDelta = 0;
  private simulationTime = 0;
  private queryStepMs = 0;
  private queryLastStepMs = 0;
  private queryTotalMs = 0;
  private querySteps = 0;
  private gatesInitialized = false;

  get proxyPenetrationTotal(): number {
    let total = 0;
    for (let index = 0; index < REEF_COUNT; index += 1) total += this.penetration[index];
    return total;
  }

  reset(): void {
    this.penetration.fill(0);
    this.deepSeconds.fill(0);
    this.falseAvoidance.fill(0);
    this.forceCounts.fill(0);
    this.forceSums.fill(0);
    this.forceBins.fill(0);
    this.stuckNow.fill(0);
    this.minClearance.fill(Infinity);
    this.passageCounts.fill(0);
    this.schoolStuckTimers.fill(0);
    this.clownfishStuckTimers.fill(0);
    this.schoolStuckCount = 0;
    this.clownfishStuckCount = 0;
    this.stepDelta = 0;
    this.simulationTime = 0;
    this.queryStepMs = 0;
    this.queryLastStepMs = 0;
    this.queryTotalMs = 0;
    this.querySteps = 0;
  }

  beginStep(delta: number, simulationTime: number): void {
    this.stepDelta = delta;
    this.simulationTime = simulationTime;
    this.queryStepMs = 0;
    this.stuckNow.fill(0);
  }

  addQueryTime(milliseconds: number): void {
    if (!this.enabled) return;
    this.queryStepMs += milliseconds;
  }

  recordForce(reefIndex: number, magnitude: number): void {
    if (!this.enabled || reefIndex < 0 || reefIndex >= REEF_COUNT) return;
    const clamped = Math.max(0, Math.min(FORCE_BIN_MAX - 1e-4, magnitude));
    const bin = Math.min(FORCE_BIN_COUNT - 1, Math.floor(clamped / FORCE_BIN_WIDTH));
    this.forceCounts[reefIndex] += 1;
    this.forceSums[reefIndex] += magnitude;
    this.forceBins[reefIndex * FORCE_BIN_COUNT + bin] += 1;
  }

  recordPenetration(reefIndex: number, depth: number): void {
    if (!this.enabled || reefIndex < 0 || reefIndex >= REEF_COUNT) return;
    this.penetration[reefIndex] += 1;
    if (depth <= -DEEP_PENETRATION_DEPTH) {
      this.deepSeconds[reefIndex] += this.stepDelta;
    }
  }

  recordFalseAvoidance(reefIndex: number): void {
    if (!this.enabled || reefIndex < 0 || reefIndex >= REEF_COUNT) return;
    this.falseAvoidance[reefIndex] += 1;
  }

  /**
   * End-of-step read-only sampling: force quota was recorded during steering,
   * penetration during the safety projection; here we sample passages and
   * stuck fish from the final positions.
   */
  endStep(
    flock: FlockData,
    clownfish: FlockData,
    obstacles: ObstacleSystem,
    config: SimulationConfig,
    clownfishConfig: SimulationConfig,
  ): void {
    this.queryLastStepMs = this.queryStepMs;
    this.queryTotalMs += this.queryStepMs;
    this.querySteps += 1;
    if (!this.enabled) return;
    this.ensureGates(obstacles.definitions);
    this.samplePassages(flock);
    this.samplePassages(clownfish);
    this.sampleStuck(flock, obstacles, config, 0);
    this.sampleStuck(clownfish, obstacles, clownfishConfig, 1);
  }

  snapshot(
    obstacles: ObstacleSystem,
    config: SimulationConfig,
  ): ReefObstacleMetricsSnapshot {
    const reefs: ReefObstacleReefMetrics[] = [];
    let penetrationTotal = 0;
    let deepTotal = 0;
    let falseTotal = 0;
    let forceSampleTotal = 0;
    let forceSumTotal = 0;
    const combinedBins = new Uint32Array(FORCE_BIN_COUNT);
    for (let index = 0; index < REEF_COUNT; index += 1) {
      const count = this.forceCounts[index];
      const sum = this.forceSums[index];
      for (let bin = 0; bin < FORCE_BIN_COUNT; bin += 1) {
        combinedBins[bin] += this.forceBins[index * FORCE_BIN_COUNT + bin];
      }
      penetrationTotal += this.penetration[index];
      deepTotal += this.deepSeconds[index];
      falseTotal += this.falseAvoidance[index];
      forceSampleTotal += count;
      forceSumTotal += sum;
      reefs.push({
        id: this.reefIds[index],
        label: this.reefLabels[index],
        anchorIndex: index,
        proxyPenetrationCount: this.penetration[index],
        deepPenetrationDuration: this.deepSeconds[index],
        falseAvoidanceCount: this.falseAvoidance[index],
        averageObstacleForce: count > 0 ? sum / count : Number.NaN,
        p95ObstacleForce: percentileFromBins(this.forceBins, count, index * FORCE_BIN_COUNT),
        stuckFishCount: this.stuckNow[index],
        forceSampleCount: count,
        minFishClearance: Number.isFinite(this.minClearance[index])
          ? this.minClearance[index]
          : Number.NaN,
      });
    }
    const minutes = this.simulationTime > 0 ? this.simulationTime / 60 : 0;
    const passages: ReefPassageMetrics[] = this.gates.map((gate, index) => {
      const count = this.passageCounts[index] ?? 0;
      return {
        id: gate.id,
        from: gate.from,
        to: gate.to,
        count,
        perMinute: minutes > 0 ? count / minutes : Number.NaN,
      };
    });
    return {
      enabled: this.enabled,
      shapeMode: config.obstacleShapeMode,
      proxyAvailable: obstacles.proxyActive,
      simulationTime: this.simulationTime,
      reefs,
      totals: {
        proxyPenetrationCount: penetrationTotal,
        deepPenetrationDuration: deepTotal,
        falseAvoidanceCount: falseTotal,
        averageObstacleForce: forceSampleTotal > 0 ? forceSumTotal / forceSampleTotal : Number.NaN,
        p95ObstacleForce: percentileFromBins(combinedBins, forceSampleTotal, 0),
        stuckFishCount: this.schoolStuckCount + this.clownfishStuckCount,
        forceSampleCount: forceSampleTotal,
      },
      passages,
      obstacleQueryTime: {
        lastStepMs: this.queryLastStepMs,
        averageStepMs: this.querySteps > 0 ? this.queryTotalMs / this.querySteps : Number.NaN,
        totalMs: this.queryTotalMs,
      },
      schools: {
        schoolStuckFishCount: this.schoolStuckCount,
        clownfishStuckFishCount: this.clownfishStuckCount,
      },
    };
  }

  private ensureGates(definitions: readonly ObstacleDefinition[]): void {
    if (this.gatesInitialized) return;
    const pairs: ReadonlyArray<readonly [number, number, string, string, string]> = [
      [0, 1, 'b-c', 'B', 'C'],
      [1, 2, 'c-hero', 'C', 'Hero'],
      [2, 3, 'hero-d', 'Hero', 'D'],
      [0, 2, 'b-hero', 'B', 'Hero'],
    ];
    for (const [fromIndex, toIndex, id, from, to] of pairs) {
      const a = definitions[fromIndex];
      const b = definitions[toIndex];
      if (!a || !b) continue;
      const dx = b.center[0] - a.center[0];
      const dz = b.center[2] - a.center[2];
      const distance = Math.sqrt(dx * dx + dz * dz) || 1;
      const axisX = dx / distance;
      const axisZ = dz / distance;
      this.gates.push({
        id,
        from,
        to,
        midX: (a.center[0] + b.center[0]) / 2,
        midY: (a.center[1] + b.center[1]) / 2,
        midZ: (a.center[2] + b.center[2]) / 2,
        axisX,
        axisZ,
        lateralX: -axisZ,
        lateralZ: axisX,
        halfWidth: Math.max(4, distance * 0.5),
        minY: 0.5,
        maxY: 18,
      });
    }
    this.passageCounts = new Uint32Array(this.gates.length);
    this.gatesInitialized = true;
  }

  private samplePassages(flock: FlockData): void {
    const { positions, previousPositions, alive, count } = flock;
    for (let fish = 0; fish < count; fish += 1) {
      if (alive[fish] === 0) continue;
      const offset = fish * 3;
      const px = previousPositions[offset];
      const py = previousPositions[offset + 1];
      const pz = previousPositions[offset + 2];
      const cx = positions[offset];
      const cy = positions[offset + 1];
      const cz = positions[offset + 2];
      for (let gateIndex = 0; gateIndex < this.gates.length; gateIndex += 1) {
        const gate = this.gates[gateIndex];
        const previousSide = (px - gate.midX) * gate.axisX + (pz - gate.midZ) * gate.axisZ;
        const currentSide = (cx - gate.midX) * gate.axisX + (cz - gate.midZ) * gate.axisZ;
        if (previousSide === 0 || currentSide === 0 || previousSide * currentSide > 0) continue;
        const denominator = previousSide - currentSide;
        const t = denominator !== 0 ? previousSide / denominator : 0;
        const crossingX = px + (cx - px) * t;
        const crossingY = py + (cy - py) * t;
        const crossingZ = pz + (cz - pz) * t;
        const lateral = (crossingX - gate.midX) * gate.lateralX
          + (crossingZ - gate.midZ) * gate.lateralZ;
        if (Math.abs(lateral) > gate.halfWidth) continue;
        if (crossingY < gate.minY || crossingY > gate.maxY) continue;
        this.passageCounts[gateIndex] += 1;
      }
    }
  }

  private sampleStuck(
    flock: FlockData,
    obstacles: ObstacleSystem,
    config: SimulationConfig,
    school: number,
  ): void {
    if (!config.obstaclesEnabled) return;
    const { positions, velocities, alive, count, capacity } = flock;
    let timers = school === 0 ? this.schoolStuckTimers : this.clownfishStuckTimers;
    if (timers.length !== capacity) {
      timers = new Float32Array(capacity);
      if (school === 0) this.schoolStuckTimers = timers;
      else this.clownfishStuckTimers = timers;
    }
    const margin = config.obstacleMargin;
    let stuck = 0;
    for (let fish = 0; fish < count; fish += 1) {
      if (alive[fish] === 0) {
        timers[fish] = 0;
        continue;
      }
      const offset = fish * 3;
      const hit = this.nearestDistance(
        obstacles,
        config.obstacleShapeMode,
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      );
      if (hit.index >= 0 && hit.index < REEF_COUNT && hit.distance < this.minClearance[hit.index]) {
        this.minClearance[hit.index] = hit.distance;
      }
      const speed = Math.sqrt(
        velocities[offset] * velocities[offset]
        + velocities[offset + 1] * velocities[offset + 1]
        + velocities[offset + 2] * velocities[offset + 2],
      );
      if (speed >= STUCK_SPEED) {
        timers[fish] = 0;
        continue;
      }
      if (hit.distance >= margin) {
        timers[fish] = 0;
        continue;
      }
      timers[fish] += this.stepDelta;
      if (timers[fish] >= STUCK_DURATION) {
        stuck += 1;
        if (hit.index >= 0 && hit.index < REEF_COUNT) this.stuckNow[hit.index] += 1;
      }
    }
    if (school === 0) this.schoolStuckCount = stuck;
    else this.clownfishStuckCount = stuck;
  }

  private nearestDistance(
    obstacles: ObstacleSystem,
    mode: ObstacleShapeMode,
    x: number,
    y: number,
    z: number,
  ): { index: number; distance: number } {
    const proxySet = obstacles.getProxySet();
    if (mode === 'reefProxy' && proxySet) {
      const result = this.queryScratch;
      proxySet.queryNearest(x, y, z, result);
      return { index: result.index, distance: result.distance };
    }
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    const definitions = obstacles.definitions;
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];
      const dx = x - definition.center[0];
      const dy = y - definition.center[1];
      const dz = z - definition.center[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) - definition.radius;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    return { index: nearestIndex, distance: nearestDistance };
  }

  private readonly queryScratch = createReefProxyQueryResult();
}
