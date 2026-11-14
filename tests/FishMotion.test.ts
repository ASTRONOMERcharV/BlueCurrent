import { describe, expect, it } from 'vitest';
import {
  clampPitch,
  stepPitch,
  targetPitchFromDirection,
  turnFromBank,
} from '../src/rendering/fishMotion';

describe('fish motion helpers', () => {
  it('maps direction Y to a bounded pitch', () => {
    expect(targetPitchFromDirection(0)).toBeCloseTo(0, 8);
    expect(targetPitchFromDirection(1)).toBeCloseTo(Math.PI / 2, 6);
    expect(targetPitchFromDirection(-1)).toBeCloseTo(-Math.PI / 2, 6);
    expect(targetPitchFromDirection(4)).toBeCloseTo(Math.PI / 2, 6);
    expect(targetPitchFromDirection(-4)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('rate-limits and clamps the pitch step', () => {
    const dt = 1 / 60;
    const first = stepPitch(0, 1.4, dt, 9, 2.4, 0.9);
    expect(first).toBeLessThanOrEqual(2.4 * dt + 1e-9);
    expect(first).toBeGreaterThan(0);

    const settled = stepPitch(0.8, 1.4, 1, 9, 2.4, 0.9);
    expect(settled).toBeLessThanOrEqual(0.9);

    const down = stepPitch(-0.8, -1.4, 1, 9, 2.4, 0.9);
    expect(down).toBeGreaterThanOrEqual(-0.9);
  });

  it('keeps the current pitch when time does not advance', () => {
    expect(stepPitch(0.4, 0.9, 0, 9, 2.4, 0.9)).toBe(0.4);
    expect(stepPitch(0.4, 0.9, -0.1, 9, 2.4, 0.9)).toBe(0.4);
    expect(clampPitch(2, 0.9)).toBe(0.9);
  });

  it('normalises bank into a bounded turn signal', () => {
    expect(turnFromBank(0, 0.65)).toBe(0);
    expect(turnFromBank(0.65, 0.65)).toBe(1);
    expect(turnFromBank(-1.3, 0.65)).toBe(-1);
    expect(turnFromBank(0.325, 0.65)).toBeCloseTo(0.5, 8);
    expect(turnFromBank(1, 0)).toBe(0);
  });
});
