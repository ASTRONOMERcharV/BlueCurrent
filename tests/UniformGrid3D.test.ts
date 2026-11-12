import { describe, expect, it } from 'vitest';
import { BruteForceSearch } from '../src/spatial/BruteForceSearch';
import { UniformGrid3D } from '../src/spatial/UniformGrid3D';
import { FlockData } from '../src/simulation/FlockData';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';
import { SeededRandom } from '../src/simulation/math';

function randomFlock(count: number): { flock: FlockData; config: ReturnType<typeof createDefaultConfig> } {
  const config = createDefaultConfig();
  const flock = new FlockData(count);
  const random = new SeededRandom(91827);
  flock.initialize(count, config, random);
  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      flock.positions[offset + axis] = random.range(config.bounds.min[axis], config.bounds.max[axis]);
    }
  }
  flock.previousPositions.set(flock.positions);
  return { flock, config };
}

function sortedNeighbors(search: BruteForceSearch | UniformGrid3D, index: number, radius: number, capacity: number): number[] {
  const output = new Int32Array(capacity);
  const count = search.collect(index, radius, output);
  return Array.from(output.subarray(0, count)).sort((a, b) => a - b);
}

describe('UniformGrid3D', () => {
  it.each([0.75, 2.5, 6, 11.3])('returns exactly the brute-force neighbor set at radius %s', (radius) => {
    const { flock, config } = randomFlock(180);
    flock.remove(7);
    flock.remove(80);
    const grid = new UniformGrid3D(config, flock.capacity);
    const brute = new BruteForceSearch();
    grid.rebuild(flock, radius);
    brute.rebuild(flock, radius);

    for (let i = 0; i < flock.count; i += 1) {
      expect(sortedNeighbors(grid, i, radius, flock.capacity)).toEqual(
        sortedNeighbors(brute, i, radius, flock.capacity),
      );
    }
    expect(grid.candidatesExamined).toBeLessThan(brute.candidatesExamined);
  });

  it('handles positions on and just outside the water bounds', () => {
    const { flock, config } = randomFlock(6);
    flock.positions.set([
      config.bounds.min[0], config.bounds.min[1], config.bounds.min[2],
      config.bounds.max[0], config.bounds.max[1], config.bounds.max[2],
      config.bounds.min[0] - 2, 10, 0,
      config.bounds.max[0] + 2, 10, 0,
      0.1, 10.1, 0.1,
      1.5, 10.1, 0.1,
    ]);
    const grid = new UniformGrid3D(config, flock.capacity);
    const brute = new BruteForceSearch();
    grid.rebuild(flock, 2);
    brute.rebuild(flock, 2);
    for (let i = 0; i < flock.count; i += 1) {
      expect(sortedNeighbors(grid, i, 2, flock.capacity)).toEqual(sortedNeighbors(brute, i, 2, flock.capacity));
    }
  });

  it('rejects a query wider than its cell size guarantee', () => {
    const { flock, config } = randomFlock(10);
    const grid = new UniformGrid3D(config, flock.capacity);
    grid.rebuild(flock, 2);
    expect(() => grid.collect(0, 2.1, new Int32Array(10))).toThrow(/exceeds grid cell size/);
  });
});
