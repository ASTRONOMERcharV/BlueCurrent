import { Vector3 } from 'three';

/**
 * Shared camera-frame and framing math. These helpers are allocation-free on
 * the hot path and never normalize a vector that is too short to carry a
 * reliable direction. Nothing here reads or writes simulation state.
 */

export const CAMERA_DIRECTION_EPSILON = 1e-4;
export const CAMERA_FRAME_TOLERANCE = 1e-5;

export const SCHOOL_LEAD_DISTANCE = 0.6;
export const SCHOOL_BACK_DISTANCE = 23.5;
export const SCHOOL_SIDE_DISTANCE = 9;
export const SCHOOL_UP_DISTANCE = 9.5;

export const SCHOOL_HEADING_MIN_COHERENCE = 0.12;
export const SCHOOL_HEADING_FULL_COHERENCE = 0.55;
export const SCHOOL_HEADING_RESPONSE = 4;
export const SCHOOL_FIT_INTERVAL = 0.1;
export const SCHOOL_FIT_RESPONSE = 1.6;
export const SCHOOL_FIT_PERCENTILE = 0.95;
export const SCHOOL_FIT_PADDING = 1.17;
export const SCHOOL_FIT_MIN_SCALE = 1;
export const SCHOOL_FIT_MAX_SCALE = 1.4;

export const PREDATOR_MIN_TARGET_DISTANCE = 0.25;
export const PREDATOR_MIN_SPEED = 0.02;

export function cameraDamping(delta: number, response: number): number {
  return 1 - Math.exp(-Math.max(0, delta) * response);
}

export function isFiniteVector(vector: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isFiniteTriple(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

/**
 * Normalizes only when the input has a direction worth trusting. On failure
 * `out` is left untouched, so callers can keep their last valid value.
 */
export function safeNormalize(
  out: Vector3,
  x: number,
  y: number,
  z: number,
  epsilon = CAMERA_DIRECTION_EPSILON,
): boolean {
  const lengthSq = x * x + y * y + z * z;
  if (!Number.isFinite(lengthSq) || lengthSq <= epsilon * epsilon) return false;
  const inverseLength = 1 / Math.sqrt(lengthSq);
  out.set(x * inverseLength, y * inverseLength, z * inverseLength);
  return true;
}

export function safeNormalizeVector(
  out: Vector3,
  source: { x: number; y: number; z: number },
  epsilon = CAMERA_DIRECTION_EPSILON,
): boolean {
  return safeNormalize(out, source.x, source.y, source.z, epsilon);
}

export type FrameSource = 'projected-right' | 'previous-up' | 'world-axis' | 'invalid';

export interface FrameResult {
  readonly valid: boolean;
  readonly source: FrameSource;
  readonly projectedRightLength: number;
}

/**
 * Right-handed camera frame (right, up, -forward). The previous right vector is
 * projected onto the plane perpendicular to the new forward; the previous up
 * and a deterministic world axis are the ordered fallbacks. A failed update
 * leaves the frame exactly as it was.
 */
export class StableCameraFrame {
  readonly forward = new Vector3(1, 0, 0);
  readonly right = new Vector3(0, 0, 1);
  readonly up = new Vector3(0, 1, 0);
  private readonly nextForward = new Vector3(1, 0, 0);
  private readonly nextRight = new Vector3(0, 0, 1);
  private readonly nextUp = new Vector3(0, 1, 0);
  private readonly projected = new Vector3();
  private readonly crossed = new Vector3();

  reset(): void {
    this.forward.set(1, 0, 0);
    this.right.set(0, 0, 1);
    this.up.set(0, 1, 0);
  }

  /** Seeds the frame from a known camera basis, preserving the current roll. */
  seed(
    forward: Vector3,
    rightCandidate: Vector3,
    upCandidate: Vector3,
  ): FrameResult {
    if (!safeNormalize(this.nextForward, forward.x, forward.y, forward.z)) {
      return { valid: false, source: 'invalid', projectedRightLength: 0 };
    }
    const result = this.buildBasis(rightCandidate, upCandidate);
    if (result.valid) this.commit();
    return result;
  }

  update(desiredForward: Vector3, epsilon = CAMERA_DIRECTION_EPSILON): FrameResult {
    if (!safeNormalize(this.nextForward, desiredForward.x, desiredForward.y, desiredForward.z, epsilon)) {
      return { valid: false, source: 'invalid', projectedRightLength: 0 };
    }
    const result = this.buildBasis(this.right, this.up, epsilon);
    if (result.valid) this.commit();
    return result;
  }

  /** No allocation, no state change: used by tests and diagnostics. */
  isOrthonormal(tolerance = CAMERA_FRAME_TOLERANCE): boolean {
    if (!isFiniteVector(this.forward) || !isFiniteVector(this.right) || !isFiniteVector(this.up)) {
      return false;
    }
    const forwardLength = this.forward.length();
    const rightLength = this.right.length();
    const upLength = this.up.length();
    if (Math.abs(forwardLength - 1) > tolerance
      || Math.abs(rightLength - 1) > tolerance
      || Math.abs(upLength - 1) > tolerance) {
      return false;
    }
    if (Math.abs(this.forward.dot(this.right)) > tolerance
      || Math.abs(this.forward.dot(this.up)) > tolerance
      || Math.abs(this.right.dot(this.up)) > tolerance) {
      return false;
    }
    this.crossed.crossVectors(this.right, this.up);
    return this.crossed.dot(this.forward) < -1 + tolerance;
  }

  private buildBasis(
    rightCandidate: Vector3,
    upCandidate: Vector3,
    epsilon = CAMERA_DIRECTION_EPSILON,
  ): FrameResult {
    const forward = this.nextForward;
    const rightDot = rightCandidate.dot(forward);
    this.projected.copy(rightCandidate).addScaledVector(forward, -rightDot);
    const rightProjectionLength = this.projected.length();
    if (Number.isFinite(rightProjectionLength) && rightProjectionLength > epsilon) {
      this.nextRight.copy(this.projected).multiplyScalar(1 / rightProjectionLength);
      this.nextUp.crossVectors(this.nextRight, forward);
      const upLength = this.nextUp.length();
      if (Number.isFinite(upLength) && upLength > 1 - 1e-6) {
        return { valid: true, source: 'projected-right', projectedRightLength: rightProjectionLength };
      }
    }

    const upDot = upCandidate.dot(forward);
    this.projected.copy(upCandidate).addScaledVector(forward, -upDot);
    const upProjectionLength = this.projected.length();
    if (Number.isFinite(upProjectionLength) && upProjectionLength > epsilon) {
      this.nextRight.crossVectors(forward, this.projected).multiplyScalar(1 / upProjectionLength);
      this.nextUp.crossVectors(this.nextRight, forward);
      return { valid: true, source: 'previous-up', projectedRightLength: rightProjectionLength };
    }

    // Both previous axes are parallel to the new forward (only possible if the
    // frame was already degenerate). Pick the world axis least aligned with it.
    const absX = Math.abs(forward.x);
    const absY = Math.abs(forward.y);
    const absZ = Math.abs(forward.z);
    if (absY <= absX && absY <= absZ) this.crossed.set(0, 1, 0);
    else if (absX <= absZ) this.crossed.set(1, 0, 0);
    else this.crossed.set(0, 0, 1);
    this.nextRight.crossVectors(forward, this.crossed);
    if (!safeNormalizeVector(this.nextRight, this.nextRight)) {
      return { valid: false, source: 'invalid', projectedRightLength: rightProjectionLength };
    }
    this.nextUp.crossVectors(this.nextRight, forward);
    return { valid: true, source: 'world-axis', projectedRightLength: rightProjectionLength };
  }

  private commit(): void {
    this.forward.copy(this.nextForward);
    this.right.copy(this.nextRight);
    this.up.copy(this.nextUp);
  }
}

export type SchoolHeadingSource = 'initial' | 'velocity-sum' | 'held';

export interface SchoolHeadingUpdate {
  readonly coherence: number;
  readonly reliability: number;
  readonly source: SchoolHeadingSource;
}

/**
 * Turns the raw velocity sum into a heading, but only trusts it when the school
 * is directionally coherent. Low coherence holds the last valid heading and
 * scales the remaining update rate down instead of normalizing noise.
 */
export class SchoolHeadingTracker {
  readonly heading = new Vector3(1, 0, 0);
  coherence = 0;
  valid = false;
  private readonly desired = new Vector3();
  private readonly nextHeading = new Vector3();

  reset(): void {
    this.heading.set(1, 0, 0);
    this.coherence = 0;
    this.valid = false;
  }

  update(sumVelocity: Vector3, totalSpeed: number, delta: number): SchoolHeadingUpdate {
    const sumLength = sumVelocity.length();
    const speed = Number.isFinite(totalSpeed) ? Math.max(0, totalSpeed) : 0;
    const rawCoherence = speed > 1e-9 && Number.isFinite(sumLength)
      ? Math.min(1, Math.max(0, sumLength / speed))
      : 0;
    this.coherence = Number.isFinite(rawCoherence) ? rawCoherence : 0;

    const usable = Number.isFinite(sumLength)
      && sumLength > CAMERA_DIRECTION_EPSILON
      && this.coherence > SCHOOL_HEADING_MIN_COHERENCE;

    if (!this.valid) {
      if (usable) {
        this.heading.copy(sumVelocity).multiplyScalar(1 / sumLength);
        if (this.heading.lengthSq() > 0.5) {
          this.valid = true;
          return { coherence: this.coherence, reliability: 1, source: 'initial' };
        }
      }
      return { coherence: this.coherence, reliability: 0, source: 'held' };
    }

    if (!usable) {
      return { coherence: this.coherence, reliability: 0, source: 'held' };
    }

    const reliability = smoothStep(
      SCHOOL_HEADING_MIN_COHERENCE,
      SCHOOL_HEADING_FULL_COHERENCE,
      this.coherence,
    );
    this.desired.copy(sumVelocity).multiplyScalar(1 / sumLength);
    const blend = cameraDamping(
      Math.min(Math.max(0, delta), 0.15),
      SCHOOL_HEADING_RESPONSE * reliability,
    );
    this.nextHeading.copy(this.heading).lerp(this.desired, blend);
    if (!safeNormalizeVector(this.heading, this.nextHeading)) {
      return { coherence: this.coherence, reliability: 0, source: 'held' };
    }
    return { coherence: this.coherence, reliability, source: 'velocity-sum' };
  }
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const span = edge1 - edge0;
  if (!(span > 0)) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / span));
  return t * t * (3 - 2 * t);
}

export interface SchoolFitOptions {
  readonly fovDegrees: number;
  readonly aspect: number;
  readonly baselineBack: number;
  readonly baselineSide: number;
  readonly baselineUp: number;
  readonly percentile: number;
  readonly screenPadding: number;
  readonly minScale: number;
  readonly maxScale: number;
}

export interface SchoolFitResult {
  readonly scale: number;
  readonly rawScale: number;
  readonly percentileValue: number;
  readonly visibleFraction: number;
  readonly sampleCount: number;
}

const fitOffset = new Vector3();
const fitView = new Vector3();
const fitBackward = new Vector3();
const fitRight = new Vector3();
const fitUp = new Vector3();

/**
 * Measures the scale needed for the P-percentile main-school fish to stay
 * inside the current viewport, including screen padding. The projection uses
 * the real FOV, aspect, camera viewing direction and the oblique camera anchor
 * produced by the baseline side/height offsets. Fish positions must be the
 * main flock only.
 */
export function measureSchoolFit(
  requiredScales: Float32Array,
  positions: Float32Array,
  alive: Uint8Array,
  count: number,
  target: Vector3,
  forward: Vector3,
  right: Vector3,
  up: Vector3,
  worldUp: Vector3,
  options: SchoolFitOptions,
): SchoolFitResult {
  const minScale = Math.min(options.minScale, options.maxScale);
  const maxScale = Math.max(options.minScale, options.maxScale);
  const fallback: SchoolFitResult = {
    scale: minScale,
    rawScale: minScale,
    percentileValue: minScale,
    visibleFraction: 1,
    sampleCount: 0,
  };
  if (!isFiniteVector(target) || !isFiniteVector(forward) || !isFiniteVector(right) || !isFiniteVector(up)) {
    return fallback;
  }

  const tanVertical = Math.tan((options.fovDegrees * Math.PI) / 360);
  if (!Number.isFinite(tanVertical) || tanVertical <= 1e-6) return fallback;
  const halfHeight = tanVertical;
  const halfWidth = tanVertical * Math.max(0.05, options.aspect);
  const padding = Math.max(1, Number.isFinite(options.screenPadding) ? options.screenPadding : 1);
  const back = Math.max(0, options.baselineBack);
  const side = Math.max(0, options.baselineSide);
  const height = Math.max(0, options.baselineUp);

  fitOffset.copy(forward).multiplyScalar(-back)
    .addScaledVector(right, side)
    .addScaledVector(worldUp, height);
  const anchorDistance = fitOffset.length();
  if (!(anchorDistance > CAMERA_DIRECTION_EPSILON)) return fallback;

  fitBackward.copy(fitOffset).multiplyScalar(1 / anchorDistance);
  fitView.copy(fitBackward).multiplyScalar(-1);
  fitRight.crossVectors(up, fitBackward);
  if (!safeNormalizeVector(fitRight, fitRight)) fitRight.copy(right);
  fitUp.crossVectors(fitBackward, fitRight);

  const limit = Math.min(Math.max(0, Math.floor(count)), requiredScales.length);
  let sampleCount = 0;
  for (let index = 0; index < limit; index += 1) {
    if (alive[index] === 0) continue;
    const offset = index * 3;
    const qx = positions[offset] - target.x;
    const qy = positions[offset + 1] - target.y;
    const qz = positions[offset + 2] - target.z;
    if (!isFiniteTriple(qx, qy, qz)) {
      requiredScales[sampleCount] = maxScale;
      sampleCount += 1;
      continue;
    }
    const depthOffset = qx * fitView.x + qy * fitView.y + qz * fitView.z;
    const horizontal = Math.abs(qx * fitRight.x + qy * fitRight.y + qz * fitRight.z);
    const vertical = Math.abs(qx * fitUp.x + qy * fitUp.y + qz * fitUp.z);
    const angular = Math.max(horizontal / halfWidth, vertical / halfHeight);
    const required = (angular * padding - depthOffset) / anchorDistance;
    requiredScales[sampleCount] = Number.isFinite(required) ? required : maxScale;
    sampleCount += 1;
  }

  if (sampleCount === 0) return fallback;
  const percentile = Math.min(1, Math.max(0, options.percentile));
  const percentileValue = selectPercentile(requiredScales, sampleCount, percentile);
  const rawScale = percentileValue;
  const scale = Math.min(maxScale, Math.max(minScale, rawScale));
  let visible = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    if (requiredScales[index] <= scale + 1e-9) visible += 1;
  }
  return {
    scale,
    rawScale,
    percentileValue,
    visibleFraction: visible / sampleCount,
    sampleCount,
  };
}

/** In-place quickselect; the array ends up partitioned, not sorted. */
function selectPercentile(values: Float32Array, count: number, percentile: number): number {
  const rank = Math.min(count - 1, Math.max(0, Math.round((count - 1) * percentile)));
  let left = 0;
  let right = count - 1;
  while (left < right) {
    const pivot = values[(left + right) >> 1];
    let low = left;
    let high = right;
    while (low <= high) {
      while (values[low] < pivot) low += 1;
      while (values[high] > pivot) high -= 1;
      if (low <= high) {
        const temporary = values[low];
        values[low] = values[high];
        values[high] = temporary;
        low += 1;
        high -= 1;
      }
    }
    if (rank <= high) right = high;
    else if (rank >= low) left = low;
    else break;
  }
  return values[rank];
}

export function computeSchoolCameraPose(
  outPosition: Vector3,
  outTarget: Vector3,
  center: Vector3,
  targetOffset: Vector3,
  forward: Vector3,
  right: Vector3,
  worldUp: Vector3,
  fit: number,
): void {
  outTarget.copy(center)
    .addScaledVector(forward, SCHOOL_LEAD_DISTANCE)
    .add(targetOffset);
  outPosition.copy(outTarget)
    .addScaledVector(forward, -SCHOOL_BACK_DISTANCE * fit)
    .addScaledVector(right, SCHOOL_SIDE_DISTANCE * fit)
    .addScaledVector(worldUp, SCHOOL_UP_DISTANCE * fit);
}

export function computePredatorCameraPose(
  outPosition: Vector3,
  outTarget: Vector3,
  predator: Vector3,
  forward: Vector3,
  right: Vector3,
  worldUp: Vector3,
  lead: number,
  back: number,
  side: number,
  height: number,
  fit: number,
  targetOffset: Vector3,
): void {
  outTarget.copy(predator)
    .addScaledVector(forward, lead)
    .add(targetOffset);
  outPosition.copy(predator)
    .addScaledVector(forward, -back * fit)
    .addScaledVector(right, side * fit)
    .addScaledVector(worldUp, height * fit);
}

export type PredatorForwardSource = 'target' | 'velocity' | 'previous' | 'initial';

export interface PredatorForwardResult {
  readonly source: PredatorForwardSource;
  readonly targetDistance: number | null;
}

/**
 * Target-liveness predicate shared by the camera and its tests. `search` and
 * `patrol` never expose a target direction even when a stale index survives in
 * the simulation state.
 */
export function isValidPredatorTarget(
  state: string,
  targetIndex: number,
  fishCount: number,
  targetAlive: number,
): boolean {
  return (state === 'pursuit' || state === 'attack')
    && Number.isInteger(targetIndex)
    && targetIndex >= 0
    && targetIndex < fishCount
    && targetAlive === 1;
}

/**
 * Ordered, allocation-free predator direction selection. A near-zero vector is
 * never normalized; the previous valid heading survives every degenerate case.
 */
export function resolvePredatorForward(
  out: Vector3,
  targetDisplacement: Vector3 | null,
  velocity: ArrayLike<number>,
  previousHeading: Vector3,
  minTargetDistance = PREDATOR_MIN_TARGET_DISTANCE,
  minSpeed = PREDATOR_MIN_SPEED,
): PredatorForwardResult {
  if (targetDisplacement) {
    const distance = targetDisplacement.length();
    if (Number.isFinite(distance) && distance > minTargetDistance) {
      out.copy(targetDisplacement).multiplyScalar(1 / distance);
      return { source: 'target', targetDistance: distance };
    }
  }
  if (safeNormalize(out, velocity[0], velocity[1], velocity[2], minSpeed)) {
    return { source: 'velocity', targetDistance: null };
  }
  if (safeNormalizeVector(out, previousHeading)) {
    return { source: 'previous', targetDistance: null };
  }
  out.set(0, 0, 1);
  return { source: 'initial', targetDistance: null };
}

const upScratch = new Vector3();

/**
 * Damps camera.up toward the target and keeps it perpendicular to the actual
 * view direction, so lookAt never sees a near-parallel up vector.
 */
export function dampCameraUp(
  cameraUp: Vector3,
  targetUp: Vector3,
  viewDirection: Vector3,
  delta: number,
  response: number,
): boolean {
  if (!isFiniteVector(cameraUp) || !isFiniteVector(targetUp) || !isFiniteVector(viewDirection)) {
    return false;
  }
  const blend = cameraDamping(Math.min(Math.max(0, delta), 0.15), response);
  upScratch.copy(cameraUp).lerp(targetUp, blend);
  upScratch.addScaledVector(viewDirection, -upScratch.dot(viewDirection));
  if (!safeNormalizeVector(upScratch, upScratch)) return false;
  cameraUp.copy(upScratch);
  return true;
}
