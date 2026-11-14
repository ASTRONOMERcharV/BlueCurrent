import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { applyScenario } from '../src/simulation/Scenarios';

/**
 * Headless fixed-step regression baseline for the visual world-continuity
 * phase. It imports only simulation modules (never rendering), runs the same
 * Encounter seed/warm-up as the browser capture, and emits the same state
 * checksum shape as `window.__blueCurrent.getSimulationSnapshot()`.
 *
 * Usage: npx tsx scripts/simulation-regression.ts
 *        npx tsx scripts/simulation-regression.ts --compare <artifact-dir>
 */

const times = [17, 43, 52, 60, 63];
const output = process.argv.find((value) => value.startsWith('--out='))
  ?.slice('--out='.length)
  ?? 'test-artifacts/world-continuity-p1/simulation-headless.json';
const legacy = process.argv.includes('--school-dynamics=legacy');
const legacyHabitat = process.argv.includes('--habitat=legacy');

function checksumFloats(hash: number, values: Float32Array): number {
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
  for (let offset = 0; offset < values.byteLength; offset += 4) {
    hash = Math.imul(hash ^ view.getUint32(offset, true), 0x01000193) >>> 0;
  }
  return hash;
}

function checksumFlock(flock: {
  count: number;
  aliveCount: number;
  positions: Float32Array;
  velocities: Float32Array;
  alive: Uint8Array;
}): string {
  let hash = Math.imul(0x811c9dc5 ^ flock.count, 0x01000193) >>> 0;
  hash = Math.imul(hash ^ flock.aliveCount, 0x01000193) >>> 0;
  hash = checksumFloats(hash, flock.positions.subarray(0, flock.count * 3));
  hash = checksumFloats(hash, flock.velocities.subarray(0, flock.count * 3));
  for (let index = 0; index < flock.count; index += 1) {
    hash = Math.imul(hash ^ flock.alive[index], 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}`;
}

function snapshot(world: SimulationWorld): Record<string, unknown> {
  const fish = checksumFlock(world.flock);
  const clownfish = checksumFlock(world.clownfishFlock);
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
    fishChecksum: fish,
    clownfishChecksum: clownfish,
    aliveCount: world.flock.aliveCount,
    clownfishAliveCount: world.clownfishFlock.aliveCount,
    captures: world.metrics.captures,
    predatorState: world.predator.state,
    predatorPosition: Array.from(world.predator.position),
    predatorVelocity: Array.from(world.predator.velocity),
    kelpRefugeEnabled: world.kelpRefuge.enabled,
    checksum: `${fish}${clownfish}${(combined >>> 0).toString(16).padStart(8, '0')}`,
  };
}

function runOnce(): Record<string, Record<string, unknown>> {
  const world = new SimulationWorld();
  if (legacy) world.setSchoolDynamicsEnabled(false);
  if (legacyHabitat) world.setClownfishHabitatMode('legacy');
  applyScenario(world, 'encounter');
  const states: Record<string, Record<string, unknown>> = {};
  for (const time of times) {
    const expectedSteps = Math.round(time * 60);
    while (world.metrics.totalSteps < expectedSteps) world.step();
    states[time.toFixed(2)] = snapshot(world);
  }
  return states;
}

const first = runOnce();
const second = runOnce();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  scenario: 'encounter',
  times,
  deterministic: JSON.stringify(first) === JSON.stringify(second),
  states: first,
}, null, 2)}\n`);
console.log(`deterministic=${JSON.stringify(first) === JSON.stringify(second)}`);
for (const time of times) {
  console.log(`${time.toFixed(2)}s`, first[time.toFixed(2)].checksum, 'alive', first[time.toFixed(2)].aliveCount);
}

const compareArgument = process.argv.find((value) => value.startsWith('--compare='));
if (compareArgument) {
  const directory = compareArgument.slice('--compare='.length);
  let failures = 0;
  for (const time of times) {
    const path = `${directory}/state-t${time.toFixed(2)}.json`;
    if (!existsSync(path)) {
      console.log(`missing ${path}`);
      failures += 1;
      continue;
    }
    const browser = JSON.parse(readFileSync(path, 'utf8')) as { checksum: string };
    const node = first[time.toFixed(2)].checksum as string;
    const match = browser.checksum === node;
    console.log(`${time.toFixed(2)}s browser=${browser.checksum} node=${node} ${match ? 'MATCH' : 'MISMATCH'}`);
    if (!match) failures += 1;
  }
  if (failures > 0) process.exitCode = 1;
}
