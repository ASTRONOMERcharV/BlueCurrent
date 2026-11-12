import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { KELP_SPECS } from '../src/rendering/KelpAsset';
import type { KelpAsset } from '../src/rendering/KelpAsset';
import { KelpScatter } from '../src/rendering/KelpScatter';
import { generateKelpLayout } from '../src/rendering/kelpPlacement';
import type { KelpPlacement } from '../src/rendering/kelpPlacement';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

function mockKelpAssets(): KelpAsset[] {
  return KELP_SPECS.map((spec) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    return {
      name: spec.name,
      geometry,
      material: new MeshStandardMaterial(),
      stats: {
        name: spec.name,
        url: spec.url,
        triangles: 1,
        vertices: 3,
        height: 3,
        width: 1,
        depth: 1,
        materialCount: 1,
        hasNormal: true,
        hasSwayWeight: true,
        hasBladePhase: true,
      },
    };
  });
}

interface PredatorProbe {
  findNearest(flock: SimulationWorld['flock'], radius: number): number;
}

function findNearest(world: SimulationWorld, radius: number): number {
  return (world.predator as unknown as PredatorProbe).findNearest(world.flock, radius);
}

function onePlantLayout(x = 0, z = 0, scale = 2): KelpPlacement[] {
  return [{
    name: 'kelp_a',
    band: 'midground',
    side: 'left',
    x,
    y: 0,
    z,
    yaw: 0,
    tiltX: 0,
    tiltZ: 0,
    scale,
    phase: 0,
    frequency: 1,
    amplitude: 1,
    tint: 0,
  }];
}

describe('kelp layout sharing', () => {
  it('uses the exact deterministic layout in simulation and rendering', () => {
    const world = new SimulationWorld();
    const expected = generateKelpLayout(REEF_OBSTACLES);
    expect(world.kelpLayout).toEqual(expected);
    expect(world.kelpRefuge.cylinders).toHaveLength(expected.length);

    const scatter = new KelpScatter(mockKelpAssets(), world.kelpLayout);
    for (const asset of KELP_SPECS) {
      const mesh = scatter.group.getObjectByName(`glb_${asset.name}`) as InstancedMesh;
      expect(mesh).toBeInstanceOf(InstancedMesh);
      const entries = world.kelpLayout.filter((placement) => placement.name === asset.name);
      expect(mesh.count).toBe(entries.length);
      const position = new Vector3();
      const scale = new Vector3();
      entries.forEach((entry, index) => {
        const matrix = new Matrix4().fromArray(mesh.instanceMatrix.array, index * 16);
        matrix.decompose(position, new Quaternion(), scale);
        expect(position.x).toBeCloseTo(entry.x, 5);
        expect(position.y).toBeCloseTo(entry.y, 5);
        expect(position.z).toBeCloseTo(entry.z, 5);
        expect(scale.x).toBeCloseTo(entry.scale, 5);
      });
    }
  });

  it('accepts an explicit layout without regenerating it', () => {
    const layout = onePlantLayout(3, -2, 1.25);
    const world = new SimulationWorld(layout);
    expect(world.kelpLayout).toBe(layout);
    expect(world.kelpRefuge.cylinders[0].x).toBe(3);
    expect(world.kelpRefuge.cylinders[0].z).toBe(-2);
    expect(world.kelpRefuge.cylinders[0].radius).toBeCloseTo(1.29315 * 1.25 * 0.8, 6);
  });
});

describe('kelp fear and shelter response', () => {
  it('cuts direct fear when the predator sight line crosses kelp', () => {
    const world = new SimulationWorld(onePlantLayout());
    world.setFishCount(2);
    world.flock.alive.fill(0, 2);
    world.flock.aliveCount = 2;
    world.config.predatorEnabled = true;
    world.config.evasionRadius = 16;
    world.predator.position.set([0, 3, -6]);
    world.predator.velocity.set([0, 0, 0]);
    world.predator.state = 'patrol';
    // Fish 0 is behind the kelp cylinder; fish 1 is in clear water.
    world.flock.positions.set([0, 3, 6], 0);
    world.flock.positions.set([6, 3, 0], 3);

    world.step();
    const shelteredFear = world.flock.fear[0];
    const exposedFear = world.flock.fear[1];
    expect(exposedFear).toBeGreaterThan(0.3);
    expect(shelteredFear).toBeGreaterThan(0);
    expect(shelteredFear).toBeLessThan(exposedFear * 0.5);
  });

  it('counts only fish whose measured cover exceeds the threshold', () => {
    const world = new SimulationWorld(onePlantLayout());
    world.setFishCount(2);
    world.flock.alive.fill(0, 2);
    world.flock.aliveCount = 2;
    world.config.predatorEnabled = false;
    const edgeDistance = world.kelpRefuge.cylinders[0].radius * 0.95;
    world.flock.positions.set([0, 2, 0], 0);
    world.flock.positions.set([edgeDistance, 2, 0], 3);

    expect(world.kelpRefuge.coverAt(0, 2, 0)).toBe(1);
    const edgeCover = world.kelpRefuge.coverAt(edgeDistance, 2, 0);
    expect(edgeCover).toBeGreaterThan(0);
    expect(edgeCover).toBeLessThan(world.config.kelpCoverThreshold);
    world.step();
    expect(world.metrics.shelteredCount).toBe(1);
    expect(world.boids.shelterSeekingCount).toBe(0);
  });

  it('does not seek kelp during undisturbed schooling', () => {
    const world = new SimulationWorld(onePlantLayout());
    world.setFishCount(60);
    world.config.predatorEnabled = false;
    for (let step = 0; step < 30; step += 1) world.step();
    expect(world.boids.shelterSeekingCount).toBe(0);
  });
});

describe('predator kelp occlusion', () => {
  it('skips a closer fish that is fully hidden behind kelp', () => {
    const world = new SimulationWorld(onePlantLayout());
    world.setFishCount(2);
    world.flock.alive.fill(0, 2);
    world.flock.aliveCount = 2;
    world.predator.position.set([0, 3, -6]);
    world.flock.positions.set([0, 3, 6], 0);
    world.flock.positions.set([10, 3, -6], 3);

    expect(findNearest(world, 20)).toBe(1);
  });

  it('still allows close-range targeting through kelp', () => {
    const world = new SimulationWorld(onePlantLayout());
    world.setFishCount(2);
    world.flock.alive.fill(0, 2);
    world.flock.aliveCount = 2;
    world.config.kelpOcclusionMinDistance = 3;
    world.predator.position.set([0, 3, 1]);
    world.flock.positions.set([0, 3, 3], 0);
    world.flock.positions.set([10, 3, -6], 3);

    expect(findNearest(world, 20)).toBe(0);
  });

  it('does not turn kelp into an absolute safe zone at capture range', () => {
    const world = new SimulationWorld(onePlantLayout());
    world.setFishCount(1);
    world.flock.alive.fill(0, 1);
    world.flock.aliveCount = 1;
    world.config.predatorEnabled = true;
    world.flock.positions.set([0, 3, 0], 0);
    world.predator.position.set([0, 3, 0.5]);
    world.predator.velocity.set([0, 0, 0]);
    world.predator.state = 'attack';
    world.predator.targetIndex = 0;

    // The prey is inside the kelp cylinder and the predator is within real
    // capture range; the physical strike still resolves.
    expect(world.kelpRefuge.coverAt(0, 3, 0)).toBeGreaterThan(0.9);
    world.predator.update(world.config.fixedDelta, world.flock);
    expect(world.predator.captures).toBe(1);
    expect(world.flock.aliveCount).toBe(0);
  });
});

describe('kelp refuge determinism', () => {
  it('keeps grid and brute-force trajectories equal with kelp active', () => {
    const gridWorld = new SimulationWorld();
    const bruteWorld = new SimulationWorld();
    gridWorld.setFishCount(150);
    bruteWorld.setFishCount(150);
    bruteWorld.setSearchMode('brute-force');
    gridWorld.releasePredator();
    bruteWorld.releasePredator();

    for (let step = 0; step < 90; step += 1) {
      gridWorld.step();
      bruteWorld.step();
    }

    for (let index = 0; index < gridWorld.flock.count * 3; index += 1) {
      expect(Math.abs(gridWorld.flock.positions[index] - bruteWorld.flock.positions[index]))
        .toBeLessThan(1e-5);
      expect(Math.abs(gridWorld.flock.velocities[index] - bruteWorld.flock.velocities[index]))
        .toBeLessThan(1e-5);
    }
    expect(gridWorld.metrics.shelteredCount).toBe(bruteWorld.metrics.shelteredCount);
    expect(gridWorld.metrics.threatenedCount).toBe(bruteWorld.metrics.threatenedCount);
  });
});
