import { describe, expect, it } from 'vitest';
import {
  centralDifferenceNormal,
  sdCapsule,
  sdEllipsoid,
  sdRoundedBox,
  sdSphere,
  unionDistance,
} from '../src/simulation/sdf';

describe('SDF primitives', () => {
  it('rounds a box by the requested radius and reports inside/outside distances', () => {
    // Inner half extents (1,2,3), rounding 0.2 -> total half extents (1.2,2.2,3.2).
    expect(sdRoundedBox(0, 0, 0, 1, 2, 3, 0.2)).toBeCloseTo(-1.2);
    expect(sdRoundedBox(1.7, 0, 0, 1, 2, 3, 0.2)).toBeCloseTo(0.5);
    expect(sdRoundedBox(1.2, 0, 0, 1, 2, 3, 0.2)).toBeCloseTo(0);
    expect(sdRoundedBox(0, 0, -4, 1, 2, 3, 0.2)).toBeCloseTo(0.8);
    // A sharp box is the rounding=0 case.
    expect(sdRoundedBox(0, 0, 0, 1, 2, 3, 0)).toBeCloseTo(-1);
  });

  it('keeps a valid rounded shape when rounding exceeds a half extent', () => {
    // Half extent 1 + rounding 5 -> a sphere-like shape of half extent 6.
    expect(sdRoundedBox(0, 0, 0, 1, 1, 1, 5)).toBeCloseTo(-6);
    expect(sdRoundedBox(6, 0, 0, 1, 1, 1, 5)).toBeCloseTo(0);
    // A thin slab with a capsule-like profile: halfY 0.05 + rounding 0.35.
    expect(sdRoundedBox(0, 0.4, 0, 0.85, 0.05, 0.85, 0.35)).toBeCloseTo(0);
    expect(sdRoundedBox(0, 0, 0, 0.85, 0.05, 0.85, 0.35)).toBeCloseTo(-0.4);
  });

  it('measures capsule middle, endpoint cap and interior', () => {
    // Capsule from (0,0,0) to (0,2,0), radius 0.5.
    expect(sdCapsule(1, 1, 0, 0, 0, 0, 0, 2, 0, 0.5)).toBeCloseTo(0.5);
    expect(sdCapsule(0, 3, 0, 0, 0, 0, 0, 2, 0, 0.5)).toBeCloseTo(0.5);
    expect(sdCapsule(0, 0, 0.25, 0, 0, 0, 0, 2, 0, 0.5)).toBeCloseTo(-0.25);
    expect(sdCapsule(0, -1, 0, 0, 0, 0, 0, 2, 0, 0.5)).toBeCloseTo(0.5);
  });

  it('degenerates a zero length capsule into a sphere', () => {
    expect(sdCapsule(0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.25)).toBeCloseTo(0.25);
    expect(sdCapsule(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.25)).toBeCloseTo(-0.25);
  });

  it('returns zero on the ellipsoid surface and a negative interior value', () => {
    expect(sdEllipsoid(2, 0, 0, 2, 1, 3)).toBeCloseTo(0, 5);
    expect(sdEllipsoid(0, 1, 0, 2, 1, 3)).toBeCloseTo(0, 5);
    expect(sdEllipsoid(0, 0, 0, 2, 1, 3)).toBeLessThan(0);
    expect(sdEllipsoid(3, 0, 0, 2, 1, 3)).toBeGreaterThan(0);
  });

  it('takes the minimum distance for a compound union', () => {
    expect(unionDistance(2, 0.4, 1.2)).toBe(0.4);
    expect(unionDistance(2, -0.3, 1.2)).toBe(-0.3);
  });

  it('computes a finite-difference normal and handles a flat field', () => {
    const out = new Float32Array(3);
    expect(centralDifferenceNormal((x, y, z) => sdSphere(x, y, z, 1), 1.4, 0, 0, 1e-3, out)).toBe(true);
    expect(out[0]).toBeCloseTo(1, 3);
    expect(out[1]).toBeCloseTo(0, 3);
    expect(out[2]).toBeCloseTo(0, 3);

    expect(centralDifferenceNormal(() => 0, 0, 0, 0, 1e-3, out)).toBe(false);
    expect(Array.from(out)).toEqual([1, 0, 0]);
  });
});
