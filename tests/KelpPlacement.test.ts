import { describe, expect, it } from 'vitest';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import {
  CENTRAL_CORRIDOR_HALF_WIDTH,
  KELP_CANOPY_RADIUS,
  generateKelpLayout,
} from '../src/rendering/kelpPlacement';

describe('generateKelpLayout', () => {
  it('is deterministic for the same seed', () => {
    const first = generateKelpLayout(REEF_OBSTACLES);
    const second = generateKelpLayout(REEF_OBSTACLES);
    expect(second).toEqual(first);
  });

  it('builds substantial left and right groves instead of a uniform scatter', () => {
    const layout = generateKelpLayout(REEF_OBSTACLES);
    const left = layout.filter((placement) => placement.side === 'left');
    const right = layout.filter((placement) => placement.side === 'right');
    expect(layout).toHaveLength(91);
    expect(left.length).toBeGreaterThanOrEqual(40);
    expect(right.length).toBeGreaterThanOrEqual(40);
    expect(layout.filter((placement) => placement.name === 'kelp_a').length).toBeGreaterThanOrEqual(20);
    expect(layout.filter((placement) => placement.name === 'kelp_b').length).toBeGreaterThanOrEqual(20);
    for (const band of ['foreground', 'midground', 'background'] as const) {
      expect(layout.filter((placement) => placement.band === band).length).toBeGreaterThan(0);
    }
  });

  it('plants every base on the procedural floor', () => {
    for (const placement of generateKelpLayout(REEF_OBSTACLES)) {
      expect(placement.y).toBeCloseTo(floorHeightAt(placement.x, placement.z) - 0.05, 6);
    }
  });

  it('keeps bases outside the collider spheres', () => {
    for (const placement of generateKelpLayout(REEF_OBSTACLES)) {
      for (const obstacle of REEF_OBSTACLES) {
        const distance = Math.hypot(
          placement.x - obstacle.center[0],
          placement.z - obstacle.center[2],
        );
        expect(distance).toBeGreaterThanOrEqual(obstacle.radius * 1.14);
      }
    }
  });

  it('keeps crowns and their sway envelope out of the central corridor', () => {
    for (const placement of generateKelpLayout(REEF_OBSTACLES)) {
      const crown = KELP_CANOPY_RADIUS[placement.name] * placement.scale;
      const sway = 0.38 * 1.18 * placement.scale;
      expect(Math.abs(placement.x) - crown - sway).toBeGreaterThanOrEqual(CENTRAL_CORRIDOR_HALF_WIDTH);
    }
  });

  it('uses taller foreground kelp and shorter background kelp', () => {
    const layout = generateKelpLayout(REEF_OBSTACLES);
    const top = (placements: typeof layout): number => Math.max(...placements.map(
      (placement) => (placement.name === 'kelp_a' ? 3.55 : 2.8) * placement.scale,
    ));
    expect(top(layout.filter((placement) => placement.band === 'foreground'))).toBeGreaterThan(7);
    expect(top(layout.filter((placement) => placement.band === 'background'))).toBeLessThan(5);
  });

  it('varies sway phase, frequency and amplitude', () => {
    const layout = generateKelpLayout(REEF_OBSTACLES);
    expect(new Set(layout.map((placement) => placement.phase.toFixed(4))).size).toBe(layout.length);
    expect(Math.min(...layout.map((placement) => placement.frequency))).toBeLessThan(0.9);
    expect(Math.max(...layout.map((placement) => placement.frequency))).toBeGreaterThan(1.1);
    expect(Math.min(...layout.map((placement) => placement.amplitude))).toBeLessThan(0.9);
    expect(Math.max(...layout.map((placement) => placement.amplitude))).toBeGreaterThan(1.1);
    for (const placement of layout) {
      expect(placement.phase).toBeGreaterThanOrEqual(0);
      expect(placement.phase).toBeLessThan(Math.PI * 2);
    }
  });
});
