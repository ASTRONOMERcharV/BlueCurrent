import { performance } from 'node:perf_hooks';
import { Vector3 } from 'three';
import {
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
  StableCameraFrame,
  cameraDamping,
  computePredatorCameraPose,
  computeSchoolCameraPose,
  measureSchoolFit,
  resolvePredatorForward,
} from '../src/rendering/cameraStability';

const FRAMES = 600;
const FISH = 500;
const EARTH_RADIUS = 18;

const positions = new Float32Array(FISH * 3);
const velocities = new Float32Array(FISH * 3);
const alive = new Uint8Array(FISH).fill(1);
const requiredScales = new Float32Array(FISH);
const target = new Vector3(0, 0, 0);
const forward = new Vector3(0.42, -0.18, 0.89).normalize();
const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
const up = new Vector3().crossVectors(right, forward).normalize();
const worldUp = new Vector3(0, 1, 0);
const outTarget = new Vector3();
const outPosition = new Vector3();
const offset = new Vector3();

let seed = 0x51f15e;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};
for (let index = 0; index < FISH; index += 1) {
  const theta = random() * Math.PI * 2;
  const cosPhi = random() * 2 - 1;
  const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
  const radius = EARTH_RADIUS * Math.cbrt(random());
  positions[index * 3] = radius * sinPhi * Math.cos(theta);
  positions[index * 3 + 1] = radius * cosPhi * 0.6;
  positions[index * 3 + 2] = radius * sinPhi * Math.sin(theta);
  velocities[index * 3] = 1.4 + random() * 0.2;
  velocities[index * 3 + 1] = random() * 0.1 - 0.05;
  velocities[index * 3 + 2] = random() * 0.1 - 0.05;
}

const fitOptions = {
  fovDegrees: 48,
  aspect: 1440 / 900,
  baselineBack: SCHOOL_BACK_DISTANCE,
  baselineSide: SCHOOL_SIDE_DISTANCE,
  baselineUp: SCHOOL_UP_DISTANCE,
  percentile: SCHOOL_FIT_PERCENTILE,
  screenPadding: SCHOOL_FIT_PADDING,
  minScale: SCHOOL_FIT_MIN_SCALE,
  maxScale: SCHOOL_FIT_MAX_SCALE,
};

let fitScale = 1;
let nextFit = 0;
let fitCalls = 0;
const schoolStarted = performance.now();
for (let frame = 0; frame < FRAMES; frame += 1) {
  if (frame >= nextFit) {
    const fit = measureSchoolFit(
      requiredScales,
      positions,
      alive,
      FISH,
      target,
      forward,
      right,
      up,
      worldUp,
      fitOptions,
    );
    fitScale += (fit.scale - fitScale) * cameraDamping(SCHOOL_FIT_INTERVAL, SCHOOL_FIT_RESPONSE);
    nextFit += Math.max(1, Math.round(SCHOOL_FIT_INTERVAL * 60));
    fitCalls += 1;
  }
  offset.copy(forward).multiplyScalar(SCHOOL_LEAD_DISTANCE);
  computeSchoolCameraPose(
    outPosition,
    outTarget,
    target,
    offset.set(0, 0, 0),
    forward,
    right,
    worldUp,
    fitScale,
  );
}
const schoolMs = performance.now() - schoolStarted;

const predatorPosition = new Vector3(3, 6, -4);
const prey = new Vector3(-9, 5.4, 7);
const displacement = new Vector3();
const previousHeading = new Vector3(0, 0, 1);
const velocity = new Float32Array([2.4, -0.3, 0.6]);
const resultTarget = new Vector3();
const resultPosition = new Vector3();
const resultForward = new Vector3();
const frameState = new StableCameraFrame();
frameState.seed(new Vector3(0.2, 0.1, 0.97).normalize(), new Vector3(1, 0, 0), worldUp);
let predatorMs = 0;
for (let frame = 0; frame < FRAMES; frame += 1) {
  displacement.subVectors(prey, predatorPosition);
  const started = performance.now();
  const resolved = resolvePredatorForward(resultForward, displacement, velocity, previousHeading);
  frameState.update(resultForward);
  computePredatorCameraPose(
    resultPosition,
    resultTarget,
    predatorPosition,
    resultForward,
    frameState.right,
    worldUp,
    Math.min(5, Math.max(2.2, resolved.targetDistance === null ? 2.2 : resolved.targetDistance * 0.45)),
    resolved.targetDistance === null ? 14 : 13.5 + Math.min(6, resolved.targetDistance * 0.3),
    5.4,
    4.8,
    1,
    offset.set(0, 0, 0),
  );
  predatorMs += performance.now() - started;
}

console.log(`school frames=${FRAMES} fish=${FISH} fits=${fitCalls} total=${schoolMs.toFixed(2)}ms mean=${(schoolMs / FRAMES).toFixed(3)}ms/frame`);
console.log(`predator frames=${FRAMES} total=${predatorMs.toFixed(2)}ms mean=${(predatorMs / FRAMES).toFixed(3)}ms/frame`);
