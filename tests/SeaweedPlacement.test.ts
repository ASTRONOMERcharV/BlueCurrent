import { describe, expect, it } from 'vitest';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import { generateSeaweedLayout } from '../src/rendering/seaweedPlacement';

describe('generateSeaweedLayout', () => {
  it('is deterministic for the same seed', () => {
    expect(generateSeaweedLayout(REEF_OBSTACLES)).toEqual(generateSeaweedLayout(REEF_OBSTACLES));
  });

  it('places six detail clumps', () => {
    const layout = generateSeaweedLayout(REEF_OBSTACLES);
    expect(layout).toHaveLength(6);
  });

  it('plants every rock base on the procedural floor', () => {
    for (const placement of generateSeaweedLayout(REEF_OBSTACLES)) {
      expect(placement.y).toBeCloseTo(floorHeightAt(placement.x, placement.z) - 0.04, 6);
    }
  });

  it('keeps bases outside the collider spheres', () => {
    for (const placement of generateSeaweedLayout(REEF_OBSTACLES)) {
      for (const obstacle of REEF_OBSTACLES) {
        const distance = Math.hypot(
          placement.x - obstacle.center[0],
          placement.z - obstacle.center[2],
        );
        expect(distance).toBeGreaterThanOrEqual(obstacle.radius * 1.33);
      }
    }
  });

  it('scales to roughly 2-2.5 m world height and varies sway', () => {
    const layout = generateSeaweedLayout(REEF_OBSTACLES);
    for (const placement of layout) {
      expect(placement.scale).toBeGreaterThanOrEqual(1.7);
      expect(placement.scale).toBeLessThanOrEqual(2.05);
      expect(placement.frequency).toBeGreaterThanOrEqual(0.85);
      expect(placement.frequency).toBeLessThanOrEqual(1.15);
      expect(placement.amplitude).toBeGreaterThanOrEqual(0.85);
      expect(placement.amplitude).toBeLessThanOrEqual(1.15);
      expect(placement.phase).toBeGreaterThanOrEqual(0);
      expect(placement.phase).toBeLessThan(Math.PI * 2);
    }
    expect(new Set(layout.map((placement) => placement.phase.toFixed(4))).size).toBe(layout.length);
  });
});
