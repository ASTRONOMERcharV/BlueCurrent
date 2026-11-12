import { describe, expect, it } from 'vitest';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { CLOWNFISH_SPAWN, DEFAULT_CLOWNFISH_COUNT } from '../src/simulation/SimulationConfig';

function centroid(world: SimulationWorld): [number, number, number] {
  const { positions, count } = world.clownfishFlock;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < count; i += 1) {
    x += positions[i * 3];
    y += positions[i * 3 + 1];
    z += positions[i * 3 + 2];
  }
  return [x / Math.max(1, count), y / Math.max(1, count), z / Math.max(1, count)];
}

describe('Clownfish school', () => {
  it('spawns a separate reef school with the default population', () => {
    const world = new SimulationWorld();
    world.config.predatorEnabled = false;
    expect(world.clownfishCount).toBe(DEFAULT_CLOWNFISH_COUNT);
    expect(world.clownfishFlock.count).toBe(DEFAULT_CLOWNFISH_COUNT);
    expect(world.metrics.clownfishCount).toBe(DEFAULT_CLOWNFISH_COUNT);
    expect(world.clownfishFlock.positions).not.toBe(world.flock.positions);

    const [centerX, centerY, centerZ] = centroid(world);
    const [spawnX, spawnY, spawnZ] = CLOWNFISH_SPAWN.center;
    expect(Math.hypot(centerX - spawnX, centerY - spawnY, centerZ - spawnZ)).toBeLessThan(1.5);

    for (let i = 0; i < world.clownfishFlock.count; i += 1) {
      const offset = i * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Number.isFinite(world.clownfishFlock.positions[offset + axis])).toBe(true);
        expect(world.clownfishFlock.positions[offset + axis])
          .toBeGreaterThanOrEqual(world.clownfishConfig.bounds.min[axis]);
        expect(world.clownfishFlock.positions[offset + axis])
          .toBeLessThanOrEqual(world.clownfishConfig.bounds.max[axis]);
      }
      for (const obstacle of world.obstacles.definitions) {
        const distance = Math.hypot(
          world.clownfishFlock.positions[offset] - obstacle.center[0],
          world.clownfishFlock.positions[offset + 1] - obstacle.center[1],
          world.clownfishFlock.positions[offset + 2] - obstacle.center[2],
        );
        expect(distance).toBeGreaterThanOrEqual(obstacle.radius);
      }
    }
  });

  it('stays near its reef habitat during undisturbed schooling', () => {
    const world = new SimulationWorld();
    world.config.predatorEnabled = false;
    world.setFishCount(60);
    for (let step = 0; step < 600; step += 1) world.step();

    const [centerX, centerY, centerZ] = centroid(world);
    const [homeX, homeY, homeZ] = world.clownfishConfig.homeCenter!;
    expect(Math.hypot(centerX - homeX, centerY - homeY, centerZ - homeZ)).toBeLessThan(6);

    for (let i = 0; i < world.clownfishFlock.count; i += 1) {
      const offset = i * 3;
      expect(world.clownfishFlock.velocities[offset]).toBeLessThanOrEqual(
        world.clownfishConfig.maxSpeed * 1.3,
      );
    }
  });

  it('is deterministic and independent of the main school population', () => {
    const first = new SimulationWorld();
    const second = new SimulationWorld();
    first.config.predatorEnabled = false;
    second.config.predatorEnabled = false;
    first.setFishCount(220);
    second.setFishCount(220);
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
    }
    expect(first.clownfishFlock.positions).toEqual(second.clownfishFlock.positions);
    expect(first.clownfishFlock.velocities).toEqual(second.clownfishFlock.velocities);
  });

  it('can be switched off without touching the main school', () => {
    const world = new SimulationWorld();
    const mainCount = world.flock.aliveCount;
    world.setClownfishCount(0);
    expect(world.clownfishFlock.aliveCount).toBe(0);
    expect(world.metrics.clownfishCount).toBe(0);
    expect(world.flock.aliveCount).toBe(mainCount);
    world.setClownfishCount(140);
    expect(world.clownfishFlock.aliveCount).toBe(140);
  });
});
