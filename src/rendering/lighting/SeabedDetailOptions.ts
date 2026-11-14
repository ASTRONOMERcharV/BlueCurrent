import { Color } from 'three';
import { UNDERWATER_LIGHTING_CONFIG } from './UnderwaterLightingConfig';

/**
 * Material-facing values for the procedural seabed detail. Colours are
 * resolved into linear working-space triples once, mirroring
 * `CausticOptions`; the GLSL never parses hex values.
 */
export interface SeabedDetailOptions {
  readonly midFrequency: number;
  readonly fineFrequency: number;
  readonly fineWeight: number;
  readonly contrast: number;
  readonly tint: readonly [number, number, number];
  readonly tintStrength: number;
  readonly roughnessAmount: number;
  readonly roughnessMin: number;
  readonly fadeStart: number;
  readonly fadeEnd: number;
}

export const SEABED_DETAIL_OPTIONS: SeabedDetailOptions = (() => {
  const fragment = UNDERWATER_LIGHTING_CONFIG.materials.seabed.fragment;
  const tint = new Color(fragment.tint);
  return {
    midFrequency: fragment.midFrequency,
    fineFrequency: fragment.fineFrequency,
    fineWeight: fragment.fineWeight,
    contrast: fragment.contrast,
    tint: [tint.r, tint.g, tint.b],
    tintStrength: fragment.tintStrength,
    roughnessAmount: fragment.roughnessAmount,
    roughnessMin: fragment.roughnessMin,
    fadeStart: fragment.fadeStart,
    fadeEnd: fragment.fadeEnd,
  };
})();
