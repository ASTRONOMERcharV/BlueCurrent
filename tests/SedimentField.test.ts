import { describe, expect, it } from 'vitest';
import { SedimentField } from '../src/environment/SedimentField';
import type { SedimentFlockView } from '../src/environment/SedimentField';
import { floorHeightAt } from '../src/rendering/rockPlacement';

function flockAt(
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  count = 1,
): SedimentFlockView {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const alive = new Uint8Array(count).fill(1);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = x + (index % 4) * 0.12;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z + Math.floor(index / 4) * 0.12;
    velocities[index * 3] = vx;
    velocities[index * 3 + 1] = vy;
    velocities[index * 3 + 2] = vz;
  }
  return { positions, velocities, alive, count };
}

const eastward = (
  _x: number,
  _y: number,
  _z: number,
  _time: number,
  out: Float32Array,
): void => {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
};

function advance(field: SedimentField, flock: SedimentFlockView, steps: number): void {
  for (let index = 0; index < steps; index += 1) {
    field.update(1 / 30, index / 30, flock, eastward);
  }
}

describe('sediment field', () => {
  it('raises particles only for low, fast fish', () => {
    const ground = floorHeightAt(0, 0);
    const field = new SedimentField({ capacity: 64 });
    advance(field, flockAt(0, ground + 0.2, 0, 2, -0.1, 0), 90);
    expect(field.activeCount).toBeGreaterThan(0);

    const high = new SedimentField({ capacity: 64 });
    advance(high, flockAt(0, 12, 0, 2, 0, 0), 90);
    expect(high.activeCount).toBe(0);

    const slow = new SedimentField({ capacity: 64 });
    advance(slow, flockAt(0, ground + 0.2, 0, 0.2, 0, 0), 90);
    expect(slow.activeCount).toBe(0);
  });

  it('keeps particles finite, above the floor and coupled to the current', () => {
    const ground = floorHeightAt(0, 0);
    const field = new SedimentField({ capacity: 64 });
    advance(field, flockAt(0, ground + 0.2, 0, 2, -0.1, 0), 120);
    let sawEastward = false;
    for (let index = 0; index < field.capacity; index += 1) {
      if (field.alive[index] === 0) continue;
      const offset = index * 3;
      expect(Number.isFinite(field.positions[offset])).toBe(true);
      expect(Number.isFinite(field.positions[offset + 1])).toBe(true);
      expect(Number.isFinite(field.positions[offset + 2])).toBe(true);
      expect(field.positions[offset + 1]).toBeGreaterThanOrEqual(
        floorHeightAt(field.positions[offset], field.positions[offset + 2]) + 0.019,
      );
      expect(field.alpha[index]).toBeGreaterThanOrEqual(0);
      expect(field.alpha[index]).toBeLessThanOrEqual(1);
      if (field.velocities[offset] > 0.05) sawEastward = true;
    }
    expect(sawEastward).toBe(true);
  });

  it('is deterministic for the same seed and input sequence', () => {
    const ground = floorHeightAt(0, 0);
    const first = new SedimentField({ capacity: 64 });
    const second = new SedimentField({ capacity: 64 });
    advance(first, flockAt(0, ground + 0.2, 0, 2, -0.1, 0), 90);
    advance(second, flockAt(0, ground + 0.2, 0, 2, -0.1, 0), 90);
    expect(second.positions).toEqual(first.positions);
    expect(second.velocities).toEqual(first.velocities);
    expect(second.activeCount).toBe(first.activeCount);
  });

  it('caps the pool and clears on reset', () => {
    const ground = floorHeightAt(0, 0);
    const field = new SedimentField({ capacity: 16 });
    advance(field, flockAt(0, ground + 0.2, 0, 2, -0.1, 0, 100), 120);
    expect(field.activeCount).toBeLessThanOrEqual(16);
    expect(field.activeCount).toBeGreaterThan(0);
    field.reset();
    expect(field.activeCount).toBe(0);
    expect(field.alive.some((value) => value !== 0)).toBe(false);
  });
});
