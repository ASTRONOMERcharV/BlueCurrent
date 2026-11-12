import { describe, expect, it } from 'vitest';
import {
  MarineSnowSimulation,
  wrapMarineSnowCoordinate,
  type CurrentSampler,
} from '../src/environment/MarineSnowField';

class ConstantField implements CurrentSampler {
  calls = 0;
  constructor(
    private readonly velocity: readonly [number, number, number],
    private readonly expectedTime = 0,
  ) {}

  sample(_x: number, _y: number, _z: number, time: number, out: Float32Array): void {
    this.calls += 1;
    expect(time).toBe(this.expectedTime);
    out[0] = this.velocity[0];
    out[1] = this.velocity[1];
    out[2] = this.velocity[2];
  }
}

const ROOMY_BOUNDS = {
  min: [-100, -100, -100] as const,
  max: [100, 100, 100] as const,
};

function makeSimulation(count = 4): MarineSnowSimulation {
  return new MarineSnowSimulation({ count, bounds: ROOMY_BOUNDS, seed: 12345 });
}

describe('marine snow field', () => {
  it('wraps coordinates inside the volume', () => {
    expect(wrapMarineSnowCoordinate(1.5, 0, 1)).toBeCloseTo(0.5, 10);
    expect(wrapMarineSnowCoordinate(-0.25, 0, 1)).toBeCloseTo(0.75, 10);
    expect(wrapMarineSnowCoordinate(0.5, 0, 1)).toBeCloseTo(0.5, 10);
    expect(() => wrapMarineSnowCoordinate(0, 1, 1)).toThrow(RangeError);
  });

  it('is deterministic for a fixed seed', () => {
    const first = makeSimulation(16);
    const second = makeSimulation(16);
    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    expect(Array.from(first.sizes)).toEqual(Array.from(second.sizes));
    const other = new MarineSnowSimulation({
      count: 16,
      bounds: ROOMY_BOUNDS,
      seed: 999,
    });
    expect(Array.from(other.positions)).not.toEqual(Array.from(first.positions));
  });

  it('advects with the current rather than an independent random walk', () => {
    const simulation = makeSimulation(1);
    simulation.positions.set([10, 5, -2]);
    simulation.verticalSpeeds[0] = 0;
    const field = new ConstantField([0.8, 0, -0.6]);
    simulation.update(field, 0, 0.5);
    expect(simulation.positions[0]).toBeCloseTo(10.4, 6);
    expect(simulation.positions[1]).toBeCloseTo(5, 6);
    expect(simulation.positions[2]).toBeCloseTo(-2.3, 6);
    expect(field.calls).toBe(1);
  });

  it('wraps at the far edge after advection', () => {
    const simulation = new MarineSnowSimulation({
      count: 1,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      seed: 1,
    });
    simulation.positions.set([0.8, 0.5, 0.5]);
    simulation.verticalSpeeds[0] = 0;
    const field = new ConstantField([1, 0, 0]);
    simulation.update(field, 0, 0.5);
    expect(simulation.positions[0]).toBeCloseTo(0.3, 6);
  });

  it('lets most flakes settle and a small fraction rise in still water', () => {
    const simulation = makeSimulation(64);
    const still = new ConstantField([0, 0, 0]);
    let settling = -1;
    let rising = -1;
    for (let index = 0; index < simulation.count; index += 1) {
      if (settling < 0 && simulation.verticalSpeeds[index] < 0) settling = index;
      if (rising < 0 && simulation.verticalSpeeds[index] > 0) rising = index;
    }
    expect(settling).toBeGreaterThanOrEqual(0);
    expect(rising).toBeGreaterThanOrEqual(0);

    simulation.positions[settling * 3 + 1] = 5;
    simulation.positions[rising * 3 + 1] = 5;
    simulation.update(still, 0, 1);
    expect(simulation.positions[settling * 3 + 1]).toBeLessThan(5);
    expect(simulation.positions[rising * 3 + 1]).toBeGreaterThan(5);
  });

  it('scales horizontal advection without changing the sampled current', () => {
    const base = makeSimulation(1);
    const fast = makeSimulation(1);
    base.positions.set([0, 0, 0]);
    fast.positions.set([0, 0, 0]);
    base.verticalSpeeds[0] = 0;
    fast.verticalSpeeds[0] = 0;
    const field = new ConstantField([1, 0, 0]);
    base.update(field, 0, 0.25, 1);
    fast.update(field, 0, 0.25, 2);
    expect(base.positions[0]).toBeCloseTo(0.25, 6);
    expect(fast.positions[0]).toBeCloseTo(0.5, 6);
  });

  it('samples the shared field once per particle per update', () => {
    const simulation = makeSimulation(12);
    const field = new ConstantField([0.3, 0.1, -0.2]);
    simulation.update(field, 0, 1 / 60);
    expect(field.calls).toBe(12);
  });

  it('rejects invalid configuration and negative time steps', () => {
    expect(() => new MarineSnowSimulation({
      count: 0,
      bounds: ROOMY_BOUNDS,
      seed: 1,
    })).toThrow(RangeError);
    expect(() => new MarineSnowSimulation({
      count: 1,
      bounds: { min: [0, 0, 0], max: [0, 1, 1] },
      seed: 1,
    })).toThrow(RangeError);
    expect(() => makeSimulation().update(new ConstantField([0, 0, 0]), 0, -1))
      .toThrow(RangeError);
  });
});
