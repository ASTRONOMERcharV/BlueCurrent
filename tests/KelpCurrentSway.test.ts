import { describe, expect, it } from 'vitest';
import { localSwayDirection } from '../src/rendering/KelpScatter';

describe('kelp current direction', () => {
  it('rotates world flow into the instance local axes', () => {
    const out = new Float32Array(2);
    localSwayDirection(0, 3, 0, out);
    expect(Array.from(out)).toEqual([0, 1]);

    localSwayDirection(2, 0, Math.PI / 2, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);

    localSwayDirection(0, 4, Math.PI / 2, out);
    expect(out[0]).toBeCloseTo(-1, 6);
    expect(out[1]).toBeCloseTo(0, 6);
  });

  it('falls back to a stable local direction for still water', () => {
    const out = new Float32Array(2);
    localSwayDirection(0, 0, 1.3, out);
    expect(Array.from(out)).toEqual([1, 0]);
  });
});
