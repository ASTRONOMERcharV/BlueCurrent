import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { SimulationWorld } from '../simulation/SimulationWorld';
import { constrainCameraPosition, constrainCameraTarget } from './terrain';
import {
  CAMERA_DIRECTION_EPSILON,
  SCHOOL_BACK_DISTANCE,
  SCHOOL_FIT_INTERVAL,
  SCHOOL_FIT_MAX_SCALE,
  SCHOOL_FIT_MIN_SCALE,
  SCHOOL_FIT_PADDING,
  SCHOOL_FIT_PERCENTILE,
  SCHOOL_FIT_RESPONSE,
  SCHOOL_LEAD_DISTANCE,
  SCHOOL_SIDE_DISTANCE,
  SCHOOL_UP_DISTANCE,
  SchoolHeadingTracker,
  StableCameraFrame,
  cameraDamping,
  computePredatorCameraPose,
  computeSchoolCameraPose,
  dampCameraUp,
  isValidPredatorTarget,
  measureSchoolFit,
  resolvePredatorForward,
  safeNormalizeVector,
} from './cameraStability';
import type {
  PredatorForwardSource,
  SchoolFitResult,
  SchoolHeadingSource,
} from './cameraStability';

export { cameraDamping } from './cameraStability';

/** Legacy orbit/school/predator names remain valid for existing automation. */
export type CameraMode = 'overview' | 'free' | 'orbit' | 'school' | 'predator';

// A right-shifted, lower-target overview pulls the hero left from the old
// projection while keeping it just right of frame centre; it also compresses
// empty upper water and lifts reef bases clear of the HUD.
export const OVERVIEW_CAMERA_POSITION = [30, 18, 29] as const;
export const OVERVIEW_CAMERA_TARGET = [0, 6.5, -2] as const;
const OVERVIEW_POSITION = new Vector3(...OVERVIEW_CAMERA_POSITION);
const OVERVIEW_TARGET = new Vector3(...OVERVIEW_CAMERA_TARGET);
const UP = new Vector3(0, 1, 0);

/** Render-only framing derived from the real predator/target separation. */
export function predatorFraming(targetDistance: number | null): {
  readonly lead: number;
  readonly back: number;
  readonly side: number;
  readonly up: number;
} {
  if (targetDistance === null) return { lead: 1.8, back: 14, side: 4.8, up: 4.4 };
  const separation = Math.max(0, targetDistance);
  return {
    lead: Math.min(5, Math.max(2.2, separation * 0.45)),
    back: 13.5 + Math.min(6, separation * 0.3),
    side: 5.4,
    up: 4.8,
  };
}

const OVERVIEW_RESPONSE = 3.2;
const SCHOOL_RESPONSE = 2.4;
const PREDATOR_RESPONSE = 3.0;
const TRANSITION_RESPONSE = 4.5;
const MAX_DELTA = 0.15;

/**
 * Camera observation rig. Every pose is derived from simulation state; the
 * controller never writes to fish or predator data. Preset modes share one
 * pipeline: desired pose -> stable frame -> damped pose/target -> safe up ->
 * world guard -> render camera.
 */
export class CameraController {
  readonly controls: OrbitControls;
  /** Follow-focus offset in world space (used to keep subjects clear of UI). */
  readonly targetOffset = new Vector3();
  mode: CameraMode = 'overview';
  /** Real observed target for screen-space markers and diagnostics. */
  readonly overlayTarget = new Vector3();
  /** Actual damped look target (excludes overlay-only subjects). */
  readonly lookTarget = new Vector3();
  readonly cameraUp = new Vector3(0, 1, 0);
  readonly schoolFrame = new StableCameraFrame();
  readonly predatorFrame = new StableCameraFrame();
  readonly schoolHeading = new SchoolHeadingTracker();
  schoolFitScale = 1;
  schoolFitRaw = 1;
  schoolVisibleFraction = 1;
  schoolPercentileValue = 1;
  schoolFitSampleCount = 0;
  headingCoherence = 0;
  headingReliability = 0;
  headingSource: SchoolHeadingSource = 'held';
  predatorForwardSource: PredatorForwardSource = 'initial';
  predatorTargetDistance: number | null = null;
  /** Orientation change and camera speed of the most recent update. */
  cameraAngularChange = 0;
  cameraTranslationSpeed = 0;

  private activeMode: CameraMode = 'overview';
  private readonly desiredTarget = new Vector3();
  private readonly desiredPosition = new Vector3();
  private readonly dampedTarget = new Vector3().copy(OVERVIEW_TARGET);
  private readonly previousPosition = new Vector3();
  private readonly previousTarget = new Vector3();
  private readonly lookDirection = new Vector3();
  private readonly cameraRight = new Vector3();
  private readonly cameraForward = new Vector3();
  private readonly cameraUpGoal = new Vector3(0, 1, 0);
  private readonly frameUpGoal = new Vector3(0, 1, 0);
  private readonly schoolCenter = new Vector3();
  private readonly schoolSum = new Vector3();
  private readonly schoolFitScales = new Float32Array(4096);
  private readonly predatorInterpolated = new Vector3();
  private readonly preyInterpolated = new Vector3();
  private readonly targetDisplacement = new Vector3();
  private readonly predatorProbe = new Vector3();
  private readonly predatorHeading = new Vector3(0, 0, 1);
  private readonly previousQuaternion = new Quaternion();
  private readonly previousCameraPosition = new Vector3();
  private transitionActive = false;
  private transitionElapsed = 0;
  private lastDelta = 0;
  private schoolFitAccumulator = 0;
  private schoolFitPending = true;
  private hasPose = false;

  constructor(readonly camera: PerspectiveCamera, element: HTMLElement) {
    this.controls = new OrbitControls(camera, element);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI * 0.91;
    this.controls.target.copy(OVERVIEW_TARGET);
    this.controls.enabled = false;
    this.controls.update();
    this.cameraUp.copy(camera.up);
    if (!safeNormalizeVector(this.cameraUp, camera.up)) this.cameraUp.copy(UP);
    this.overlayTarget.copy(this.controls.target);
    this.lookTarget.copy(this.controls.target);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    // Free/orbit preserves the current pose; preset modes damp toward their rig.
    this.controls.enabled = mode === 'free' || mode === 'orbit';
  }

  /** Fixed render-only camera pose for reproducible visual comparisons. */
  setPose(position: readonly [number, number, number], target: readonly [number, number, number]): void {
    this.mode = 'free';
    this.activeMode = 'free';
    this.transitionActive = false;
    this.controls.enabled = false;
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.applyWorldGuard();
    this.dampedTarget.copy(this.controls.target);
    this.overlayTarget.copy(this.controls.target);
    this.lookTarget.copy(this.dampedTarget);
    this.cameraUp.copy(this.camera.up);
    if (!safeNormalizeVector(this.cameraUp, this.camera.up)) this.cameraUp.copy(UP);
    this.previousQuaternion.copy(this.camera.quaternion);
    this.previousCameraPosition.copy(this.camera.position);
    this.cameraAngularChange = 0;
    this.cameraTranslationSpeed = 0;
    this.hasPose = true;
  }

  update(world: SimulationWorld, delta: number, alpha = 1): void {
    const safeDelta = Number.isFinite(delta) ? Math.min(Math.max(0, delta), MAX_DELTA) : 0;
    const safeAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    this.lastDelta = safeDelta;
    if (!this.hasPose) {
      this.previousPosition.copy(this.camera.position);
      this.previousTarget.copy(this.controls.target);
      this.previousQuaternion.copy(this.camera.quaternion);
      this.previousCameraPosition.copy(this.camera.position);
      this.hasPose = true;
    }
    if (this.mode !== this.activeMode) this.transitionTo(this.mode);

    if (this.activeMode === 'overview') {
      this.updateOverview();
    } else if (this.activeMode === 'school') {
      this.updateSchool(world);
    } else if (this.activeMode === 'predator') {
      this.updatePredator(world, safeAlpha);
    } else {
      this.updateInteractive();
    }

    this.cameraAngularChange = this.previousQuaternion.angleTo(this.camera.quaternion);
    const travelled = this.previousCameraPosition.distanceTo(this.camera.position);
    this.cameraTranslationSpeed = safeDelta > 1e-6 ? travelled / safeDelta : 0;
    this.previousQuaternion.copy(this.camera.quaternion);
    this.previousCameraPosition.copy(this.camera.position);
  }

  private updateOverview(): void {
    const fit = this.viewportFit();
    this.desiredPosition.copy(OVERVIEW_POSITION).sub(OVERVIEW_TARGET).multiplyScalar(fit).add(OVERVIEW_TARGET);
    this.desiredTarget.copy(OVERVIEW_TARGET).add(this.targetOffset);
    this.frameUpGoal.copy(UP);
    this.overlayTarget.copy(this.desiredTarget);
    this.blendTransition();
    this.dampPose(OVERVIEW_RESPONSE);
    this.finishPreset(OVERVIEW_RESPONSE);
  }

  private updateSchool(world: SimulationWorld): void {
    const flock = world.flock;
    this.schoolCenter.set(world.center[0], world.center[1], world.center[2]);
    this.schoolSum.set(0, 0, 0);
    let totalSpeed = 0;
    for (let index = 0; index < flock.count; index += 1) {
      if (flock.alive[index] === 0) continue;
      const offset = index * 3;
      const vx = flock.velocities[offset];
      const vy = flock.velocities[offset + 1];
      const vz = flock.velocities[offset + 2];
      this.schoolSum.x += vx;
      this.schoolSum.y += vy;
      this.schoolSum.z += vz;
      totalSpeed += Math.hypot(vx, vy, vz);
    }
    const heading = this.schoolHeading.update(this.schoolSum, totalSpeed, this.lastDelta);
    this.headingCoherence = heading.coherence;
    this.headingReliability = heading.reliability;
    this.headingSource = heading.source;
    if (!this.schoolHeading.valid) {
      this.cameraForward.subVectors(this.controls.target, this.camera.position);
      if (safeNormalizeVector(this.schoolHeading.heading, this.cameraForward)) {
        this.schoolHeading.valid = true;
      }
    }

    const frame = this.schoolFrame.update(this.schoolHeading.heading);
    if (!frame.valid) {
      this.readCameraBasis();
      this.schoolFrame.seed(this.cameraForward, this.cameraRight, this.cameraUp);
    }

    this.desiredTarget.copy(this.schoolCenter)
      .addScaledVector(this.schoolFrame.forward, SCHOOL_LEAD_DISTANCE)
      .add(this.targetOffset);
    this.schoolFitAccumulator += this.lastDelta;
    if (this.schoolFitPending || this.schoolFitAccumulator >= SCHOOL_FIT_INTERVAL) {
      const fit = measureSchoolFit(
        this.schoolFitScales,
        flock.positions,
        flock.alive,
        flock.count,
        this.desiredTarget,
        this.schoolFrame.forward,
        this.schoolFrame.right,
        this.schoolFrame.up,
        UP,
        {
          fovDegrees: this.camera.fov,
          aspect: this.camera.aspect,
          baselineBack: SCHOOL_BACK_DISTANCE,
          baselineSide: SCHOOL_SIDE_DISTANCE,
          baselineUp: SCHOOL_UP_DISTANCE,
          percentile: SCHOOL_FIT_PERCENTILE,
          screenPadding: SCHOOL_FIT_PADDING,
          minScale: SCHOOL_FIT_MIN_SCALE,
          maxScale: SCHOOL_FIT_MAX_SCALE,
        },
      );
      this.schoolFitRaw = fit.rawScale;
      this.schoolPercentileValue = fit.percentileValue;
      this.schoolVisibleFraction = fit.visibleFraction;
      this.schoolFitSampleCount = fit.sampleCount;
      this.schoolFitPending = false;
      this.schoolFitAccumulator = 0;
    }
    const targetScale = Math.min(
      SCHOOL_FIT_MAX_SCALE,
      Math.max(SCHOOL_FIT_MIN_SCALE, this.schoolFitRaw),
    );
    this.schoolFitScale += (targetScale - this.schoolFitScale)
      * cameraDamping(this.lastDelta, SCHOOL_FIT_RESPONSE);

    computeSchoolCameraPose(
      this.desiredPosition,
      this.desiredTarget,
      this.schoolCenter,
      this.targetOffset,
      this.schoolFrame.forward,
      this.schoolFrame.right,
      UP,
      this.schoolFitScale,
    );
    this.frameUpGoal.copy(this.schoolFrame.up);
    this.overlayTarget.copy(this.schoolCenter);
    this.blendTransition();
    this.dampPose(SCHOOL_RESPONSE);
    this.finishPreset(SCHOOL_RESPONSE);
  }

  private updatePredator(world: SimulationWorld, alpha: number): void {
    const predator = world.predator;
    const flock = world.flock;
    const previousX = predator.previousPosition[0];
    const previousY = predator.previousPosition[1];
    const previousZ = predator.previousPosition[2];
    this.predatorInterpolated.set(
      previousX + (predator.position[0] - previousX) * alpha,
      previousY + (predator.position[1] - previousY) * alpha,
      previousZ + (predator.position[2] - previousZ) * alpha,
    );

    const targetIndex = predator.targetIndex;
    const hasTarget = isValidPredatorTarget(
      predator.state,
      targetIndex,
      flock.count,
      flock.alive[targetIndex] ?? 0,
    );
    let displacement: Vector3 | null = null;
    if (hasTarget) {
      const offset = targetIndex * 3;
      this.preyInterpolated.set(
        flock.previousPositions[offset]
          + (flock.positions[offset] - flock.previousPositions[offset]) * alpha,
        flock.previousPositions[offset + 1]
          + (flock.positions[offset + 1] - flock.previousPositions[offset + 1]) * alpha,
        flock.previousPositions[offset + 2]
          + (flock.positions[offset + 2] - flock.previousPositions[offset + 2]) * alpha,
      );
      this.targetDisplacement.subVectors(this.preyInterpolated, this.predatorInterpolated);
      displacement = this.targetDisplacement;
      this.overlayTarget.copy(this.preyInterpolated);
    } else {
      this.overlayTarget.copy(this.predatorInterpolated);
    }

    const direction = resolvePredatorForward(
      this.predatorProbe,
      displacement,
      predator.velocity,
      this.predatorHeading,
    );
    this.predatorForwardSource = direction.source;
    this.predatorTargetDistance = direction.targetDistance;
    this.predatorHeading.copy(this.predatorProbe);
    const frame = this.predatorFrame.update(this.predatorHeading);
    if (!frame.valid) {
      this.readCameraBasis();
      this.predatorFrame.seed(this.cameraForward, this.cameraRight, this.cameraUp);
    }

    const framing = predatorFraming(direction.targetDistance);
    const fit = this.viewportFit();
    computePredatorCameraPose(
      this.desiredPosition,
      this.desiredTarget,
      this.predatorInterpolated,
      this.predatorFrame.forward,
      this.predatorFrame.right,
      UP,
      framing.lead,
      framing.back,
      framing.side,
      framing.up,
      fit,
      this.targetOffset,
    );
    this.frameUpGoal.copy(this.predatorFrame.up);
    this.blendTransition();
    this.dampPose(PREDATOR_RESPONSE);
    this.finishPreset(PREDATOR_RESPONSE);
  }

  private updateInteractive(): void {
    this.cameraUp.copy(UP);
    this.camera.up.copy(UP);
    this.controls.update();
    this.applyWorldGuard();
    this.dampedTarget.copy(this.controls.target);
    this.overlayTarget.copy(this.controls.target);
    this.lookTarget.copy(this.dampedTarget);
  }

  private transitionTo(next: CameraMode): void {
    this.activeMode = next;
    this.previousPosition.copy(this.camera.position);
    this.previousTarget.copy(this.controls.target);
    this.transitionElapsed = 0;
    this.transitionActive = next !== 'free' && next !== 'orbit';
    if (next === 'free' || next === 'orbit') {
      this.cameraUp.copy(UP);
      this.camera.up.copy(UP);
      this.dampedTarget.copy(this.controls.target);
      this.overlayTarget.copy(this.controls.target);
      return;
    }

    this.readCameraBasis();
    if (next === 'school') {
      this.schoolFrame.seed(this.cameraForward, this.cameraRight, this.cameraUp);
      if (!this.schoolHeading.valid) {
        this.schoolHeading.heading.copy(this.cameraForward);
        this.schoolHeading.valid = true;
      }
      const baseDistance = Math.hypot(SCHOOL_BACK_DISTANCE, SCHOOL_SIDE_DISTANCE, SCHOOL_UP_DISTANCE);
      this.schoolFitScale = Math.min(
        SCHOOL_FIT_MAX_SCALE,
        Math.max(
          SCHOOL_FIT_MIN_SCALE,
          this.camera.position.distanceTo(this.controls.target) / baseDistance,
        ),
      );
      this.schoolFitPending = true;
      this.schoolFitAccumulator = 0;
    } else if (next === 'predator') {
      this.predatorFrame.seed(this.cameraForward, this.cameraRight, this.cameraUp);
      this.predatorHeading.copy(this.cameraForward);
    } else {
      this.frameUpGoal.copy(UP);
    }
  }

  /** Blends a mode switch from the live pose instead of stale rig coordinates. */
  private blendTransition(): void {
    if (!this.transitionActive) return;
    this.transitionElapsed += this.lastDelta;
    const progress = Math.min(1, 1 - Math.exp(-this.transitionElapsed * TRANSITION_RESPONSE));
    this.desiredPosition.lerpVectors(this.previousPosition, this.desiredPosition, progress);
    this.desiredTarget.lerpVectors(this.previousTarget, this.desiredTarget, progress);
    if (progress >= 0.995) this.transitionActive = false;
  }

  private dampPose(response: number): void {
    const blend = cameraDamping(this.lastDelta, response);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.dampedTarget.lerp(this.desiredTarget, blend);
  }

  /**
   * Applies orientation after damping. The up vector keeps the established
   * world-up roll whenever the view permits it, and falls back to the stable
   * frame up only near the vertical singularity.
   */
  private finishPreset(response: number): void {
    this.lookDirection.subVectors(this.dampedTarget, this.camera.position);
    if (!safeNormalizeVector(this.lookDirection, this.lookDirection)) {
      this.lookDirection.subVectors(this.desiredTarget, this.desiredPosition);
      if (!safeNormalizeVector(this.lookDirection, this.lookDirection)) {
        this.lookDirection.set(0, 0, -1);
      }
    }
    this.cameraUpGoal.copy(UP).addScaledVector(this.lookDirection, -UP.dot(this.lookDirection));
    if (this.cameraUpGoal.lengthSq() > 0.0625) {
      this.cameraUpGoal.normalize();
    } else {
      this.cameraUpGoal.copy(this.frameUpGoal);
    }
    if (!dampCameraUp(
      this.cameraUp,
      this.cameraUpGoal,
      this.lookDirection,
      this.lastDelta,
      response,
    )) {
      this.cameraUp.copy(this.cameraUpGoal);
    }
    this.camera.up.copy(this.cameraUp);
    this.controls.target.copy(this.dampedTarget);
    this.controls.update();
    this.applyWorldGuard();
    this.dampedTarget.copy(this.controls.target);
    this.lookTarget.copy(this.dampedTarget);
    this.controls.target.copy(this.overlayTarget);
  }

  /**
   * World-range guard only: never shorten the orbit distance. It stops the
   * camera from drilling under the seabed, leaving the generated terrain, or
   * panning the observation target into empty space.
   */
  private applyWorldGuard(): void {
    constrainCameraTarget(this.controls.target);
    if (constrainCameraPosition(this.camera.position)) {
      this.camera.lookAt(this.controls.target);
    }
  }

  private viewportFit(): number {
    return Math.max(1, 0.78 / Math.max(0.35, this.camera.aspect));
  }

  /** Reads the camera's world basis; falls back to the current view direction. */
  private readCameraBasis(): void {
    this.camera.updateMatrixWorld();
    const elements = this.camera.matrixWorld.elements;
    this.cameraRight.set(elements[0], elements[1], elements[2]);
    this.cameraUp.set(elements[4], elements[5], elements[6]);
    this.cameraForward.set(-elements[8], -elements[9], -elements[10]);
    if (!safeNormalizeVector(this.cameraRight, this.cameraRight)) {
      this.cameraRight.crossVectors(UP, this.cameraForward);
    }
    if (!safeNormalizeVector(this.cameraForward, this.cameraForward)) {
      this.cameraForward.subVectors(this.controls.target, this.camera.position);
    }
    if (this.cameraForward.lengthSq() <= CAMERA_DIRECTION_EPSILON * CAMERA_DIRECTION_EPSILON) {
      this.cameraForward.set(0, 0, 1);
    } else {
      this.cameraForward.normalize();
    }
    if (!safeNormalizeVector(this.cameraUp, this.cameraUp)) this.cameraUp.copy(UP);
    this.cameraRight.crossVectors(this.cameraForward, this.cameraUp);
    if (!safeNormalizeVector(this.cameraRight, this.cameraRight)) {
      this.cameraRight.crossVectors(this.cameraForward, UP);
      if (!safeNormalizeVector(this.cameraRight, this.cameraRight)) this.cameraRight.set(1, 0, 0);
    }
    this.cameraUp.crossVectors(this.cameraRight, this.cameraForward);
    if (!safeNormalizeVector(this.cameraUp, this.cameraUp)) this.cameraUp.copy(UP);
  }
}

export type { SchoolFitResult };
