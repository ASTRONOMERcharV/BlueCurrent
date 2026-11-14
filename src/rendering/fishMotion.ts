/**
 * Pure helpers for the renderer-side fish motion (Phase E1). They only shape
 * presentation from already-simulated velocity/bank; no simulation state is
 * read back or written.
 */

export function targetPitchFromDirection(directionY: number): number {
  return Math.asin(Math.max(-1, Math.min(1, directionY)));
}

export function clampPitch(pitch: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, pitch));
}

/**
 * Exponential approach with a per-frame rate limit and a hard pitch limit.
 * `dt <= 0` keeps the current state so pausing does not snap the pose.
 */
export function stepPitch(
  current: number,
  target: number,
  dt: number,
  response: number,
  rateLimit: number,
  limit: number,
): number {
  const limitedTarget = clampPitch(target, limit);
  if (!(dt > 0)) return clampPitch(current, limit);
  const blend = 1 - Math.exp(-dt * response);
  const desired = current + (limitedTarget - current) * blend;
  const maximumStep = rateLimit * dt;
  const step = Math.max(-maximumStep, Math.min(maximumStep, desired - current));
  return clampPitch(current + step, limit);
}

export function turnFromBank(bank: number, reference: number): number {
  if (!(reference > 0)) return 0;
  return Math.max(-1, Math.min(1, bank / reference));
}

export interface FishMotionDiagnostics {
  readonly meanAbsPitch: number;
  readonly maxAbsPitch: number;
  readonly meanAbsBank: number;
  readonly maxAbsBank: number;
  readonly meanAbsTurn: number;
  readonly maxAbsTurn: number;
  readonly meanSpeed: number;
  readonly meanFear: number;
  /**
   * Fish whose instantaneous velocity demands the steepest pitch, with its
   * current world position. Velocity-derived, so the same fish in both motion
   * modes; read-only capture telemetry.
   */
  readonly maxTargetPitchIndex: number;
  readonly maxTargetPitchPosition: readonly [number, number, number] | null;
}
