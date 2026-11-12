import { describe, expect, it } from 'vitest';
import { Bone, Group, MeshStandardMaterial, Quaternion, Scene, Skeleton, Vector3 } from 'three';
import { ObstacleSystem } from '../src/simulation/ObstacleSystem';
import { PredatorSystem } from '../src/simulation/PredatorSystem';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';
import { PredatorRenderer } from '../src/rendering/PredatorRenderer';
import type { PredatorRigAsset, PredatorRigStats } from '../src/rendering/PredatorRigAsset';
import type { PredatorRigBinding, PredatorRigBindings } from '../src/rendering/PredatorAnimationController';
import { wrapAngle } from '../src/rendering/PredatorAnimationController';

const SPINE_S = [0.02, 0.2, 0.35, 0.5, 0.64, 0.78, 0.9];
const FORWARD = new Vector3(0, 0, 1);

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

function makeAsset(rig: PredatorRigBindings): PredatorRigAsset {
  return {
    scene: new Group(),
    skinnedMeshes: [],
    skeleton: new Skeleton([new Bone()]),
    bones: new Map(),
    rig,
    materials: [new MeshStandardMaterial()],
    stats: { triangles: 0 } as unknown as PredatorRigStats,
  };
}

function createRenderer(): { predator: PredatorSystem; renderer: PredatorRenderer } {
  const predator = new PredatorSystem(createDefaultConfig(), new ObstacleSystem());
  predator.position.set([0, 10, 0]);
  predator.velocity.set([0, 0, 4]);
  predator.state = 'patrol';
  const renderer = new PredatorRenderer(new Scene(), predator, makeAsset(makeRig()));
  return { predator, renderer };
}

function yawOf(renderer: PredatorRenderer): number {
  FORWARD.set(0, 0, 1).applyQuaternion(renderer.group.quaternion);
  return Math.atan2(FORWARD.x, FORWARD.z);
}

describe('PredatorRenderer visibility', () => {
  it('does not hard-snap the rigged yaw when visibility resumes', () => {
    const { predator, renderer } = createRenderer();
    for (let i = 0; i < 30; i += 1) renderer.update(1, 1 / 60, true);
    const before = yawOf(renderer);

    // Hide at the old velocity, then reverse the velocity while hidden.
    for (let i = 0; i < 10; i += 1) renderer.update(1, 1 / 60, false);
    predator.velocity.set([0, 0, -4]);
    renderer.update(1, 1 / 60, false);
    renderer.update(1, 1 / 60, true);

    const after = yawOf(renderer);
    // Two 1/60 s updates inside the max yaw rate (4 rad/s); the old suspend()
    // path re-sampled and snapped the full π reversal in one frame.
    const limit = 4 * (2 / 60) + 1e-6;
    expect(Math.abs(wrapAngle(after - before))).toBeLessThanOrEqual(limit);
  });
});
