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
import { CORAL_SPECS } from '../src/rendering/CoralAsset';
import type { CoralAsset } from '../src/rendering/CoralAsset';
import { CoralScatter, TEMPERATE_CORAL_NAMES } from '../src/rendering/CoralScatter';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';

function mockAssets(): CoralAsset[] {
  return CORAL_SPECS.map((spec) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    return {
      name: spec.name,
      geometry,
      stats: {
        name: spec.name,
        url: spec.url,
        triangles: 1,
        vertices: 3,
        height: 1,
        width: 1,
        depth: 1,
        materialCount: 1,
        hasUV: true,
        hasNormal: true,
        hasTangent: true,
      },
    };
  });
}

function instanceTransform(mesh: InstancedMesh, index: number): {
  position: Vector3;
  scale: Vector3;
} {
  const matrix = new Matrix4().fromArray(mesh.instanceMatrix.array, index * 16);
  const position = new Vector3();
  const scale = new Vector3();
  matrix.decompose(position, new Quaternion(), scale);
  return { position, scale };
}

describe('main-scene coral composition', () => {
  it('defaults to a restrained temperate layer with two species and 12 colonies', () => {
    const scatter = new CoralScatter(mockAssets(), new MeshStandardMaterial(), REEF_OBSTACLES);
    expect(scatter.mode).toBe('temperate');
    expect(scatter.meshCount).toBe(2);
    expect(scatter.instanceCount).toBe(12);
    expect(scatter.triangleCount).toBe(12);
    expect(scatter.group.children.map((child) => child.name)).toEqual(
      TEMPERATE_CORAL_NAMES.map((name) => `main_${name}`),
    );

    for (const child of scatter.group.children) {
      const mesh = child as InstancedMesh;
      expect(mesh.count).toBe(6);
      for (let index = 0; index < mesh.count; index += 1) {
        const { position, scale } = instanceTransform(mesh, index);
        // All colonies sit at a reef base or the two foreground accents.
        const nearReef = REEF_OBSTACLES.some((obstacle) => Math.hypot(
          position.x - obstacle.center[0],
          position.z - obstacle.center[2],
        ) < obstacle.radius * 1.2);
        expect(nearReef || position.z > 20).toBe(true);
        // 2026-11-10: reef colonies were scaled up so they read against the
        // 0.90-1.10 m fish; temperate stays smaller than the full tier.
        expect(scale.x).toBeGreaterThanOrEqual(0.75);
        expect(scale.x).toBeLessThanOrEqual(1.45);
      }
      // The sixth entry is the single foreground accent per species.
      const foreground = instanceTransform(mesh, mesh.count - 1);
      expect(foreground.position.z).toBeGreaterThan(20);
    }
  });

  it('keeps the original 48-colony show reef behind the explicit full tier', () => {
    const scatter = new CoralScatter(
      mockAssets(),
      new MeshStandardMaterial(),
      REEF_OBSTACLES,
      { mode: 'full' },
    );
    expect(scatter.mode).toBe('full');
    expect(scatter.meshCount).toBe(6);
    expect(scatter.instanceCount).toBe(48);
    expect(scatter.triangleCount).toBe(48);
    for (const child of scatter.group.children) {
      expect(child).toBeInstanceOf(InstancedMesh);
      expect((child as InstancedMesh).count).toBe(8);
      // Each species' eighth instance is its foreground colony beyond +Z = 20.
      const foreground = instanceTransform(child as InstancedMesh, 7);
      expect(foreground.position.z).toBeGreaterThan(20);
    }
  });

  it('keeps full-tier coral subordinate to the hero and low-reef silhouettes', () => {
    const scatter = new CoralScatter(
      mockAssets(),
      new MeshStandardMaterial(),
      REEF_OBSTACLES,
      { mode: 'full' },
    );
    const reefTotals = [0, 0, 0, 0, 0];
    for (const child of scatter.group.children) {
      const mesh = child as InstancedMesh;
      // The first five entries follow obstacle order: B / C / Hero / D / E.
      const reefScales = Array.from(
        { length: 5 },
        (_, index) => instanceTransform(mesh, index).scale.x,
      );
      reefScales.forEach((scale, index) => { reefTotals[index] += scale; });
      const foreground = instanceTransform(mesh, 7).scale.x;
      expect(foreground).toBeLessThan(reefScales[2]);
    }
    // Individual colonies retain natural size variation; the hierarchy is a
    // group-level constraint across all six species, not a forced equal size.
    expect(reefTotals[2]).toBeGreaterThan(reefTotals[1] * 1.4);
    expect(reefTotals[2]).toBeGreaterThan(reefTotals[4] * 1.3);
  });

  it('rejects a temperate composition without both required species', () => {
    const onlyFan = mockAssets().filter((asset) => asset.name === 'coral_fan');
    expect(() => new CoralScatter(
      onlyFan,
      new MeshStandardMaterial(),
      REEF_OBSTACLES,
    )).toThrow(/temperate coral composition/);
  });
});
