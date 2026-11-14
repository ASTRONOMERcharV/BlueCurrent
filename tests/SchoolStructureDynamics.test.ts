import { describe, expect, it } from 'vitest';
import {
  alignmentAgreementWeight,
  densityAwareSeparationScale,
  propagatedFear,
} from '../src/simulation/BoidSystem';
import { addBoundaryForce } from '../src/simulation/EnvironmentForces';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';
import { applyScenario } from '../src/simulation/Scenarios';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

const PRE_E2_CHECKSUM = '535bf8835258bcf1b2e9e696';
const PRE_E2_FISH_CHECKSUM = '535bf883';

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
  return hash.toString(16).padStart(8, '0');
}

function combinedChecksum(world: SimulationWorld): string {
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
  return `${fish}${clownfish}${(combined >>> 0).toString(16).padStart(8, '0')}`;
}

describe('E2 school-structure terms', () => {
  it('weights alignment by heading agreement', () => {
    expect(alignmentAgreementWeight(1)).toBeCloseTo(1, 10);
    expect(alignmentAgreementWeight(0)).toBeCloseTo(0.5, 10);
    expect(alignmentAgreementWeight(-1)).toBeCloseTo(0, 10);
    expect(alignmentAgreementWeight(4)).toBeCloseTo(1, 10);
    expect(alignmentAgreementWeight(-4)).toBeCloseTo(0, 10);
  });

  it('boosts separation only above the density target and caps it', () => {
    const config = createDefaultConfig();
    expect(densityAwareSeparationScale(0, config)).toBe(1);
    expect(densityAwareSeparationScale(config.cohesionDensityTarget, config)).toBe(1);
    expect(densityAwareSeparationScale(config.cohesionDensityTarget * 2, config))
      .toBeCloseTo(1 + config.separationDensityBoost, 8);
    expect(densityAwareSeparationScale(1_000_000, config)).toBeCloseTo(1.6, 8);
    const legacy = { ...config, schoolDynamicsEnabled: false };
    expect(densityAwareSeparationScale(1_000_000, legacy)).toBe(1);
  });

  it('gates startle propagation by a noise floor and keeps legacy plain', () => {
    const config = createDefaultConfig();
    expect(propagatedFear(0.01, config)).toBe(0);
    expect(propagatedFear(0.5, config)).toBeCloseTo(0.5 * config.fearPropagation, 10);
    const legacy = { ...config, schoolDynamicsEnabled: false };
    expect(propagatedFear(0.01, legacy)).toBeCloseTo(0.01 * config.fearPropagation, 10);
  });

  it('keeps the normal boundary component and boosts only the tangential share at fear', () => {
    const config = createDefaultConfig();
    const calm = new Float32Array(3);
    const scared = new Float32Array(3);
    // x = 0 keeps the tangential term out of z, so z is the pure normal force.
    addBoundaryForce(0, 10, -18, config, calm, 0);
    addBoundaryForce(0, 10, -18, config, scared, 0.8);
    expect(scared[2]).toBeCloseTo(calm[2], 10);
    expect(Math.abs(scared[0])).toBeGreaterThan(Math.abs(calm[0]));
  });
});

describe('E2 deterministic effect', () => {
  it('reproduces the pre-E2 encounter checksum when both new systems are legacy', () => {
    const world = new SimulationWorld();
    world.setSchoolDynamicsEnabled(false);
    world.setClownfishHabitatMode('legacy');
    applyScenario(world, 'encounter');
    while (world.metrics.totalSteps < 1020) world.step();
    expect(checksumFlock(world.flock)).toBe(PRE_E2_FISH_CHECKSUM);
    expect(combinedChecksum(world)).toBe(PRE_E2_CHECKSUM);
  }, 60000);

  it('changes the encounter trajectory but stays deterministic with the terms on', () => {
    const first = new SimulationWorld();
    applyScenario(first, 'encounter');
    while (first.metrics.totalSteps < 600) first.step();
    const second = new SimulationWorld();
    applyScenario(second, 'encounter');
    while (second.metrics.totalSteps < 600) second.step();
    expect(combinedChecksum(second)).toBe(combinedChecksum(first));
    const legacy = new SimulationWorld();
    legacy.setSchoolDynamicsEnabled(false);
    applyScenario(legacy, 'encounter');
    while (legacy.metrics.totalSteps < 600) legacy.step();
    expect(combinedChecksum(first)).not.toBe(combinedChecksum(legacy));
  }, 60000);
});

describe('school-structure telemetry', () => {
  it('exposes component sizes consistent with the roots array', () => {
    const world = new SimulationWorld();
    applyScenario(world, 'encounter');
    while (world.metrics.totalSteps < 120) world.step();
    const snapshot = world.getSchoolStructureSnapshot();
    expect(snapshot.roots.length).toBe(snapshot.fishCount);
    expect(snapshot.sizes.length).toBe(snapshot.fishCount);
    let alive = 0;
    let schools = 0;
    let largest = 0;
    for (let index = 0; index < snapshot.fishCount; index += 1) {
      const root = snapshot.roots[index];
      if (root < 0) continue;
      alive += 1;
      expect(snapshot.sizes[root]).toBeGreaterThanOrEqual(1);
    }
    for (let index = 0; index < snapshot.fishCount; index += 1) {
      if (snapshot.roots[index] !== index) continue;
      const size = snapshot.sizes[index];
      if (size >= 5) schools += 1;
      largest = Math.max(largest, size);
    }
    expect(alive).toBe(snapshot.aliveCount);
    expect(snapshot.schools).toBe(schools);
    expect(snapshot.largestSchool).toBe(largest);
    expect(snapshot.medianSchoolSize).toBeGreaterThanOrEqual(0);
    expect(snapshot.largestPolarization).toBeGreaterThanOrEqual(0);
    expect(snapshot.largestPolarization).toBeLessThanOrEqual(1);
    expect(snapshot.startleCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.edgePressureCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.version).toBeGreaterThan(0);
  }, 30000);
});
