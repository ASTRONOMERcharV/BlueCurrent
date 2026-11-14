import type { MeshStandardMaterial } from 'three';
import type { SeabedDetailOptions } from './lighting/SeabedDetailOptions';

/**
 * Phase D2 seabed detail: a texture-free, static fragment term on top of the
 * vertex palette. It only modifies albedo and roughness before lighting, so
 * the single linear `UnderwaterMedium` composition and tonemapping order are
 * untouched. Detail fades to zero at `fadeEnd`, keeping the far shelf free of
 * noise cost and moire.
 *
 * Chained exactly like `applyCaustics`: the previous `onBeforeCompile` and
 * `customProgramCacheKey` are preserved so caustics still apply.
 */

function replaceOnce(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`Seabed detail shader injection point not found: ${search}`);
  }
  return source.replace(search, replacement);
}

const NOISE_GLSL = `
  float bcSeabedHash(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }
  float bcSeabedNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 weight = local * local * (3.0 - 2.0 * local);
    float a = bcSeabedHash(cell);
    float b = bcSeabedHash(cell + vec2(1.0, 0.0));
    float c = bcSeabedHash(cell + vec2(0.0, 1.0));
    float d = bcSeabedHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
  }
`;

export function applySeabedDetail(
  material: MeshStandardMaterial,
  options: SeabedDetailOptions,
): void {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader) => {
    previousCompile.call(material, shader, undefined as never);

    shader.uniforms.uSeabedMidFrequency = { value: options.midFrequency };
    shader.uniforms.uSeabedFineFrequency = { value: options.fineFrequency };
    shader.uniforms.uSeabedFineWeight = { value: options.fineWeight };
    shader.uniforms.uSeabedContrast = { value: options.contrast };
    shader.uniforms.uSeabedTint = {
      value: [options.tint[0], options.tint[1], options.tint[2]],
    };
    shader.uniforms.uSeabedTintStrength = { value: options.tintStrength };
    shader.uniforms.uSeabedRoughnessAmount = { value: options.roughnessAmount };
    shader.uniforms.uSeabedRoughnessMin = { value: options.roughnessMin };
    shader.uniforms.uSeabedFadeStart = { value: options.fadeStart };
    shader.uniforms.uSeabedFadeEnd = { value: options.fadeEnd };

    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <common>',
      `#include <common>
        varying vec3 vSeabedWorld;`,
    );
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>
        vSeabedWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>
        varying vec3 vSeabedWorld;
        uniform float uSeabedMidFrequency;
        uniform float uSeabedFineFrequency;
        uniform float uSeabedFineWeight;
        uniform float uSeabedContrast;
        uniform vec3 uSeabedTint;
        uniform float uSeabedTintStrength;
        uniform float uSeabedRoughnessAmount;
        uniform float uSeabedRoughnessMin;
        uniform float uSeabedFadeStart;
        uniform float uSeabedFadeEnd;
        ${NOISE_GLSL}`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <color_fragment>',
      `#include <color_fragment>
        float bcSeabedDetail = bcSeabedNoise(vSeabedWorld.xz * uSeabedMidFrequency);
        bcSeabedDetail = mix(
          bcSeabedDetail,
          bcSeabedNoise(vSeabedWorld.xz * uSeabedFineFrequency),
          uSeabedFineWeight
        );
        float bcSeabedFade = 1.0 - smoothstep(
          uSeabedFadeStart,
          uSeabedFadeEnd,
          distance(vSeabedWorld, cameraPosition)
        );
        if (bcSeabedFade > 0.001) {
          float bcSeabedShade = mix(
            1.0 - uSeabedContrast,
            1.0 + uSeabedContrast,
            bcSeabedDetail
          );
          diffuseColor.rgb *= mix(1.0, bcSeabedShade, bcSeabedFade);
          diffuseColor.rgb = mix(
            diffuseColor.rgb,
            uSeabedTint,
            bcSeabedFade * uSeabedTintStrength
          );
        }`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
        if (bcSeabedFade > 0.001) {
          roughnessFactor = clamp(
            roughnessFactor
              + (bcSeabedDetail - 0.5) * 2.0 * uSeabedRoughnessAmount * bcSeabedFade,
            uSeabedRoughnessMin,
            1.0
          );
        }`,
    );
  };

  material.customProgramCacheKey = () => [
    previousKey(),
    'seabed-detail',
    options.midFrequency.toFixed(3),
    options.fineFrequency.toFixed(3),
    options.fineWeight.toFixed(3),
    options.contrast.toFixed(3),
    options.tint.join(','),
    options.tintStrength.toFixed(3),
    options.roughnessAmount.toFixed(3),
    options.roughnessMin.toFixed(3),
    options.fadeStart.toFixed(2),
    options.fadeEnd.toFixed(2),
  ].join(':');
  material.needsUpdate = true;
}
