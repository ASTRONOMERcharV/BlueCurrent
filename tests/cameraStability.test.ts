import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_FRAME_TOLERANCE,
  SCHOOL_FIT_MAX_SCALE,
  SCHOOL_FIT_MIN_SCALE,
  SchoolHeadingTracker,
  StableCameraFrame,
  cameraDamping,
  computePredatorCameraPose,
  computeSchoolCameraPose,
  dampCameraUp,
  isFiniteVector,
  isValidPredatorTarget,
  measureSchoolFit,
  resolvePredatorForward,
  safeNormalize,
  type SchoolFitOptions,
} from '../src/rendering/cameraStability';

const UP = new Vector3(0, 1, 0);

function frameIsSane(frame: StableCameraFrame): void {
  expect(isFiniteVector(frame.forward)).toBe(true);
  expect(isFiniteVector(frame.right)).toBe(true);
  expect(isFiniteVector(frame.up)).toBe(true);
  expect(Math.abs(frame.forward.length() - 1)).toBeLessThan(CAMERA_FRAME_TOLERANCE);
  expect(Math.abs(frame.right.length() - 1)).toBeLessThan(CAMERA_FRAME_TOLERANCE);
  expect(Math.abs(frame.up.length() - 1)).toBeLessThan(CAMERA_FRAME_TOLERANCE);
  expect(Math.abs(frame.forward.dot(frame.right))).toBeLessThan(CAMERA_FRAME_TOLERANCE);
  expect(Math.abs(frame.forward.dot(frame.up))).toBeLessThan(CAMERA_FRAME_TOLERANCE);
  expect(Math.abs(frame.right.dot(frame.up))).toBeLessThan(CAMERA_FRAME_TOLERANCE);
  expect(frame.isOrthonormal()).toBe(true);
}

describe('StableCameraFrame', () => {
  it('keeps a canonical frame for horizontal directions', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    const diagonal = new Vector3(1, 0, 1).normalize();
    const result = frame.update(diagonal);
    expect(result.valid).toBe(true);
    expect(result.source).toBe('projected-right');
    expect(frame.forward.distanceTo(diagonal)).toBeLessThan(1e-6);
    expect(frame.right.dot(new Vector3(0, 0, 1))).toBeGreaterThan(0);
    expect(frame.up.y).toBeCloseTo(1);
    frameIsSane(frame);
  });

  it('remains finite and orthonormal at exact vertical directions', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    const upResult = frame.update(new Vector3(0, 1, 0));
    expect(upResult.valid).toBe(true);
    expect(upResult.projectedRightLength).toBeGreaterThan(0);
    frameIsSane(frame);

    const downResult = frame.update(new Vector3(0, -1, 0));
    expect(downResult.valid).toBe(true);
    frameIsSane(frame);
  });

  it('does not degenerate near the vertical singularity', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    for (const degrees of [89.9, 90, 90.1, 179.9, 180]) {
      const radians = (degrees * Math.PI) / 180;
      const result = frame.update(new Vector3(Math.cos(radians) * 1e-3, 1, Math.sin(radians) * 1e-3));
      expect(result.valid).toBe(true);
      frameIsSane(frame);
    }
  });

  it('crosses the vertical singularity without flipping the right vector', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    let previousRight = frame.right.clone();
    for (let step = 0; step <= 40; step += 1) {
      const angle = -Math.PI / 2 + (step / 40) * Math.PI;
      const result = frame.update(new Vector3(Math.cos(angle), Math.sin(angle), 0));
      expect(result.valid).toBe(true);
      expect(frame.right.dot(previousRight)).toBeGreaterThan(0.99);
      previousRight = frame.right.clone();
    }
    frameIsSane(frame);
  });

  it('handles an opposite direction change while keeping handedness', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    const result = frame.update(new Vector3(-1, 0, 0));
    expect(result.valid).toBe(true);
    expect(frame.right.dot(new Vector3(0, 0, 1))).toBeGreaterThan(0.99);
    frameIsSane(frame);
  });

  it('falls back to the previous up when the previous right is degenerate', () => {
    const frame = new StableCameraFrame();
    const result = frame.seed(new Vector3(1, 0, 0), new Vector3(1, 0, 0), UP);
    expect(result.valid).toBe(true);
    expect(result.source).toBe('previous-up');
    expect(frame.right.z).toBeCloseTo(1);
    frameIsSane(frame);
  });

  it('falls back to a deterministic world axis when both previous axes are degenerate', () => {
    const frame = new StableCameraFrame();
    const result = frame.seed(new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0));
    expect(result.valid).toBe(true);
    expect(result.source).toBe('world-axis');
    frameIsSane(frame);
  });

  it('leaves the last valid frame untouched when the desired direction is zero', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    const forward = frame.forward.clone();
    const right = frame.right.clone();
    const up = frame.up.clone();
    const result = frame.update(new Vector3(0, 0, 0));
    expect(result.valid).toBe(false);
    expect(frame.forward.distanceTo(forward)).toBe(0);
    expect(frame.right.distanceTo(right)).toBe(0);
    expect(frame.up.distanceTo(up)).toBe(0);
  });
});

describe('SchoolHeadingTracker', () => {
  it('tracks a coherent population from rest', () => {
    const tracker = new SchoolHeadingTracker();
    const result = tracker.update(new Vector3(10, 0, 0), 10, 1 / 60);
    expect(result.source).toBe('initial');
    expect(result.coherence).toBeCloseTo(1);
    expect(tracker.valid).toBe(true);
    expect(tracker.heading.x).toBeCloseTo(1);
  });

  it('holds the last valid heading for opposing subgroups', () => {
    const tracker = new SchoolHeadingTracker();
    tracker.update(new Vector3(10, 0, 0), 10, 1 / 60);
    const result = tracker.update(new Vector3(0, 0, 0), 20, 1 / 60);
    expect(result.source).toBe('held');
    expect(result.coherence).toBeCloseTo(0);
    expect(tracker.heading.x).toBeCloseTo(1);
    expect(isFiniteVector(tracker.heading)).toBe(true);
  });

  it('slows the heading update under low coherence', () => {
    const coherent = new SchoolHeadingTracker();
    coherent.update(new Vector3(1, 0, 0), 1, 1 / 60);
    const coherentResult = coherent.update(new Vector3(1, 0, 0.2), 1.0198, 1 / 60);

    const noisy = new SchoolHeadingTracker();
    noisy.update(new Vector3(1, 0, 0), 1, 1 / 60);
    // Sum of 0.2 units of forward motion over 1.0 units of path length.
    const noisyResult = noisy.update(new Vector3(0.2, 0, 0.02), 1.001, 1 / 60);

    expect(noisyResult.reliability).toBeLessThan(coherentResult.reliability);
    expect(noisy.heading.angleTo(new Vector3(1, 0, 0))).toBeLessThan(
      coherent.heading.angleTo(new Vector3(1, 0, 0)),
    );
    expect(isFiniteVector(noisy.heading)).toBe(true);
  });

  it('recovers normal tracking after coherence returns', () => {
    const tracker = new SchoolHeadingTracker();
    tracker.update(new Vector3(1, 0, 0), 1, 1 / 60);
    tracker.update(new Vector3(0.1, 0, 0), 2, 1 / 60);
    let recovery = tracker.update(new Vector3(0, 0, 1), 1, 0.15);
    for (let step = 0; step < 10; step += 1) {
      recovery = tracker.update(new Vector3(0, 0, 1), 1, 0.15);
    }
    expect(recovery.source).toBe('velocity-sum');
    expect(recovery.reliability).toBeCloseTo(1);
    expect(tracker.heading.z).toBeGreaterThan(0.9);
  });

  it('never normalizes a zero velocity sum from rest', () => {
    const tracker = new SchoolHeadingTracker();
    const result = tracker.update(new Vector3(0, 0, 0), 0, 1 / 60);
    expect(result.source).toBe('held');
    expect(tracker.valid).toBe(false);
    expect(isFiniteVector(tracker.heading)).toBe(true);
  });
});

function fitOptions(overrides: Partial<SchoolFitOptions> = {}): SchoolFitOptions {
  return {
    fovDegrees: 48,
    aspect: 1.6,
    baselineBack: 23.5,
    baselineSide: 9,
    baselineUp: 9.5,
    percentile: 0.95,
    screenPadding: 1.17,
    minScale: SCHOOL_FIT_MIN_SCALE,
    maxScale: SCHOOL_FIT_MAX_SCALE,
    ...overrides,
  };
}

function syntheticSchool(count: number, spread: number): {
  positions: Float32Array;
  alive: Uint8Array;
} {
  const positions = new Float32Array(count * 3);
  const alive = new Uint8Array(count).fill(1);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    positions[offset] = ((index * 37) % 100) / 100 * spread * 2 - spread;
    positions[offset + 1] = ((index * 53) % 100) / 100 * spread * 2 - spread;
    positions[offset + 2] = ((index * 71) % 100) / 100 * spread * 2 - spread;
  }
  return { positions, alive };
}

describe('measureSchoolFit', () => {
  const forward = new Vector3(0, 0, -1);
  const right = new Vector3(1, 0, 0);
  const up = new Vector3(0, 1, 0);

  it('keeps the baseline scale for a compact school', () => {
    const school = syntheticSchool(200, 2);
    const scales = new Float32Array(200);
    const fit = measureSchoolFit(
      scales,
      school.positions,
      school.alive,
      200,
      new Vector3(0, 0, 0),
      forward,
      right,
      up,
      UP,
      fitOptions(),
    );
    expect(fit.scale).toBe(SCHOOL_FIT_MIN_SCALE);
    expect(fit.visibleFraction).toBe(1);
    expect(fit.sampleCount).toBe(200);
  });

  it('ignores a small number of far outliers through P95', () => {
    const count = 200;
    const school = syntheticSchool(count, 2);
    for (let index = 190; index < count; index += 1) {
      const offset = index * 3;
      school.positions[offset] = 120 + index;
      school.positions[offset + 1] = 0;
      school.positions[offset + 2] = 0;
    }
    const fit = measureSchoolFit(
      new Float32Array(count),
      school.positions,
      school.alive,
      count,
      new Vector3(0, 0, 0),
      forward,
      right,
      up,
      UP,
      fitOptions(),
    );
    expect(fit.scale).toBe(SCHOOL_FIT_MIN_SCALE);
    expect(fit.visibleFraction).toBeCloseTo(0.95, 2);
  });

  it('expands the scale for a widely dispersed school', () => {
    const school = syntheticSchool(200, 60);
    const fit = measureSchoolFit(
      new Float32Array(200),
      school.positions,
      school.alive,
      200,
      new Vector3(0, 0, 0),
      forward,
      right,
      up,
      UP,
      fitOptions(),
    );
    expect(fit.rawScale).toBeGreaterThan(1);
    expect(fit.scale).toBeLessThanOrEqual(SCHOOL_FIT_MAX_SCALE);
    expect(fit.visibleFraction).toBeGreaterThan(0);
    expect(fit.visibleFraction).toBeLessThanOrEqual(1);
  });

  it('requires more distance through a narrow viewport', () => {
    const school = syntheticSchool(200, 10);
    const wide = measureSchoolFit(
      new Float32Array(200),
      school.positions,
      school.alive,
      200,
      new Vector3(0, 0, 0),
      forward,
      right,
      up,
      UP,
      fitOptions({ aspect: 2 }),
    );
    const narrow = measureSchoolFit(
      new Float32Array(200),
      school.positions,
      school.alive,
      200,
      new Vector3(0, 0, 0),
      forward,
      right,
      up,
      UP,
      fitOptions({ aspect: 0.5 }),
    );
    expect(narrow.rawScale).toBeGreaterThan(wide.rawScale);
  });

  it('excludes dead fish and reports an empty population safely', () => {
    const school = syntheticSchool(10, 400);
    school.alive.fill(0);
    const fit = measureSchoolFit(
      new Float32Array(10),
      school.positions,
      school.alive,
      10,
      new Vector3(0, 0, 0),
      forward,
      right,
      up,
      UP,
      fitOptions(),
    );
    expect(fit.sampleCount).toBe(0);
    expect(fit.scale).toBe(SCHOOL_FIT_MIN_SCALE);
    expect(fit.visibleFraction).toBe(1);
  });

  it('returns finite output for a degenerate direction', () => {
    const school = syntheticSchool(10, 2);
    const fit = measureSchoolFit(
      new Float32Array(10),
      school.positions,
      school.alive,
      10,
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 0),
      right,
      up,
      UP,
      fitOptions(),
    );
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.scale).toBe(SCHOOL_FIT_MIN_SCALE);
  });
});

describe('camera pose composition', () => {
  it('preserves the exact school baseline at fit 1', () => {
    const position = new Vector3();
    const target = new Vector3();
    computeSchoolCameraPose(
      position,
      target,
      new Vector3(0, 0, 0),
      new Vector3(),
      new Vector3(0, 0, -1),
      new Vector3(1, 0, 0),
      UP,
      1,
    );
    expect(target.x).toBeCloseTo(0);
    expect(target.z).toBeCloseTo(-0.6);
    expect(position.x).toBeCloseTo(9);
    expect(position.y).toBeCloseTo(9.5);
    expect(position.z).toBeCloseTo(22.9);
  });

  it('preserves the exact predator baseline at fit 1', () => {
    const position = new Vector3();
    const target = new Vector3();
    computePredatorCameraPose(
      position,
      target,
      new Vector3(1, 2, 3),
      new Vector3(0, 0, -1),
      new Vector3(1, 0, 0),
      UP,
      3,
      15,
      5.4,
      4.8,
      1,
      new Vector3(),
    );
    expect(target.x).toBeCloseTo(1);
    expect(target.y).toBeCloseTo(2);
    expect(target.z).toBeCloseTo(0);
    expect(position.x).toBeCloseTo(6.4);
    expect(position.y).toBeCloseTo(6.8);
    expect(position.z).toBeCloseTo(18);
  });
});

describe('resolvePredatorForward', () => {
  const previous = new Vector3(1, 0, 0);

  it('uses a valid target direction first', () => {
    const out = new Vector3();
    const result = resolvePredatorForward(
      out,
      new Vector3(0, 0, -10),
      new Float32Array([0, 0, 1]),
      previous,
    );
    expect(result.source).toBe('target');
    expect(result.targetDistance).toBeCloseTo(10);
    expect(out.z).toBeCloseTo(-1);
  });

  it('falls back to velocity when the target is too close', () => {
    const out = new Vector3();
    const result = resolvePredatorForward(
      out,
      new Vector3(0, 0, -0.01),
      new Float32Array([0, 3, 0]),
      previous,
    );
    expect(result.source).toBe('velocity');
    expect(result.targetDistance).toBeNull();
    expect(out.y).toBeCloseTo(1);
  });

  it('falls back to the previous heading for zero velocity and zero target distance', () => {
    const out = new Vector3();
    const result = resolvePredatorForward(
      out,
      new Vector3(0, 0, 0),
      new Float32Array(3),
      previous,
    );
    expect(result.source).toBe('previous');
    expect(out.x).toBeCloseTo(1);
  });

  it('uses the deterministic initialization direction when everything is degenerate', () => {
    const out = new Vector3();
    const result = resolvePredatorForward(out, null, new Float32Array(3), new Vector3());
    expect(result.source).toBe('initial');
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(1);
  });

  it('does not normalize non-finite target or velocity data', () => {
    const out = new Vector3();
    const result = resolvePredatorForward(
      out,
      new Vector3(Number.NaN, 0, 0),
      new Float32Array([Number.POSITIVE_INFINITY, 0, 0]),
      previous,
    );
    expect(result.source).toBe('previous');
    expect(isFiniteVector(out)).toBe(true);
  });
});

describe('predator target validity', () => {
  it('accepts an alive in-range target only while pursuing or attacking', () => {
    expect(isValidPredatorTarget('pursuit', 7, 500, 1)).toBe(true);
    expect(isValidPredatorTarget('attack', 7, 500, 1)).toBe(true);
    expect(isValidPredatorTarget('patrol', 7, 500, 1)).toBe(false);
    expect(isValidPredatorTarget('search', 7, 500, 1)).toBe(false);
  });

  it('rejects a dead target without changing the index', () => {
    expect(isValidPredatorTarget('pursuit', 7, 500, 0)).toBe(false);
  });

  it('rejects out-of-range, fractional and negative indices', () => {
    expect(isValidPredatorTarget('pursuit', 500, 500, 1)).toBe(false);
    expect(isValidPredatorTarget('pursuit', -1, 500, 1)).toBe(false);
    expect(isValidPredatorTarget('pursuit', 1.5, 500, 1)).toBe(false);
  });
});

describe('predator pursuit transitions', () => {
  it('keeps the pose continuous through a full vertical sweep', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(-1, 0, 0), new Vector3(0, 0, -1), UP);
    const predator = new Vector3(0, 40, 0);
    const position = new Vector3();
    const target = new Vector3();
    const zero = new Vector3();
    let previousPosition: Vector3 | null = null;
    for (let step = 0; step <= 120; step += 1) {
      const angle = -Math.PI / 2 + (step / 120) * Math.PI;
      const direction = new Vector3(Math.sin(angle), Math.cos(angle), 0);
      const update = frame.update(direction);
      expect(update.valid).toBe(true);
      computePredatorCameraPose(
        position,
        target,
        predator,
        frame.forward,
        frame.right,
        UP,
        3,
        16,
        5.4,
        4.8,
        1,
        zero,
      );
      expect(isFiniteVector(position)).toBe(true);
      expect(isFiniteVector(target)).toBe(true);
      if (previousPosition) {
        expect(position.distanceTo(previousPosition)).toBeLessThan(1.5);
      }
      previousPosition = position.clone();
    }
    frameIsSane(frame);
  });

  it('does not flip the frame when the target switches sides', () => {
    const frame = new StableCameraFrame();
    frame.seed(new Vector3(1, 0, 0), new Vector3(0, 0, 1), UP);
    const out = new Vector3();
    resolvePredatorForward(out, new Vector3(10, 0, -2), new Float32Array(3), new Vector3(1, 0, 0));
    frame.update(out);
    const rightBefore = frame.right.clone();
    resolvePredatorForward(out, new Vector3(-10, 0, -2), new Float32Array(3), frame.forward);
    const update = frame.update(out);
    expect(update.valid).toBe(true);
    // The switch turns the forward axis by ~157 degrees; the projected right
    // follows the shortest rotation and must not mirror.
    expect(frame.right.dot(rightBefore)).toBeGreaterThan(0.8);
    expect(frame.isOrthonormal()).toBe(true);
  });
});

describe('dampCameraUp', () => {
  it('keeps world up for a horizontal view', () => {
    const cameraUp = new Vector3(0, 1, 0);
    const result = dampCameraUp(cameraUp, UP, new Vector3(0, 0, -1), 1 / 60, 3);
    expect(result).toBe(true);
    expect(cameraUp.y).toBeCloseTo(1);
    expect(cameraUp.dot(new Vector3(0, 0, -1))).toBeCloseTo(0);
  });

  it('projects a stable frame up for a vertical view', () => {
    const cameraUp = new Vector3(0, 1, 0);
    const result = dampCameraUp(cameraUp, new Vector3(0, 0, -1), new Vector3(0, 1, 0), 1 / 60, 3);
    expect(result).toBe(true);
    expect(Math.abs(cameraUp.dot(new Vector3(0, 1, 0)))).toBeLessThan(1e-6);
    expect(cameraUp.length()).toBeCloseTo(1);
  });

  it('rejects non-finite input', () => {
    const cameraUp = new Vector3(0, 1, 0);
    expect(dampCameraUp(cameraUp, new Vector3(Number.NaN, 0, 0), UP, 1 / 60, 3)).toBe(false);
    expect(isFiniteVector(cameraUp)).toBe(true);
  });
});

describe('shared direction guards', () => {
  it('never writes a normalized near-zero vector', () => {
    const out = new Vector3(4, 5, 6);
    const result = safeNormalize(out, 0, 0, 0);
    expect(result).toBe(false);
    expect(out.x).toBe(4);
    expect(out.y).toBe(5);
    expect(out.z).toBe(6);
  });

  it('keeps damping frame-rate independent', () => {
    const once = cameraDamping(1 / 30, 2.4);
    const twice = 1 - (1 - cameraDamping(1 / 60, 2.4)) ** 2;
    expect(once).toBeCloseTo(twice, 10);
  });
});
