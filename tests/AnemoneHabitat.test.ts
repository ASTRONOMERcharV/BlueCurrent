import { describe, expect, it } from 'vitest';
import {
  anemoneAnchorForReef,
  anemoneAnchors,
  nearestAnemoneAnchor,
} from '../src/environment/AnemoneHabitat';
import { applyScenario } from '../src/simulation/Scenarios';
import { CLOWNFISH_SPAWN } from '../src/simulation/SimulationConfig';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';

function meanClownfishSpeed(world: SimulationWorld): number {
  const { velocities, alive, count } = world.clownfishFlock;
  let total = 0;
  let aliveCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (alive[index] === 0) continue;
    const offset = index * 3;
    total += Math.hypot(velocities[offset], velocities[offset + 1], velocities[offset + 2]);
    aliveCount += 1;
  }
  return aliveCount > 0 ? total / aliveCount : 0;
}

describe('anemone habitat anchors', () => {
  it('owns the same deterministic reef-base formula as the rendered anemone', () => {
    const anchors = anemoneAnchors(REEF_OBSTACLES);
    expect(anchors.map((anchor) => anchor.id)).toEqual([
      'anemone-b', 'anemone-c', 'anemone-hero', 'anemone-d', 'anemone-e',
    ]);
    for (let index = 0; index < REEF_OBSTACLES.length; index += 1) {
      const obstacle = REEF_OBSTACLES[index];
      const anchor = anemoneAnchorForReef(obstacle, index);
      const angle = index * 1.71 + 5 * 2.39996;
      const radial = obstacle.radius * 1.17;
      expect(anchor.x).toBeCloseTo(obstacle.center[0] + Math.cos(angle) * radial, 10);
      expect(anchor.z).toBeCloseTo(obstacle.center[2] + Math.sin(angle) * radial, 10);
      expect(anchor.hover[0]).toBeCloseTo(anchor.x, 10);
      expect(anchor.hover[2]).toBeCloseTo(anchor.z, 10);
      expect(anchor.hover[1]).toBeCloseTo(anchor.y + 5.5, 10);
    }
  });

  it('selects the anemone nearest the original clownfish spawn', () => {
    const anchors = anemoneAnchors(REEF_OBSTACLES);
    expect(nearestAnemoneAnchor(anchors, CLOWNFISH_SPAWN.center)?.id).toBe('anemone-b');
  });
});

describe('clownfish anemone habitat', () => {
  it('stays near the anchor without pinning the school', () => {
    const world = new SimulationWorld();
    applyScenario(world, 'calm');
    const initial = world.getClownfishHabitatDiagnostics();
    expect(initial.mode).toBe('anemone');
    expect(initial.anchorId).toBe('anemone-b');
    expect(initial.center).not.toBeNull();
    for (let step = 0; step < 900; step += 1) world.step();
    const habitat = world.getClownfishHabitatDiagnostics();
    expect(habitat.distance).not.toBeNull();
    expect(habitat.distance!).toBeLessThanOrEqual(4.5);
    expect(habitat.spread).toBeGreaterThanOrEqual(1.0);
    expect(meanClownfishSpeed(world)).toBeGreaterThan(0.4);
    expect(habitat.withinAttractRadius).toBeGreaterThan(0);
  }, 60000);

  it('returns to the habitat after the predator is disabled', () => {
    const world = new SimulationWorld();
    applyScenario(world, 'encounter');
    for (let step = 0; step < 600; step += 1) world.step();
    world.config.predatorEnabled = false;
    world.clownfishConfig.predatorEnabled = false;
    for (let step = 0; step < 600; step += 1) world.step();
    const habitat = world.getClownfishHabitatDiagnostics();
    expect(habitat.distance).not.toBeNull();
    expect(habitat.distance!).toBeLessThanOrEqual(8);
  }, 90000);

  it('keeps the main school identical while the clownfish habitat changes', () => {
    const anchored = new SimulationWorld();
    applyScenario(anchored, 'calm');
    const legacy = new SimulationWorld();
    legacy.setClownfishHabitatMode('legacy');
    applyScenario(legacy, 'calm');
    for (let step = 0; step < 300; step += 1) {
      anchored.step();
      legacy.step();
    }
    expect(anchored.flock.positions).toEqual(legacy.flock.positions);
    expect(anchored.clownfishFlock.positions).not.toEqual(legacy.clownfishFlock.positions);
    expect(legacy.getClownfishHabitatDiagnostics().mode).toBe('legacy');
    expect(legacy.getClownfishHabitatDiagnostics().center).toBeNull();
  }, 60000);

  it('is deterministic with the same seed and habitat', () => {
    const first = new SimulationWorld();
    const second = new SimulationWorld();
    applyScenario(first, 'calm');
    applyScenario(second, 'calm');
    for (let step = 0; step < 300; step += 1) {
      first.step();
      second.step();
    }
    expect(second.clownfishFlock.positions).toEqual(first.clownfishFlock.positions);
    expect(second.clownfishFlock.velocities).toEqual(first.clownfishFlock.velocities);
  }, 60000);
});
