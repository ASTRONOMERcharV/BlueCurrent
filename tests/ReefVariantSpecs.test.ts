import { describe, expect, it } from 'vitest';
import {
  HERO_REEF_SPEC,
  REEF_VARIANT_ORDER,
  REEF_VARIANT_SPECS,
} from '../src/rendering/reefVariantSpecs';
import { REEF_SAMPLE_ANCHOR_INDEX } from '../src/rendering/ReefSample';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';

describe('reef variant specs', () => {
  it('contains the hero plus four derived variants with unique identifiers', () => {
    expect(REEF_VARIANT_SPECS).toHaveLength(5);
    expect(new Set(REEF_VARIANT_SPECS.map((spec) => spec.id)).size).toBe(5);
    expect(new Set(REEF_VARIANT_SPECS.map((spec) => spec.anchorIndex)).size).toBe(5);
    expect(new Set(REEF_VARIANT_SPECS.map((spec) => spec.assetPrefix)).size).toBe(5);
    expect(REEF_VARIANT_ORDER).toEqual(REEF_VARIANT_SPECS.map((spec) => spec.id));
  });

  it('anchors the hero on obstacle 2 and the variants on 0, 1, 3 and 4', () => {
    expect(HERO_REEF_SPEC.anchorIndex).toBe(REEF_SAMPLE_ANCHOR_INDEX);
    expect(REEF_VARIANT_SPECS.map((spec) => spec.anchorIndex)).toEqual([2, 0, 1, 3, 4]);
    expect(REEF_VARIANT_SPECS.map((spec) => spec.label)).toEqual([
      'Hero sample', 'Spire', 'Platform', 'Twin', 'Terraces',
    ]);
  });

  it('uses one dominant hero with medium and laterally extended low reefs', () => {
    for (const spec of REEF_VARIANT_SPECS) {
      if (spec.id === 'hero') continue;
      expect(HERO_REEF_SPEC.targetHeight / spec.targetHeight).toBeGreaterThanOrEqual(1.35);
    }
    for (const id of ['b', 'd'] as const) {
      const spec = REEF_VARIANT_SPECS.find((entry) => entry.id === id)!;
      expect(spec.targetHeight).toBeGreaterThan(6);
      expect(spec.targetHeight).toBeLessThan(7);
    }
    for (const id of ['c', 'e'] as const) {
      const spec = REEF_VARIANT_SPECS.find((entry) => entry.id === id)!;
      expect(spec.targetHeight).toBeLessThan(5);
      expect(spec.targetWidth / spec.targetHeight).toBeGreaterThan(1.35);
    }
    expect(new Set(REEF_VARIANT_SPECS.map((spec) => spec.targetHeight)).size).toBe(5);
  });

  it('keeps the existing collision budgets and open channel clearances', () => {
    for (const spec of REEF_VARIANT_SPECS) {
      const obstacle = REEF_OBSTACLES[spec.anchorIndex];
      expect(spec.obstacleRadius).toBe(obstacle.radius);
      expect(spec.targetWidth).toBeLessThanOrEqual(obstacle.radius * 2.1);
      expect(spec.targetDepth).toBeLessThanOrEqual(obstacle.radius * 2);
      expect(spec.targetHeight).toBeGreaterThan(0);
      expect(spec.assetPrefix.length).toBeGreaterThan(0);
    }

    // Existing obstacle centres already define usable swimming gaps. The
    // composition pass reveals them visually instead of moving the simulation.
    const channelPairs = [[0, 1], [1, 3], [2, 3], [0, 4]] as const;
    for (const [aIndex, bIndex] of channelPairs) {
      const a = REEF_OBSTACLES[aIndex];
      const b = REEF_OBSTACLES[bIndex];
      const centreDistance = Math.hypot(
        a.center[0] - b.center[0],
        a.center[2] - b.center[2],
      );
      expect(centreDistance - a.radius - b.radius).toBeGreaterThan(4);
    }
  });

  it('leans secondary reefs while keeping the hero upright', () => {
    expect(HERO_REEF_SPEC.tiltXDegrees).toBe(0);
    expect(HERO_REEF_SPEC.tiltZDegrees).toBe(0);
    const secondary = REEF_VARIANT_SPECS.filter((spec) => spec.id !== 'hero');
    expect(secondary.filter(
      (spec) => spec.tiltXDegrees !== 0 || spec.tiltZDegrees !== 0,
    )).toHaveLength(4);
    for (const spec of secondary) {
      expect(Math.abs(spec.tiltXDegrees)).toBeLessThanOrEqual(4);
      expect(Math.abs(spec.tiltZDegrees)).toBeLessThanOrEqual(4);
    }
  });

  it('uses ordered LOD distances and non-empty epibiont plans', () => {
    for (const spec of REEF_VARIANT_SPECS) {
      const [near, far] = spec.lodDistances;
      expect(near).toBeGreaterThan(0);
      expect(far).toBeGreaterThan(near);
      expect(spec.epibiontSeed).toBeGreaterThan(0);
      expect(spec.apronSeed).toBeGreaterThan(0);
      expect(spec.epibiontOptions.clusterCount ?? 7).toBeGreaterThan(0);
    }
  });
});
