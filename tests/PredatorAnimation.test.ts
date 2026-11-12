import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import type { PredatorSystem } from '../src/simulation/PredatorSystem';
import {
  PredatorRenderer,
  predatorBankForYawRate,
  predatorSpineBendAngle,
  predatorTurnForYawRate,
} from '../src/rendering/PredatorRenderer';

describe('predator turn animation', () => {
  it('banks the dorsal side into a left turn', () => {
    // Positive yaw turns toward local +X (the shark's left), so the roll
    // around local +Z must be negative to tip the back toward the turn.
    expect(predatorBankForYawRate(1)).toBeCloseTo(-0.22, 5);
    expect(predatorBankForYawRate(-1)).toBeCloseTo(0.22, 5);
  });

  it('clamps the bank to a believable maximum', () => {
    expect(predatorBankForYawRate(10)).toBeCloseTo(-0.6, 5);
    expect(predatorBankForYawRate(-10)).toBeCloseTo(0.6, 5);
  });

  it('maps yaw rate onto the normalized body C-bend input', () => {
    expect(predatorTurnForYawRate(0.9)).toBeCloseTo(0.5, 5);
    expect(predatorTurnForYawRate(-0.9)).toBeCloseTo(-0.5, 5);
    expect(predatorTurnForYawRate(4)).toBeCloseTo(1, 5);
    expect(predatorTurnForYawRate(-4)).toBeCloseTo(-1, 5);
  });

  it('keeps the head fixed and bends the tail into a flexible follow-through', () => {
    expect(predatorSpineBendAngle(0, 1, 0)).toBeCloseTo(0, 8);
    expect(predatorSpineBendAngle(1, 1, 1)).toBeCloseTo(-0.38, 5);
    expect(predatorSpineBendAngle(1, -1, -1)).toBeCloseTo(0.38, 5);
    expect(predatorSpineBendAngle(0.5, 0, 0)).toBeCloseTo(0, 8);
  });

  it('lets the tail lag behind a new turn instead of rotating rigidly', () => {
    const body = predatorSpineBendAngle(0.55, 1, 0);
    const tailAtTurnStart = predatorSpineBendAngle(1, 1, 0);
    const tailAfterFollowing = predatorSpineBendAngle(1, 1, 1);
    expect(body).toBeLessThan(0);
    expect(tailAtTurnStart).toBeCloseTo(0, 8);
    expect(Math.abs(tailAfterFollowing)).toBeGreaterThan(Math.abs(body));
  });

  it('holds an old tail turn briefly after the head starts straightening', () => {
    expect(predatorSpineBendAngle(1, 0, 0.6)).toBeCloseTo(-0.228, 5);
    expect(predatorSpineBendAngle(0.18, 0, 0.6)).toBeCloseTo(0, 8);
  });

  it('smooths a 90-degree velocity snap and delays the tail response', () => {
    const predator = {
      position: new Float32Array(3),
      previousPosition: new Float32Array(3),
      velocity: new Float32Array([0, 0, 4]),
      state: 'pursuit',
    } as unknown as PredatorSystem;
    const renderer = new PredatorRenderer(new Scene(), predator);
    renderer.update(1, 1 / 60, true);

    predator.velocity.set([4, 0, 0]);
    renderer.update(1, 0.1, true);
    const forward = new Vector3(0, 0, 1).applyQuaternion(renderer.group.quaternion);
    expect(forward.x).toBeGreaterThan(0.5);
    expect(forward.x).toBeLessThan(0.95);
    expect(forward.z).toBeGreaterThan(0.2);
    expect(renderer.turnFactor).toBeGreaterThan(0);
    expect(renderer.tailTurnFactor).toBeGreaterThan(0);
    expect(Math.abs(renderer.tailTurnFactor)).toBeLessThan(Math.abs(renderer.turnFactor));

    predator.velocity.set([0, 0, 4]);
    renderer.update(1, 0.1, true);
    expect(renderer.tailTurnFactor).toBeGreaterThan(renderer.turnFactor);
  });
});
