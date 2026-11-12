import { describe, expect, it } from 'vitest';
import {
  henyeyGreensteinPeak,
  henyeyGreensteinRelative,
  WATER_ATTENUATION_RGB,
  WATER_FOG_DENSITY,
  waterFogFactor,
  waterScatterLayerMix,
  waterSunLobe,
  waterSurfaceFactor,
  waterTransmittance,
  waterVisibilityDistance,
} from '../src/environment/UnderwaterOptics';

describe('underwater optics', () => {
  it('starts fully transparent and approaches complete in-scattering', () => {
    expect(waterFogFactor(0, WATER_FOG_DENSITY, 1)).toBe(0);
    const far = waterFogFactor(1200, WATER_FOG_DENSITY, 1);
    expect(far).toBeGreaterThan(0.99);
    expect(far).toBeLessThanOrEqual(1);
  });

  it('increases monotonically with view distance', () => {
    const samples = [0, 5, 10, 20, 40, 80].map((distance) => (
      waterFogFactor(distance, WATER_FOG_DENSITY, 1)
    ));
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1]);
    }
  });

  it('absorbs red before green and green before blue', () => {
    const distance = 30;
    const factors = [0, 1, 2].map((channel) => (
      waterFogFactor(distance, WATER_FOG_DENSITY, channel)
    ));
    expect(factors[0]).toBeGreaterThan(factors[1]);
    expect(factors[1]).toBeGreaterThan(factors[2]);
    expect(WATER_ATTENUATION_RGB[0]).toBeGreaterThan(WATER_ATTENUATION_RGB[2]);
  });

  it('keeps transmission and in-scattering complementary per channel', () => {
    const transmission = waterTransmittance(18, WATER_FOG_DENSITY);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(transmission[channel] + waterFogFactor(18, WATER_FOG_DENSITY, channel))
        .toBeCloseTo(1, 12);
    }
  });

  it('gives shorter visibility to red than blue', () => {
    const red = waterVisibilityDistance(0);
    const green = waterVisibilityDistance(1);
    const blue = waterVisibilityDistance(2);
    expect(red).toBeLessThan(green);
    expect(green).toBeLessThan(blue);
  });

  it('rejects invalid inputs instead of returning NaN', () => {
    expect(() => waterFogFactor(-1, 0.02, 0)).toThrow(RangeError);
    expect(() => waterFogFactor(1, -0.02, 0)).toThrow(RangeError);
    expect(() => waterFogFactor(1, 0.02, 3)).toThrow(RangeError);
    expect(() => waterVisibilityDistance(0, 0.02, 0)).toThrow(RangeError);
  });
});

describe('phase 2 layered lit scattering', () => {
  it('mixes from near to far water colour with a finite exponential curve', () => {
    expect(waterScatterLayerMix(0, 28)).toBe(0);
    expect(waterScatterLayerMix(28, 28)).toBeCloseTo(1 - Math.exp(-1), 12);
    const samples = [0, 5, 14, 28, 56, 112].map((distance) => (
      waterScatterLayerMix(distance, 28)
    ));
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1]);
      expect(samples[index]).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the Henyey-Greenstein phase isotropic at g = 0', () => {
    for (const cosTheta of [-1, -0.5, 0, 0.5, 1]) {
      expect(henyeyGreensteinRelative(cosTheta, 0)).toBeCloseTo(1, 12);
    }
    expect(henyeyGreensteinPeak(0)).toBe(1);
    expect(waterSunLobe(1, 0)).toBe(0);
  });

  it('peaks toward the sun and falls below one behind the camera', () => {
    const g = 0.35;
    const forward = henyeyGreensteinRelative(1, g);
    const sideways = henyeyGreensteinRelative(0, g);
    const backward = henyeyGreensteinRelative(-1, g);
    expect(forward).toBeGreaterThan(1);
    expect(sideways).toBeLessThan(1);
    expect(backward).toBeLessThan(sideways);
    expect(forward).toBeCloseTo(henyeyGreensteinPeak(g), 12);
    expect(waterSunLobe(1, g)).toBeCloseTo(1, 12);
    expect(waterSunLobe(-1, g)).toBe(0);
  });

  it('lifts the upper water column and clamps outside the height range', () => {
    expect(waterSurfaceFactor(0, 1, 18)).toBe(0);
    expect(waterSurfaceFactor(1, 1, 18)).toBe(0);
    expect(waterSurfaceFactor(9.5, 1, 18)).toBeCloseTo(0.5, 12);
    expect(waterSurfaceFactor(18, 1, 18)).toBe(1);
    expect(waterSurfaceFactor(40, 1, 18)).toBe(1);
  });

  it('rejects invalid scattering inputs', () => {
    expect(() => waterScatterLayerMix(-1, 28)).toThrow(RangeError);
    expect(() => waterScatterLayerMix(1, 0)).toThrow(RangeError);
    expect(() => henyeyGreensteinRelative(1.1, 0.3)).toThrow(RangeError);
    expect(() => henyeyGreensteinRelative(0.5, -0.1)).toThrow(RangeError);
    expect(() => henyeyGreensteinPeak(1)).toThrow(RangeError);
    expect(() => waterSunLobe(2, 0.3)).toThrow(RangeError);
    expect(() => waterSurfaceFactor(Number.NaN)).toThrow(RangeError);
    expect(() => waterSurfaceFactor(5, 18, 1)).toThrow(RangeError);
  });
});
