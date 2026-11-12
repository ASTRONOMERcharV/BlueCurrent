import { Bone, MathUtils, Quaternion, Vector3 } from 'three';
import type { PredatorState } from '../simulation/PredatorSystem';

/**
 * Procedural swimming controller for the rigged shayu predator.
 *
 * The simulation owns the trajectory; this class only turns the real motion
 * state (velocity, state) into a bone pose. It never writes positions or
 * velocities back into the simulation.
 *
 * Axis convention (glTF): +Z forward, +Y up, +X left.
 * Spine bones bend around their local up axis, pectoral fins flap around the
 * local forward axis. Bone-local axes are derived from the rest pose so the
 * controller does not depend on Blender bone roll.
 */

export interface PredatorRigConfig {
  /** Speed that maps to the top of the frequency/amplitude range. */
  referenceSpeed: number;
  minFrequency: number;
  maxFrequency: number;
  attackFrequencyBoost: number;
  thrustFrequencyBoost: number;
  minBodyAmplitude: number;
  maxBodyAmplitude: number;
  bodyWaveNumber: number;
  envelopeStart: number;
  envelopePower: number;
  tailFinAmplitude: number;
  tailFinPhaseLag: number;
  turnBendMax: number;
  turnTailBoost: number;
  bankMax: number;
  bankGain: number;
  maxYawRate: number;
  maxPitchRate: number;
  pitchLimit: number;
  pectoralBaseAngle: number;
  pectoralBankGain: number;
  pectoralMaxAngle: number;
}

export const DEFAULT_PREDATOR_RIG_CONFIG: PredatorRigConfig = {
  referenceSpeed: 7.4,
  minFrequency: 0.8,
  maxFrequency: 1.9,
  attackFrequencyBoost: 0.55,
  thrustFrequencyBoost: 0.25,
  minBodyAmplitude: 0.045,
  maxBodyAmplitude: 0.10,
  bodyWaveNumber: 3.0,
  envelopeStart: 0.34,
  envelopePower: 1.15,
  tailFinAmplitude: 0.38,
  tailFinPhaseLag: 0.55,
  turnBendMax: 0.13,
  turnTailBoost: 2.2,
  bankMax: 0.34,
  bankGain: 0.11,
  maxYawRate: 4.0,
  maxPitchRate: 0.75,
  pitchLimit: 1.15,
  pectoralBaseAngle: 0.18,
  pectoralBankGain: 0.45,
  pectoralMaxAngle: 0.28,
};

export interface PredatorRigBinding {
  readonly bone: Bone;
  /** Bone local rest rotation; every frame starts from this, never accumulates. */
  readonly restQuaternion: Quaternion;
  /** Rotation axis expressed in the bone's rest-local frame. */
  readonly bendAxis: Vector3;
  /** Normalised position along the body: 0 head, 1 tail. */
  readonly s: number;
}

export interface PredatorRigBindings {
  /** Spine chain without the tail-fin bone, head to peduncle. */
  readonly spine: PredatorRigBinding[];
  readonly tailFin: PredatorRigBinding;
  readonly pectoralLeft: PredatorRigBinding;
  readonly pectoralRight: PredatorRigBinding;
}

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const FORWARD = new Vector3(0, 0, 1);

/**
 * Below this horizontal speed (m/s) the velocity has no meaningful heading:
 * atan2(vx, vz) is dominated by float noise and can flip between ±π. Yaw and
 * pitch both hold their previous target instead.
 */
export const MIN_HORIZONTAL_SPEED = 0.4;

function clamp01(value: number): number {
  return MathUtils.clamp(value, 0, 1);
}

/** Smoothstep with explicit edges. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function predatorBodyEnvelope(s: number, config: PredatorRigConfig): number {
  return Math.pow(smoothstep(config.envelopeStart, 1.0, s), config.envelopePower);
}

export function predatorSwimFrequency(
  speedNorm: number,
  attack: number,
  thrust: number,
  config: PredatorRigConfig,
): number {
  const base = MathUtils.lerp(
    config.minFrequency,
    config.maxFrequency,
    smoothstep(0.08, 1.0, speedNorm),
  );
  return MathUtils.clamp(
    base + attack * config.attackFrequencyBoost + thrust * config.thrustFrequencyBoost,
    config.minFrequency * 0.75,
    config.maxFrequency + config.attackFrequencyBoost + config.thrustFrequencyBoost,
  );
}

export function predatorBodyAmplitude(
  speedNorm: number,
  attack: number,
  thrust: number,
  config: PredatorRigConfig,
): number {
  const base = MathUtils.lerp(
    config.minBodyAmplitude,
    config.maxBodyAmplitude,
    smoothstep(0.08, 1.0, speedNorm),
  );
  return base * (1 + 0.22 * attack + 0.18 * thrust);
}

/** Target pitch from velocity; horizontal speed near zero holds the last pitch. */
export function predatorPitchTarget(
  verticalSpeed: number,
  horizontalSpeed: number,
  previousTarget: number,
  config: PredatorRigConfig,
): number {
  if (horizontalSpeed < MIN_HORIZONTAL_SPEED) return previousTarget;
  return MathUtils.clamp(
    Math.atan2(verticalSpeed, horizontalSpeed),
    -config.pitchLimit,
    config.pitchLimit,
  );
}

/** Bank into a turn: a positive (left) yaw rate rolls the dorsal side inboard. */
export function predatorBankTarget(
  yawRate: number,
  speedNorm: number,
  config: PredatorRigConfig,
): number {
  const speedFactor = 0.45 + 0.55 * Math.min(1, Math.max(0, speedNorm));
  return MathUtils.clamp(
    -yawRate * config.bankGain * speedFactor,
    -config.bankMax,
    config.bankMax,
  );
}

function createBinding(
  bone: Bone,
  worldAxis: Vector3,
  headZ: number,
  lengthZ: number,
): PredatorRigBinding {
  const worldQuaternion = bone.getWorldQuaternion(new Quaternion());
  const bendAxis = worldAxis
    .clone()
    .applyQuaternion(worldQuaternion.invert())
    .normalize();
  const worldPosition = bone.getWorldPosition(new Vector3());
  const s = MathUtils.clamp((headZ - worldPosition.z) / lengthZ, 0, 1);
  return {
    bone,
    restQuaternion: bone.quaternion.clone(),
    bendAxis,
    s,
  };
}

/**
 * Derive all controller bindings from a loaded skeleton. Must be called while
 * the model is still at the origin (before it is added to a moving group) so
 * the rest axes are in model space.
 */
export function createPredatorRigBindings(
  bones: ReadonlyMap<string, Bone>,
  headZ: number,
  lengthZ: number,
): PredatorRigBindings {
  const find = (name: string): Bone => {
    const bone = bones.get(name);
    if (!bone) throw new Error(`predator rig missing bone ${name}`);
    return bone;
  };
  const spine = [
    'Spine_00',
    'Spine_01',
    'Spine_02',
    'Spine_03',
    'Spine_04',
    'Spine_05',
    'Caudal_Peduncle',
  ].map((name) => createBinding(find(name), UP, headZ, lengthZ));
  return {
    spine,
    tailFin: createBinding(find('Tail_Fin'), UP, headZ, lengthZ),
    pectoralLeft: createBinding(find('Pectoral_L_Root'), FORWARD, headZ, lengthZ),
    pectoralRight: createBinding(find('Pectoral_R_Root'), FORWARD, headZ, lengthZ),
  };
}

export interface PredatorPoseReadout {
  readonly phase: number;
  readonly frequency: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly bank: number;
  readonly turn: number;
  readonly tailTurn: number;
  readonly thrust: number;
  readonly attack: number;
}

export class PredatorAnimationController {
  readonly config: PredatorRigConfig;
  private readonly bindings: PredatorRigBindings;
  private readonly deltaQuaternion = new Quaternion();
  private readonly yawQuaternion = new Quaternion();
  private readonly pitchQuaternion = new Quaternion();
  private readonly rollQuaternion = new Quaternion();
  private readonly root = new Quaternion();

  private phaseValue = 0;
  private frequencyValue = DEFAULT_PREDATOR_RIG_CONFIG.minFrequency;
  private yawValue = 0;
  private pitchValue = 0;
  private rollValue = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private pitchTarget = 0;
  private turnValue = 0;
  private tailTurnValue = 0;
  private thrustValue = 0;
  private attackValue = 0;
  private verticalIntent = 0;
  private speedNormValue = 0;
  private previousSpeed = 0;
  private previousSpeedValid = false;
  private hasSample = false;

  constructor(
    bindings: PredatorRigBindings,
    config: Partial<PredatorRigConfig> = {},
  ) {
    this.bindings = bindings;
    this.config = { ...DEFAULT_PREDATOR_RIG_CONFIG, ...config };
    this.applyBones();
    this.composeRoot();
  }

  get rootQuaternion(): Quaternion {
    return this.root;
  }

  get phase(): number {
    return this.phaseValue;
  }

  get frequency(): number {
    return this.frequencyValue;
  }

  get yaw(): number {
    return this.yawValue;
  }

  get pitch(): number {
    return this.pitchValue;
  }

  get bank(): number {
    return this.rollValue;
  }

  get turn(): number {
    return this.turnValue;
  }

  get tailTurn(): number {
    return this.tailTurnValue;
  }

  get thrust(): number {
    return this.thrustValue;
  }

  get attack(): number {
    return this.attackValue;
  }

  /**
   * Explicit re-spawn reset (keeps phase, re-snaps the next sample). Do not
   * use this for visibility gating: the next update hard-aligns yaw to the
   * target heading, which shows up as a heading snap when visibility flickers.
   */
  suspend(): void {
    this.hasSample = false;
    this.previousSpeedValid = false;
  }

  reset(): void {
    this.phaseValue = 0;
    this.frequencyValue = this.config.minFrequency;
    this.yawValue = 0;
    this.pitchValue = 0;
    this.rollValue = 0;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.pitchTarget = 0;
    this.turnValue = 0;
    this.tailTurnValue = 0;
    this.thrustValue = 0;
    this.attackValue = 0;
    this.verticalIntent = 0;
    this.speedNormValue = 0;
    this.previousSpeed = 0;
    this.previousSpeedValid = false;
    this.hasSample = false;
    this.applyBones();
    this.composeRoot();
  }

  readPose(): PredatorPoseReadout {
    return {
      phase: this.phaseValue,
      frequency: this.frequencyValue,
      yaw: this.yawValue,
      pitch: this.pitchValue,
      bank: this.rollValue,
      turn: this.turnValue,
      tailTurn: this.tailTurnValue,
      thrust: this.thrustValue,
      attack: this.attackValue,
    };
  }

  update(delta: number, velocity: ArrayLike<number>, state: PredatorState): void {
    const dt = MathUtils.clamp(delta, 0, 0.1);
    const vx = velocity[0] ?? 0;
    const vy = velocity[1] ?? 0;
    const vz = velocity[2] ?? 0;
    const speed = Math.hypot(vx, vy, vz);
    const horizontalSpeed = Math.hypot(vx, vz);
    const speedNorm = Math.min(1.25, speed / this.config.referenceSpeed);
    // Gate on the horizontal component, not the total speed: during a near
    // vertical search swim the total speed is high while vx/vz are noise, and
    // atan2 would flip the target heading between ±π every few frames. This
    // mirrors the pitch guard above and holds the last stable heading instead.
    const targetHeading = horizontalSpeed >= MIN_HORIZONTAL_SPEED
      ? Math.atan2(vx, vz)
      : this.yawValue;
    const nextPitchTarget = predatorPitchTarget(
      vy,
      horizontalSpeed,
      this.pitchTarget,
      this.config,
    );
    this.pitchTarget = nextPitchTarget;
    this.speedNormValue = speedNorm;
    this.targetHeading = targetHeading;

    if (!this.hasSample) {
      this.yawValue = targetHeading;
      this.pitchValue = nextPitchTarget;
      this.rollValue = 0;
      this.yawVelocity = 0;
      this.pitchVelocity = 0;
      this.previousSpeed = speed;
      this.previousSpeedValid = true;
      this.hasSample = true;
    }

    if (dt > 0) {
      // Spring integration in small substeps keeps frame spikes stable.
      const steps = Math.max(1, Math.ceil(dt / 0.02));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) this.integrateOrientation(h);
      const headingError = wrapAngle(targetHeading - this.yawValue);
      this.integrateSignals(dt, speed, headingError, vy, state);

      const targetFrequency = predatorSwimFrequency(
        speedNorm,
        this.attackValue,
        this.thrustValue,
        this.config,
      );
      this.frequencyValue += (targetFrequency - this.frequencyValue) * (1 - Math.exp(-dt * 2.5));
      // Keep the phase cumulative: wrapping or resetting it on state changes
      // makes the tail snap. Float precision is ample for a session.
      this.phaseValue += Math.PI * 2 * this.frequencyValue * dt;
    }

    this.applyBones();
    this.composeRoot();
  }

  private integrateOrientation(step: number): void {
    const yawError = wrapAngle(this.targetHeading - this.yawValue);
    const yawOmega = 9.0;
    const yawAcceleration = yawOmega * yawOmega * yawError - 2 * yawOmega * this.yawVelocity;
    this.yawVelocity = MathUtils.clamp(
      this.yawVelocity + yawAcceleration * step,
      -this.config.maxYawRate,
      this.config.maxYawRate,
    );
    this.yawValue = wrapAngle(this.yawValue + this.yawVelocity * step);

    const pitchOmega = 5.5;
    const pitchAcceleration =
      pitchOmega * pitchOmega * (this.pitchTarget - this.pitchValue)
      - 2 * pitchOmega * this.pitchVelocity;
    this.pitchVelocity = MathUtils.clamp(
      this.pitchVelocity + pitchAcceleration * step,
      -this.config.maxPitchRate,
      this.config.maxPitchRate,
    );
    this.pitchValue = MathUtils.clamp(
      this.pitchValue + this.pitchVelocity * step,
      -this.config.pitchLimit,
      this.config.pitchLimit,
    );

    const targetBank = predatorBankTarget(this.yawVelocity, this.speedNormValue, this.config);
    this.rollValue += (targetBank - this.rollValue) * (1 - Math.exp(-step * 4.5));
  }

  private targetHeading = 0;

  private integrateSignals(
    dt: number,
    speed: number,
    headingError: number,
    verticalSpeed: number,
    state: PredatorState,
  ): void {
    const rawTurn = MathUtils.clamp(
      this.yawVelocity * 0.55 + headingError * 0.9,
      -1,
      1,
    );
    this.turnValue += (rawTurn - this.turnValue) * (1 - Math.exp(-dt * 6.5));
    this.tailTurnValue += (this.turnValue - this.tailTurnValue) * (1 - Math.exp(-dt * 2.6));

    this.attackValue += ((state === 'attack' ? 1 : 0) - this.attackValue)
      * (1 - Math.exp(-dt * 6.0));

    if (this.previousSpeedValid) {
      const targetThrust = MathUtils.clamp(
        (speed - this.previousSpeed) / (dt * 9),
        -1,
        1,
      );
      this.thrustValue += (targetThrust - this.thrustValue) * (1 - Math.exp(-dt * 8.0));
    }
    this.previousSpeed = speed;
    this.previousSpeedValid = true;

    const verticalTarget = MathUtils.clamp(verticalSpeed / 1.8, -1, 1);
    this.verticalIntent += (verticalTarget - this.verticalIntent) * (1 - Math.exp(-dt * 2.5));
  }

  private applyBones(): void {
    const config = this.config;
    const amplitude = predatorBodyAmplitude(
      this.speedNormValue,
      this.attackValue,
      this.thrustValue,
      config,
    );
    for (const binding of this.bindings.spine) {
      const envelope = predatorBodyEnvelope(binding.s, config);
      const swim = envelope * amplitude * Math.sin(
        this.phaseValue - config.bodyWaveNumber * binding.s,
      );
      const delayedTurn = MathUtils.lerp(
        this.turnValue,
        this.tailTurnValue,
        smoothstep(0.2, 1.0, binding.s),
      );
      const turnWeight = Math.pow(smoothstep(0.12, 0.9, binding.s), 1.15);
      const turn = turnWeight * config.turnBendMax * delayedTurn;
      this.applyBend(binding, swim + turn);
    }

    const tailSwing = config.tailFinAmplitude
      * (0.55 + 0.45 * Math.min(1, this.speedNormValue))
      * (1 + 0.3 * this.attackValue + 0.15 * this.thrustValue)
      * Math.sin(this.phaseValue - config.bodyWaveNumber * 1.02 - config.tailFinPhaseLag);
    const tailTurnAngle = config.turnBendMax * config.turnTailBoost * this.tailTurnValue;
    this.applyBend(this.bindings.tailFin, tailSwing + tailTurnAngle);

    const pectoralBase = this.verticalIntent * config.pectoralBaseAngle
      + this.attackValue * 0.06;
    const pectoralAsymmetry = this.rollValue * config.pectoralBankGain;
    const raiseLeft = MathUtils.clamp(
      pectoralBase + pectoralAsymmetry,
      -config.pectoralMaxAngle,
      config.pectoralMaxAngle,
    );
    const raiseRight = MathUtils.clamp(
      pectoralBase - pectoralAsymmetry,
      -config.pectoralMaxAngle,
      config.pectoralMaxAngle,
    );
    this.applyBend(this.bindings.pectoralLeft, raiseLeft);
    // A positive rotation around +Z raises the +X (left) fin; mirror for right.
    this.applyBend(this.bindings.pectoralRight, -raiseRight);
  }

  private applyBend(binding: PredatorRigBinding, angle: number): void {
    this.deltaQuaternion.setFromAxisAngle(binding.bendAxis, angle);
    binding.bone.quaternion.copy(binding.restQuaternion).multiply(this.deltaQuaternion);
  }

  private composeRoot(): void {
    this.yawQuaternion.setFromAxisAngle(UP, this.yawValue);
    // Three.js is right-handed: a positive rotation about +X sends +Z toward
    // -Y. The controller stores nose-up as positive pitch, so invert here.
    this.pitchQuaternion.setFromAxisAngle(RIGHT, -this.pitchValue);
    this.rollQuaternion.setFromAxisAngle(FORWARD, this.rollValue);
    this.root
      .copy(this.yawQuaternion)
      .multiply(this.pitchQuaternion)
      .multiply(this.rollQuaternion);
  }
}
