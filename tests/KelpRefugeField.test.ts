import { describe, expect, it } from 'vitest';
import {
  closestPointOnKelpCylinder,
  kelpCoverAt,
  KelpRefugeField,
  segmentIntersectsKelpCylinder,
} from '../src/environment/KelpRefugeField';
import type { KelpRefugePlacement } from '../src/environment/KelpRefugeField';
import { SeededRandom } from '../src/simulation/math';

function randomPlacements(random: SeededRandom, count: number): KelpRefugePlacement[] {
  const placements: KelpRefugePlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    placements.push({
      name: random.next() < 0.5 ? 'kelp_a' : 'kelp_b',
      x: random.range(-24, 24),
      y: random.range(-0.6, 0.6),
      z: random.range(-24, 24),
      scale: random.range(0.5, 2.2),
    });
  }
  return placements;
}

describe('KelpRefugeField', () => {
  it('derives each cylinder from the shared placement and canopy profile', () => {
    const field = new KelpRefugeField([
      { name: 'kelp_a', x: 1, y: 2, z: -3, scale: 2 },
      { name: 'kelp_b', x: -5, y: 0, z: 4, scale: 0.5 },
    ]);
    expect(field.cylinders).toHaveLength(2);
    expect(field.cylinders[0].radius).toBeCloseTo(1.29315 * 2 * 0.8, 6);
    expect(field.cylinders[0].baseY).toBe(2);
    expect(field.cylinders[0].topY).toBeCloseTo(2 + 3.55 * 2, 6);
    expect(field.cylinders[1].radius).toBeCloseTo(0.96785 * 0.5 * 0.8, 6);
    expect(field.cylinders[1].topY).toBeCloseTo(2.8 * 0.5, 6);
    expect(field.maxRadius).toBe(field.cylinders[0].radius);
  });

  it('matches a brute-force scan for cover and segment queries', () => {
    const random = new SeededRandom(0x6b656c70);
    const placements = randomPlacements(random, 40);
    const field = new KelpRefugeField(placements);
    const cylinders = field.cylinders;

    for (let query = 0; query < 500; query += 1) {
      const x = random.range(-28, 28);
      const y = random.range(-1, 9);
      const z = random.range(-28, 28);
      const expectedCover = Math.max(
        0,
        ...cylinders.map((cylinder) => kelpCoverAt(cylinder, x, y, z)),
      );
      expect(field.coverAt(x, y, z)).toBeCloseTo(expectedCover, 12);

      const x1 = random.range(-28, 28);
      const y1 = random.range(-1, 9);
      const z1 = random.range(-28, 28);
      const expectedBlocked = cylinders.some((cylinder) => (
        segmentIntersectsKelpCylinder(cylinder, x, y, z, x1, y1, z1)
      ));
      expect(field.blocksSegment(x, y, z, x1, y1, z1)).toBe(expectedBlocked);
    }
  });

  it('keeps full cover at the core and fades only near the crown edge', () => {
    const field = new KelpRefugeField([
      { name: 'kelp_a', x: 0, y: 0, z: 0, scale: 1 },
    ]);
    const radius = field.cylinders[0].radius;
    expect(field.coverAt(0, 1.5, 0)).toBe(1);
    const edgeCover = field.coverAt(radius * 0.95, 1.5, 0);
    expect(edgeCover).toBeGreaterThan(0);
    expect(edgeCover).toBeLessThan(1);
    expect(field.coverAt(radius, 1.5, 0)).toBe(0);
    expect(field.coverAt(0, field.cylinders[0].topY + 0.01, 0)).toBe(0);
    expect(field.coverAt(0, -0.01, 0)).toBe(0);
  });

  it('blocks only segments that really cross the cylinder volume', () => {
    const field = new KelpRefugeField([
      { name: 'kelp_a', x: 0, y: 0, z: 0, scale: 1 },
    ]);
    expect(field.blocksSegment(-4, 2, 0, 4, 2, 0)).toBe(true);
    expect(field.blocksSegment(-4, 5, 0, 4, 5, 0)).toBe(false);
    expect(field.blocksSegment(-4, 2, 4, 4, 2, 4)).toBe(false);
    expect(field.blocksSegment(0, -2, 0, 0, 7, 0)).toBe(true);
    expect(field.blocksSegment(-4, 2, 0, -2, 2, 0)).toBe(false);
  });

  it('points sheltering fish at the closest point on the nearest cylinder', () => {
    const field = new KelpRefugeField([
      { name: 'kelp_a', x: 0, y: 0, z: 0, scale: 2 },
      { name: 'kelp_b', x: 12, y: 0, z: 0, scale: 1 },
    ]);
    const out = new Float32Array(3);
    const proximity = field.nearestRefuge(6, 2, 0, 10, out);
    expect(proximity).toBeGreaterThan(0);
    expect(proximity).toBeLessThanOrEqual(1);

    const expected = new Float32Array(3);
    const distance = closestPointOnKelpCylinder(field.cylinders[0], 6, 2, 0, expected);
    expect(out[0]).toBeCloseTo((expected[0] - 6) / distance, 6);
    expect(out[1]).toBeCloseTo((expected[1] - 2) / distance, 6);
    expect(out[2]).toBeCloseTo((expected[2] - 0) / distance, 6);

    expect(field.nearestRefuge(60, 2, 60, 10, out)).toBe(0);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('returns no refuge or occlusion while disabled', () => {
    const field = new KelpRefugeField([
      { name: 'kelp_a', x: 0, y: 0, z: 0, scale: 1 },
    ]);
    field.enabled = false;
    expect(field.coverAt(0, 1, 0)).toBe(0);
    expect(field.blocksSegment(-4, 1, 0, 4, 1, 0)).toBe(false);
    expect(field.nearestRefuge(2, 1, 0, 10, new Float32Array(3))).toBe(0);
  });

  it('rejects invalid placements', () => {
    expect(() => new KelpRefugeField([
      { name: 'kelp_a', x: 0, y: 0, z: 0, scale: 0 },
    ])).toThrow(/scale must be greater than zero/);
    expect(() => new KelpRefugeField([
      { name: 'kelp_a', x: Number.NaN, y: 0, z: 0, scale: 1 },
    ])).toThrow(/must be finite/);
  });
});
