import { describe, expect, it } from 'vitest';
import {
  buildReefCollisionProxy,
  buildReefProxySet,
  createReefProxyQueryResult,
  eulerYXZMatrix,
  numericNormal,
  type ReefWorldTransform,
} from '../src/simulation/ReefCollisionProxy';
import {
  REEF_NEAR_LOCAL_SIZE,
  type ReefProxyShapeSpec,
  type ReefProxySpec,
} from '../src/simulation/reefCollisionProxySpecs';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import { REEF_VARIANT_SPECS } from '../src/rendering/reefVariantSpecs';

function testSpec(shapes: readonly ReefProxyShapeSpec[]): ReefProxySpec {
  return { id: 'c', label: 'Test reef', anchorIndex: 0, shapes };
}

function testTransform(overrides: Partial<ReefWorldTransform> = {}): ReefWorldTransform {
  return {
    id: 'c',
    anchorIndex: 0,
    position: [0, 0, 0],
    yaw: 0,
    tiltX: 0,
    tiltZ: 0,
    scale: [1, 1, 1],
    localSize: [4, 2, 4],
    ...overrides,
  };
}

function reefTransform(id: 'b' | 'c' | 'hero' | 'd' | 'e'): ReefWorldTransform {
  const spec = REEF_VARIANT_SPECS.find((candidate) => candidate.id === id)!;
  const localSize = REEF_NEAR_LOCAL_SIZE[id];
  const obstacleCenters: Record<string, readonly [number, number, number]> = {
    b: [-7, 3.4, -3],
    c: [5, 3.5, 4],
    hero: [0, 3.6, -9],
    d: [11, 3.2, -7],
    e: [-12, 3.4, 9],
  };
  const [x, , z] = obstacleCenters[id];
  return {
    id,
    anchorIndex: spec.anchorIndex,
    position: [x, floorHeightAt(x, z) - spec.embedDepth, z],
    yaw: (spec.yawDegrees * Math.PI) / 180,
    tiltX: (spec.tiltXDegrees * Math.PI) / 180,
    tiltZ: (spec.tiltZDegrees * Math.PI) / 180,
    scale: [
      spec.targetWidth / localSize[0],
      spec.targetHeight / localSize[1],
      spec.targetDepth / localSize[2],
    ],
    localSize,
  };
}

function localToWorld(transform: ReefWorldTransform, x: number, y: number, z: number): [number, number, number] {
  const rotation = eulerYXZMatrix(transform.yaw, transform.tiltX, transform.tiltZ);
  const sx = x * transform.scale[0];
  const sy = y * transform.scale[1];
  const sz = z * transform.scale[2];
  return [
    transform.position[0] + rotation[0] * sx + rotation[1] * sy + rotation[2] * sz,
    transform.position[1] + rotation[3] * sx + rotation[4] * sy + rotation[5] * sz,
    transform.position[2] + rotation[6] * sx + rotation[7] * sy + rotation[8] * sz,
  ];
}

describe('reef collision proxies', () => {
  it('matches three.js Euler order YXZ for a 90 degree yaw', () => {
    const matrix = eulerYXZMatrix(Math.PI / 2, 0, 0);
    // Local +X maps to world -Z.
    expect(matrix[0]).toBeCloseTo(0, 6);
    expect(matrix[2]).toBeCloseTo(1, 6);
    expect(matrix[6]).toBeCloseTo(-1, 6);
    expect(matrix[8]).toBeCloseTo(0, 6);
    const x = matrix[0] * 1 + matrix[1] * 0 + matrix[2] * 0;
    const y = matrix[3] * 1 + matrix[4] * 0 + matrix[5] * 0;
    const z = matrix[6] * 1 + matrix[7] * 0 + matrix[8] * 0;
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1, 6);
  });

  it('measures a local rounded box in world space', () => {
    const proxy = buildReefCollisionProxy(
      testTransform(),
      testSpec([
        { kind: 'roundedBox', center: [0, 0.5, 0], half: [0.5, 0.25, 0.5], rounding: 0.1 },
      ]),
    );
    // Local half (1,0.5,1), rounding 0.2 -> total half (1.2,0.7,1.2) at y=1.
    expect(proxy.distance(1.5, 1, 0)).toBeCloseTo(0.3);
    expect(proxy.distance(0, 1, 0)).toBeCloseTo(-0.7);
    expect(proxy.distance(0, 1, -1.2)).toBeCloseTo(0);
  });

  it('applies rotation, non-uniform scale and world position together', () => {
    const proxy = buildReefCollisionProxy(
      testTransform({
        position: [10, 1, -2],
        yaw: Math.PI / 2,
        scale: [2, 1, 0.5],
      }),
      testSpec([
        { kind: 'roundedBox', center: [0, 0.5, 0], half: [0.5, 0.25, 0.5], rounding: 0 },
      ]),
    );
    // Local half (1,0.5,1) -> world half (2,0.5,0.5) before the yaw; after a
    // 90° yaw the long local X axis lies along world Z. Box center (10,2,-2).
    expect(proxy.distance(10, 2, -2.7)).toBeCloseTo(-0.5);
    expect(proxy.distance(10, 2.7, -2)).toBeCloseTo(0.2);
    expect(proxy.distance(10.6, 2, -2)).toBeCloseTo(0.1);
    expect(proxy.distance(12.3, 2, -2)).toBeCloseTo(1.8);
  });

  it('returns an outward analytic normal for box, capsule and ellipsoid', () => {
    const box = buildReefCollisionProxy(
      testTransform(),
      testSpec([{ kind: 'roundedBox', center: [0, 0.5, 0], half: [0.5, 0.25, 0.5], rounding: 0.1 }]),
    );
    const normal = new Float32Array(3);
    box.query(2.5, 1, 0, normal);
    expect(normal[0]).toBeCloseTo(1, 5);
    expect(normal[1]).toBeCloseTo(0, 5);

    const capsule = buildReefCollisionProxy(
      testTransform(),
      testSpec([{ kind: 'capsule', a: [0, 0.2, 0], b: [0, 0.8, 0], radius: 0.2 }]),
    );
    capsule.query(0.8, 1, 0, normal);
    expect(normal[0]).toBeCloseTo(1, 5);

    const ellipsoid = buildReefCollisionProxy(
      testTransform(),
      testSpec([{ kind: 'ellipsoid', center: [0, 0.5, 0], radii: [0.5, 0.25, 0.5] }]),
    );
    ellipsoid.query(0, 1, 2.2, normal);
    expect(normal[2]).toBeCloseTo(1, 4);
  });

  it('keeps the analytic normal close to a central difference', () => {
    const proxy = buildReefCollisionProxy(reefTransform('hero'));
    const analytic = new Float32Array(3);
    const numeric = new Float32Array(3);
    const point = localToWorld(reefTransform('hero'), -1.1, 2.4, 0.2);
    proxy.query(point[0], point[1], point[2], analytic);
    expect(numericNormal(proxy, point[0], point[1], point[2], 0.01, numeric)).toBe(true);
    const dot = analytic[0] * numeric[0] + analytic[1] * numeric[1] + analytic[2] * numeric[2];
    expect(dot).toBeGreaterThan(0.99);
  });

  it('takes the minimum of a compound and reports the winning shape', () => {
    const proxy = buildReefCollisionProxy(
      testTransform(),
      testSpec([
        { kind: 'roundedBox', center: [0, 0.25, 0], half: [0.4, 0.1, 0.4], rounding: 0.05 },
        { kind: 'roundedBox', center: [0, 0.85, 0], half: [0.2, 0.1, 0.2], rounding: 0.05 },
      ]),
    );
    const normal = new Float32Array(3);
    const result = proxy.queryWithShape(0, 2.4, 0, normal);
    expect(result.shapeIndex).toBe(1);
    expect(result.distance).toBeCloseTo(0.4);
  });

  it('handles a degenerate capsule without NaNs', () => {
    const proxy = buildReefCollisionProxy(
      testTransform(),
      testSpec([{ kind: 'capsule', a: [0, 0.5, 0], b: [0, 0.5, 0], radius: 0.2 }]),
    );
    // Local center y=1, radius 0.2*2=0.4 -> point 0.5 from the center is 0.1 outside.
    expect(proxy.distance(0.5, 1, 0)).toBeCloseTo(0.1);
    const normal = new Float32Array(3);
    proxy.query(0.5, 1, 0, normal);
    expect(Number.isFinite(normal[0] + normal[1] + normal[2])).toBe(true);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
  });

  it('reports the nearest reef across a set', () => {
    const set = buildReefProxySet([reefTransform('b'), reefTransform('c')]);
    const result = createReefProxyQueryResult();
    const nearC = localToWorld(reefTransform('c'), 0, 0.2, 0);
    expect(set.queryNearest(nearC[0], nearC[1], nearC[2], result)).toBe(true);
    expect(result.id).toBe('c');
    expect(result.distance).toBeLessThan(0);
    const far = set.queryNearest(0, 30, 0, result);
    expect(far).toBe(true);
    expect(result.distance).toBeGreaterThan(5);
  });

  it('removes the old 7 m vertical sphere envelope for C and E', () => {
    for (const id of ['c', 'e'] as const) {
      const transform = reefTransform(id);
      const proxy = buildReefCollisionProxy(transform);
      const [x, baseY, z] = transform.position;
      let top = baseY;
      for (let y = baseY; y < baseY + 12; y += 0.02) {
        if (proxy.distance(x, y, z) <= 0) top = y;
      }
      const spec = REEF_VARIANT_SPECS.find((candidate) => candidate.id === id)!;
      const oldSphereTop = id === 'c' ? 3.5 + 3.5 : 3.4 + 3.4;
      expect(top - baseY).toBeGreaterThan(spec.targetHeight * 0.8);
      expect(top - baseY).toBeLessThan(spec.targetHeight * 1.2);
      expect(top).toBeLessThan(oldSphereTop - 1.5);
    }
  });

  it('covers the hero top above the old sphere and closes it just above the mesh', () => {
    const transform = reefTransform('hero');
    const proxy = buildReefCollisionProxy(transform);
    const inside = localToWorld(transform, -0.85, 4.45, 0.4);
    const above = localToWorld(transform, -0.85, 4.85, 0.4);
    expect(inside[1]).toBeGreaterThan(7.2);
    expect(proxy.distance(...inside)).toBeLessThan(0);
    expect(proxy.distance(...above)).toBeGreaterThan(0);
  });

  it('keeps the twin columns separate with an open front gap', () => {
    const transform = reefTransform('d');
    const proxy = buildReefCollisionProxy(transform);
    const left = localToWorld(transform, -0.6, 1.5, 0.1);
    const right = localToWorld(transform, 0.95, 1.5, 0.2);
    const gap = localToWorld(transform, 0.2, 1.5, -0.1);
    expect(proxy.distance(...left)).toBeLessThan(0);
    expect(proxy.distance(...right)).toBeLessThan(0);
    expect(proxy.distance(...gap)).toBeGreaterThan(0.05);
  });
});
