import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyScenario, type ScenarioId } from '../src/simulation/Scenarios';
import type { SimulationConfig } from '../src/simulation/SimulationConfig';
import type { SimulationWorld } from '../src/simulation/SimulationWorld';

interface SpatialSnapshot {
  step: number;
  simulationTime: number;
  fishCount: number;
  averageNeighbors: number;
  averageSeparationNeighbors: number;
  averageAlignmentNeighbors: number;
  radiusOfGyration: number;
  polarization: number;
  schoolCount: number;
  largestSchool: number;
  threatenedCount: number;
  captures: number;
  nearestDistance: { minimum: number; p05: number; median: number };
  standardDeviation: [number, number, number];
  minimumColliderClearance: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

function snapshot(world: SimulationWorld): SpatialSnapshot {
  const { flock } = world;
  const nearest = new Float64Array(flock.count);
  nearest.fill(Number.POSITIVE_INFINITY);
  let separationNeighbors = 0;
  let alignmentNeighbors = 0;
  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;
  let minimumColliderClearance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < flock.count; i += 1) {
    if (flock.alive[i] === 0) continue;
    const offset = i * 3;
    const x = flock.positions[offset];
    const y = flock.positions[offset + 1];
    const z = flock.positions[offset + 2];
    centerX += x;
    centerY += y;
    centerZ += z;
    for (const obstacle of world.obstacles.definitions) {
      const clearance = Math.hypot(x - obstacle.center[0], y - obstacle.center[1], z - obstacle.center[2])
        - obstacle.radius;
      minimumColliderClearance = Math.min(minimumColliderClearance, clearance);
    }
    for (let j = i + 1; j < flock.count; j += 1) {
      if (flock.alive[j] === 0) continue;
      const otherOffset = j * 3;
      const distance = Math.hypot(
        x - flock.positions[otherOffset],
        y - flock.positions[otherOffset + 1],
        z - flock.positions[otherOffset + 2],
      );
      nearest[i] = Math.min(nearest[i], distance);
      nearest[j] = Math.min(nearest[j], distance);
      if (distance <= world.config.separationRadius) separationNeighbors += 2;
      if (distance <= world.config.alignmentRadius) alignmentNeighbors += 2;
    }
  }

  const aliveCount = Math.max(1, flock.aliveCount);
  centerX /= aliveCount;
  centerY /= aliveCount;
  centerZ /= aliveCount;
  let varianceX = 0;
  let varianceY = 0;
  let varianceZ = 0;
  const finiteNearest: number[] = [];
  for (let i = 0; i < flock.count; i += 1) {
    if (flock.alive[i] === 0) continue;
    const offset = i * 3;
    varianceX += (flock.positions[offset] - centerX) ** 2;
    varianceY += (flock.positions[offset + 1] - centerY) ** 2;
    varianceZ += (flock.positions[offset + 2] - centerZ) ** 2;
    if (Number.isFinite(nearest[i])) finiteNearest.push(nearest[i]);
  }
  finiteNearest.sort((a, b) => a - b);

  return {
    step: world.metrics.totalSteps,
    simulationTime: world.metrics.simulationTime,
    fishCount: flock.aliveCount,
    averageNeighbors: world.metrics.averageNeighbors,
    averageSeparationNeighbors: separationNeighbors / aliveCount,
    averageAlignmentNeighbors: alignmentNeighbors / aliveCount,
    radiusOfGyration: world.metrics.radiusOfGyration,
    polarization: world.metrics.polarization,
    schoolCount: world.metrics.schoolCount,
    largestSchool: world.metrics.largestSchool,
    threatenedCount: world.metrics.threatenedCount,
    captures: world.metrics.captures,
    nearestDistance: {
      minimum: finiteNearest[0] ?? 0,
      p05: percentile(finiteNearest, 0.05),
      median: percentile(finiteNearest, 0.5),
    },
    standardDeviation: [
      Math.sqrt(varianceX / aliveCount),
      Math.sqrt(varianceY / aliveCount),
      Math.sqrt(varianceZ / aliveCount),
    ],
    minimumColliderClearance: Number.isFinite(minimumColliderClearance) ? minimumColliderClearance : 0,
  };
}

function advance(world: SimulationWorld, steps: number, every = 60): SpatialSnapshot[] {
  const samples: SpatialSnapshot[] = [];
  for (let step = 0; step < steps; step += 1) {
    world.step();
    if ((step + 1) % every === 0) samples.push(snapshot(world));
  }
  return samples;
}

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const output = resolve(outputArgument?.slice('--output='.length)
  ?? 'test-artifacts/visual-quality-v1/behavior-latest.json');
function numberArgument(name: string): number | undefined {
  const argument = process.argv.find((candidate) => candidate.startsWith(`--${name}=`));
  if (!argument) return undefined;
  const value = Number(argument.slice(name.length + 3));
  if (!Number.isFinite(value)) throw new Error(`Invalid --${name} value.`);
  return value;
}
const densityTarget = numberArgument('cohesion-density-target');
const densityMinScale = numberArgument('cohesion-density-min-scale');
const alignmentRadius = numberArgument('alignment-radius');
const cohesionRadius = numberArgument('cohesion-radius');
const boundaryMargin = numberArgument('boundary-margin');
const maxTurnRate = numberArgument('max-turn-rate');
const overrides: Partial<SimulationConfig> = {};
if (densityTarget !== undefined) overrides.cohesionDensityTarget = densityTarget;
if (densityMinScale !== undefined) overrides.cohesionDensityMinScale = densityMinScale;
if (alignmentRadius !== undefined) overrides.alignmentRadius = alignmentRadius;
if (cohesionRadius !== undefined) overrides.cohesionRadius = cohesionRadius;
if (boundaryMargin !== undefined) overrides.boundaryMargin = boundaryMargin;
if (maxTurnRate !== undefined) overrides.maxTurnRate = maxTurnRate;
const report: Record<string, unknown> = {
  note: 'Fixed-seed CPU simulation measurements. No FPS, GPU-time or visual-acceptance claim.',
  generatedAt: new Date().toISOString(),
  overrides,
  scenarios: {},
};

for (const id of ['calm', 'encounter', 'obstacles'] as const satisfies readonly ScenarioId[]) {
  const { SimulationWorld } = await import('../src/simulation/SimulationWorld');
  const world = new SimulationWorld();
  const scenario = applyScenario(world, id, overrides);
  const initial = snapshot(world);
  const pursuit = advance(world, id === 'encounter' ? 360 : 600);
  let recovery: SpatialSnapshot[] = [];
  if (id === 'encounter') {
    world.regroupSchool();
    world.config.predatorEnabled = false;
    recovery = advance(world, 600);
  }
  (report.scenarios as Record<string, unknown>)[id] = {
    seed: scenario.seed,
    warmupSteps: scenario.warmupSteps,
    config: {
      separationRadius: world.config.separationRadius,
      alignmentRadius: world.config.alignmentRadius,
      cohesionRadius: world.config.cohesionRadius,
      separationWeight: world.config.separationWeight,
      alignmentWeight: world.config.alignmentWeight,
      cohesionWeight: world.config.cohesionWeight,
      cohesionDensityTarget: world.config.cohesionDensityTarget,
      cohesionDensityMinScale: world.config.cohesionDensityMinScale,
      minSpeed: world.config.minSpeed,
      maxSpeed: world.config.maxSpeed,
      maxAcceleration: world.config.maxAcceleration,
      maxTurnRate: world.config.maxTurnRate,
      boundaryMargin: world.config.boundaryMargin,
      evasionWeight: world.config.evasionWeight,
      evasionRadius: world.config.evasionRadius,
      evasionPredictionTime: world.config.evasionPredictionTime,
      evasionLateralWeight: world.config.evasionLateralWeight,
      fearPropagation: world.config.fearPropagation,
    },
    initial,
    pursuit,
    recovery,
  };
  console.log(`${id}: ${initial.averageNeighbors.toFixed(2)} neighbors, Rg ${initial.radiusOfGyration.toFixed(2)} m`);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${output}`);
