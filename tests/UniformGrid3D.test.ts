import { describe, expect, it } from 'vitest';
import { BruteForceSearch } from '../src/spatial/BruteForceSearch';
import { UniformGrid3D } from '../src/spatial/UniformGrid3D';
import { FlockData } from '../src/simulation/FlockData';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';
import type { SimulationConfig } from '../src/simulation/SimulationConfig';
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

/**
 * Independent unpruned implementation of the linked-cell query. It recreates
 * the grid's cell assignment, ascending-index cell lists and dz/dy/dx
 * traversal so a prune can be checked for order preservation, not only set
 * equality.
 */
function referenceNeighborSequence(
  flock: FlockData,
  config: SimulationConfig,
  grid: UniformGrid3D,
  index: number,
  radius: number,
): number[] {
  const [dimX, dimY, dimZ] = grid.dimensions;
  const cellSize = grid.cellSize;
  const minX = config.bounds.min[0];
  const minY = config.bounds.min[1];
  const minZ = config.bounds.min[2];
  const cells: number[][] = Array.from({ length: dimX * dimY * dimZ }, () => []);
  for (let other = 0; other < flock.count; other += 1) {
    if (flock.alive[other] === 0) continue;
    const offset = other * 3;
    const cx = Math.max(0, Math.min(dimX - 1, Math.floor((flock.positions[offset] - minX) / cellSize)));
    const cy = Math.max(0, Math.min(dimY - 1, Math.floor((flock.positions[offset + 1] - minY) / cellSize)));
    const cz = Math.max(0, Math.min(dimZ - 1, Math.floor((flock.positions[offset + 2] - minZ) / cellSize)));
    cells[cx + dimX * (cy + dimY * cz)].push(other);
  }

  const offset = index * 3;
  const x = flock.positions[offset];
  const y = flock.positions[offset + 1];
  const z = flock.positions[offset + 2];
  const cx = Math.max(0, Math.min(dimX - 1, Math.floor((x - minX) / cellSize)));
  const cy = Math.max(0, Math.min(dimY - 1, Math.floor((y - minY) / cellSize)));
  const cz = Math.max(0, Math.min(dimZ - 1, Math.floor((z - minZ) / cellSize)));
  const radiusSquared = radius * radius;
  const sequence: number[] = [];

  for (let dz = -1; dz <= 1; dz += 1) {
    const gz = cz + dz;
    if (gz < 0 || gz >= dimZ) continue;
    for (let dy = -1; dy <= 1; dy += 1) {
      const gy = cy + dy;
      if (gy < 0 || gy >= dimY) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const gx = cx + dx;
        if (gx < 0 || gx >= dimX) continue;
        const cell = cells[gx + dimX * (gy + dimY * gz)];
        for (const other of cell) {
          if (other === index) continue;
          const otherOffset = other * 3;
          const ox = flock.positions[otherOffset] - x;
          const oy = flock.positions[otherOffset + 1] - y;
          const oz = flock.positions[otherOffset + 2] - z;
          if (ox * ox + oy * oy + oz * oz <= radiusSquared) sequence.push(other);
        }
      }
    }
  }
  return sequence;
}

function expectGridSequence(
  flock: FlockData,
  config: SimulationConfig,
  grid: UniformGrid3D,
  index: number,
  radius: number,
): void {
  const output = new Int32Array(flock.capacity);
  const count = grid.collect(index, radius, output);
  expect(Array.from(output.subarray(0, count))).toEqual(
    referenceNeighborSequence(flock, config, grid, index, radius),
  );
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

  it.each([0.75, 2.5, 6, 11.3])('preserves the unpruned cell-order sequence at radius %s', (radius) => {
    const { flock, config } = randomFlock(180);
    flock.remove(7);
    flock.remove(80);
    const grid = new UniformGrid3D(config, flock.capacity);
    grid.rebuild(flock, radius);

    for (let i = 0; i < flock.count; i += 1) {
      expectGridSequence(flock, config, grid, i, radius);
    }
    // A dead query is still a valid query point; the reference must match.
    expectGridSequence(flock, config, grid, 7, radius);
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
      expectGridSequence(flock, config, grid, i, 2);
    }
  });

  it('preserves sequence when the query radius is smaller than the rebuild cell size', () => {
    const { flock, config } = randomFlock(120);
    const grid = new UniformGrid3D(config, flock.capacity);
    grid.rebuild(flock, 5);
    for (let i = 0; i < flock.count; i += 1) {
      expectGridSequence(flock, config, grid, i, 2.5);
    }
  });

  it('includes a neighbor exactly on the radius and excludes one just outside', () => {
    const { flock, config } = randomFlock(5);
    flock.positions.set([
      0, 10, 0,
      5, 10, 0,
      5.0001, 10, 0,
      0, 15, 0,
      0, 10, 5,
    ]);
    const grid = new UniformGrid3D(config, flock.capacity);
    grid.rebuild(flock, 5);
    const output = new Int32Array(flock.capacity);
    const count = grid.collect(0, 5, output);
    expect(Array.from(output.subarray(0, count)).sort((a, b) => a - b)).toEqual([1, 3, 4]);
    expectGridSequence(flock, config, grid, 0, 5);
  });

  it('rejects a query wider than its cell size guarantee', () => {
    const { flock, config } = randomFlock(10);
    const grid = new UniformGrid3D(config, flock.capacity);
    grid.rebuild(flock, 2);
    expect(() => grid.collect(0, 2.1, new Int32Array(10))).toThrow(/exceeds grid cell size/);
  });
});
