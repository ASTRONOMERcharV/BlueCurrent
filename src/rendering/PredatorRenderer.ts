import {
  Color,
  ConeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { PredatorSystem } from '../simulation/PredatorSystem';
import type { PredatorAsset } from './PredatorAsset';
import { isPredatorRigAsset } from './PredatorRigAsset';
import type { PredatorRigAsset } from './PredatorRigAsset';
import { PredatorAnimationController } from './PredatorAnimationController';
import { applyFresnelRim } from './UnderwaterLighting';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

const FORWARD = new Vector3(0, 0, 1);
const SWIM_TAIL_START = -1.95;
const SWIM_TAIL_END = 1.30;
const REFERENCE_MAX_ACCELERATION = 9;
const SPINE_PIVOT_Z = 2.45;
const SPINE_LENGTH = 5.20;
const MAX_SPINE_TURN_ANGLE = 0.38;
const HEADING_RESPONSE = 9.0;
const TURN_RESPONSE = 7.5;
const TAIL_TURN_RESPONSE = 3.0;
const HEADING_ERROR_TURN_GAIN = 2.4;
const HEADING_ERROR_BANK_GAIN = 1.8;

export interface PredatorSwimUniforms {
  readonly phase: { value: number };
  readonly speed: { value: number };
  readonly attack: { value: number };
  readonly thrust: { value: number };
  readonly turn: { value: number };
  readonly turnLag: { value: number };
  readonly jaw: { value: number };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Roll into a turn: a positive (left) yaw rate banks the dorsal side left. */
export function predatorBankForYawRate(yawRate: number): number {
  return MathUtils.clamp(-yawRate * 0.22, -0.6, 0.6);
}

/** Normalized body C-bend input for the swim shader. */
export function predatorTurnForYawRate(yawRate: number): number {
  return MathUtils.clamp(yawRate / 1.8, -1, 1);
}

/**
 * Local yaw applied along the flexible spine. The head is the rotation pivot;
 * the tail uses a slower turn signal, so it follows instead of moving as part
 * of a rigid body. Keep this in sync with the GLSL below.
 */
export function predatorSpineBendAngle(bodyT: number, turn: number, tailTurn: number): number {
  const t = MathUtils.clamp(bodyT, 0, 1);
  const lagBlend = MathUtils.smoothstep(t, 0.18, 1.0);
  const delayedTurn = MathUtils.lerp(turn, tailTurn, lagBlend);
  return -delayedTurn * MAX_SPINE_TURN_ANGLE * Math.pow(t, 1.35);
}

/**
 * Inject the body-undulation vertex shader into a GLB material.
 * The same helper is used by the asset preview turntable. Every predator
 * material shares the uniforms so eyes, teeth and the mouth follow the body
 * bend without detaching.
 */
export function applyPredatorSwimShader(
  material: MeshStandardMaterial,
  hasTailWeights: boolean,
  uniforms: PredatorSwimUniforms,
  hasJawWeights = false,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwimPhase = uniforms.phase;
    shader.uniforms.uSwimSpeed = uniforms.speed;
    shader.uniforms.uAttack = uniforms.attack;
    shader.uniforms.uThrust = uniforms.thrust;
    shader.uniforms.uTurn = uniforms.turn;
    shader.uniforms.uTurnLag = uniforms.turnLag;
    shader.uniforms.uJawAngle = uniforms.jaw;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uSwimPhase;
        uniform float uSwimSpeed;
        uniform float uAttack;
        uniform float uThrust;
        uniform float uTurn;
        uniform float uTurnLag;
        uniform float uJawAngle;
        ${hasTailWeights ? 'attribute float aTailWeight;' : ''}
        ${hasJawWeights ? 'attribute float aJawWeight;' : ''}
      `)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        // A smooth heading change is a rotation field, not a lateral shear.
        // The head stays on the pivot while the tail receives the delayed
        // signal, so every cross-section (including fins) follows the bend.
        float predatorBodyT = clamp((${SPINE_PIVOT_Z.toFixed(2)} - position.z) / ${SPINE_LENGTH.toFixed(2)}, 0.0, 1.0);
        float predatorLagBlend = smoothstep(0.18, 1.0, predatorBodyT);
        float predatorDelayedTurn = mix(uTurn, uTurnLag, predatorLagBlend);
        float predatorTurnAngle = -predatorDelayedTurn * ${MAX_SPINE_TURN_ANGLE.toFixed(2)} * pow(predatorBodyT, 1.35);
        float predatorTurnCos = cos(predatorTurnAngle);
        float predatorTurnSin = sin(predatorTurnAngle);
        objectNormal.xz = vec2(
          predatorTurnCos * objectNormal.x + predatorTurnSin * objectNormal.z,
          -predatorTurnSin * objectNormal.x + predatorTurnCos * objectNormal.z
        );
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float tailWeight = ${hasTailWeights
          ? 'aTailWeight'
          : `1.0 - smoothstep(${SWIM_TAIL_START.toFixed(2)}, ${SWIM_TAIL_END.toFixed(2)}, position.z)`};
        float swimWave = sin(uSwimPhase + position.z * 1.05);
        float secondaryWave = sin(uSwimPhase * 0.52 + position.z * 0.58 + 1.7);
        // Hunting acceleration widens the beat; braking narrows it.
        float swimAmplitude = (0.15 + 0.035 * uSwimSpeed) * (0.35 + 0.65 * tailWeight);
        swimAmplitude *= (1.0 + 0.20 * uAttack) * (1.0 + 0.35 * uThrust);
        float swimOffset = (swimWave + secondaryWave * 0.28) * tailWeight * swimAmplitude;

        // Rotate the swimming cross-section around the head pivot. Using the
        // same angle for normals above keeps lighting attached to the skin.
        float predatorSpineZ = position.z - ${SPINE_PIVOT_Z.toFixed(2)};
        float predatorSwimX = position.x + swimOffset;
        transformed.x = predatorTurnCos * predatorSwimX + predatorTurnSin * predatorSpineZ;
        transformed.z = ${SPINE_PIVOT_Z.toFixed(2)} - predatorTurnSin * predatorSwimX + predatorTurnCos * predatorSpineZ;
        transformed.y = position.y;

        // The lower jaw rotates about a hinge under the eye. _JAW is 1 on
        // the jaw/teeth, 0 on the skull and blended through the mouth wall.
        float jawWeight = ${hasJawWeights ? 'aJawWeight' : '0.0'};
        if (jawWeight > 0.001) {
          float jawDz = transformed.z - 1.70;
          float jawDy = transformed.y + 0.30;
          float jawC = cos(uJawAngle);
          float jawS = sin(uJawAngle);
          float jawY = -0.30 + jawDy * jawC - jawDz * jawS;
          float jawZ = 1.70 + jawDy * jawS + jawDz * jawC;
          transformed.y = mix(transformed.y, jawY, jawWeight);
          transformed.z = mix(transformed.z, jawZ, jawWeight);
        }
      `);
  };
  material.customProgramCacheKey = () =>
    `blue-current-predator-${hasTailWeights ? 'weighted' : 'fallback'}-${hasJawWeights ? 'jaw' : 'nojaw'}-v4`;
}

export interface ProceduralPredator {
  readonly group: Group;
  readonly tailPivot: Group;
  readonly material: MeshStandardMaterial;
  readonly triangles: number;
}

/** The original faceted predator, shared by the renderer and the preview. */
export function createProceduralPredator(): ProceduralPredator {
  const group = new Group();
  const material = new MeshStandardMaterial({
    color: 0x60747a,
    roughness: 0.55,
    metalness: 0.06,
    flatShading: true,
  });

  const bodyGeometry = new SphereGeometry(0.5, 10, 6);
  bodyGeometry.scale(1.25, 0.72, 3.2);
  group.add(new Mesh(bodyGeometry, material));

  const snoutGeometry = new ConeGeometry(0.52, 1.25, 8);
  snoutGeometry.rotateX(Math.PI / 2);
  snoutGeometry.translate(0, 0, 1.72);
  group.add(new Mesh(snoutGeometry, material));

  const dorsalGeometry = new ConeGeometry(0.52, 1.15, 3);
  dorsalGeometry.translate(0, 0.58, -0.2);
  group.add(new Mesh(dorsalGeometry, material));

  for (const side of [-1, 1]) {
    const finGeometry = new ConeGeometry(0.58, 1.35, 3);
    finGeometry.scale(1, 0.45, 1);
    finGeometry.rotateZ(side * Math.PI / 2);
    finGeometry.translate(side * 1.15, -0.16, 0.5);
    group.add(new Mesh(finGeometry, material));
  }

  const tailPivot = new Group();
  tailPivot.position.z = -1.55;
  const tailGeometry = new ConeGeometry(0.9, 1.35, 3);
  tailGeometry.rotateX(Math.PI / 2);
  tailGeometry.translate(0, 0, -0.58);
  tailPivot.add(new Mesh(tailGeometry, material));
  group.add(tailPivot);

  let triangles = 0;
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute('position');
    triangles += (index ? index.count : position.count) / 3;
  });

  return { group, tailPivot, material, triangles };
}

type PredatorModelKind = 'procedural' | 'blender';

export class PredatorRenderer {
  readonly group = new Group();
  readonly modelKind: PredatorModelKind;
  readonly triangleCount: number;
  readonly rigged: boolean;
  private readonly controller: PredatorAnimationController | null;
  private readonly tailPivot: Group;
  private readonly direction = new Vector3();
  private readonly renderDirection = new Vector3(0, 0, 1);
  private readonly targetQuaternion = new Quaternion();
  private readonly renderQuaternion = new Quaternion();
  private readonly bankQuaternion = new Quaternion();
  private readonly material: MeshStandardMaterial | null;
  private readonly bodyMaterial: MeshStandardMaterial | null;
  private readonly attackRim = { value: 0 };
  private readonly normalColor = new Color(0x60747a);
  private readonly attackColor = new Color(0x7f6b60);
  private readonly swimUniforms: PredatorSwimUniforms = {
    phase: { value: 0 },
    speed: { value: 0 },
    attack: { value: 0 },
    thrust: { value: 0 },
    turn: { value: 0 },
    turnLag: { value: 0 },
    jaw: { value: 0 },
  };
  private swimPhase = 0;
  private tailPhase = 0;
  private attackGlow = 0;
  private bank = 0;
  private thrust = 0;
  private turn = 0;
  private tailTurn = 0;
  private jawAngle = 0;
  private heading: number | null = null;
  private hasRenderDirection = false;
  private previousSpeed = 0;
  private hasSpeedSample = false;

  constructor(
    scene: Scene,
    private readonly predator: PredatorSystem,
    asset?: PredatorAsset | PredatorRigAsset,
  ) {
    const rigAsset = asset && isPredatorRigAsset(asset) ? asset : undefined;
    this.modelKind = asset ? 'blender' : 'procedural';
    this.rigged = Boolean(rigAsset);

    if (asset && isPredatorRigAsset(asset)) {
      this.tailPivot = new Group();
      this.material = null;
      this.controller = new PredatorAnimationController(asset.rig);
      const bodyMaterial = asset.materials.find(
        (material) => material.name === 'predator_body',
      ) ?? asset.materials[0];
      this.bodyMaterial = bodyMaterial;
      // Attack feedback is an edge tint, not full-body emissive. This preserves
      // the shayu texture's grey dorsal / pale ventral countershading.
      for (const material of asset.materials) {
        material.flatShading = false;
        material.color.multiply(new Color(0x9fc9d9));
        material.needsUpdate = true;
        applyFresnelRim(material, {
          ...UNDERWATER_LIGHTING_CONFIG.predatorRim,
          alert: this.attackRim,
        });
      }
      this.group.add(asset.scene);
      this.triangleCount = asset.stats.triangles;
    } else if (asset) {
      this.tailPivot = new Group();
      this.material = null;
      this.controller = null;
      this.bodyMaterial = asset.materials[0];
      const hasTailWeights = Boolean(asset.geometry.getAttribute('aTailWeight'));
      const hasJawWeights = Boolean(asset.geometry.getAttribute('aJawWeight'));
      for (const material of asset.materials) {
        applyPredatorSwimShader(material, hasTailWeights, this.swimUniforms, hasJawWeights);
        material.color.multiply(new Color(0x9fc9d9));
        applyFresnelRim(material, {
          ...UNDERWATER_LIGHTING_CONFIG.predatorRim,
          alert: this.attackRim,
        });
        material.flatShading = false;
        material.needsUpdate = true;
      }
      this.group.add(new Mesh(asset.geometry, asset.materials));
      this.triangleCount = asset.stats.triangles;
    } else {
      const procedural = createProceduralPredator();
      applyFresnelRim(procedural.material, {
        ...UNDERWATER_LIGHTING_CONFIG.predatorRim,
        strength: UNDERWATER_LIGHTING_CONFIG.predatorRim.proceduralStrength,
        power: 2.3,
        alert: this.attackRim,
      });
      this.tailPivot = procedural.tailPivot;
      this.material = procedural.material;
      this.controller = null;
      this.bodyMaterial = null;
      this.group.add(procedural.group);
      this.triangleCount = procedural.triangles;
    }

    this.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = false;
      object.receiveShadow = false;
    });
    scene.add(this.group);
  }

  /** Current roll into a turn, radians. */
  get bankAngle(): number {
    return this.controller ? this.controller.bank : this.bank;
  }

  /** Smoothed acceleration signal in [-1, 1] feeding the swim shader. */
  get thrustFactor(): number {
    return this.controller ? this.controller.thrust : this.thrust;
  }

  /** Smoothed yaw-rate signal in [-1, 1] feeding the body C-bend. */
  get turnFactor(): number {
    return this.controller ? this.controller.turn : this.turn;
  }

  /** Slower follow-through signal used by the peduncle and caudal fin. */
  get tailTurnFactor(): number {
    return this.controller ? this.controller.tailTurn : this.tailTurn;
  }

  /** Current jaw opening in radians (0 = closed). */
  get jawOpen(): number {
    return this.controller ? 0 : this.jawAngle;
  }

  /** Smoothed pitch of the whole model, radians (rigged path only). */
  get pitchAngle(): number {
    return this.controller ? this.controller.pitch : 0;
  }

  /** Current tail-beat frequency in Hz (rigged path only). */
  get swimFrequency(): number {
    return this.controller ? this.controller.frequency : 0;
  }

  /** Continuous swim phase in radians (rigged path only). */
  get swimPhaseValue(): number {
    return this.controller ? this.controller.phase : this.swimPhase;
  }

  update(alpha: number, delta: number, visible: boolean): void {
    this.group.visible = visible;
    const dt = Math.min(0.1, Math.max(0, delta));
    const { position, previousPosition, velocity, state } = this.predator;
    if (!visible) {
      this.heading = null;
      this.hasSpeedSample = false;
      this.hasRenderDirection = false;
      // Keep the rigged controller running while hidden. suspend() cleared its
      // sample and hard-snapped yaw on resume, so visibility flicker produced
      // an extra heading jump on top of the trajectory itself.
      this.controller?.update(dt, velocity, state);
      return;
    }
    this.group.position.set(
      MathUtils.lerp(previousPosition[0], position[0], alpha),
      MathUtils.lerp(previousPosition[1], position[1], alpha),
      MathUtils.lerp(previousPosition[2], position[2], alpha),
    );
    this.direction.set(velocity[0], velocity[1], velocity[2]);
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    const speedNorm = Math.min(1, speed / 7.4);
    const attacking = state === 'attack';

    if (this.controller) {
      // Rigged path: the controller reads the real simulation state and poses
      // the skeleton; it never writes back to the simulation.
      this.controller.update(dt, velocity, state);
      this.group.quaternion.copy(this.controller.rootQuaternion);
      if (this.bodyMaterial) {
        this.attackGlow = MathUtils.lerp(
          this.attackGlow,
          attacking ? 1 : 0,
          1 - Math.exp(-dt * 7),
        );
        this.attackRim.value = this.attackGlow;
      }
      return;
    }

    if (this.direction.lengthSq() > 0.0001) {
      this.direction.normalize();
      this.targetQuaternion.setFromUnitVectors(FORWARD, this.direction);
      if (!this.hasRenderDirection) {
        this.renderQuaternion.copy(this.targetQuaternion);
        this.hasRenderDirection = true;
      } else if (dt > 0) {
        // The head follows the simulation quickly but not instantaneously.
        // The remaining heading error feeds the spine bend below.
        const response = HEADING_RESPONSE + (state === 'attack' ? 3.0 : 0.0);
        this.renderQuaternion.slerp(this.targetQuaternion, 1 - Math.exp(-dt * response));
      }
      this.renderDirection.copy(FORWARD).applyQuaternion(this.renderQuaternion);

      const targetHeading = Math.atan2(this.direction.x, this.direction.z);
      const renderHeading = Math.atan2(this.renderDirection.x, this.renderDirection.z);
      const headingError = wrapAngle(targetHeading - renderHeading);
      let yawRate = 0;
      if (dt > 0 && this.heading !== null) {
        yawRate = MathUtils.clamp(wrapAngle(targetHeading - this.heading) / dt, -3.5, 3.5);
      }
      if (dt > 0) {
        // Bank and bend use the same signal, but with independent time
        // constants. The slower tail value produces visible follow-through.
        const targetBank = predatorBankForYawRate(
          yawRate + headingError * HEADING_ERROR_BANK_GAIN,
        );
        this.bank += (targetBank - this.bank) * (1 - Math.exp(-dt * 4.5));
        const targetTurn = predatorTurnForYawRate(
          yawRate + headingError * HEADING_ERROR_TURN_GAIN,
        );
        this.turn += (targetTurn - this.turn) * (1 - Math.exp(-dt * TURN_RESPONSE));
        this.tailTurn += (this.turn - this.tailTurn) * (1 - Math.exp(-dt * TAIL_TURN_RESPONSE));
        this.heading = targetHeading;
      }
    } else {
      // No usable velocity: keep the last orientation and level out gradually.
      this.heading = null;
      this.bank += (0 - this.bank) * (1 - Math.exp(-dt * 3));
      this.turn += (0 - this.turn) * (1 - Math.exp(-dt * 3));
      this.tailTurn += (this.turn - this.tailTurn) * (1 - Math.exp(-dt * 2.4));
    }
    this.bankQuaternion.setFromAxisAngle(FORWARD, this.bank);
    this.group.quaternion.copy(this.renderQuaternion).multiply(this.bankQuaternion);

    if (dt > 0) {
      if (this.hasSpeedSample) {
        const targetThrust = MathUtils.clamp(
          (speed - this.previousSpeed) / (dt * REFERENCE_MAX_ACCELERATION), -1, 1,
        );
        this.thrust += (targetThrust - this.thrust) * (1 - Math.exp(-dt * 8));
      }
      this.previousSpeed = speed;
      this.hasSpeedSample = true;
    }

    if (dt > 0) {
      const jawTarget = attacking ? 0.42 : state === 'pursuit' ? 0.06 : 0.012;
      this.jawAngle += (jawTarget - this.jawAngle) * (1 - Math.exp(-dt * (attacking ? 20 : 7)));
    }

    if (this.bodyMaterial) {
      this.swimPhase += dt * (3.0 + speedNorm * 2.6 + (attacking ? 1.8 : 0) + this.thrust * 1.1);
      this.swimUniforms.phase.value = this.swimPhase;
      this.swimUniforms.speed.value = speedNorm;
      this.swimUniforms.thrust.value = this.thrust;
      this.swimUniforms.turn.value = this.turn;
      this.swimUniforms.turnLag.value = this.tailTurn;
      this.swimUniforms.jaw.value = this.jawAngle;
      this.attackGlow = MathUtils.lerp(this.attackGlow, attacking ? 1 : 0, 1 - Math.exp(-dt * 7));
      this.swimUniforms.attack.value = this.attackGlow;
      this.attackRim.value = this.attackGlow;
    } else if (this.material) {
      this.tailPhase += dt * (6.5 + speedNorm * 3.0 + (attacking ? 2.5 : 0) + this.thrust * 2.0);
      const tailAmplitude = (0.30 + 0.08 * speedNorm) * (1 + 0.30 * this.thrust);
      this.tailPivot.rotation.y = Math.sin(this.tailPhase) * Math.max(0.12, tailAmplitude);
      this.material.color.copy(this.normalColor).lerp(this.attackColor, attacking ? 0.32 : 0);
      this.attackGlow = MathUtils.lerp(this.attackGlow, attacking ? 1 : 0, 1 - Math.exp(-dt * 7));
      this.attackRim.value = this.attackGlow;
    }
  }
}
