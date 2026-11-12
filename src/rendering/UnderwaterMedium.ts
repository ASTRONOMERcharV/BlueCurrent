import {
  Color,
  Material,
  ShaderChunk,
  Vector3,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { WATER_ATTENUATION_RGB, WATER_FOG_DENSITY } from '../environment/UnderwaterOptics';
import {
  UNDERWATER_LIGHTING_CONFIG,
  UNDERWATER_SUN_DIRECTION,
} from './lighting/UnderwaterLightingConfig';

/** Mid-water colour used by the in-scattering medium and legacy fog. */
export const UNDERWATER_WATER_COLOR = UNDERWATER_LIGHTING_CONFIG.water.color;
/** Far background outside the fogged geometry. */
export const UNDERWATER_BACKGROUND_COLOR = UNDERWATER_LIGHTING_CONFIG.water.background;

/**
 * One source of truth for the water medium. Absorption is per channel in 1/m;
 * light-scattering strength and the local layers remain art-directed controls.
 */
export interface UnderwaterMediumConfig {
  readonly waterColor: number;
  readonly absorption: readonly [number, number, number];
  readonly visibilityDistance: number;
  readonly scatteringStrength: number;
  readonly scatteringAnisotropy: number;
  /** Near-water and far-water hues for the Phase 2 distance layering. */
  readonly scatterNearColor: number;
  readonly scatterFarColor: number;
  readonly scatterColorDistance: number;
  /** Lit upper water column and weak sunward phase lobe. */
  readonly surfaceScatterColor: number;
  readonly surfaceScatterStrength: number;
  readonly surfaceHeight: number;
  readonly deepHeight: number;
  readonly sunScatterColor: number;
  readonly sunScatterStrength: number;
  readonly sunDirection: readonly [number, number, number];
  readonly fogStart: number;
  readonly particleDensity: number;
  readonly particleBrightness: number;
  readonly causticsStrength: number;
  readonly volumetricStrength: number;
}

const absorption = WATER_ATTENUATION_RGB.map(
  (multiplier) => multiplier * WATER_FOG_DENSITY,
) as [number, number, number];

export const UNDERWATER_MEDIUM_CONFIG: UnderwaterMediumConfig = {
  // Light-scattered colour, not the near-black far background medium.
  waterColor: UNDERWATER_LIGHTING_CONFIG.water.scatterColor,
  absorption,
  // Distance at which 5% of green object radiance remains (1/e^3).
  visibilityDistance: -Math.log(0.05) / absorption[1],
  scatteringStrength: UNDERWATER_LIGHTING_CONFIG.water.scatteringStrength,
  // Phase 2 uses a weak forward lobe; the shader clamps g to [0, 0.9].
  scatteringAnisotropy: UNDERWATER_LIGHTING_CONFIG.water.scatteringAnisotropy,
  scatterNearColor: UNDERWATER_LIGHTING_CONFIG.water.scatterNearColor,
  scatterFarColor: UNDERWATER_LIGHTING_CONFIG.water.scatterFarColor,
  scatterColorDistance: UNDERWATER_LIGHTING_CONFIG.water.scatterColorDistance,
  surfaceScatterColor: UNDERWATER_LIGHTING_CONFIG.water.surfaceScatterColor,
  surfaceScatterStrength: UNDERWATER_LIGHTING_CONFIG.water.surfaceScatterStrength,
  surfaceHeight: UNDERWATER_LIGHTING_CONFIG.water.surfaceHeight,
  deepHeight: UNDERWATER_LIGHTING_CONFIG.water.deepHeight,
  sunScatterColor: UNDERWATER_LIGHTING_CONFIG.water.sunScatterColor,
  sunScatterStrength: UNDERWATER_LIGHTING_CONFIG.water.sunScatterStrength,
  sunDirection: UNDERWATER_SUN_DIRECTION,
  fogStart: 0,
  particleDensity: UNDERWATER_LIGHTING_CONFIG.water.marineSnowDensity,
  particleBrightness: UNDERWATER_LIGHTING_CONFIG.water.marineSnowOpacity,
  causticsStrength: UNDERWATER_LIGHTING_CONFIG.water.causticsStrength,
  volumetricStrength: UNDERWATER_LIGHTING_CONFIG.water.volumetricStrength,
};

/**
 * `clear` composes in linear working space before ACES tone mapping and the
 * output transfer. `legacy-display` keeps the old post-transfer fog formula
 * exclusively for A/B rollback (`?water=legacy`); it is never composed twice.
 */
export type WaterOpticsModel = 'clear' | 'legacy-display';

/** Names are shared by the UI, diagnostics API and capture automation. */
export type WaterDebugLayer =
  | 'sceneFog'
  | 'waterAttenuation'
  | 'volumetricScattering'
  | 'marineParticles'
  | 'lightShafts'
  | 'caustics'
  | 'surfaceLight';

export type MediumDebugLayer = 'sceneFog' | 'waterAttenuation' | 'volumetricScattering';
export type LocalWaterDebugLayer = Exclude<WaterDebugLayer, MediumDebugLayer>;

export interface WaterDebugState extends Record<WaterDebugLayer, boolean> {
  /** Null means that no post-processing composer is installed (not "disabled"). */
  readonly postProcessing: null;
}

export function createWaterDebugState(): WaterDebugState {
  return {
    sceneFog: true,
    waterAttenuation: true,
    volumetricScattering: true,
    marineParticles: true,
    lightShafts: true,
    caustics: true,
    surfaceLight: true,
    postProcessing: null,
  };
}

let installed = false;

/**
 * Built-in materials keep their fog plumbing only for the compatibility path.
 * The clear path receives a dedicated injection before `<tonemapping_fragment>`
 * and uses its own view-distance varying, so it remains valid when `scene.fog`
 * is null and never performs a second transfer after ACES.
 */
export function installUnderwaterMedium(): void {
  if (installed) return;
  installed = true;
  const [red, green, blue] = WATER_ATTENUATION_RGB;

  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG

  uniform vec3 fogColor;
  varying float vFogDepth;
  uniform float uWaterMediumEnabled;
  uniform float uWaterAttenuationEnabled;
  uniform float uWaterScatteringEnabled;
  uniform float uWaterLegacyMode;
  uniform vec3 uWaterAbsorption;
  uniform vec3 uWaterColor;
  uniform float uWaterScatteringStrength;
  uniform float uWaterFogStart;
  uniform vec3 uWaterScatterNear;
  uniform vec3 uWaterScatterFar;
  uniform float uWaterScatterDistance;
  uniform vec3 uWaterSurfaceScatter;
  uniform float uWaterSurfaceScatterStrength;
  uniform float uWaterSurfaceHeight;
  uniform float uWaterDeepHeight;
  uniform vec3 uWaterSunScatter;
  uniform float uWaterSunScatterStrength;
  uniform vec3 uWaterSunDirection;
  uniform float uWaterScatteringAnisotropy;

  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

#endif
`;

  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG

  if ( uWaterLegacyMode > 0.5 ) {
    #ifdef FOG_EXP2
      vec3 legacyTransmittance = exp(
        - fogDensity * vec3( ${red.toFixed(3)}, ${green.toFixed(3)}, ${blue.toFixed(3)} ) * vFogDepth
      );
    #else
      vec3 legacyTransmittance = vec3( 1.0 ) - vec3( smoothstep( fogNear, fogFar, vFogDepth ) );
    #endif

    // Three r180's fogColor uniform is already in output space. Encoding it
    // again here is the historical defect retained only for the A/B baseline.
    vec3 legacyWaterColor = sRGBTransferOETF( vec4( fogColor, 1.0 ) ).rgb;
    vec3 legacyTransmitted = mix(
      gl_FragColor.rgb,
      gl_FragColor.rgb * legacyTransmittance,
      uWaterAttenuationEnabled
    );
    vec3 legacyInScattering = legacyWaterColor * ( vec3( 1.0 ) - legacyTransmittance )
      * uWaterScatteringEnabled;
    vec3 legacyComposed = legacyTransmitted + legacyInScattering;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, legacyComposed, uWaterMediumEnabled );
  }

#endif
`;
}

export function isUnderwaterMediumInstalled(): boolean {
  return installed;
}

/**
 * Single attachment point for the underwater terms on built-in materials.
 * Existing swim, kelp, Fresnel and caustic callbacks are preserved. Attaching
 * the same material twice is harmless, which matters for lazy GLB loads.
 */
export class UnderwaterMedium {
  private readonly attached = new WeakSet<Material>();
  private readonly uniforms = {
    uWaterMediumEnabled: { value: 1 },
    uWaterAttenuationEnabled: { value: 1 },
    uWaterScatteringEnabled: { value: 1 },
    uWaterLegacyMode: { value: 0 },
    uWaterAbsorption: { value: new Vector3(...UNDERWATER_MEDIUM_CONFIG.absorption) },
    uWaterColor: { value: new Color(UNDERWATER_MEDIUM_CONFIG.waterColor) },
    uWaterScatteringStrength: { value: UNDERWATER_MEDIUM_CONFIG.scatteringStrength },
    uWaterFogStart: { value: UNDERWATER_MEDIUM_CONFIG.fogStart },
    uWaterScatterNear: { value: new Color(UNDERWATER_MEDIUM_CONFIG.scatterNearColor) },
    uWaterScatterFar: { value: new Color(UNDERWATER_MEDIUM_CONFIG.scatterFarColor) },
    uWaterScatterDistance: { value: UNDERWATER_MEDIUM_CONFIG.scatterColorDistance },
    uWaterSurfaceScatter: { value: new Color(UNDERWATER_MEDIUM_CONFIG.surfaceScatterColor) },
    uWaterSurfaceScatterStrength: { value: UNDERWATER_MEDIUM_CONFIG.surfaceScatterStrength },
    uWaterSurfaceHeight: { value: UNDERWATER_MEDIUM_CONFIG.surfaceHeight },
    uWaterDeepHeight: { value: UNDERWATER_MEDIUM_CONFIG.deepHeight },
    uWaterSunScatter: { value: new Color(UNDERWATER_MEDIUM_CONFIG.sunScatterColor) },
    uWaterSunScatterStrength: { value: UNDERWATER_MEDIUM_CONFIG.sunScatterStrength },
    uWaterSunDirection: { value: new Vector3(...UNDERWATER_MEDIUM_CONFIG.sunDirection) },
    uWaterScatteringAnisotropy: { value: UNDERWATER_MEDIUM_CONFIG.scatteringAnisotropy },
  };

  constructor(model: WaterOpticsModel = 'clear') {
    this.setOpticsModel(model);
  }

  get opticsModel(): WaterOpticsModel {
    return this.uniforms.uWaterLegacyMode.value > 0.5 ? 'legacy-display' : 'clear';
  }

  setOpticsModel(model: WaterOpticsModel): void {
    this.uniforms.uWaterLegacyMode.value = model === 'legacy-display' ? 1 : 0;
  }

  attach(root: Object3D): void {
    root.traverse((object) => {
      const renderable = object as Object3D & { material?: Material | Material[] };
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) this.attachMaterial(material);
    });
  }

  setLayer(layer: MediumDebugLayer, enabled: boolean): void {
    const value = enabled ? 1 : 0;
    if (layer === 'sceneFog') this.uniforms.uWaterMediumEnabled.value = value;
    else if (layer === 'waterAttenuation') this.uniforms.uWaterAttenuationEnabled.value = value;
    else this.uniforms.uWaterScatteringEnabled.value = value;
  }

  private attachMaterial(material: Material): void {
    if (this.attached.has(material)) return;
    this.attached.add(material);
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);

    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      previousCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      if (!shader.vertexShader.includes('#include <common>')
        || !shader.vertexShader.includes('#include <project_vertex>')
        || !shader.fragmentShader.includes('#include <common>')
        || !shader.fragmentShader.includes('#include <tonemapping_fragment>')) {
        // Custom dome/shaft/snow shaders handle their own output conversion and
        // must not receive a second medium composition.
        return;
      }

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying float vWaterViewDepth;
          varying vec3 vWaterViewDirection;
          varying vec3 vWaterWorldPosition;
        `)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vWaterViewDepth = - mvPosition.z;
          vWaterViewDirection = mvPosition.xyz;
          vec4 waterWorldPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            waterWorldPosition = instanceMatrix * waterWorldPosition;
          #endif
          vWaterWorldPosition = ( modelMatrix * waterWorldPosition ).xyz;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vWaterViewDepth;
          varying vec3 vWaterViewDirection;
          varying vec3 vWaterWorldPosition;
          #ifndef USE_FOG
            uniform float uWaterMediumEnabled;
            uniform float uWaterAttenuationEnabled;
            uniform float uWaterScatteringEnabled;
            uniform float uWaterLegacyMode;
            uniform vec3 uWaterAbsorption;
            uniform vec3 uWaterColor;
            uniform float uWaterScatteringStrength;
            uniform float uWaterFogStart;
            uniform vec3 uWaterScatterNear;
            uniform vec3 uWaterScatterFar;
            uniform float uWaterScatterDistance;
            uniform vec3 uWaterSurfaceScatter;
            uniform float uWaterSurfaceScatterStrength;
            uniform float uWaterSurfaceHeight;
            uniform float uWaterDeepHeight;
            uniform vec3 uWaterSunScatter;
            uniform float uWaterSunScatterStrength;
            uniform vec3 uWaterSunDirection;
            uniform float uWaterScatteringAnisotropy;
          #endif
        `)
        .replace('#include <tonemapping_fragment>', `
          // Beer-Lambert extinction and in-scattering in linear working space.
          // Direct light, shadows, Fresnel and caustics are already present in
          // gl_FragColor; only the camera-to-surface water path is added here.
          float waterPathLength = max( vWaterViewDepth - uWaterFogStart, 0.0 );
          vec3 waterTransmittance = exp( - uWaterAbsorption * waterPathLength );
          vec3 waterTransmitted = mix(
            gl_FragColor.rgb,
            gl_FragColor.rgb * waterTransmittance,
            uWaterAttenuationEnabled
          );

          // Phase 2 near/far hue layering. This changes the colour of the
          // in-scattering term, not the extinction curve or the object light.
          float waterScatterMix = 1.0 - exp(
            - waterPathLength / max( uWaterScatterDistance, 0.001 )
          );
          vec3 waterLayerColor = mix(
            uWaterScatterNear, uWaterScatterFar, waterScatterMix
          );

          // Lit upper column: estimate the midpoint height of the water path.
          // A shallow path picks up a little more of the sun/hemisphere light;
          // the deep path stays on the ambient near/far palette above.
          vec3 waterViewDirection = vWaterViewDirection
            / max( length( vWaterViewDirection ), 0.0001 );
          vec3 waterWorldViewDirection = normalize(
            vWaterWorldPosition - cameraPosition
          );
          float waterMidHeight = cameraPosition.y
            + waterWorldViewDirection.y * waterPathLength * 0.5;
          float waterSurfaceSpan = max(
            uWaterSurfaceHeight - uWaterDeepHeight, 0.001
          );
          float waterSurfaceT = clamp(
            ( waterMidHeight - uWaterDeepHeight ) / waterSurfaceSpan, 0.0, 1.0
          );
          float waterSurfaceFactor = waterSurfaceT * waterSurfaceT
            * ( 3.0 - 2.0 * waterSurfaceT );
          vec3 waterLitColor = mix(
            waterLayerColor,
            uWaterSurfaceScatter,
            waterSurfaceFactor * uWaterSurfaceScatterStrength
          );

          // Weak forward-scattering lobe toward the sun. The relative phase is
          // one for an isotropic medium, so only the positive lobe is applied.
          vec3 waterSunViewDirection = normalize(
            ( viewMatrix * vec4( uWaterSunDirection, 0.0 ) ).xyz
          );
          float waterCosTheta = clamp(
            dot( waterViewDirection, waterSunViewDirection ), -1.0, 1.0
          );
          float waterG = clamp( uWaterScatteringAnisotropy, 0.0, 0.9 );
          float waterPhaseDenominator = max(
            1.0 + waterG * waterG - 2.0 * waterG * waterCosTheta, 0.0001
          );
          float waterPhase = ( 1.0 - waterG * waterG )
            / pow( waterPhaseDenominator, 1.5 );
          float waterPhasePeak = ( 1.0 + waterG )
            / max( ( 1.0 - waterG ) * ( 1.0 - waterG ), 0.0001 );
          float waterSunLobe = clamp(
            ( waterPhase - 1.0 ) / max( waterPhasePeak - 1.0, 0.0001 ), 0.0, 1.0
          );
          vec3 waterScatterColor = mix(
            waterLitColor,
            uWaterSunScatter,
            waterSunLobe * uWaterSunScatterStrength
          );

          vec3 waterInScattering = waterScatterColor
            * ( vec3( 1.0 ) - waterTransmittance )
            * uWaterScatteringEnabled * uWaterScatteringStrength;
          vec3 waterComposed = waterTransmitted + waterInScattering;
          float clearMedium = ( 1.0 - uWaterLegacyMode ) * uWaterMediumEnabled;
          gl_FragColor.rgb = mix( gl_FragColor.rgb, waterComposed, clearMedium );

          #include <tonemapping_fragment>
        `);
    };
    material.customProgramCacheKey = () => `${previousKey()}|underwater-medium-clear-v3`;
    material.needsUpdate = true;
  }
}
