import { describe, expect, it } from 'vitest';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';
import {
  FLOOR_BASE_Y,
  ROCK_DIMENSIONS,
  allPlacements,
  floorHeightAt,
  generateRockLayout,
} from '../src/rendering/rockPlacement';

describe('rock placement', () => {
  it('is deterministic for a fixed seed', () => {
    const first = generateRockLayout(REEF_OBSTACLES, 1234);
    const second = generateRockLayout(REEF_OBSTACLES, 1234);
    expect(second).toEqual(first);
  });

  it('reshuffles decoration for a different seed', () => {
    const first = generateRockLayout(REEF_OBSTACLES, 1234);
    const second = generateRockLayout(REEF_OBSTACLES, 9876);
    expect(second.medium).not.toEqual(first.medium);
  });

  it('anchors the five large rocks to the simulation obstacles', () => {
    const layout = generateRockLayout(REEF_OBSTACLES);
    expect(layout.large).toHaveLength(REEF_OBSTACLES.length);
    layout.large.forEach((placement, index) => {
      const obstacle = REEF_OBSTACLES[index];
      expect(placement.x).toBeCloseTo(obstacle.center[0]);
      expect(placement.z).toBeCloseTo(obstacle.center[2]);
      expect(placement.kind).toBe('large');
      expect(ROCK_DIMENSIONS[placement.name].kind).toBe('large');
    });
  });

  it('keeps medium rocks clear of reefs and each other', () => {
    const layout = generateRockLayout(REEF_OBSTACLES);
    expect(layout.medium.length).toBeGreaterThanOrEqual(12);
    for (const placement of layout.medium) {
      for (const obstacle of REEF_OBSTACLES) {
        const distance = Math.hypot(placement.x - obstacle.center[0], placement.z - obstacle.center[2]);
        expect(distance).toBeGreaterThan(obstacle.radius + 1.3);
      }
      expect(Math.abs(placement.x)).toBeLessThanOrEqual(25);
      expect(Math.abs(placement.z)).toBeLessThanOrEqual(25);
    }
    for (let i = 0; i < layout.medium.length; i += 1) {
      for (let j = i + 1; j < layout.medium.length; j += 1) {
        const a = layout.medium[i];
        const b = layout.medium[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2.2);
      }
    }
  });

  it('scatters dunes away from the reef cores with no overlaps', () => {
    const layout = generateRockLayout(REEF_OBSTACLES);
    expect(layout.dunes).toHaveLength(5);
    layout.dunes.forEach((placement) => {
      expect(ROCK_DIMENSIONS[placement.name].kind).toBe('dune');
      for (const obstacle of REEF_OBSTACLES) {
        const distance = Math.hypot(placement.x - obstacle.center[0], placement.z - obstacle.center[2]);
        expect(distance).toBeGreaterThan(obstacle.radius + 4.0);
      }
    });
    for (let i = 0; i < layout.dunes.length; i += 1) {
      for (let j = i + 1; j < layout.dunes.length; j += 1) {
        const a = layout.dunes[i];
        const b = layout.dunes[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4.0);
      }
    }
  });

  it('embeds every placement into the sea floor', () => {
    const layout = generateRockLayout(REEF_OBSTACLES);
    for (const placement of allPlacements(layout)) {
      const floor = floorHeightAt(placement.x, placement.z);
      expect(placement.y).toBeLessThanOrEqual(floor);
      expect(placement.scale).toBeGreaterThan(0.5);
      expect(Number.isFinite(placement.yaw)).toBe(true);
    }
  });

  it('derives floor heights from the multi-scale terrain function', () => {
    const x = 7.3;
    const z = -4.1;
    expect(floorHeightAt(x, z)).toBeCloseTo(
      FLOOR_BASE_Y
        + Math.sin(x * 0.42) * Math.cos(z * 0.35) * 0.17
        + Math.sin(x * 0.13 + 1.1) * Math.cos(z * 0.18 - 0.6) * 0.23
        + Math.sin((x + z) * 0.085 + 0.4) * 0.16,
      6,
    );
    expect(Math.max(floorHeightAt(-20, 20), floorHeightAt(0, 0), floorHeightAt(20, -20)))
      .toBeGreaterThan(FLOOR_BASE_Y);
  });

  it('keeps the observation-side foreground dune subordinate to the reef', () => {
    const layout = generateRockLayout(REEF_OBSTACLES);
    const foreground = layout.dunes.filter(
      (placement) => placement.z > 15 && placement.x > -12 && placement.x < 2,
    );
    expect(foreground).toHaveLength(1);
    expect(foreground[0].scale).toBeLessThan(0.85);
    // Shrinking the foreground accent must not reshuffle the other dunes.
    expect(layout.dunes).toHaveLength(5);
  });

  it('leaves the central swimming corridor free of medium decorative rocks', () => {
    const layout = generateRockLayout(REEF_OBSTACLES);
    for (const placement of layout.medium) {
      if (Math.abs(placement.x) < 7) {
        expect(placement.z).toBeGreaterThanOrEqual(16);
      }
    }
  });
});
