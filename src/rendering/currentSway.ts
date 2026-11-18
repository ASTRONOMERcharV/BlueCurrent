import type {
  InstancedBufferAttribute,
  MeshStandardMaterial,
} from 'three';
import type { OceanCurrentField } from '../environment/OceanCurrentField';

/**
 * Shared current-driven sway for kelp and detail seaweed (Phase D3).
 *
 * The GLSL keeps the accepted kelp language from docs/ASSET_SPEC.md section 15:
 *   displacement = A * pow(swayWeight, exponent) * sin(time * frequency + phaseGradient * y + phase)
 * `phase` is a per-instance random value plus the per-blade `_BLADEPHASE`, so
 * neighbouring plants and individual blades never move in lockstep. The sway
 * direction comes from `OceanCurrentField` in world XZ and is rotated into the
 * instance's local axes; the root stays pinned because `_SWAYWEIGHT` is 0.
 *
 * Local flow speed adds a small amplitude/frequency response. Both gains are
 * art-directed config values and may be set to 0 to restore the previous
 * direction-only motion for A/B captures.
 */

export interface CurrentSwayOptions {
  /** Base sway amplitude in metres. */
  readonly amplitude: number;
  /** Base angular frequency. */
  readonly frequency: number;
  /** Phase gradient along local height (radians per metre). */
  readonly phaseGradient: number;
  /** Exponent applied to the asset's sway weight. */
  readonly swayExponent: number;
  /** Secondary orthogonal lobe relative to the main sway. */
  readonly secondaryWeight: number;
  /** Amplitude response per unit of normalised speed above/below 1. */
  readonly speedAmplitude: number;
  /** Frequency response per unit of normalised speed. */
  readonly speedFrequency: number;
  /** Flow speed treated as neutral (gain 1). */
  readonly referenceSpeed: number;
}

export interface CurrentSwayLayer {
  readonly entries: readonly {
    readonly x: number;
    readonly z: number;
    readonly yaw: number;
  }[];
  /** World Y used to sample the current for each entry. */
  readonly sampleY: Float32Array;
  /** Packed local sway direction X, Z and local flow speed. */
  readonly sway: InstancedBufferAttribute;
}

const SAMPLE_SCRATCH = new Float32Array(3);
const DIRECTION_SCRATCH = new Float32Array(2);

/**
 * Rotate a world-space current direction into an instance's local XZ axes.
 * Re-exported from `KelpScatter` to keep the existing import path stable.
 */
export function localSwayDirection(
  currentX: number,
  currentZ: number,
  yaw: number,
  out: Float32Array,
): void {
  const length = Math.hypot(currentX, currentZ);
  if (length < 1e-8) {
    out[0] = 1;
    out[1] = 0;
    return;
  }
  const worldX = currentX / length;
  const worldZ = currentZ / length;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  out[0] = cosine * worldX - sine * worldZ;
  out[1] = sine * worldX + cosine * worldZ;
}

/** Sample the shared current field for every plant and upload three floats. */
export function updateCurrentSway(
  layer: CurrentSwayLayer,
  field: OceanCurrentField,
  time: number,
): void {
  layer.entries.forEach((placement, index) => {
    field.sample(placement.x, layer.sampleY[index], placement.z, time, SAMPLE_SCRATCH);
    localSwayDirection(
      SAMPLE_SCRATCH[0],
      SAMPLE_SCRATCH[2],
      placement.yaw,
      DIRECTION_SCRATCH,
    );
    layer.sway.setXYZ(
      index,
      DIRECTION_SCRATCH[0],
      DIRECTION_SCRATCH[1],
      Math.hypot(SAMPLE_SCRATCH[0], SAMPLE_SCRATCH[1], SAMPLE_SCRATCH[2]),
    );
  });
  layer.sway.needsUpdate = true;
}

function replaceOnce(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`Current sway shader injection point not found: ${search}`);
  }
  return source.replace(search, replacement);
}

/** Install the shared sway chunk on a cloned standard material. */
export function applyCurrentSway(
  material: MeshStandardMaterial,
  options: CurrentSwayOptions,
  timeUniform: { value: number },
): void {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader) => {
    previousCompile.call(material, shader, undefined as never);

    shader.uniforms.uSwayTime = timeUniform;
    shader.uniforms.uSwayAmplitude = { value: options.amplitude };
    shader.uniforms.uSwayFrequency = { value: options.frequency };
    shader.uniforms.uSwayPhaseGradient = { value: options.phaseGradient };
    shader.uniforms.uSwaySpeedAmplitude = { value: options.speedAmplitude };
    shader.uniforms.uSwaySpeedFrequency = { value: options.speedFrequency };
    shader.uniforms.uSwayReferenceSpeed = { value: options.referenceSpeed };
    shader.uniforms.uSwaySecondaryWeight = { value: options.secondaryWeight };
    shader.uniforms.uSwayExponent = { value: options.swayExponent };

    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <common>',
      `#include <common>
        uniform float uSwayTime;
        uniform float uSwayAmplitude;
        uniform float uSwayFrequency;
        uniform float uSwayPhaseGradient;
        uniform float uSwaySpeedAmplitude;
        uniform float uSwaySpeedFrequency;
        uniform float uSwayReferenceSpeed;
        uniform float uSwaySecondaryWeight;
        uniform float uSwayExponent;
        attribute float aSwayWeight;
        attribute float aBladePhase;
        attribute float instancePhase;
        attribute float instanceFrequency;
        attribute float instanceAmplitude;
        attribute vec3 instanceSway;`,
    );
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>
        float swayWeight = pow(clamp(aSwayWeight, 0.0, 1.0), uSwayExponent);
        float speedNorm = clamp(
          instanceSway.z / max(uSwayReferenceSpeed, 0.0001),
          0.0,
          2.0
        );
        float swayAmpGain = max(0.35, 1.0 + uSwaySpeedAmplitude * (speedNorm - 1.0));
        float swayFreqGain = 1.0 + uSwaySpeedFrequency * (speedNorm - 1.0);
        float swayPhase = uSwayTime * uSwayFrequency * instanceFrequency * swayFreqGain
          + uSwayPhaseGradient * position.y
          + instancePhase + aBladePhase;
        float sway = sin(swayPhase) * uSwayAmplitude * instanceAmplitude
          * swayAmpGain * swayWeight;
        float swaySecondary = cos(swayPhase * 0.81 + 1.7) * uSwayAmplitude
          * uSwaySecondaryWeight * instanceAmplitude * swayAmpGain * swayWeight;
        transformed.x += sway * instanceSway.x - swaySecondary * instanceSway.y;
        transformed.z += sway * instanceSway.y + swaySecondary * instanceSway.x;`,
    );
  };

  material.customProgramCacheKey = () => [
    previousKey(),
    'current-sway',
    options.amplitude.toFixed(3),
    options.frequency.toFixed(3),
    options.phaseGradient.toFixed(3),
    options.swayExponent.toFixed(2),
    options.secondaryWeight.toFixed(2),
    options.speedAmplitude.toFixed(3),
    options.speedFrequency.toFixed(3),
    options.referenceSpeed.toFixed(3),
  ].join(':');
  material.needsUpdate = true;
}
