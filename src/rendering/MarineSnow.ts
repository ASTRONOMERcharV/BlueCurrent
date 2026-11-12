import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Color,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';
import {
  DEFAULT_MARINE_SNOW_BOUNDS,
  MarineSnowSimulation,
  type CurrentSampler,
  type MarineSnowBounds,
} from '../environment/MarineSnowField';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

export interface MarineSnowConfig {
  readonly count?: number;
  readonly bounds?: MarineSnowBounds;
  readonly seed?: number;
  readonly advection?: number;
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPointScale;
  varying float vAlpha;
  varying float vSparkle;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depth = max(0.5, -mvPosition.z);
    gl_PointSize = clamp(aSize * uPointScale / depth, 1.0, 9.0);
    gl_Position = projectionMatrix * mvPosition;
    // Fade the volume edges and very near flakes so no hard rectangles appear.
    float nearFade = smoothstep(2.0, 7.0, depth);
    float farFade = 1.0 - smoothstep(42.0, 70.0, depth);
    vAlpha = nearFade * farFade;
    vSparkle = 0.72 + 0.28 * sin(uTime * 1.7 + aPhase * 6.2831853);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSparkle;

  void main() {
    vec2 local = gl_PointCoord - vec2(0.5);
    float radius = length(local) * 2.0;
    float sprite = smoothstep(1.0, 0.18, radius);
    float alpha = sprite * vAlpha * vSparkle * uOpacity;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Marine snow and micro-bubbles rendered as one GPU point cloud, advected on
 * the CPU by the shared OceanCurrentField. Two thousand points would still be
 * cheaper than one extra instanced draw of a helper mesh, and the update path
 * keeps the current field as the single source of motion.
 */
export class MarineSnow {
  readonly points: Points;
  readonly simulation: MarineSnowSimulation;
  private readonly material: ShaderMaterial;
  private readonly positionAttribute: BufferAttribute;
  private readonly timeUniform = { value: 0 };
  private readonly advection: number;
  private readonly field: CurrentSampler;

  constructor(scene: Scene, field: CurrentSampler, config: MarineSnowConfig = {}) {
    // The volume still holds the full deterministic field; the clear-water
    // preset renders 42% of it, rather than regenerating a different field.
    const count = config.count
      ?? Math.round(950 * UNDERWATER_LIGHTING_CONFIG.water.marineSnowDensity);
    this.advection = config.advection ?? 1.15;
    this.field = field;
    this.simulation = new MarineSnowSimulation({
      count,
      bounds: config.bounds ?? DEFAULT_MARINE_SNOW_BOUNDS,
      seed: config.seed ?? 0x5eaf00d,
    });

    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.simulation.positions, 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute(
      'aSize',
      new BufferAttribute(this.simulation.sizes, 1),
    );
    geometry.setAttribute(
      'aPhase',
      new BufferAttribute(this.simulation.phases, 1),
    );

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: this.timeUniform,
        uPointScale: { value: 700 },
        uColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.marineSnowColor) },
        uOpacity: { value: UNDERWATER_LIGHTING_CONFIG.water.marineSnowOpacity },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });

    this.points = new Points(geometry, this.material);
    this.points.name = 'marineSnow';
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  get particleCount(): number {
    return this.simulation.count;
  }

  update(time: number, delta: number): void {
    if (!this.points.visible) return;
    this.timeUniform.value = time;
    this.simulation.update(this.field, time, delta, this.advection);
    this.positionAttribute.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.points.visible = visible;
  }

  setOpacity(opacity: number): void {
    (this.material.uniforms.uOpacity as { value: number }).value = opacity;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
