import {
  DirectionalLight,
  HemisphereLight,
  Object3D,
  Scene,
  Vector3,
  type Camera,
  type MeshStandardMaterial,
} from 'three';
import {
  UNDERWATER_LIGHTING_CONFIG,
  type RgbTriple,
} from './UnderwaterLightingConfig';

export interface RimLightPose {
  readonly position: Vector3;
  readonly target: Vector3;
}

const SUN_TARGET = new Vector3(...UNDERWATER_LIGHTING_CONFIG.sun.target);

/**
 * Camera-relative rim placement: the lamp sits behind and above the subject
 * from the camera's point of view. It is one shared light, never per fish.
 */
export function computeRimLightPose(
  cameraPosition: Vector3,
  focus: Vector3,
  out: RimLightPose = { position: new Vector3(), target: new Vector3() },
): RimLightPose {
  const dx = focus.x - cameraPosition.x;
  const dy = focus.y - cameraPosition.y;
  const dz = focus.z - cameraPosition.z;
  const length = Math.hypot(dx, dy, dz);
  const { distance, lift } = UNDERWATER_LIGHTING_CONFIG.rim;
  if (length < 1e-6) {
    out.position.set(focus.x, focus.y + lift, focus.z - distance);
  } else {
    out.position.set(
      focus.x + (dx / length) * distance + (dy / length) * -1.5,
      focus.y + (dy / length) * distance + lift,
      focus.z + (dz / length) * distance,
    );
  }
  out.target.copy(focus);
  return out;
}

export interface UnderwaterLightSnapshot {
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly hemisphereIntensity: number;
  readonly rimIntensity: number;
  readonly sunCastsShadow: boolean;
  readonly shadowMapSize: number;
}

/** Surface sun, directional water fill and a restrained shared rim. */
export class UnderwaterLighting {
  readonly sun: DirectionalLight;
  readonly hemisphere: HemisphereLight;
  readonly rim: DirectionalLight;
  private readonly rimTarget = new Object3D();
  private readonly desiredPose: RimLightPose = {
    position: new Vector3(),
    target: new Vector3(),
  };
  private hasRimPose = false;

  constructor(scene: Scene) {
    const config = UNDERWATER_LIGHTING_CONFIG;
    this.sun = new DirectionalLight(config.sun.color, config.sun.intensity);
    this.sun.name = 'underwaterSurfaceSun';
    this.sun.position.set(...config.sun.position);
    this.sun.target.position.copy(SUN_TARGET);
    this.sun.castShadow = config.sun.shadow.enabled;
    const shadow = config.sun.shadow;
    this.sun.shadow.mapSize.set(shadow.mapSize, shadow.mapSize);
    this.sun.shadow.camera.left = -shadow.extent;
    this.sun.shadow.camera.right = shadow.extent;
    this.sun.shadow.camera.top = shadow.extent;
    this.sun.shadow.camera.bottom = -shadow.extent;
    this.sun.shadow.camera.near = shadow.near;
    this.sun.shadow.camera.far = shadow.far;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = shadow.bias;
    this.sun.shadow.normalBias = shadow.normalBias;
    scene.add(this.sun, this.sun.target);

    this.hemisphere = new HemisphereLight(
      config.hemisphere.skyColor,
      config.hemisphere.groundColor,
      config.hemisphere.intensity,
    );
    this.hemisphere.name = 'underwaterHemisphereFill';
    scene.add(this.hemisphere);

    this.rim = new DirectionalLight(config.rim.color, config.rim.intensity);
    this.rim.name = 'underwaterSharedRim';
    this.rim.target = this.rimTarget;
    scene.add(this.rim, this.rimTarget);
  }

  update(camera: Camera, focus: Vector3, delta: number): void {
    const config = UNDERWATER_LIGHTING_CONFIG.rim;
    computeRimLightPose(camera.position, focus, this.desiredPose);
    this.rimTarget.position.lerp(
      this.desiredPose.target,
      this.damping(delta, config.targetDamping),
    );
    if (!this.hasRimPose) {
      this.rim.position.copy(this.desiredPose.position);
      this.hasRimPose = true;
    } else {
      this.rim.position.lerp(
        this.desiredPose.position,
        this.damping(delta, config.positionDamping),
      );
    }
  }

  snapshot(): UnderwaterLightSnapshot {
    return {
      sunColor: this.sun.color.getHex(),
      sunIntensity: this.sun.intensity,
      hemisphereIntensity: this.hemisphere.intensity,
      rimIntensity: this.rim.intensity,
      sunCastsShadow: this.sun.castShadow,
      shadowMapSize: this.sun.shadow.mapSize.x,
    };
  }

  private damping(delta: number, response: number): number {
    return 1 - Math.exp(-Math.max(0, delta) * response);
  }
}

export interface FresnelRimOptions {
  readonly color?: RgbTriple;
  readonly strength?: number;
  readonly power?: number;
  readonly heightShadeMinimum?: number;
  readonly alertColor?: RgbTriple;
  readonly alertStrength?: number;
  /** Shared, real predator attack state smoothed by PredatorRenderer. */
  readonly alert?: { value: number };
}

function replaceOnce(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`Rim shader injection point missing: ${search}`);
  return source.replace(search, replacement);
}

/**
 * Shared creature rim with an optional attack-coloured edge. World position is
 * captured after skinning, so the rigged shark's rim follows its current pose.
 */
export function applyFresnelRim(
  material: MeshStandardMaterial,
  options: FresnelRimOptions = {},
): void {
  const config = UNDERWATER_LIGHTING_CONFIG.predatorRim;
  const color = options.color ?? config.color;
  const strength = options.strength ?? 0.35;
  const power = options.power ?? 2.8;
  const heightShadeMinimum = options.heightShadeMinimum ?? config.heightShadeMinimum;
  const alertColor = options.alertColor ?? config.alertColor;
  const alertStrength = options.alertStrength ?? 0;
  const alert = options.alert ?? { value: 0 };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = (shader) => {
    previousCompile.call(material, shader, undefined as never);
    shader.uniforms.uRimAlert = alert;
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <common>',
      `#include <common>
        varying vec3 vRimWorldPosition;
        varying vec3 vRimWorldNormal;`,
    );
    // Unlike begin_vertex, this point is after both swim deformation and the
    // rig skinning chunk. Instancing is folded in exactly once here.
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <skinning_vertex>',
      `#include <skinning_vertex>
        vec4 rimWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rimWorld = instanceMatrix * rimWorld;
        #endif
        vRimWorldPosition = (modelMatrix * rimWorld).xyz;`,
    );
    shader.vertexShader = replaceOnce(
      shader.vertexShader,
      '#include <defaultnormal_vertex>',
      `#include <defaultnormal_vertex>
        vRimWorldNormal = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>
        varying vec3 vRimWorldPosition;
        varying vec3 vRimWorldNormal;
        uniform float uRimAlert;`,
    );
    shader.fragmentShader = replaceOnce(
      shader.fragmentShader,
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
        vec3 rimView = normalize(cameraPosition - vRimWorldPosition);
        float rimFacing = clamp(dot(normalize(vRimWorldNormal), rimView), 0.0, 1.0);
        float fresnel = pow(1.0 - rimFacing, ${power.toFixed(2)});
        float heightShade = mix(${heightShadeMinimum.toFixed(3)}, 1.0,
          smoothstep(2.0, 18.0, vRimWorldPosition.y));
        gl_FragColor.rgb *= heightShade;
        vec3 rimColor = mix(
          vec3(${color.map((channel) => channel.toFixed(3)).join(', ')}),
          vec3(${alertColor.map((channel) => channel.toFixed(3)).join(', ')}),
          uRimAlert
        );
        float rimStrength = ${strength.toFixed(3)} + uRimAlert * ${alertStrength.toFixed(3)};
        gl_FragColor.rgb += rimColor * (fresnel * rimStrength);`,
    );
  };

  material.customProgramCacheKey = () => [
    previousKey(),
    'fresnel-rim-v2',
    color.join(','),
    strength.toFixed(3),
    power.toFixed(2),
    heightShadeMinimum.toFixed(3),
    alertColor.join(','),
    alertStrength.toFixed(3),
  ].join(':');
  material.needsUpdate = true;
}
