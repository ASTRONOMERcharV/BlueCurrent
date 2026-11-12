import { UNDERWATER_LIGHTING_CONFIG } from './UnderwaterLightingConfig';
import type { CausticSurfaceId } from './UnderwaterLightingConfig';
import type { CausticOptions } from '../Caustics';

/**
 * Build the per-surface caustic options from the central Phase 3 config.
 * Seabed, reef rocks, dunes, corals and the new terrain decorations all
 * sample the same world-space field; only their relative intensity/scale
 * differ, and no caustic magic number lives outside that config.
 */
export function causticOptionsFor(surface: CausticSurfaceId): CausticOptions {
  const caustics = UNDERWATER_LIGHTING_CONFIG.water.caustics;
  const preset = caustics.surfaces[surface];
  return {
    intensity: preset.intensity,
    scale: preset.scale,
    color: caustics.color,
    baseFrequency: caustics.pattern.baseFrequency,
    timeSpeed: caustics.pattern.timeSpeed,
    warpStrength: caustics.pattern.warpStrength,
    ridgePower: caustics.pattern.ridgePower,
    fineMix: caustics.pattern.fineMix,
    fineFrequency: caustics.pattern.fineFrequency,
    facingMinimum: caustics.facing.minimum,
    facingPower: caustics.facing.power,
    macro: caustics.macro,
    distanceFade: caustics.distanceFade,
  };
}
