import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('BoidSystem debug sample', () => {
  it('records real neighbors without changing the selected fish trajectory', () => {
    const sampled = new SimulationWorld();
    const baseline = new SimulationWorld();
    sampled.config.predatorEnabled = false;
    baseline.config.predatorEnabled = false;
    sampled.boids.debugFishIndex = 0;
    for (let step = 0; step < 30; step += 1) {
      sampled.step();
      baseline.step();
    }
    expect(sampled.flock.positions).toEqual(baseline.flock.positions);
    expect(sampled.boids.debugSample.index).toBe(0);
    expect(sampled.boids.debugSample.neighborCount).toBeGreaterThan(0);
    for (let index = 0; index < sampled.boids.debugSample.neighborCount; index += 1) {
      const neighbor = sampled.boids.debugSample.neighbors[index];
      expect(neighbor).not.toBe(0);
      expect(sampled.flock.alive[neighbor]).toBe(1);
    }
  });

  it('stores the weighted component forces rather than a velocity approximation', () => {
    const world = new SimulationWorld();
    world.config.predatorEnabled = false;
    world.config.separationWeight = 0;
    world.config.alignmentWeight = 0;
    world.config.cohesionWeight = 0;
    world.boids.debugFishIndex = 0;
    world.step();
    for (const force of [
      world.boids.debugSample.separation,
      world.boids.debugSample.alignment,
      world.boids.debugSample.cohesion,
    ]) {
      expect(Array.from(force)).toHaveLength(3);
      for (const component of force) expect(component).toBeCloseTo(0, 10);
    }
  });
});
