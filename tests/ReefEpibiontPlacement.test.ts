import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import {
  EPIBIONT_SPECIES,
  countBySpecies,
  extractReefTriangles,
  planEpibionts,
} from '../src/rendering/reefEpibiontPlacement';

function flatReefGeometry(size = 8, segments = 24, height = 2.4): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= segments; row += 1) {
    for (let column = 0; column <= segments; column += 1) {
      const x = (column / segments - 0.5) * size;
      const z = (row / segments - 0.5) * size;
      // Slight dome so the surface samples are not all coplanar.
      const y = height + 0.3 * (1 - (x * x + z * z) / (size * size));
      positions.push(x, y, z);
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const a = row * (segments + 1) + column;
      const b = a + 1;
      const c = a + segments + 2;
      const d = a + segments + 1;
      indices.push(a, c, b, a, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

describe('reef epibiont placement', () => {
  it('is deterministic for a fixed seed', () => {
    const triangles = extractReefTriangles(flatReefGeometry());
    const first = planEpibionts(triangles);
    const second = planEpibionts(triangles);
    expect(second).toEqual(first);
  });

  it('only places top colonies on up-facing surface above the sediment line', () => {
    const triangles = extractReefTriangles(flatReefGeometry());
    const plan = planEpibionts(triangles);
    expect(plan.placements.length).toBeGreaterThan(45);
    for (const placement of plan.placements) {
      expect(placement.y).toBeGreaterThan(0.7);
      expect(placement.ny).toBeGreaterThan(0.2);
      expect(Number.isFinite(placement.x)).toBe(true);
      expect(Number.isFinite(placement.z)).toBe(true);
    }
  });

  it('keeps 7 clusters of 6-8 colonies and adds scattered encrusting recruits', () => {
    const plan = planEpibionts(extractReefTriangles(flatReefGeometry()));
    expect(plan.clusters).toHaveLength(7);
    for (const cluster of plan.clusters) {
      expect(cluster.count).toBeGreaterThanOrEqual(6);
      expect(cluster.count).toBeLessThanOrEqual(8);
    }
    const scattered = plan.placements.filter((placement) => placement.cluster === -1);
    expect(scattered.length).toBeGreaterThan(15);
    expect(scattered.length).toBeLessThanOrEqual(24);
  });

  it('adds side encrusting colonies on steep faces', () => {
    const box = new BoxGeometry(6, 2.5, 6, 6, 2, 6);
    box.translate(0, 1.25, 0);
    const plan = planEpibionts(extractReefTriangles(box));
    const side = plan.placements.filter((placement) => placement.cluster === -2);
    expect(side.length).toBeGreaterThan(4);
    expect(side.length).toBeLessThanOrEqual(10);
    for (const placement of side) {
      expect(placement.ny).toBeLessThanOrEqual(0.45);
      expect(placement.y).toBeGreaterThan(0.7);
    }
  });

  it('keeps most of the up-facing bedrock visible', () => {
    const plan = planEpibionts(extractReefTriangles(flatReefGeometry()));
    expect(plan.eligibleArea).toBeGreaterThan(0);
    expect(plan.coverage).toBeGreaterThan(0.01);
    expect(plan.coverage).toBeLessThan(0.5);
  });

  it('counts species consistently and uses only known species indices', () => {
    const plan = planEpibionts(extractReefTriangles(flatReefGeometry()));
    const counts = countBySpecies(plan);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(plan.placements.length);
    for (const placement of plan.placements) {
      expect(placement.species).toBeGreaterThanOrEqual(0);
      expect(placement.species).toBeLessThan(EPIBIONT_SPECIES.length);
      expect(placement.scale).toBeGreaterThan(0);
    }
  });

  it('returns an empty plan when the surface offers no candidates', () => {
    const plan = planEpibionts([], 1234);
    expect(plan.placements).toHaveLength(0);
    expect(plan.clusters).toHaveLength(0);
    expect(plan.coverage).toBe(0);
  });
});
