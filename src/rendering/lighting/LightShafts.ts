import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector4,
} from 'three';
import type { ObstacleDefinition } from '../../simulation/ObstacleSystem';
import { UNDERWATER_MEDIUM_CONFIG } from '../UnderwaterMedium';
import { UNDERWATER_LIGHTING_CONFIG } from './UnderwaterLightingConfig';

const SHAFTS = UNDERWATER_LIGHTING_CONFIG.water.shafts;

/** Emit every config number as a GLSL float literal (never an int literal). */
const glsl = (value: number): string => value.toFixed(5);

/**
 * Phase 4 beam material.
 *
 * All geometry/animation values come from `water.shafts`; the shader only
 * carries per-instance data (time) and the reef-core spheres. The noise is a
 * texture-free two-octave value noise in world space, so the two crossed planes
 * of a shaft agree with each other and no UV stretching is visible.
 *
 * Occlusion is deliberately two-layered and must not be confused:
 *   1. real depth-test occlusion (default `depthTest: true`) against opaque
 *      geometry — rocks and seabed stay solid in front of a beam;
 *   2. analytic fades near the seabed height band and inside reef-core spheres,
 *      which depth testing cannot resolve for a zero-thickness additive plane.
 * There is no post-processing, depth texture, per-pixel volumetrics or extra
 * render pass.
 */
export function createShaftMaterial(
  obstacles: readonly ObstacleDefinition[],
  time: { value: number },
): ShaderMaterial {
  const noise = SHAFTS.noise;
  const lateral = SHAFTS.lateral;
  const vertical = SHAFTS.vertical;
  const nearFade = SHAFTS.nearFade;
  const farFade = SHAFTS.farFade;
  const seabedFade = SHAFTS.seabedFade;
  const rockSpheres = obstacles.map(
    (obstacle) => new Vector4(obstacle.center[0], obstacle.center[1], obstacle.center[2], obstacle.radius),
  );

  return new ShaderMaterial({
    uniforms: {
      uShaftColor: { value: new Color(SHAFTS.color) },
      uShaftOpacity: {
        value: SHAFTS.opacity * UNDERWATER_MEDIUM_CONFIG.volumetricStrength,
      },
      uTime: time,
      uRockSpheres: { value: rockSpheres },
      uRockMargin: { value: SHAFTS.occlusion.rockMargin },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: `varying vec2 vUv;
      varying float vViewDepth;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        vViewDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: `uniform vec3 uShaftColor;
      uniform float uShaftOpacity;
      uniform float uTime;
      uniform vec4 uRockSpheres[${obstacles.length}];
      uniform float uRockMargin;
      varying vec2 vUv;
      varying float vViewDepth;
      varying vec3 vWorldPosition;

      float shaftHash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float shaftValueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = shaftHash(i);
        float b = shaftHash(i + vec2(1.0, 0.0));
        float c = shaftHash(i + vec2(0.0, 1.0));
        float d = shaftHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Two octaves only; the fine octave's cell stays several metres across
      // at the 42-110 m far-fade band, so distant beams cannot alias into
      // flicker or moiré.
      float shaftNoise(vec2 p) {
        float coarse = shaftValueNoise(p);
        float fine = shaftValueNoise(p * ${glsl(noise.octaveScale)} + vec2(17.1, -9.2));
        return coarse * ${glsl(1 - noise.octaveWeight)} + fine * ${glsl(noise.octaveWeight)};
      }

      void main() {
        // World-space, slowly drifting noise. Brightness and width share it so
        // the column breathes instead of showing a uniform translucent quad.
        vec2 noiseUv = vec2(
          vWorldPosition.x + vWorldPosition.z,
          vWorldPosition.y * ${glsl(noise.verticalScale)}
        ) * ${glsl(noise.scale)};
        noiseUv.y -= uTime * ${glsl(noise.speed)};
        float noise = shaftNoise(noiseUv);
        float brightness = ${glsl(1 - noise.contrast)} + ${glsl(2 * noise.contrast)} * noise;
        // Widen only: a shrinking scale would leave the profile above zero at
        // the quad edge and re-introduce a hard border.
        float widthScale = 1.0 + ${glsl(noise.widthAmount)} * max(0.0, noise - 0.5);
        float u = min(1.0, abs(vUv.x - 0.5) * 2.0 * widthScale);

        // Soft shoulder: a broad low-power skirt under a tighter core. Both
        // terms reach zero with zero slope at the quad edge, so no hard border
        // is visible even when the camera is close to the plane.
        float core = ${glsl(lateral.coreWeight)} * pow(max(0.0, 1.0 - u), ${glsl(lateral.corePower)});
        float shoulder = ${glsl(lateral.shoulderWeight)}
          * pow(max(0.0, 1.0 - u), ${glsl(lateral.shoulderPower)});
        float profile = (core + shoulder) / ${glsl(lateral.coreWeight + lateral.shoulderWeight)};

        float vertical = smoothstep(0.0, ${glsl(vertical.bottomFadeEnd)}, vUv.y)
          * (1.0 - smoothstep(${glsl(vertical.topFadeStart)}, 1.0, vUv.y));
        // Fade the shaft as the camera enters it: no quad edge in the predator
        // follow-cam or a free camera sitting inside the beams.
        float nearFade = smoothstep(${glsl(nearFade.start)}, ${glsl(nearFade.end)}, vViewDepth);
        // Distant beams keep a faint hint only.
        float farFade = mix(1.0, ${glsl(farFade.minimum)},
          smoothstep(${glsl(farFade.start)}, ${glsl(farFade.end)}, vViewDepth));

        // Analytic seabed contact: conservative world-height band above the
        // terrain crest. This is a height approximation, not a depth lookup.
        float seabedFade = smoothstep(${glsl(seabedFade.start)}, ${glsl(seabedFade.end)}, vWorldPosition.y);

        // Analytic reef-core shell: a beam fragment inside a rock volume must
        // not be drawn in front of that rock. Real depth occlusion is unchanged.
        float rockFade = 1.0;
        for (int i = 0; i < ${obstacles.length}; i++) {
          vec3 offset = vWorldPosition - uRockSpheres[i].xyz;
          float radius = uRockSpheres[i].w;
          rockFade *= smoothstep(
            radius * radius,
            (radius + uRockMargin) * (radius + uRockMargin),
            dot(offset, offset)
          );
        }

        float alpha = profile * vertical * nearFade * farFade
          * seabedFade * rockFade * brightness * uShaftOpacity;
        gl_FragColor = vec4(uShaftColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Build the six crossed beam planes (3 anchors × 2 planes) sharing one
 * geometry and one material. Draw-call count and material variants are
 * unchanged from Phase 3.
 */
export function createLightShaftGroup(
  obstacles: readonly ObstacleDefinition[],
  time: { value: number },
): Group {
  const group = new Group();
  group.name = 'lightShafts';
  const geometry = new PlaneGeometry(SHAFTS.width, SHAFTS.height);
  const material = createShaftMaterial(obstacles, time);
  SHAFTS.positions.forEach((anchor, index) => {
    for (let cross = 0; cross < 2; cross += 1) {
      const shaft = new Mesh(geometry, material);
      shaft.name = `lightShaft-${index}-${cross}`;
      shaft.position.set(anchor.x, SHAFTS.centerHeight, anchor.z);
      shaft.rotation.set(0, anchor.yaw + cross * SHAFTS.crossAngle, SHAFTS.tilt);
      group.add(shaft);
    }
  });
  return group;
}
