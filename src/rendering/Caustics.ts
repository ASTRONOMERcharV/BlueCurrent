import type { MeshStandardMaterial } from 'three';

export interface CausticUniforms {
  readonly time: { value: number };
  readonly strength: { value: number };
}

export interface MacroEnvelopeOptions {
  /** Minimum value of the slow large-scale envelope (0..1). */
  readonly base?: number;
  /** Amplitude of the slow large-scale envelope (base + amplitude <= 1). */
  readonly amplitude?: number;
  /** World-space frequency along X / Z, in radians per metre. */
  readonly frequencyX?: number;
  readonly frequencyZ?: number;
  /** Envelope animation speed, in radians per second. */
  readonly speed?: number;
}

export interface DistanceFadeOptions {
  /** View distance (m) where the fade starts. */
  readonly start?: number;
  /** View distance (m) where the fade reaches `minimum`. */
  readonly end?: number;
  /** Fraction of the caustic kept at and beyond `end` (1 disables the fade). */
  readonly minimum?: number;
}

export interface CausticOptions {
  /** Multiplier on the caustic addition (linear light units). */
  readonly intensity?: number;
  /** World-space pattern scale. Larger numbers make finer cells. */
  readonly scale?: number;
  /** RGB tint of the projected light. */
  readonly color?: readonly [number, number, number];
  /** Pattern frequency before the per-surface scale (radians per metre). */
  readonly baseFrequency?: number;
  /** Pattern animation speed. */
  readonly timeSpeed?: number;
  /** Domain-warp amount; higher values break the regular lattice. */
  readonly warpStrength?: number;
  /** Ridge exponent; higher values thin the bright filaments. */
  readonly ridgePower?: number;
  /** Weight of the fine detail octave (0..1); lower reduces shimmer. */
  readonly fineMix?: number;
  /** Fine octave frequency multiplier inside the pattern. */
  readonly fineFrequency?: number;
  /** Facing mask floor for vertical surfaces. */
  readonly facingMinimum?: number;
  /** Facing exponent; 1 is linear, higher concentrates on up-facing faces. */
  readonly facingPower?: number;
  /** Slow large-scale envelope that stops the field reading as tiling. */
  readonly macro?: MacroEnvelopeOptions;
  /** View-distance attenuation so far caustics weaken naturally. */
  readonly distanceFade?: DistanceFadeOptions;
}

const DEFAULT_COLOR = [0.46, 0.88, 0.78] as const;
const DEFAULT_BASE_FREQUENCY = 0.42;
const DEFAULT_TIME_SPEED = 0.55;
const DEFAULT_WARP_STRENGTH = 0.38;
const DEFAULT_RIDGE_POWER = 7;
const DEFAULT_FINE_MIX = 0.45;
const DEFAULT_FINE_FREQUENCY = 5.1;
const DEFAULT_FACING_MINIMUM = 0.12;
const DEFAULT_FACING_POWER = 1.6;
const DEFAULT_MACRO = {
  base: 0.62,
  amplitude: 0.38,
  frequencyX: 0.09,
  frequencyZ: 0.13,
  speed: 0.08,
} as const;
const DEFAULT_DISTANCE_FADE = { start: 0, end: 0, minimum: 1 } as const;

/**
 * A world-space caustic field. The same world XZ coordinate feeds every
 * surface, so a light filament runs continuously from the seabed onto a rock
 * instead of repeating per object UV (the previous floor-only implementation).
 *
 * All art-directed knobs arrive through `CausticOptions`; callers take them
 * from `UNDERWATER_LIGHTING_CONFIG.water.caustics` so no magic numbers live at
 * the call sites. Defaults reproduce the Phase 3 baseline behaviour.
 */
const CAUSTIC_GLSL = /* glsl */ `
float bcCaustic(vec2 worldXZ, float time) {
  vec2 p = worldXZ * uCausticBaseFrequency;
  float t = time * uCausticTimeSpeed;
  vec2 warp = vec2(
    sin(p.y * 1.37 + t * 1.6) + 0.6 * sin(p.y * 2.71 - t * 1.1),
    cos(p.x * 1.29 - t * 1.4) + 0.6 * cos(p.x * 2.53 + t * 0.9)
  );
  vec2 q = p + warp * uCausticWarp;
  float a = sin(q.x * 2.2 + q.y * 0.9 + t * 2.1);
  float b = sin(q.y * 1.85 - q.x * 0.75 - t * 1.8);
  float c = sin((q.x + q.y) * 1.35 + t * 1.2);
  float ridge = 1.0 - abs(a * 0.5 + b * 0.33 + c * 0.17);
  float fine = 0.5 + 0.5 * sin(
    q.x * uCausticFineFrequency - q.y * uCausticFineFrequency * 0.73 + t * 2.8
  );
  return pow(max(ridge, 0.0), uCausticRidgePower)
    * (1.0 - uCausticFineMix + uCausticFineMix * fine);
}
`;

function replaceOnce(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`Caustic shader injection point not found: ${search}`);
  }
  return source.replace(search, replacement);
}

/**
 * Add dynamic caustics to a built-in MeshStandardMaterial. The material keeps
 * its PBR maps; the caustic term is added to the outgoing radiance just before
 * tone mapping. Works for ordinary meshes and InstancedMesh instances because
 * instanceMatrix is folded into the world-space varying.
 */
export function applyCaustics(
  material: MeshStandardMaterial,
  uniforms: CausticUniforms,
  options: CausticOptions = {},
): void {
  const intensity = options.intensity ?? 0.06;
  const scale = options.scale ?? 1;
  const color = options.color ?? DEFAULT_COLOR;
  const baseFrequency = options.baseFrequency ?? DEFAULT_BASE_FREQUENCY;
  const timeSpeed = options.timeSpeed ?? DEFAULT_TIME_SPEED;
  const warpStrength = options.warpStrength ?? DEFAULT_WARP_STRENGTH;
  const ridgePower = options.ridgePower ?? DEFAULT_RIDGE_POWER;
  const fineMix = options.fineMix ?? DEFAULT_FINE_MIX;
  const fineFrequency = options.fineFrequency ?? DEFAULT_FINE_FREQUENCY;
  const facingMinimum = options.facingMinimum ?? DEFAULT_FACING_MINIMUM;
  const facingPower = options.facingPower ?? DEFAULT_FACING_POWER;
  const macro = { ...DEFAULT_MACRO, ...options.macro };
  const distanceFade = { ...DEFAULT_DISTANCE_FADE, ...options.distanceFade };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader) => {
    previousCompile.call(material, shader, undefined as never);
    shader.uniforms.uCausticTime = uniforms.time;
    shader.uniforms.uCausticStrength = uniforms.strength;
    shader.uniforms.uCausticIntensity = { value: intensity };
    shader.uniforms.uCausticScale = { value: scale };
    shader.uniforms.uCausticColor = {
      value: [color[0], color[1], color[2]],
    };
    shader.uniforms.uCausticBaseFrequency = { value: baseFrequency };
    shader.uniforms.uCausticTimeSpeed = { value: timeSpeed };
    shader.uniforms.uCausticWarp = { value: warpStrength };
    shader.uniforms.uCausticRidgePower = { value: ridgePower };
    shader.uniforms.uCausticFineMix = { value: fineMix };
    shader.uniforms.uCausticFineFrequency = { value: fineFrequency };
    shader.uniforms.uCausticFacingMin = { value: facingMinimum };
    shader.uniforms.uCausticFacingPower = { value: facingPower };
    shader.uniforms.uCausticMacroBase = { value: macro.base };
    shader.uniforms.uCausticMacroAmplitude = { value: macro.amplitude };
    shader.uniforms.uCausticMacroFrequencyX = { value: macro.frequencyX };
    shader.uniforms.uCausticMacroFrequencyZ = { value: macro.frequencyZ };
    shader.uniforms.uCausticMacroSpeed = { value: macro.speed };
    shader.uniforms.uCausticDistanceStart = { value: distanceFade.start };
    shader.uniforms.uCausticDistanceEnd = { value: distanceFade.end };
    shader.uniforms.uCausticDistanceMin = { value: distanceFade.minimum };

    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <common>',
      `#include <common>
        varying vec3 vCausticWorld;
        varying vec3 vCausticWorldNormal;`,
    );
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>
        vec4 causticWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          causticWorld = instanceMatrix * causticWorld;
        #endif
        vCausticWorld = (modelMatrix * causticWorld).xyz;`,
    );
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <defaultnormal_vertex>',
      `#include <defaultnormal_vertex>
        vCausticWorldNormal = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`,
    );

    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>
        varying vec3 vCausticWorld;
        varying vec3 vCausticWorldNormal;
        uniform float uCausticTime;
        uniform float uCausticStrength;
        uniform float uCausticIntensity;
        uniform float uCausticScale;
        uniform vec3 uCausticColor;
        uniform float uCausticBaseFrequency;
        uniform float uCausticTimeSpeed;
        uniform float uCausticWarp;
        uniform float uCausticRidgePower;
        uniform float uCausticFineMix;
        uniform float uCausticFineFrequency;
        uniform float uCausticFacingMin;
        uniform float uCausticFacingPower;
        uniform float uCausticMacroBase;
        uniform float uCausticMacroAmplitude;
        uniform float uCausticMacroFrequencyX;
        uniform float uCausticMacroFrequencyZ;
        uniform float uCausticMacroSpeed;
        uniform float uCausticDistanceStart;
        uniform float uCausticDistanceEnd;
        uniform float uCausticDistanceMin;
        ${CAUSTIC_GLSL}`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
        float causticUp = clamp(vCausticWorldNormal.y, 0.0, 1.0);
        // Horizontal surfaces catch the focused light; vertical faces only
        // receive a faint wraparound so rocks do not go fully dark.
        float causticMask = uCausticFacingMin
          + (1.0 - uCausticFacingMin) * pow(causticUp, uCausticFacingPower);
        float causticValue = bcCaustic(vCausticWorld.xz * uCausticScale, uCausticTime);
        // A slow, large-scale envelope stops the pattern reading as a tiled
        // texture: some patches of seabed are brightly dappled, others calm.
        float causticMacro = uCausticMacroBase + uCausticMacroAmplitude * sin(
          vCausticWorld.x * uCausticMacroFrequencyX
          + vCausticWorld.z * uCausticMacroFrequencyZ
          + uCausticTime * uCausticMacroSpeed
        );
        // Phase 3: past the near field the pattern would shimmer or alias, so
        // it weakens with view distance instead of tiling into the far water.
        float causticDistance = length(vCausticWorld - cameraPosition);
        float causticSpan = max(uCausticDistanceEnd - uCausticDistanceStart, 0.0001);
        float causticDistanceT = clamp(
          (causticDistance - uCausticDistanceStart) / causticSpan, 0.0, 1.0
        );
        causticDistanceT = causticDistanceT * causticDistanceT * (3.0 - 2.0 * causticDistanceT);
        float causticDistanceFade = 1.0
          - (1.0 - uCausticDistanceMin) * causticDistanceT;
        gl_FragColor.rgb += uCausticColor
          * (causticValue * causticMacro * causticMask * causticDistanceFade
            * uCausticIntensity * uCausticStrength);`,
    );
  };

  material.customProgramCacheKey = () => [
    previousKey(),
    'caustics',
    intensity.toFixed(3),
    scale.toFixed(3),
    color.join(','),
    baseFrequency.toFixed(3),
    timeSpeed.toFixed(3),
    warpStrength.toFixed(3),
    ridgePower.toFixed(2),
    fineMix.toFixed(3),
    fineFrequency.toFixed(2),
    facingMinimum.toFixed(3),
    facingPower.toFixed(2),
    macro.base.toFixed(3),
    macro.amplitude.toFixed(3),
    macro.frequencyX.toFixed(3),
    macro.frequencyZ.toFixed(3),
    macro.speed.toFixed(3),
    distanceFade.start.toFixed(1),
    distanceFade.end.toFixed(1),
    distanceFade.minimum.toFixed(3),
  ].join(':');
  material.needsUpdate = true;
}
