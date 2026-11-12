/**
 * Pure underwater optics shared by the fog shader and tests.
 *
 * The renderer uses the same exponential extinction curve described in the
 * Phase 3 design note:
 *
 *   C(d) = C_object * exp(-beta_rgb * d) + C_water * (1 - exp(-beta_rgb * d))
 *
 * `beta` is wavelength dependent: red is absorbed first, blue-green survives
 * longest. That produces the depth layering (clear near, lower contrast in the
 * middle, water-coloured far field) without tinting meshes by hand.
 */

import { UNDERWATER_LIGHTING_CONFIG } from '../rendering/lighting/UnderwaterLightingConfig';

/** Per-channel multiplier applied to the scene fog density. */
export const WATER_ATTENUATION_RGB = UNDERWATER_LIGHTING_CONFIG.water.attenuationRgb;

/** Scene fog density used as the base beta (1/m). */
export const WATER_FOG_DENSITY: number = UNDERWATER_LIGHTING_CONFIG.water.fogDensity;

/** One channel's exponential in-scattering factor in [0, 1]. */
export function waterFogFactor(distance: number, density: number, channel: number): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError('distance must be a non-negative finite number');
  }
  if (!Number.isFinite(density) || density < 0) {
    throw new RangeError('density must be a non-negative finite number');
  }
  const multiplier = WATER_ATTENUATION_RGB[channel];
  if (multiplier === undefined) throw new RangeError('channel must be 0, 1 or 2');
  return 1 - Math.exp(-(density * multiplier) * distance);
}

/**
 * Fraction of the object colour that survives to the camera, per channel.
 * The remainder is replaced by the water colour.
 */
export function waterTransmittance(
  distance: number,
  density = WATER_FOG_DENSITY,
): [number, number, number] {
  return [
    1 - waterFogFactor(distance, density, 0),
    1 - waterFogFactor(distance, density, 1),
    1 - waterFogFactor(distance, density, 2),
  ];
}

/**
 * Estimated visibility distance for a channel: the distance at which only
 * `remainder` of the object colour is left. The default 0.02 corresponds to
 * the classic "4 %" visibility limit (1/e^4).
 */
export function waterVisibilityDistance(
  channel: number,
  density = WATER_FOG_DENSITY,
  remainder = 0.02,
): number {
  if (!(remainder > 0 && remainder <= 1)) {
    throw new RangeError('remainder must be in (0, 1]');
  }
  const multiplier = WATER_ATTENUATION_RGB[channel];
  if (multiplier === undefined) throw new RangeError('channel must be 0, 1 or 2');
  return -Math.log(remainder) / (density * multiplier);
}

/**
 * Blend factor between the near-water and far-water scattering colours.
 * Zero at the camera and approaching one past the colour distance. This is a
 * hue-layering control, not an extinction curve: the photometric extinction
 * remains the per-channel Beer-Lambert term above.
 */
export function waterScatterLayerMix(
  distance: number,
  colorDistance: number = UNDERWATER_LIGHTING_CONFIG.water.scatterColorDistance,
): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError('distance must be a non-negative finite number');
  }
  if (!Number.isFinite(colorDistance) || colorDistance <= 0) {
    throw new RangeError('colorDistance must be a positive finite number');
  }
  return 1 - Math.exp(-distance / colorDistance);
}

/**
 * Relative Henyey-Greenstein phase function, normalised so that an isotropic
 * medium (g = 0) returns exactly 1. Forward angles return values above one;
 * the shader uses only the positive lobe, so the water never darkens behind
 * the camera merely because the phase model says so.
 */
export function henyeyGreensteinRelative(cosTheta: number, anisotropy: number): number {
  if (!Number.isFinite(cosTheta) || cosTheta < -1 || cosTheta > 1) {
    throw new RangeError('cosTheta must be in [-1, 1]');
  }
  if (!Number.isFinite(anisotropy) || anisotropy < 0 || anisotropy >= 1) {
    throw new RangeError('anisotropy must be in [0, 1)');
  }
  const g = anisotropy;
  const denominator = Math.max(1 + g * g - 2 * g * cosTheta, 1e-4);
  return (1 - g * g) / Math.pow(denominator, 1.5);
}

/** Forward peak of the relative phase function; equals one at g = 0. */
export function henyeyGreensteinPeak(anisotropy: number): number {
  if (!Number.isFinite(anisotropy) || anisotropy < 0 || anisotropy >= 1) {
    throw new RangeError('anisotropy must be in [0, 1)');
  }
  const g = anisotropy;
  return (1 + g) / Math.max((1 - g) * (1 - g), 1e-4);
}

/**
 * Sunward scattering lobe in [0, 1]: zero away from the sun, one exactly on
 * the forward peak. The shader mirrors this formula.
 */
export function waterSunLobe(cosTheta: number, anisotropy: number): number {
  const phase = henyeyGreensteinRelative(cosTheta, anisotropy);
  const peak = henyeyGreensteinPeak(anisotropy);
  const span = peak - 1;
  if (span <= 1e-9) return 0;
  return Math.min(Math.max((phase - 1) / span, 0), 1);
}

/**
 * Smoothstep factor for the lit upper water column. `height` is the estimated
 * midpoint height of the camera-to-surface water path in metres.
 */
export function waterSurfaceFactor(
  height: number,
  deepHeight: number = UNDERWATER_LIGHTING_CONFIG.water.deepHeight,
  surfaceHeight: number = UNDERWATER_LIGHTING_CONFIG.water.surfaceHeight,
): number {
  if (!Number.isFinite(height)) throw new RangeError('height must be finite');
  if (!Number.isFinite(deepHeight) || !Number.isFinite(surfaceHeight)) {
    throw new RangeError('heights must be finite');
  }
  if (!(surfaceHeight > deepHeight)) {
    throw new RangeError('surfaceHeight must be greater than deepHeight');
  }
  const t = Math.min(Math.max((height - deepHeight) / (surfaceHeight - deepHeight), 0), 1);
  return t * t * (3 - 2 * t);
}
