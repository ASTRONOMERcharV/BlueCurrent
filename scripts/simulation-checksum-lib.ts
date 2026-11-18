import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { applyScenario } from '../src/simulation/Scenarios';

/** The encounter checkpoints used by the Phase F regression and docs. */
export const ENCOUNTER_TIMES = [17, 43, 52, 60, 63] as const;

/** D026 E2/E4 dynamic encounter checksums at ENCOUNTER_TIMES. */
export const D026_DYNAMIC_CHECKSUMS: Readonly<Record<string, string>> = {
  '17.00': '8a4ebd8073cc884fa5621e60',
  '43.00': '69d993ea1f7a467566b1e394',
  '52.00': '251d7c0f66ffc470ef667eab',
  '60.00': '937cdfef29cd2a9c2b21ac48',
  '63.00': '42e406513e0b960cd0c4c5e5',
};

/** Pre-E2 checksum reproduced with `?schoolDynamics=legacy` + `?habitat=legacy`. */
export const PRE_E2_FISH_CHECKSUM = '535bf883';
export const PRE_E2_CHECKSUM = '535bf8835258bcf1b2e9e696';

export interface EncounterSnapshot {
  simulationTime: number;
  totalSteps: number;
  seed: number;
  fishChecksum: string;
  clownfishChecksum: string;
  aliveCount: number;
  clownfishAliveCount: number;
  captures: number;
  predatorState: string;
  predatorPosition: number[];
  predatorVelocity: number[];
  kelpRefugeEnabled: boolean;
  checksum: string;
}

export type EncounterStates = Record<string, EncounterSnapshot>;

export interface EncounterOptions {
  times?: readonly number[];
  legacySchoolDynamics?: boolean;
  legacyHabitat?: boolean;
}

export function checksumFloats(hash: number, values: Float32Array): number {
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
  for (let offset = 0; offset < values.byteLength; offset += 4) {
    hash = Math.imul(hash ^ view.getUint32(offset, true), 0x01000193) >>> 0;
  }
  return hash;
}

export function checksumFlock(flock: {
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

export function combinedChecksum(world: SimulationWorld): string {
  const predatorHash = world.predator.state
    .split('')
    .reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
  let combined = Math.imul(0x811c9dc5 ^ world.metrics.totalSteps, 0x01000193) >>> 0;
  combined = Math.imul(combined ^ world.metrics.captures, 0x01000193) >>> 0;
  combined = checksumFloats(combined, world.predator.position);
  combined = checksumFloats(combined, world.predator.velocity);
  combined = Math.imul(combined ^ predatorHash, 0x01000193) >>> 0;
  return (combined >>> 0).toString(16).padStart(8, '0');
}

export function snapshot(world: SimulationWorld): EncounterSnapshot {
  const fishChecksum = checksumFlock(world.flock);
  const clownfishChecksum = checksumFlock(world.clownfishFlock);
  return {
    simulationTime: world.metrics.simulationTime,
    totalSteps: world.metrics.totalSteps,
    seed: world.config.seed,
    fishChecksum,
    clownfishChecksum,
    aliveCount: world.flock.aliveCount,
    clownfishAliveCount: world.clownfishFlock.aliveCount,
    captures: world.metrics.captures,
    predatorState: world.predator.state,
    predatorPosition: Array.from(world.predator.position),
    predatorVelocity: Array.from(world.predator.velocity),
    kelpRefugeEnabled: world.kelpRefuge.enabled,
    checksum: `${fishChecksum}${clownfishChecksum}${combinedChecksum(world)}`,
  };
}

/**
 * Replay the canonical encounter state. The default times and flags match
 * scripts/simulation-regression.ts and the Phase E checksum baseline.
 */
export function runEncounterStates(options: EncounterOptions = {}): EncounterStates {
  const world = new SimulationWorld();
  if (options.legacySchoolDynamics) world.setSchoolDynamicsEnabled(false);
  if (options.legacyHabitat) world.setClownfishHabitatMode('legacy');
  applyScenario(world, 'encounter');
  const times = options.times ?? ENCOUNTER_TIMES;
  const states: EncounterStates = {};
  for (const time of times) {
    const expectedSteps = Math.round(time * 60);
    while (world.metrics.totalSteps < expectedSteps) world.step();
    states[time.toFixed(2)] = snapshot(world);
  }
  return states;
}
