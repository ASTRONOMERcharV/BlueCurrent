import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';
import { FlockData } from '../src/simulation/FlockData';
import { SeededRandom } from '../src/simulation/math';

describe('School initialization', () => {
  it('uses a deterministic, non-overlapping three-dimensional ellipsoid', () => {
    const config = createDefaultConfig();
    config.predatorEnabled = false;
    const first = new FlockData(config.maxFishCount);
    const second = new FlockData(config.maxFishCount);
    first.initialize(500, config, new SeededRandom(config.seed));
    second.initialize(500, config, new SeededRandom(config.seed));
    expect(first.positions).toEqual(second.positions);
    expect(first.velocities).toEqual(second.velocities);

    let minimumDistance = Number.POSITIVE_INFINITY;
    let centerY = 0;
    const directions = new Set<string>();
    for (let i = 0; i < first.count; i += 1) {
      const offset = i * 3;
      centerY += first.positions[offset + 1];
      directions.add(Math.atan2(first.velocities[offset + 2], first.velocities[offset]).toFixed(3));
      for (let axis = 0; axis < 3; axis += 1) {
        expect(first.positions[offset + axis]).toBeGreaterThanOrEqual(config.bounds.min[axis] + config.boundaryMargin);
        expect(first.positions[offset + axis]).toBeLessThanOrEqual(config.bounds.max[axis] - config.boundaryMargin);
      }
      for (let j = i + 1; j < first.count; j += 1) {
        const otherOffset = j * 3;
        minimumDistance = Math.min(minimumDistance, Math.hypot(
          first.positions[offset] - first.positions[otherOffset],
          first.positions[offset + 1] - first.positions[otherOffset + 1],
          first.positions[offset + 2] - first.positions[otherOffset + 2],
        ));
      }
    }
    expect(minimumDistance).toBeGreaterThanOrEqual(config.separationRadius * 0.6 - 1e-5);
    expect(centerY / first.count).toBeCloseTo(10, 1);
    expect(directions.size).toBeGreaterThan(400);
  });

  it('scales the sampling volume for larger populations without leaving the water', () => {
    const config = createDefaultConfig();
    const flock = new FlockData(config.maxFishCount);
    flock.initialize(2000, config, new SeededRandom(config.seed));
    for (let i = 0; i < flock.count * 3; i += 1) {
      expect(Number.isFinite(flock.positions[i])).toBe(true);
    }
    for (let i = 0; i < flock.count; i += 1) {
      const offset = i * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        expect(flock.positions[offset + axis]).toBeGreaterThanOrEqual(config.bounds.min[axis] + config.boundaryMargin);
        expect(flock.positions[offset + axis]).toBeLessThanOrEqual(config.bounds.max[axis] - config.boundaryMargin);
      }
    }
  });
});
