import { mkdirSync, writeFileSync } from 'node:fs';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { applyScenario } from '../src/simulation/Scenarios';
import {
  buildReefProxySet,
  eulerYXZMatrix,
  type ReefCollisionProxy,
  type ReefWorldTransform,
} from '../src/simulation/ReefCollisionProxy';
import { REEF_NEAR_LOCAL_SIZE } from '../src/simulation/reefCollisionProxySpecs';
import { REEF_VARIANT_SPECS } from '../src/rendering/reefVariantSpecs';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import type { ObstacleShapeMode } from '../src/simulation/SimulationConfig';

/**
 * Fixed-seed Sphere vs ReefProxy comparison for Experiment A.
 *
 * Usage: npx tsx scripts/reef-collision-experiment.ts [--mode=sphere|reefProxy|both]
 *        [--out=test-artifacts/reef-collision/experiment.json]
 *
 * The 150-step Encounter warm-up always uses the sphere collider, matching the
 * browser boot order (scenario applied before the reef GLBs finish loading).
 * Both modes therefore start from an identical state at t=0 of the measured run.
 */

const TIMES = [17, 43, 52, 60, 63] as const;
const OBSTACLE_CENTERS: Record<string, readonly [number, number, number]> = {
  b: [-7, 3.4, -3],
  c: [5, 3.5, 4],
  hero: [0, 3.6, -9],
  d: [11, 3.2, -7],
  e: [-12, 3.4, 9],
};

function buildTransforms(): ReefWorldTransform[] {
  return REEF_VARIANT_SPECS
    .map((spec): ReefWorldTransform => {
      const localSize = REEF_NEAR_LOCAL_SIZE[spec.id];
      const center = OBSTACLE_CENTERS[spec.id];
      return {
        id: spec.id,
        anchorIndex: spec.anchorIndex,
        position: [
          center[0],
          floorHeightAt(center[0], center[2]) - spec.embedDepth,
          center[2],
        ],
        yaw: (spec.yawDegrees * Math.PI) / 180,
        tiltX: (spec.tiltXDegrees * Math.PI) / 180,
        tiltZ: (spec.tiltZDegrees * Math.PI) / 180,
        scale: [
          spec.targetWidth / localSize[0],
          spec.targetHeight / localSize[1],
          spec.targetDepth / localSize[2],
        ],
        localSize,
      };
    })
    .sort((a, b) => a.anchorIndex - b.anchorIndex);
}

function checksumFloats(hash: number, values: Float32Array): number {
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
  for (let offset = 0; offset < values.byteLength; offset += 4) {
    hash = Math.imul(hash ^ view.getUint32(offset, true), 0x01000193) >>> 0;
  }
  return hash;
}

function checksumFlock(flock: SimulationWorld['flock']): string {
  let hash = Math.imul(0x811c9dc5 ^ flock.count, 0x01000193) >>> 0;
  hash = Math.imul(hash ^ flock.aliveCount, 0x01000193) >>> 0;
  hash = checksumFloats(hash, flock.positions.subarray(0, flock.count * 3));
  hash = checksumFloats(hash, flock.velocities.subarray(0, flock.count * 3));
  for (let index = 0; index < flock.count; index += 1) {
    hash = Math.imul(hash ^ flock.alive[index], 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}`;
}

function worldChecksum(world: SimulationWorld): string {
  const fish = checksumFlock(world.flock);
  const clownfish = checksumFlock(world.clownfishFlock);
  let combined = Math.imul(0x811c9dc5 ^ world.metrics.totalSteps, 0x01000193) >>> 0;
  combined = Math.imul(combined ^ world.metrics.captures, 0x01000193) >>> 0;
  combined = checksumFloats(combined, world.predator.position);
  combined = checksumFloats(combined, world.predator.velocity);
  return `${fish}${clownfish}${(combined >>> 0).toString(16).padStart(8, '0')}`;
}

function inverseTransform(
  transform: ReefWorldTransform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const rotation = eulerYXZMatrix(transform.yaw, transform.tiltX, transform.tiltZ);
  const dx = x - transform.position[0];
  const dy = y - transform.position[1];
  const dz = z - transform.position[2];
  const lx = rotation[0] * dx + rotation[3] * dy + rotation[6] * dz;
  const ly = rotation[1] * dx + rotation[4] * dy + rotation[7] * dz;
  const lz = rotation[2] * dx + rotation[5] * dy + rotation[8] * dz;
  return [
    lx / transform.scale[0],
    ly / transform.scale[1],
    lz / transform.scale[2],
  ];
}

function proxyTopAtAnchor(proxy: ReefCollisionProxy, transform: ReefWorldTransform): number {
  const [x, , z] = transform.position;
  let top = transform.position[1];
  for (let y = transform.position[1]; y < transform.position[1] + 15; y += 0.02) {
    if (proxy.distance(x, y, z) <= 0) top = y;
  }
  return top;
}

interface CheckpointAnalysis {
  readonly perReef: Array<{
    id: string;
    proxyTopY: number;
    oldSphereTopY: number;
    minFishClearance: number;
    fishInsideProxy: number;
    fishInOpenedSphereSpace: number;
  }>;
  readonly heroFishAboveOldSphereTop: number;
  readonly twinGapClearance: number;
  readonly twinGapNearbyFish: number;
  readonly schoolCount: number;
  readonly clownfishCount: number;
}

function analyzeCheckpoint(
  world: SimulationWorld,
  transforms: readonly ReefWorldTransform[],
  proxies: ReturnType<typeof buildReefProxySet>,
): CheckpointAnalysis {
  const perReef = proxies.proxies.map((proxy, index) => ({
    id: proxy.id,
    proxyTopY: proxyTopAtAnchor(proxy, transforms[index]),
    oldSphereTopY: world.obstacles.definitions[index].center[1]
      + world.obstacles.definitions[index].radius,
    minFishClearance: Number.POSITIVE_INFINITY,
    fishInsideProxy: 0,
    fishInOpenedSphereSpace: 0,
  }));
  let heroFishAboveOldSphereTop = 0;
  let twinGapNearbyFish = 0;
  const dTransform = transforms.find((transform) => transform.id === 'd')!;
  const dProxy = proxies.proxies.find((proxy) => proxy.id === 'd')!;
  const dRotation = eulerYXZMatrix(dTransform.yaw, dTransform.tiltX, dTransform.tiltZ);
  const gapLocal = [0.21 * (dTransform.localSize[0] / 2), 1.5, 0];
  const gapWorld = [
    dTransform.position[0]
      + dRotation[0] * gapLocal[0] * dTransform.scale[0]
      + dRotation[1] * gapLocal[1] * dTransform.scale[1],
    dTransform.position[1]
      + dRotation[3] * gapLocal[0] * dTransform.scale[0]
      + dRotation[4] * gapLocal[1] * dTransform.scale[1],
    dTransform.position[2]
      + dRotation[6] * gapLocal[0] * dTransform.scale[0]
      + dRotation[7] * gapLocal[1] * dTransform.scale[1],
  ];
  const twinGapClearance = dProxy.distance(gapWorld[0], gapWorld[1], gapWorld[2]);

  const visit = (flock: SimulationWorld['flock']): void => {
    const { positions, alive, count } = flock;
    for (let fish = 0; fish < count; fish += 1) {
      if (alive[fish] === 0) continue;
      const offset = fish * 3;
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      for (let index = 0; index < proxies.proxies.length; index += 1) {
        const proxy = proxies.proxies[index];
        const definition = world.obstacles.definitions[index];
        const distance = proxy.distance(x, y, z);
        if (distance < perReef[index].minFishClearance) {
          perReef[index].minFishClearance = distance;
        }
        if (distance < 0) perReef[index].fishInsideProxy += 1;
        const dx = x - definition.center[0];
        const dy = y - definition.center[1];
        const dz = z - definition.center[2];
        if (distance > 0.1 && dx * dx + dy * dy + dz * dz < definition.radius * definition.radius) {
          perReef[index].fishInOpenedSphereSpace += 1;
        }
      }
      const hero = world.obstacles.definitions[2];
      const heroDx = x - hero.center[0];
      const heroDz = z - hero.center[2];
      if (y > hero.center[1] + hero.radius && heroDx * heroDx + heroDz * heroDz < 3 * 3) {
        heroFishAboveOldSphereTop += 1;
      }
      const [lx, ly, lz] = inverseTransform(dTransform, x, y, z);
      const gapDx = x - gapWorld[0];
      const gapDy = y - gapWorld[1];
      const gapDz = z - gapWorld[2];
      if (lx > 0.06 && lx < 0.48 && ly > 0.8 && ly < 2.2 && lz > -0.3 && lz < 0.3) {
        twinGapNearbyFish += 1;
      } else if (gapDx * gapDx + gapDy * gapDy + gapDz * gapDz < 4) {
        twinGapNearbyFish += 1;
      }
    }
  };
  visit(world.flock);
  visit(world.clownfishFlock);
  for (const entry of perReef) {
    if (!Number.isFinite(entry.minFishClearance)) entry.minFishClearance = Number.NaN;
  }
  return {
    perReef,
    heroFishAboveOldSphereTop,
    twinGapClearance,
    twinGapNearbyFish,
    schoolCount: world.metrics.fishCount,
    clownfishCount: world.metrics.clownfishCount,
  };
}

interface ModeRun {
  readonly mode: ObstacleShapeMode;
  readonly deterministic: boolean | null;
  readonly wallMs: number;
  readonly checkpoints: Record<string, {
    checksum: string;
    analysis: CheckpointAnalysis;
    metrics: ReturnType<SimulationWorld['getObstacleDiagnostics']>;
  }>;
}

function runMode(mode: ObstacleShapeMode, transforms: readonly ReefWorldTransform[]): ModeRun {
  const started = performance.now();
  const world = new SimulationWorld();
  applyScenario(world, 'encounter');
  const proxies = buildReefProxySet(transforms);
  world.setReefProxies(proxies);
  world.setObstacleShapeMode(mode);
  world.setObstacleMetricsEnabled(true);
  const checkpoints: ModeRun['checkpoints'] = {};
  for (const time of TIMES) {
    const expectedSteps = Math.round(time * 60);
    while (world.metrics.totalSteps < expectedSteps) world.step();
    checkpoints[time.toFixed(2)] = {
      checksum: worldChecksum(world),
      analysis: analyzeCheckpoint(world, transforms, proxies),
      metrics: world.getObstacleDiagnostics(),
    };
  }
  return {
    mode,
    deterministic: null,
    wallMs: performance.now() - started,
    checkpoints,
  };
}

const modeArgument = process.argv.find((value) => value.startsWith('--mode='));
const requestedMode = modeArgument?.slice('--mode='.length) ?? 'both';
const outArgument = process.argv.find((value) => value.startsWith('--out='));
const outputPath = outArgument?.slice('--out='.length)
  ?? 'test-artifacts/reef-collision/experiment.json';

const transforms = buildTransforms();
const modes: ObstacleShapeMode[] = requestedMode === 'both'
  ? ['sphere', 'reefProxy']
  : [requestedMode as ObstacleShapeMode];
const runs = modes.map((mode) => runMode(mode, transforms));
const verify = process.argv.includes('--verify');
const rerun = verify ? modes.map((mode) => runMode(mode, transforms)) : [];
for (let index = 0; index < runs.length; index += 1) {
  if (!rerun[index]) continue;
  // Wall-clock query timings differ between runs; determinism is defined by
  // the simulation checksums (positions, velocities, alive mask, predator),
  // exactly like scripts/simulation-regression.ts.
  const deterministic = TIMES.every((time) => (
    runs[index].checkpoints[time.toFixed(2)].checksum
    === rerun[index].checkpoints[time.toFixed(2)].checksum
  ));
  runs[index] = { ...runs[index], deterministic };
}

mkdirSync('test-artifacts/reef-collision', { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({
  scenario: 'encounter',
  times: TIMES,
  fishCount: 500,
  clownfishCount: 100,
  obstacleShapeMode: requestedMode,
  transforms,
  runs,
  rerunMatches: verify ? runs.map((run) => run.deterministic) : null,
}, null, 2)}\n`);

for (const run of runs) {
  console.log(`\n=== ${run.mode} (wall ${run.wallMs.toFixed(0)} ms) ===`);
  for (const time of TIMES) {
    const checkpoint = run.checkpoints[time.toFixed(2)];
    const totals = checkpoint.metrics.totals;
    console.log(
      `${time.toFixed(2)}s ${checkpoint.checksum} ` +
      `pen=${totals.proxyPenetrationCount} deep=${totals.deepPenetrationDuration.toFixed(3)} ` +
      `false=${totals.falseAvoidanceCount} avgF=${totals.averageObstacleForce.toFixed(2)} ` +
      `p95F=${totals.p95ObstacleForce.toFixed(2)} stuck=${totals.stuckFishCount} ` +
      `query=${checkpoint.metrics.obstacleQueryTime.averageStepMs.toFixed(3)}ms`,
    );
    console.log(
      `   passages ${checkpoint.metrics.passages.map((gate) => `${gate.id}:${gate.count}`).join(' ')} ` +
      `| heroAbove=${checkpoint.analysis.heroFishAboveOldSphereTop} ` +
      `twinGap=${checkpoint.analysis.twinGapClearance.toFixed(2)}m/${checkpoint.analysis.twinGapNearbyFish}fish`,
    );
    console.log(
      `   perReef ${checkpoint.metrics.reefs.map((reef) => (
        `${reef.id}:min=${Number.isFinite(reef.minFishClearance) ? reef.minFishClearance.toFixed(2) : 'N/A'},` +
        `open=${checkpoint.analysis.perReef.find((entry) => entry.id === reef.id)?.fishInOpenedSphereSpace ?? 0}`
      )).join(' ')}`,
    );
  }
}
console.log(`\nwrote ${outputPath}`);
