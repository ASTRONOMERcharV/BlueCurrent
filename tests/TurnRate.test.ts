import { describe, expect, it } from 'vitest';
import { clampVelocityTurn } from '../src/simulation/math';

describe('turn-rate limiting', () => {
  it('preserves speed while limiting a sharp direction change', () => {
    const out = new Float32Array(3);
    clampVelocityTurn(4, 0, 0, 0, 4, 0, 1, 0.1, out);
    const [x, y, z] = out;
    expect(Math.hypot(x, y, z)).toBeCloseTo(4, 6);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(Math.acos(x / 4)).toBeCloseTo(0.1, 5);
    expect(z).toBeCloseTo(0, 8);
  });

  it('leaves a turn inside the limit untouched', () => {
    const out = new Float32Array(3);
    clampVelocityTurn(4, 0, 0, 4, 0, 0, 2, 1 / 60, out);
    expect(Array.from(out)).toEqual([4, 0, 0]);
  });
});
