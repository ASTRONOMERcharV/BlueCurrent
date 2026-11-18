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
import {
  clampPitch,
  stepPitch,
  targetPitchFromDirection,
  turnFromBank,
  type FishMotionDiagnostics,
} from './fishMotion';

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
  /** Absolute renderer pitch limit (rad). */
  readonly pitchLimit?: number;
  /** Maximum pitch change per second (rad/s). */
  readonly pitchRateLimit?: number;
  /** Exponential pitch response rate (1/s). */
  readonly pitchResponse?: number;
  /** Lateral tail bend per unit of normalised bank. */
  readonly turnCurvature?: number;
  /** Bank magnitude treated as a full turn. */
  readonly turnBankReference?: number;
  /**
   * `legacy` reproduces the pre-E1 presentation (instant, unclamped pitch and
   * no turn bend) for same-version before/after captures. Presentation only.
   */
  readonly motionMode?: 'smooth' | 'legacy';
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
  pitchLimit: 0.9,
  pitchRateLimit: 2.4,
  pitchResponse: 9,
  turnCurvature: 0.2,
  turnBankReference: 0.65,
  motionMode: 'smooth',
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
  private readonly turnAttribute: InstancedBufferAttribute;
  private readonly pitchState: Float32Array;
  private readonly headingState: Float32Array;
  private readonly motionInitialized: Uint8Array;
  private lastMotionTime = Number.NEGATIVE_INFINITY;
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
    this.turnAttribute = new InstancedBufferAttribute(new Float32Array(flock.capacity), 1);
    this.turnAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceTurn', this.turnAttribute);
    this.pitchState = new Float32Array(flock.capacity);
    this.headingState = new Float32Array(flock.capacity);
    this.motionInitialized = new Uint8Array(flock.capacity);

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
          attribute float instanceTurn;
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
          transformed.x += instanceTurn * ${this.options.turnCurvature.toFixed(3)}
            * pow(tailWeight, 1.35);
        `);
    };
    bodyMaterial.customProgramCacheKey = () => `blue-current-fish-${this.modelKind}-v6-${this.options.swimRateBase}-${this.options.swimRateSpeed}-${this.options.swimRateFear}-${this.options.swimPhasePerZ}-${this.options.swimAmplitude}-${this.options.turnCurvature}-${this.options.turnBankReference}-${this.options.motionMode}`;
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

    // Render-only pitch state. First frame, a time jump or a large step snaps
    // to the simulated heading so paused/scrubbed captures stay reproducible;
    // a non-positive step keeps the pose instead of jumping.
    const dt = time - this.lastMotionTime;
    const snap = !Number.isFinite(this.lastMotionTime) || time < this.lastMotionTime || dt > 0.25;
    const smooth = dt > 0 && !snap;
    this.lastMotionTime = time;
    const { pitchLimit, pitchRateLimit, pitchResponse, turnBankReference } = this.options;

    for (let i = 0; i < count; i += 1) {
      const offset = i * 3;
      this.dummy.position.set(
        MathUtils.lerp(previousPositions[offset], positions[offset], alpha),
        MathUtils.lerp(previousPositions[offset + 1], positions[offset + 1], alpha),
        MathUtils.lerp(previousPositions[offset + 2], positions[offset + 2], alpha),
      );
      const velocityX = velocities[offset];
      const velocityY = velocities[offset + 1];
      const velocityZ = velocities[offset + 2];
      const speed = Math.max(0.0001, Math.hypot(velocityX, velocityY, velocityZ));
      const horizontalSpeed = Math.hypot(velocityX, velocityZ);
      let heading = this.headingState[i];
      if (horizontalSpeed > 1e-4) heading = Math.atan2(velocityX, velocityZ);
      const targetPitch = targetPitchFromDirection(velocityY / speed);
      let pitch = this.pitchState[i];
      if (this.options.motionMode === 'legacy') {
        // Pre-E1 presentation kept for same-version comparison captures: the
        // body follows the instantaneous velocity with no smoothing, rate
        // limit or limit.
        pitch = targetPitch;
        this.motionInitialized[i] = 1;
      } else if (snap || this.motionInitialized[i] === 0) {
        pitch = clampPitch(targetPitch, pitchLimit);
        this.motionInitialized[i] = 1;
      } else if (smooth) {
        pitch = stepPitch(pitch, targetPitch, dt, pitchResponse, pitchRateLimit, pitchLimit);
      }
      this.pitchState[i] = pitch;
      this.headingState[i] = heading;
      const cosPitch = Math.cos(pitch);
      this.direction.set(
        Math.sin(heading) * cosPitch,
        Math.sin(pitch),
        Math.cos(heading) * cosPitch,
      );
      this.direction.normalize();
      this.dummy.quaternion.setFromUnitVectors(FORWARD, this.direction);
      const bank = MathUtils.lerp(previousBanks[i], banks[i], alpha);
      this.bankRotation.setFromAxisAngle(FORWARD, bank);
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
      this.turnAttribute.setX(
        i,
        this.options.motionMode === 'legacy' ? 0 : turnFromBank(bank, turnBankReference),
      );
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.motion.needsUpdate = true;
    this.fearAttribute.needsUpdate = true;
    this.turnAttribute.needsUpdate = true;
  }

  /** Read-only motion summary for capture evidence and debug telemetry. */
  motionDiagnostics(): FishMotionDiagnostics {
    const { velocities, alive, count, fear, banks, positions } = this.flock;
    let pitchSum = 0;
    let pitchMax = 0;
    let bankSum = 0;
    let bankMax = 0;
    let turnSum = 0;
    let turnMax = 0;
    let speedSum = 0;
    let fearSum = 0;
    let targetPitchMax = -1;
    let targetPitchIndex = -1;
    let live = 0;
    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0) continue;
      live += 1;
      const pitch = Math.abs(this.pitchState[i]);
      pitchSum += pitch;
      pitchMax = Math.max(pitchMax, pitch);
      const bank = Math.abs(banks[i]);
      bankSum += bank;
      bankMax = Math.max(bankMax, bank);
      const turn = Math.abs(this.turnAttribute.getX(i));
      turnSum += turn;
      turnMax = Math.max(turnMax, turn);
      const offset = i * 3;
      const speed = Math.hypot(velocities[offset], velocities[offset + 1], velocities[offset + 2]);
      speedSum += speed;
      fearSum += fear[i];
      const targetPitch = Math.abs(targetPitchFromDirection(velocities[offset + 1] / Math.max(0.0001, speed)));
      if (targetPitch > targetPitchMax) {
        targetPitchMax = targetPitch;
        targetPitchIndex = i;
      }
    }
    if (live === 0) {
      return {
        meanAbsPitch: 0,
        maxAbsPitch: 0,
        meanAbsBank: 0,
        maxAbsBank: 0,
        meanAbsTurn: 0,
        maxAbsTurn: 0,
        meanSpeed: 0,
        meanFear: 0,
        maxTargetPitchIndex: -1,
        maxTargetPitchPosition: null,
      };
    }
    return {
      meanAbsPitch: pitchSum / live,
      maxAbsPitch: pitchMax,
      meanAbsBank: bankSum / live,
      maxAbsBank: bankMax,
      meanAbsTurn: turnSum / live,
      maxAbsTurn: turnMax,
      meanSpeed: speedSum / live,
      meanFear: fearSum / live,
      maxTargetPitchIndex: targetPitchIndex,
      maxTargetPitchPosition: targetPitchIndex >= 0
        ? [
          positions[targetPitchIndex * 3],
          positions[targetPitchIndex * 3 + 1],
          positions[targetPitchIndex * 3 + 2],
        ]
        : null,
    };
  }
}
