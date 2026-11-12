import { describe, expect, it } from 'vitest';
import { Bone, Quaternion, Vector3 } from 'three';
import {
  DEFAULT_PREDATOR_RIG_CONFIG,
  MIN_HORIZONTAL_SPEED,
  PredatorAnimationController,
  predatorBankTarget,
  predatorBodyAmplitude,
  predatorBodyEnvelope,
  predatorPitchTarget,
  predatorSwimFrequency,
  wrapAngle,
  type PredatorRigBinding,
  type PredatorRigBindings,
} from '../src/rendering/PredatorAnimationController';

const SPINE_S = [0.02, 0.2, 0.35, 0.5, 0.64, 0.78, 0.9];

function makeBinding(s: number, axis = new Vector3(0, 1, 0)): PredatorRigBinding {
  return {
    bone: new Bone(),
    restQuaternion: new Quaternion(),
    bendAxis: axis.clone(),
    s,
  };
}

function makeRig(): PredatorRigBindings {
  return {
    spine: SPINE_S.map((s) => makeBinding(s)),
    tailFin: makeBinding(0.96),
    pectoralLeft: makeBinding(0, new Vector3(0, 0, 1)),
    pectoralRight: makeBinding(0, new Vector3(0, 0, 1)),
  };
}

function velocity(heading: number, pitch: number, speed: number): [number, number, number] {
  return [
    speed * Math.cos(pitch) * Math.sin(heading),
    speed * Math.sin(pitch),
    speed * Math.cos(pitch) * Math.cos(heading),
  ];
}

function angleOf(binding: PredatorRigBinding): number {
  return 2 * Math.atan2(
    Math.hypot(binding.bone.quaternion.x, binding.bone.quaternion.y, binding.bone.quaternion.z),
    Math.abs(binding.bone.quaternion.w),
  );
}

describe('predator swim parameter mapping', () => {
  it('raises tail-beat frequency smoothly with speed and attack', () => {
    const slow = predatorSwimFrequency(0.1, 0, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    const cruise = predatorSwimFrequency(0.4, 0, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    const fast = predatorSwimFrequency(1.0, 0, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    const attack = predatorSwimFrequency(0.4, 1, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    expect(slow).toBeGreaterThan(0.5);
    expect(cruise).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(cruise);
    expect(attack).toBeGreaterThan(cruise);
  });

  it('keeps the front body stiff and grows the amplitude toward the tail', () => {
    const front = predatorBodyEnvelope(0.1, DEFAULT_PREDATOR_RIG_CONFIG);
    const middle = predatorBodyEnvelope(0.55, DEFAULT_PREDATOR_RIG_CONFIG);
    const tail = predatorBodyEnvelope(1.0, DEFAULT_PREDATOR_RIG_CONFIG);
    expect(front).toBe(0);
    expect(middle).toBeGreaterThan(0);
    expect(tail).toBeGreaterThan(middle);
    expect(tail).toBeCloseTo(1, 6);
  });

  it('raises swim amplitude with speed, attack and thrust', () => {
    const slow = predatorBodyAmplitude(0.1, 0, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    const fast = predatorBodyAmplitude(1.0, 0, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    const attack = predatorBodyAmplitude(0.1, 1, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    expect(fast).toBeGreaterThan(slow);
    expect(attack).toBeGreaterThan(slow);
  });

  it('holds pitch when horizontal speed is too low to be meaningful', () => {
    const held = predatorPitchTarget(5, 0.1, 0.3, DEFAULT_PREDATOR_RIG_CONFIG);
    expect(held).toBeCloseTo(0.3, 8);
    const pitched = predatorPitchTarget(2, 2, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    expect(pitched).toBeCloseTo(Math.PI / 4, 6);
    const clamped = predatorPitchTarget(100, 1, 0, DEFAULT_PREDATOR_RIG_CONFIG);
    expect(clamped).toBeCloseTo(DEFAULT_PREDATOR_RIG_CONFIG.pitchLimit, 6);
  });

  it('banks into the turn and clamps the angle', () => {
    expect(predatorBankTarget(1, 1, DEFAULT_PREDATOR_RIG_CONFIG)).toBeLessThan(0);
    expect(predatorBankTarget(-1, 1, DEFAULT_PREDATOR_RIG_CONFIG)).toBeGreaterThan(0);
    expect(Math.abs(predatorBankTarget(100, 1, DEFAULT_PREDATOR_RIG_CONFIG)))
      .toBeCloseTo(DEFAULT_PREDATOR_RIG_CONFIG.bankMax, 6);
  });
});

describe('PredatorAnimationController', () => {
  it('integrates a continuous phase and never resets it on a state change', () => {
    const controller = new PredatorAnimationController(makeRig());
    const v = velocity(0, 0, 3);
    for (let i = 0; i < 60; i += 1) controller.update(1 / 60, v, 'patrol');
    const before = controller.phase;
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 60; i += 1) controller.update(1 / 60, v, 'patrol');
    const cruise = controller.phase;
    expect(cruise).toBeGreaterThan(before);
    controller.update(1 / 60, v, 'attack');
    expect(controller.phase).toBeGreaterThan(cruise);
    expect(controller.attack).toBeGreaterThan(0);
  });

  it('starts each frame from the rest pose instead of accumulating rotations', () => {
    const rig = makeRig();
    const controller = new PredatorAnimationController(rig);
    const v = velocity(0, 0, 4);
    controller.update(0, v, 'patrol');
    const first = rig.tailFin.bone.quaternion.clone();
    for (let i = 0; i < 100; i += 1) controller.update(0, v, 'patrol');
    expect(rig.tailFin.bone.quaternion.angleTo(first)).toBeLessThan(1e-6);
    expect(angleOf(rig.tailFin)).toBeLessThanOrEqual(DEFAULT_PREDATOR_RIG_CONFIG.tailFinAmplitude + 0.2);
  });

  it('limits the pitch rate during a sudden vertical velocity change', () => {
    const controller = new PredatorAnimationController(makeRig());
    controller.update(1 / 60, velocity(0, 0, 4), 'patrol');
    const before = controller.pitch;
    controller.update(0.1, [2, 4, 0], 'pursuit');
    const step = Math.abs(controller.pitch - before);
    expect(step).toBeLessThanOrEqual(DEFAULT_PREDATOR_RIG_CONFIG.maxPitchRate * 0.1 + 1e-6);
    expect(controller.pitch).toBeGreaterThan(before);
    expect(Number.isFinite(controller.pitch)).toBe(true);
    const forward = new Vector3(0, 0, 1).applyQuaternion(controller.rootQuaternion);
    expect(forward.y).toBeGreaterThan(0);
  });

  it('holds yaw through near-vertical noise instead of flipping ±π', () => {
    const controller = new PredatorAnimationController(makeRig());
    controller.update(1 / 60, velocity(0.6, 0, 3), 'search');
    const settled = controller.yaw;

    for (let i = 0; i < 240; i += 1) {
      // Total speed stays high while the horizontal part is only noise, which
      // is exactly the search-state singularity that used to flip atan2 ±π.
      const noise = (i % 2 === 0 ? 1 : -1) * (MIN_HORIZONTAL_SPEED * 0.25);
      controller.update(1 / 60, [noise, -3, noise * 0.5], 'search');
      expect(Math.abs(wrapAngle(controller.yaw - settled))).toBeLessThan(1e-6);
    }
    expect(Math.abs(controller.turn)).toBeLessThan(0.05);

    // A real horizontal heading is still followed after the hold.
    for (let i = 0; i < 120; i += 1) {
      controller.update(1 / 60, velocity(-1.2, 0, 3), 'search');
    }
    expect(Math.abs(wrapAngle(controller.yaw - (-1.2)))).toBeLessThan(0.05);
  });

  it('bends the body into a left turn and mirrors it for a right turn', () => {
    const left = new PredatorAnimationController(makeRig());
    for (let i = 0; i < 30; i += 1) {
      left.update(1 / 60, velocity((Math.PI / 2) * (i / 29), 0, 3), 'patrol');
    }
    expect(left.turn).toBeGreaterThan(0);
    expect(left.bank).toBeLessThan(0);
    expect(left.tailTurn).toBeGreaterThan(0);

    const right = new PredatorAnimationController(makeRig());
    for (let i = 0; i < 30; i += 1) {
      right.update(1 / 60, velocity(-(Math.PI / 2) * (i / 29), 0, 3), 'patrol');
    }
    expect(right.turn).toBeLessThan(0);
    expect(right.bank).toBeGreaterThan(0);
    expect(right.tailTurn).toBeLessThan(0);

    // Delta-yaw angle sign is accessible through the root forward vector.
    const forward = new Vector3(0, 0, 1).applyQuaternion(left.rootQuaternion);
    expect(forward.x).toBeGreaterThan(0);
    const rightForward = new Vector3(0, 0, 1).applyQuaternion(right.rootQuaternion);
    expect(rightForward.x).toBeLessThan(0);
  });

  it('raises both pectorals for a climb and lowers them for a dive', () => {
    const upRig = makeRig();
    const up = new PredatorAnimationController(upRig);
    const climb = velocity(0, 0.4, 4);
    for (let i = 0; i < 120; i += 1) up.update(1 / 60, climb, 'patrol');
    expect(upRig.pectoralLeft.bone.quaternion.z).toBeGreaterThan(0.01);
    expect(upRig.pectoralRight.bone.quaternion.z).toBeLessThan(-0.01);

    const downRig = makeRig();
    const down = new PredatorAnimationController(downRig);
    const dive = velocity(0, -0.4, 4);
    for (let i = 0; i < 120; i += 1) down.update(1 / 60, dive, 'patrol');
    expect(downRig.pectoralLeft.bone.quaternion.z).toBeLessThan(-0.01);
    expect(downRig.pectoralRight.bone.quaternion.z).toBeGreaterThan(0.01);
    expect(down.pitch).toBeLessThan(0);
  });

  it('produces a unit root quaternion and finite pose throughout', () => {
    const controller = new PredatorAnimationController(makeRig());
    for (let i = 0; i < 120; i += 1) {
      const t = i / 60;
      controller.update(1 / 60, velocity(Math.sin(t), Math.sin(t * 2) * 0.3, 2 + t), 'pursuit');
    }
    const pose = controller.readPose();
    for (const value of Object.values(pose)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(controller.rootQuaternion.length()).toBeCloseTo(1, 6);
  });
});
