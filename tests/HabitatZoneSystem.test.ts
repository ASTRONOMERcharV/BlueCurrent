import { describe, expect, it } from 'vitest';
import {
  createHabitatSample,
  HabitatZoneSystem,
  KELP_GEOMETRY_PROFILES,
  kelpAnchorsFromLayout,
  type HabitatZone,
  type HabitatZoneOptions,
  type KelpAnchor,
} from '../src/environment/HabitatZoneSystem';
import { generateKelpLayout } from '../src/rendering/kelpPlacement';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';

function flatHabitat(options: HabitatZoneOptions = {}): HabitatZoneSystem {
  return new HabitatZoneSystem({
    bounds: { min: [-20, 0, -20], max: [20, 20, 20] },
    floorAt: () => 0,
    ...options,
  });
}

function sampleAt(habitat: HabitatZoneSystem, x: number, y: number, z: number) {
  return habitat.sample(x, y, z, createHabitatSample());
}

function existingHabitat(): HabitatZoneSystem {
  return new HabitatZoneSystem({
    kelp: kelpAnchorsFromLayout(generateKelpLayout(REEF_OBSTACLES)),
    reefs: REEF_OBSTACLES,
  });
}

describe('HabitatZoneSystem', () => {
  it.each([
    [1, 'benthic'],
    [6, 'lower-midwater'],
    [12, 'upper-midwater'],
    [18, 'surface-canopy'],
  ] as [number, HabitatZone][])('classifies the dominant layer at h=%s', (height, zone) => {
    expect(sampleAt(flatHabitat(), 0, height, 0).zone).toBe(zone);
  });

  it('keeps all four continuous layer weights normalized across and beyond the water column', () => {
    const habitat = flatHabitat();
    const out = createHabitatSample();
    for (let height = -2; height <= 24; height += 0.05) {
      habitat.sample(0, height, 0, out);
      const weights = Object.values(out.weights);
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      for (const weight of weights) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stays normalized and non-negative when custom layer transitions overlap', () => {
    const habitat = flatHabitat({
      benthicTop: 2.5,
      lowerMidwaterTop: 3,
      upperMidwaterTop: 3.5,
      layerTransition: 4,
    });
    for (let height = -1; height <= 7; height += 0.01) {
      const out = sampleAt(habitat, 0, height, 0);
      const weights = Object.values(out.weights);
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      for (const weight of weights) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it('blends layer boundaries smoothly rather than creating hard boxes', () => {
    const habitat = flatHabitat();
    const before = sampleAt(habitat, 0, 2.499, 0);
    const after = sampleAt(habitat, 0, 2.501, 0);
    expect(Math.abs(after.weights.benthic - before.weights.benthic)).toBeLessThan(0.004);
    expect(before.weights.lowerMidwater).toBeGreaterThan(0);
    expect(after.weights.benthic).toBeGreaterThan(0);
  });

  it('reports physical height/depth and monotonically attenuates relative light', () => {
    const habitat = flatHabitat({ lightAttenuation: 0.055 });
    const deep = sampleAt(habitat, 0, 2, 0);
    const middle = sampleAt(habitat, 0, 10, 0);
    const shallow = sampleAt(habitat, 0, 18, 0);
    expect(deep.depth).toBe(18);
    expect(deep.heightAboveFloor).toBe(2);
    expect(deep.lightIntensity).toBeLessThan(middle.lightIntensity);
    expect(middle.lightIntensity).toBeLessThan(shallow.lightIntensity);
    expect(sampleAt(habitat, 0, 21, 0).lightIntensity).toBe(1);
  });

  it('converts all 91 grouped kelp placements using asset crown dimensions', () => {
    const layout = generateKelpLayout(REEF_OBSTACLES);
    const anchors = kelpAnchorsFromLayout(layout);
    // Independent asset-bounds expectations; do not derive both sides from one constant.
    expect(KELP_GEOMETRY_PROFILES).toEqual({
      kelp_a: { height: 3.55, canopyRadius: 1.29315 },
      kelp_b: { height: 2.8, canopyRadius: 0.96785 },
    });
    expect(anchors).toHaveLength(91);
    // 2026-11-11 reef scale-up moved the left groves outward; the fixed 91
    // plants now resolve to a slightly broader kelp_a share.
    expect(anchors.filter((anchor) => anchor.name === 'kelp_a')).toHaveLength(51);
    expect(anchors.filter((anchor) => anchor.name === 'kelp_b')).toHaveLength(40);
    for (let index = 0; index < anchors.length; index += 1) {
      const profile = KELP_GEOMETRY_PROFILES[layout[index].name];
      expect(anchors[index].height).toBeCloseTo(profile.height * layout[index].scale, 12);
      expect(anchors[index].canopyRadius).toBeCloseTo(
        profile.canopyRadius * layout[index].scale,
        12,
      );
      expect(anchors[index].y).toBeCloseTo(floorHeightAt(layout[index].x, layout[index].z) - 0.05, 12);
    }
  });

  it('classifies decorative foreground and background anchors outside the simulation volume', () => {
    const habitat = existingHabitat();
    const outside = habitat.kelp.filter((anchor) => (
      Math.abs(anchor.x) > 20 || Math.abs(anchor.z) > 20
    ));
    expect(outside).toHaveLength(16);
    for (const anchor of outside) {
      expect(sampleAt(habitat, anchor.x, 10, anchor.z).inBounds).toBe(false);
    }
  });

  it('samples a real kelp crown vertically and removes density above its top', () => {
    const anchor: KelpAnchor = {
      name: 'kelp_a', x: 2, y: -0.25, z: -3, height: 4, canopyRadius: 1.5,
    };
    const habitat = flatHabitat({ floorAt: () => -0.25, kelp: [anchor] });
    const middle = sampleAt(habitat, 2, 1.75, -3);
    expect(middle.kelpDensity).toBeCloseTo(1, 7);
    expect(middle.canopyTopY).toBeCloseTo(3.75, 7);
    expect(habitat.canopyTopAt(2, -3)).toBeCloseTo(3.75, 7);
    expect(sampleAt(habitat, 2, 3.76, -3).kelpDensity).toBe(0);
    expect(sampleAt(habitat, 2, -0.25, -3).kelpDensity).toBe(0);
  });

  it('uses the tallest overlapping canopy independently of anchor order', () => {
    const kelp: KelpAnchor[] = [
      { name: 'kelp_a', x: 0, y: 0, z: 0, height: 2, canopyRadius: 2 },
      { name: 'kelp_b', x: 0.5, y: 0, z: 0, height: 4, canopyRadius: 2 },
    ];
    const first = flatHabitat({ kelp });
    const second = flatHabitat({ kelp: [...kelp].reverse() });
    expect(first.canopyTopAt(0, 0)).toBe(4);
    expect(second.canopyTopAt(0, 0)).toBe(4);
    expect(sampleAt(first, 0, 3, 0)).toEqual(sampleAt(second, 0, 3, 0));
  });

  it('falls smoothly from crown cover through the edge into open water', () => {
    const habitat = flatHabitat({
      kelp: [{ name: 'kelp_a', x: 0, y: 0, z: 0, height: 4, canopyRadius: 2 }],
    });
    const center = sampleAt(habitat, 0, 2, 0).kelpDensity;
    const edge = sampleAt(habitat, 2, 2, 0).kelpDensity;
    const softEdge = sampleAt(habitat, 2.1, 2, 0);
    const outside = sampleAt(habitat, 3, 2, 0).kelpDensity;
    expect(center).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(softEdge.kelpDensity);
    expect(softEdge.kelpDensity).toBeGreaterThan(outside);
    expect(softEdge.canopyTopY).toBe(4);
    expect(habitat.canopyTopAt(2.1, 0)).toBe(4);
    expect(outside).toBe(0);
    expect(habitat.canopyTopAt(3, 0)).toBe(0);
  });

  it('reports three-dimensional reef proximity without treating reefs as boxes', () => {
    const habitat = flatHabitat({
      reefs: [{ center: [1, 2, 3], radius: 2 }],
      reefInfluenceMargin: 2,
    });
    expect(sampleAt(habitat, 1, 2, 3).reefProximity).toBe(1);
    expect(sampleAt(habitat, 1, 2, 6).reefProximity).toBeCloseTo(0.5, 7);
    expect(sampleAt(habitat, 1, 2, 7).reefProximity).toBe(0);
    expect(sampleAt(habitat, 1, 6, 3).reefProximity).toBe(0);
  });

  it('reuses the exact seabed function and marks all three boundary axes', () => {
    const habitat = existingHabitat();
    const out = sampleAt(habitat, 4, 10, -2);
    expect(out.floorY).toBeCloseTo(floorHeightAt(4, -2), 12);
    expect(out.inBounds).toBe(true);
    expect(sampleAt(habitat, 21, 10, -2).inBounds).toBe(false);
    expect(sampleAt(habitat, 4, 0, -2).inBounds).toBe(false);
    expect(sampleAt(habitat, 4, 10, -21).inBounds).toBe(false);
  });

  it('handles degenerate zero-area anchors without NaN or ghost canopies', () => {
    const habitat = flatHabitat({
      floorAt: () => -0.25,
      kelp: [{ name: 'kelp_a', x: 0, y: 0, z: 0, height: 0, canopyRadius: 0 }],
      reefs: [{ center: [0, 0, 0], radius: 0 }],
    });
    const out = sampleAt(habitat, 0, 1, 0);
    expect(out.kelpDensity).toBe(0);
    expect(out.reefProximity).toBe(0);
    expect(out.canopyTopY).toBe(-0.25);
    for (const value of Object.values(out.weights)) expect(Number.isFinite(value)).toBe(true);
  });

  it('rejects non-finite query positions instead of returning a plausible-looking sample', () => {
    const habitat = flatHabitat();
    expect(() => sampleAt(habitat, Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => habitat.canopyTopAt(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('reuses the caller-provided output object', () => {
    const habitat = flatHabitat();
    const out = createHabitatSample();
    expect(habitat.sample(0, 10, 0, out)).toBe(out);
  });

  it.each([
    { benthicTop: 0 },
    { benthicTop: 3, lowerMidwaterTop: 3 },
    { lowerMidwaterTop: 8, upperMidwaterTop: 8 },
    { lowerMidwaterTop: Number.NaN },
    { upperMidwaterTop: Number.NaN },
    { lowerMidwaterTop: Number.POSITIVE_INFINITY },
    { upperMidwaterTop: Number.POSITIVE_INFINITY },
    { layerTransition: 0 },
    { kelpEdgeScale: 0.75 },
    { reefInfluenceMargin: -1 },
    { reefInfluenceMargin: 0 },
    { surfaceLightIntensity: 1.1 },
    { lightAttenuation: -0.1 },
  ] as HabitatZoneOptions[])('rejects invalid habitat configuration %#', (options) => {
    expect(() => flatHabitat(options)).toThrow(RangeError);
  });
});
