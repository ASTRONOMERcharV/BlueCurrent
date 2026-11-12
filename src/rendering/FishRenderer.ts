import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { FlockData } from '../simulation/FlockData';
import { createFishGeometry } from './Environment';
import type { FishAsset } from './FishAsset';
import { applyFresnelRim } from './UnderwaterLighting';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

const FORWARD = new Vector3(0, 0, 1);
const TAIL_START = -0.95;
const TAIL_END = 0.12;
const TAIL_AMPLITUDE = 0.16;

type FishModelKind = 'procedural' | 'blender';

export interface FishRendererOptions {
  /** Mid-body scale multiplier applied to the authored geometry length. */
  readonly scaleBase?: number;
  readonly scaleVariation?: number;
  /** `school` applies the species tint; `texture` keeps the GLB stripes. */
  readonly tintMode?: 'school' | 'texture';
  readonly alertStrength?: number;
  readonly rimStrength?: number;
  readonly swimRateBase?: number;
  readonly swimRateSpeed?: number;
  readonly swimRateFear?: number;
  readonly swimPhasePerZ?: number;
  readonly swimAmplitude?: number;
}

const DEFAULT_RENDER_OPTIONS: Required<FishRendererOptions> = {
  // 1.641 m authored length x 0.55-0.67 = 0.90-1.10 m world length.
  scaleBase: 0.55,
  scaleVariation: 0.12,
  tintMode: 'school',
  alertStrength: 0.72,
  rimStrength: UNDERWATER_LIGHTING_CONFIG.schoolRim.strength ?? 0.12,
  swimRateBase: 4.2,
  swimRateSpeed: 6.2,
  swimRateFear: 2.4,
  swimPhasePerZ: 2.35,
  swimAmplitude: TAIL_AMPLITUDE,
};

/** Small reef school: 0.50-0.60 m long, rapid pectoral-style wiggle. */
export const CLOWNFISH_RENDER_OPTIONS: FishRendererOptions = {
  scaleBase: 0.5,
  scaleVariation: 0.1,
  tintMode: 'texture',
  alertStrength: 0.32,
  rimStrength: 0.07,
  swimRateBase: 6.2,
  swimRateSpeed: 3.0,
  swimRateFear: 3.0,
  swimPhasePerZ: 3.0,
  swimAmplitude: 0.14,
};

export class FishRenderer {
  readonly mesh: InstancedMesh;
  readonly modelKind: FishModelKind;
  readonly triangleCount: number;
  readonly worldLengthMin: number;
  readonly worldLengthMax: number;
  private readonly dummy = new Object3D();
  private readonly direction = new Vector3();
  private readonly bankRotation = new Quaternion();
  private readonly color = new Color();
  private readonly baseColor = new Color();
  private readonly alertColor = new Color(0xffa27c);
  private readonly motion: InstancedBufferAttribute;
  private readonly fearAttribute: InstancedBufferAttribute;
  private readonly timeUniform = { value: 0 };
  private readonly tailStartUniform = { value: TAIL_START };
  private readonly tailEndUniform = { value: TAIL_END };
  private readonly options: Required<FishRendererOptions>;

  constructor(
    scene: Scene,
    private readonly flock: FlockData,
    asset?: FishAsset,
    options: FishRendererOptions = {},
  ) {
    this.options = { ...DEFAULT_RENDER_OPTIONS, ...options };
    this.modelKind = asset ? 'blender' : 'procedural';
    const geometry = asset?.geometry ?? createFishGeometry();
    const hasTailWeights = Boolean(geometry.getAttribute('aTailWeight'));
    const materials: MeshStandardMaterial[] = asset?.materials ?? [
      new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.52,
        metalness: 0.12,
        flatShading: true,
      }),
    ];

    const phases = new Float32Array(flock.phases);
    geometry.setAttribute('instancePhase', new InstancedBufferAttribute(phases, 1));
    this.motion = new InstancedBufferAttribute(new Float32Array(flock.capacity), 1);
    this.motion.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceSpeed', this.motion);
    this.fearAttribute = new InstancedBufferAttribute(new Float32Array(flock.capacity), 1);
    this.fearAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceFear', this.fearAttribute);

    const bodyMaterial = materials[0];
    bodyMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uSwimTime = this.timeUniform;
      shader.uniforms.uTailStart = this.tailStartUniform;
      shader.uniforms.uTailEnd = this.tailEndUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uSwimTime;
          uniform float uTailStart;
          uniform float uTailEnd;
          attribute float instancePhase;
          attribute float instanceSpeed;
          attribute float instanceFear;
          ${hasTailWeights ? 'attribute float aTailWeight;' : ''}
        `)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float tailWeight = ${hasTailWeights
            ? 'aTailWeight'
            : '1.0 - smoothstep(uTailStart, uTailEnd, position.z)'};
          float swimRate = ${this.options.swimRateBase.toFixed(3)}
            + instanceSpeed * ${this.options.swimRateSpeed.toFixed(3)}
            + instanceFear * ${this.options.swimRateFear.toFixed(3)};
          float swimPhase = uSwimTime * swimRate + instancePhase
            + position.z * ${this.options.swimPhasePerZ.toFixed(3)};
          float tailWave = sin(swimPhase);
          float bodyWave = sin(swimPhase * 0.54 + instancePhase * 0.7) * 0.34;
          float swimAmplitude = 0.66 + instanceSpeed * 0.42 + instanceFear * 0.30;
          transformed.x += (tailWave * tailWeight + bodyWave * tailWeight * 0.35)
            * ${this.options.swimAmplitude.toFixed(3)} * swimAmplitude;
        `);
    };
    bodyMaterial.customProgramCacheKey = () => `blue-current-fish-${this.modelKind}-v4-${this.options.swimRateBase}-${this.options.swimRateSpeed}-${this.options.swimRateFear}-${this.options.swimPhasePerZ}-${this.options.swimAmplitude}`;
    // The school keeps only a thin shared Fresnel edge; the shark carries the
    // obvious rim. Individual fish are therefore grouped by the water light,
    // not turned into 500 evenly spotlit objects.
    for (const material of materials) {
      applyFresnelRim(material, {
        ...UNDERWATER_LIGHTING_CONFIG.schoolRim,
        strength: this.options.rimStrength,
      });
    }
    if (asset) {
      // The GLB supplies its own PBR maps and double-sided flags; keep them.
      bodyMaterial.flatShading = false;
      bodyMaterial.needsUpdate = true;
    }

    this.mesh = new InstancedMesh(geometry, asset ? materials : bodyMaterial, flock.capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = flock.count;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    this.triangleCount = (index ? index.count : position.count) / 3;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const baseLength = bounds.max.z - bounds.min.z;
    this.worldLengthMin = baseLength * this.options.scaleBase;
    this.worldLengthMax = baseLength * (this.options.scaleBase + this.options.scaleVariation);
    scene.add(this.mesh);
  }

  update(alpha: number, time: number, maximumSpeed: number): void {
    const { positions, previousPositions, velocities, alive, count, fear, variants, banks, previousBanks } = this.flock;
    this.mesh.count = count;
    this.timeUniform.value = time;

    for (let i = 0; i < count; i += 1) {
      const offset = i * 3;
      this.dummy.position.set(
        MathUtils.lerp(previousPositions[offset], positions[offset], alpha),
        MathUtils.lerp(previousPositions[offset + 1], positions[offset + 1], alpha),
        MathUtils.lerp(previousPositions[offset + 2], positions[offset + 2], alpha),
      );
      this.direction.set(velocities[offset], velocities[offset + 1], velocities[offset + 2]);
      const speed = Math.max(0.0001, this.direction.length());
      this.direction.multiplyScalar(1 / speed);
      this.dummy.quaternion.setFromUnitVectors(FORWARD, this.direction);
      this.bankRotation.setFromAxisAngle(FORWARD, MathUtils.lerp(previousBanks[i], banks[i], alpha));
      this.dummy.quaternion.multiply(this.bankRotation);

      const scale = alive[i] === 0
        ? 0
        : this.options.scaleBase + variants[i] * this.options.scaleVariation;
      const variantBin = Math.min(3, Math.floor(variants[i] * 4));
      this.dummy.scale.set(
        scale * (0.94 + variantBin * 0.025),
        scale * (0.95 + ((variantBin * 3) % 4) * 0.025),
        scale * (0.94 + variantBin * 0.035),
      );
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      if (this.options.tintMode === 'texture') {
        // Keep the authored orange/white stripes; only a neutral, very slight
        // warm variation is multiplied over the texture.
        this.baseColor.setHSL(0.07, 0.08, 0.95 + variants[i] * 0.04);
      } else if (this.modelKind === 'blender') {
        // The texture already carries the countershading; instanceColor only
        // adds a gentle per-fish tint plus the real fear response.
        const hue = 0.47 + variants[i] * 0.05;
        this.baseColor.setHSL(hue, 0.20, 0.92 + variants[i] * 0.07);
      } else {
        const hue = 0.48 + variants[i] * 0.055;
        this.baseColor.setHSL(hue, 0.62, 0.24 + variants[i] * 0.18);
      }
      this.color.copy(this.baseColor).lerp(
        this.alertColor,
        Math.min(this.options.alertStrength, fear[i] * 0.9),
      );
      this.mesh.setColorAt(i, this.color);
      this.motion.setX(i, Math.min(1.5, speed / maximumSpeed));
      this.fearAttribute.setX(i, fear[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.motion.needsUpdate = true;
    this.fearAttribute.needsUpdate = true;
  }
}
