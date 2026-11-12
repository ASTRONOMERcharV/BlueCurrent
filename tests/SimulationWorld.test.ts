import { describe, expect, it } from 'vitest';
import { FixedStepScheduler } from '../src/simulation/FixedStepScheduler';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('FixedStepScheduler', () => {
  it('uses fixed deltas, reports interpolation and caps catch-up work', () => {
    const scheduler = new FixedStepScheduler(0.04, 2);
    const deltas: number[] = [];
    // advance() deliberately clamps a single incoming frame delta to 150 ms.
    const result = scheduler.advance(1.4, (delta) => deltas.push(delta));
    expect(deltas).toEqual([0.04, 0.04]);
    expect(result.steps).toBe(2);
    expect(result.droppedSteps).toBe(1);
    expect(result.alpha).toBeCloseTo(0.75);
  });

  it('does not integrate negative time and resets its accumulator', () => {
    const scheduler = new FixedStepScheduler(1 / 60, 8);
    let steps = 0;
    scheduler.advance(-1, () => { steps += 1; });
    expect(steps).toBe(0);
    scheduler.advance(0.1, () => { steps += 1; });
    scheduler.reset();
    scheduler.advance(0, () => { steps += 1; });
    expect(steps).toBe(6);
  });
});

describe('SimulationWorld', () => {
  it('is deterministic for the same seed and configuration', () => {
    const first = new SimulationWorld();
    const second = new SimulationWorld();
    first.setFishCount(120);
    second.setFishCount(120);
    for (let step = 0; step < 120; step += 1) {
      first.step();
      second.step();
    }
    expect(first.flock.positions).toEqual(second.flock.positions);
    expect(first.flock.velocities).toEqual(second.flock.velocities);
    expect(first.predator.position).toEqual(second.predator.position);
    // Wall-clock timings are measurements, not deterministic simulation state.
    const { lastStepMs: _firstLast, averageStepMs: _firstAverage, ...firstMetrics } = first.metrics;
    const { lastStepMs: _secondLast, averageStepMs: _secondAverage, ...secondMetrics } = second.metrics;
    expect(firstMetrics).toEqual(secondMetrics);
  });

  it('shares equivalent behavior between grid and brute-force searches', () => {
    const gridWorld = new SimulationWorld();
    const bruteWorld = new SimulationWorld();
    gridWorld.config.predatorEnabled = false;
    bruteWorld.config.predatorEnabled = false;
    gridWorld.setFishCount(150);
    bruteWorld.setFishCount(150);
    bruteWorld.setSearchMode('brute-force');
    gridWorld.step();
    bruteWorld.step();

    expect(gridWorld.metrics.averageNeighbors).toBeCloseTo(bruteWorld.metrics.averageNeighbors, 5);
    for (let i = 0; i < gridWorld.flock.count * 3; i += 1) {
      expect(Math.abs(gridWorld.flock.positions[i] - bruteWorld.flock.positions[i])).toBeLessThan(1e-5);
      expect(Math.abs(gridWorld.flock.velocities[i] - bruteWorld.flock.velocities[i])).toBeLessThan(1e-5);
    }
  });

  it('keeps all live fish finite, inside the water and outside reef colliders', () => {
    const world = new SimulationWorld();
    world.setFishCount(250);
    for (let step = 0; step < 360; step += 1) world.step();

    for (let i = 0; i < world.flock.count; i += 1) {
      if (world.flock.alive[i] === 0) continue;
      const offset = i * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const position = world.flock.positions[offset + axis];
        expect(Number.isFinite(position)).toBe(true);
        expect(Number.isFinite(world.flock.velocities[offset + axis])).toBe(true);
        expect(position).toBeGreaterThanOrEqual(world.config.bounds.min[axis]);
        expect(position).toBeLessThanOrEqual(world.config.bounds.max[axis]);
      }
      for (const obstacle of world.obstacles.definitions) {
        const distance = Math.hypot(
          world.flock.positions[offset] - obstacle.center[0],
          world.flock.positions[offset + 1] - obstacle.center[1],
          world.flock.positions[offset + 2] - obstacle.center[2],
        );
        expect(distance).toBeGreaterThanOrEqual(obstacle.radius + 0.279);
      }
    }
  });

  it('executes real pursuit and capture, reducing the live population', () => {
    const world = new SimulationWorld();
    world.setFishCount(20);
    world.config.maxSpeed = 4;
    world.config.predatorAggression = 1.5;
    world.releasePredator();
    for (let step = 0; step < 1500 && world.metrics.captures === 0; step += 1) world.step();
    expect(world.metrics.captures).toBeGreaterThan(0);
    expect(world.flock.aliveCount).toBe(20 - world.metrics.captures);
  });

  it('clears the evasion response when the predator is disabled', () => {
    const world = new SimulationWorld();
    world.setFishCount(100);
    world.releasePredator();
    for (let step = 0; step < 120 && world.metrics.threatenedCount === 0; step += 1) world.step();
    expect(world.metrics.threatenedCount).toBeGreaterThan(0);
    world.config.predatorEnabled = false;
    world.step();
    expect(world.metrics.threatenedCount).toBe(0);
    expect(world.flock.fear.every((value) => value === 0)).toBe(true);
  });
});
