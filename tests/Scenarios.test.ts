import { describe, expect, it } from 'vitest';
import { applyScenario, getScenario, SCENARIOS } from '../src/simulation/Scenarios';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('ecosystem scenarios', () => {
  it('defines three distinct fixed seeds and complete starting populations', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(['calm', 'encounter', 'obstacles']);
    expect(new Set(SCENARIOS.map((scenario) => scenario.seed)).size).toBe(3);
    for (const scenario of SCENARIOS) {
      const world = new SimulationWorld();
      applyScenario(world, scenario.id);
      expect(world.config.seed).toBe(scenario.seed);
      expect(world.metrics.totalSteps).toBe(scenario.warmupSteps);
      expect(world.metrics.fishCount).toBe(500);
      expect(world.boids.searchMode).toBe('grid');
    }
  }, 15000);

  it('replays the exact same state after unrelated parameter edits', () => {
    const first = new SimulationWorld();
    const second = new SimulationWorld();
    applyScenario(first, 'encounter');
    second.config.maxSpeed = 8;
    second.config.predatorAggression = 0.2;
    second.setSearchMode('brute-force');
    applyScenario(second, 'encounter');
    for (let step = 0; step < 90; step += 1) {
      first.step();
      second.step();
    }
    expect(second.flock.positions).toEqual(first.flock.positions);
    expect(second.flock.velocities).toEqual(first.flock.velocities);
    expect(second.predator.position).toEqual(first.predator.position);
    expect(second.predator.state).toBe(first.predator.state);
  }, 15000);

  it('keeps calm and navigation scenarios free of predators', () => {
    for (const id of ['calm', 'obstacles'] as const) {
      const world = new SimulationWorld();
      applyScenario(world, id);
      for (let step = 0; step < 60; step += 1) world.step();
      expect(world.config.predatorEnabled).toBe(false);
      expect(world.metrics.threatenedCount).toBe(0);
    }
    expect(getScenario('encounter').releasePredator).toBe(true);
  }, 15000);
});
