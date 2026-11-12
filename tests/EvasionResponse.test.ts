import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

describe('obstacle line of sight', () => {
  it('blocks segments that cross a reef sphere and leaves the rest clear', () => {
    const world = new SimulationWorld();
    const [obstacle] = world.obstacles.definitions;
    const [cx, cy, cz] = obstacle.center;
    const radius = obstacle.radius;
    expect(world.obstacles.blocksSegment(
      cx - radius * 3, cy, cz,
      cx + radius * 3, cy, cz,
    )).toBe(true);
    expect(world.obstacles.blocksSegment(
      cx - radius * 3, cy + radius * 3, cz,
      cx + radius * 3, cy + radius * 3, cz,
    )).toBe(false);
    expect(world.obstacles.blocksSegment(
      cx + radius * 1.5, cy, cz,
      cx + radius * 3, cy, cz,
    )).toBe(false);
  });
});

describe('predator evasion response', () => {
  it('reduces fear when a reef lies between fish and predator', () => {
    const world = new SimulationWorld();
    world.setFishCount(2);
    // setFishCount keeps a 10-fish safety floor; retire the unused seed fish so
    // this test observes only the two fish whose positions are explicit.
    world.flock.alive.fill(0, 2);
    world.flock.aliveCount = 2;
    world.config.predatorEnabled = true;
    const [obstacle] = world.obstacles.definitions;
    const predator = world.predator;
    predator.position.set([
      obstacle.center[0] - 2,
      obstacle.center[1],
      obstacle.center[2],
    ]);
    predator.velocity.set([0, 0, 0]);
    // One fish behind the reef, one beside it at the same distance.
    world.flock.positions[0] = obstacle.center[0] + 5.5;
    world.flock.positions[1] = obstacle.center[1];
    world.flock.positions[2] = obstacle.center[2];
    world.flock.positions[3] = obstacle.center[0] + 1;
    world.flock.positions[4] = obstacle.center[1];
    world.flock.positions[5] = obstacle.center[2] + 4;
    world.step();
    const exposedFear = world.flock.fear[1];
    const shelteredFear = world.flock.fear[0];
    expect(exposedFear).toBeGreaterThan(shelteredFear);
    expect(shelteredFear).toBeLessThanOrEqual(exposedFear * 0.5 + 1e-5);
  });

  it('propagates alarm to calm neighbors and decays it in one step', () => {
    const world = new SimulationWorld();
    world.setFishCount(2);
    world.flock.alive.fill(0, 2);
    world.flock.aliveCount = 2;
    world.config.predatorEnabled = true;
    world.config.fearPropagation = 0.5;
    world.predator.position.set([-2, 10, 0]);
    world.predator.velocity.set([0, 0, 0]);
    // Fish 0 sits close to the predator, fish 1 is 2 m away but calm.
    world.flock.positions[0] = 4;
    world.flock.positions[1] = 10;
    world.flock.positions[2] = 0;
    world.flock.positions[3] = 6;
    world.flock.positions[4] = 10;
    world.flock.positions[5] = 0;
    world.step();
    const previousDirectFear = world.flock.fear[0];
    world.step();
    const directFear = world.flock.fear[0];
    const propagatedFear = world.flock.fear[1];
    expect(directFear).toBeGreaterThan(0.2);
    expect(propagatedFear).toBeGreaterThan(0);
    expect(propagatedFear).toBeLessThan(directFear);
    expect(propagatedFear).toBeCloseTo(previousDirectFear * world.config.fearPropagation, 5);
    world.config.predatorEnabled = false;
    world.step();
    expect(world.flock.fear[0]).toBe(0);
    expect(world.flock.fear[1]).toBe(0);
  });
});
