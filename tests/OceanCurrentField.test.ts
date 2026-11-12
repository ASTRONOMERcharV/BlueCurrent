import { describe, expect, it } from 'vitest';
import {
  createReefVortices,
  DEFAULT_CURRENT_DIRECTION,
  DEFAULT_OCEAN_CURRENT_CONFIG,
  OceanCurrentField,
  type OceanCurrentConfig,
} from '../src/environment/OceanCurrentField';

function velocityAt(
  field: OceanCurrentField,
  x: number,
  y: number,
  z: number,
  time = 0,
): Float32Array {
  const out = new Float32Array(3);
  field.sample(x, y, z, time, out);
  return out;
}

function withoutTurbulence(config: Partial<OceanCurrentConfig> = {}): Partial<OceanCurrentConfig> {
  return {
    baseDirection: [1, 0, 0],
    baseSpeed: 0.4,
    turbulenceAmplitude: 0,
    boundaryLayerHeight: 0,
    maxSpeed: 10,
    vortices: [],
    ...config,
  };
}

describe('OceanCurrentField', () => {
  it('uses the normalized horizontal direction inherited from the kelp asset', () => {
    expect(Math.hypot(...DEFAULT_CURRENT_DIRECTION)).toBeCloseTo(1, 12);
    expect(DEFAULT_CURRENT_DIRECTION[0]).toBeCloseTo(0.82 / Math.hypot(0.82, 0.57), 12);
    expect(DEFAULT_CURRENT_DIRECTION[1]).toBe(0);
    expect(DEFAULT_CURRENT_DIRECTION[2]).toBeCloseTo(-0.57 / Math.hypot(0.82, 0.57), 12);
  });

  it('returns a uniform base current and leaves unrelated output elements untouched', () => {
    const field = new OceanCurrentField(withoutTurbulence({ baseDirection: [2, 0, 0] }));
    const out = new Float32Array([0, 0, 0, 91]);
    field.sample(-100, 7, 42, 123, out);
    expect(out[0]).toBeCloseTo(0.4, 7);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(91);
  });

  it('is deterministic across instances and does not depend on wall-clock time', () => {
    const config = withoutTurbulence({
      turbulenceAmplitude: 0.12,
      vortices: createReefVortices([{ center: [1, 2, -3], radius: 2.2 }]),
    });
    const first = new OceanCurrentField(config, (x, z) => -0.25 + x * 0.001 - z * 0.001);
    const second = new OceanCurrentField(config, (x, z) => -0.25 + x * 0.001 - z * 0.001);
    for (const time of [0, 0.1, 10, 1000]) {
      expect(velocityAt(first, 3, 4, -2, time)).toEqual(velocityAt(second, 3, 4, -2, time));
    }
  });

  it('repeats the analytic turbulence after one configured period', () => {
    const field = new OceanCurrentField(withoutTurbulence({
      turbulenceAmplitude: 0.08,
      turbulencePeriod: 24,
      maxSpeed: 100,
    }));
    const initial = velocityAt(field, 1.3, 4.2, -2.1, 0.73);
    const repeated = velocityAt(field, 1.3, 4.2, -2.1, 0.73 + 24);
    for (let index = 0; index < 3; index += 1) {
      expect(repeated[index]).toBeCloseTo(initial[index], 6);
    }
  });

  it('keeps nearby samples continuous instead of adding independent random jitter', () => {
    const field = new OceanCurrentField({}, () => -0.25);
    const baseline = velocityAt(field, 2, 8, -3, 1.7);
    const nearby = velocityAt(field, 2.0001, 8, -3, 1.7);
    for (let index = 0; index < 3; index += 1) {
      expect(Math.abs(nearby[index] - baseline[index])).toBeLessThan(1e-5);
    }
  });

  it('creates a right-handed tangential vortex with a zero-velocity axis', () => {
    const field = new OceanCurrentField(withoutTurbulence({
      baseSpeed: 0,
      baseDirection: [0, 0, 0],
      vortices: [{ center: [0, 0, 0], axis: [0, 1, 0], radius: 2, strength: 0.5 }],
    }));
    const axis = velocityAt(field, 0, 3, 0);
    expect(Math.hypot(...axis)).toBe(0);

    const positiveX = velocityAt(field, 2, 0, 0);
    expect(positiveX[0]).toBeCloseTo(0, 7);
    expect(positiveX[1]).toBeCloseTo(0, 7);
    expect(positiveX[2]).toBeLessThan(0);
    expect(Math.abs(positiveX[2])).toBeCloseTo(0.5, 6);
  });

  it('reverses circulation when vortex strength changes sign and decays far away', () => {
    const vortex = { center: [0, 0, 0], radius: 2, strength: 0.4 } as const;
    const positive = new OceanCurrentField(withoutTurbulence({
      baseSpeed: 0,
      baseDirection: [0, 0, 0],
      vortices: [vortex],
    }));
    const negative = new OceanCurrentField(withoutTurbulence({
      baseSpeed: 0,
      baseDirection: [0, 0, 0],
      vortices: [{ ...vortex, strength: -0.4 }],
    }));
    const a = velocityAt(positive, 2, 0, 0);
    const b = velocityAt(negative, 2, 0, 0);
    for (let index = 0; index < 3; index += 1) expect(b[index]).toBeCloseTo(-a[index], 7);
    expect(positive.speedAt(20, 0, 0, 0)).toBeLessThan(positive.speedAt(2, 0, 0, 0));
  });

  it('applies the configured Gaussian falloff along the vortex axis', () => {
    const field = new OceanCurrentField(withoutTurbulence({
      baseSpeed: 0,
      baseDirection: [0, 0, 0],
      vortices: [{ center: [0, 0, 0], radius: 2, strength: 0.4 }],
    }));
    const onPlane = field.speedAt(2, 0, 0, 0);
    const abovePlane = field.speedAt(2, 3, 0, 0);
    expect(abovePlane / onPlane).toBeCloseTo(Math.exp(-9 / 8), 6);
  });

  it('attenuates flow continuously toward the injected seabed', () => {
    const field = new OceanCurrentField(
      withoutTurbulence({ boundaryLayerHeight: 2 }),
      () => 2,
    );
    expect(field.speedAt(0, 2, 0, 0)).toBe(0);
    const middle = field.speedAt(0, 3, 0, 0);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(0.4);
    expect(field.speedAt(0, 4, 0, 0)).toBeCloseTo(0.4, 7);
  });

  it('keeps the unattenuated analytic turbulence divergence-free', () => {
    const field = new OceanCurrentField(withoutTurbulence({
      baseSpeed: 0,
      baseDirection: [0, 0, 0],
      turbulenceAmplitude: 0.4,
      turbulenceLength: 7,
      turbulencePeriod: 19,
      maxSpeed: 100,
    }));
    const epsilon = 0.005;
    const time = 2.7;
    const xPlus = velocityAt(field, 1.2 + epsilon, 3.4, -2.3, time);
    const xMinus = velocityAt(field, 1.2 - epsilon, 3.4, -2.3, time);
    const yPlus = velocityAt(field, 1.2, 3.4 + epsilon, -2.3, time);
    const yMinus = velocityAt(field, 1.2, 3.4 - epsilon, -2.3, time);
    const zPlus = velocityAt(field, 1.2, 3.4, -2.3 + epsilon, time);
    const zMinus = velocityAt(field, 1.2, 3.4, -2.3 - epsilon, time);
    const divergence = (xPlus[0] - xMinus[0] + yPlus[1] - yMinus[1] + zPlus[2] - zMinus[2])
      / (2 * epsilon);
    expect(Math.abs(divergence)).toBeLessThan(1e-4);
  });

  it('keeps scanned velocities finite and within the configured speed ceiling', () => {
    const field = new OceanCurrentField({
      ...DEFAULT_OCEAN_CURRENT_CONFIG,
      vortices: createReefVortices([
        { center: [-7, 2.1, -3], radius: 2.1 },
        { center: [5, 1.75, 4], radius: 1.75 },
      ], 0.3),
    }, () => -0.25);
    for (const x of [-30, -5, 0, 7, 30]) {
      for (const y of [-2, 0, 1, 10, 25]) {
        for (const z of [-25, -3, 0, 9, 25]) {
          for (const time of [0, 1, 24, 1e9]) {
            const velocity = velocityAt(field, x, y, z, time);
            expect(Number.isFinite(velocity[0])).toBe(true);
            expect(Number.isFinite(velocity[1])).toBe(true);
            expect(Number.isFinite(velocity[2])).toBe(true);
            expect(Math.hypot(...velocity)).toBeLessThanOrEqual(field.config.maxSpeed + 1e-6);
          }
        }
      }
    }
  });

  it('matches speedAt with an explicitly sampled velocity', () => {
    const field = new OceanCurrentField();
    const velocity = velocityAt(field, 2, 8, 4, 3);
    expect(field.speedAt(2, 8, 4, 3)).toBeCloseTo(Math.hypot(...velocity), 7);
  });

  it('actually clamps speed without overflow or changing direction', () => {
    for (const baseSpeed of [10, 1e200]) {
      const field = new OceanCurrentField(withoutTurbulence({
        baseDirection: [1, 2, 3],
        baseSpeed,
        maxSpeed: 0.5,
      }));
      const velocity = velocityAt(field, 0, 0, 0);
      expect(Math.hypot(...velocity)).toBeCloseTo(0.5, 6);
      const expectedLength = Math.hypot(1, 2, 3);
      for (let index = 0; index < 3; index += 1) {
        expect(velocity[index]).toBeCloseTo(0.5 * (index + 1) / expectedLength, 6);
      }
    }
  });

  it('reduces very large time values modulo the period instead of overflowing phase', () => {
    const field = new OceanCurrentField({ boundaryLayerHeight: 0 });
    const velocity = velocityAt(field, 1, 2, 3, Number.MAX_VALUE);
    for (const component of velocity) expect(Number.isFinite(component)).toBe(true);
    expect(Math.hypot(...velocity)).toBeLessThanOrEqual(field.config.maxSpeed);
    expect(() => velocityAt(field, 0, 0, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('derives explicit vortex geometry without duplicating reef definitions', () => {
    const vortices = createReefVortices([{ center: [3, 2, -4], radius: 1.5 }], 0.2, 2);
    expect(vortices).toHaveLength(1);
    expect(vortices[0].center).toEqual([3, 2, -4]);
    expect(vortices[0].radius).toBeCloseTo(3);
    expect(vortices[0].strength).toBe(0.2);
    expect(() => createReefVortices([{ center: [0, 0, 0], radius: 0 }])).toThrow(RangeError);
  });

  it.each([
    { baseSpeed: -1 },
    { turbulenceAmplitude: -0.1 },
    { turbulenceLength: 0 },
    { turbulencePeriod: 0 },
    { boundaryLayerHeight: -1 },
    { maxSpeed: -1 },
    { maxSpeed: 3.5e38 },
    { turbulenceLength: Number.MIN_VALUE },
    { turbulencePeriod: Number.MIN_VALUE },
    { baseDirection: [0, 0, 0], baseSpeed: 0.2 },
    { vortices: [{ center: [0, 0, 0], radius: Number.NaN, strength: 0.1 }] },
    { vortices: [{ center: [0, 0, 0], radius: 1, strength: Number.NaN }] },
    { vortices: [{ center: [0, 0, 0], radius: 1, strength: 0.1, axis: [0, 0, 0] }] },
  ] as Partial<OceanCurrentConfig>[])('rejects invalid configuration %#', (config) => {
    expect(() => new OceanCurrentField(config)).toThrow(RangeError);
  });

  it('allows an entirely disabled current with a zero base direction', () => {
    const field = new OceanCurrentField(withoutTurbulence({
      baseDirection: [0, 0, 0],
      baseSpeed: 0,
      maxSpeed: 0,
    }));
    expect(velocityAt(field, 0, 0, 0)).toEqual(new Float32Array(3));
  });
});
