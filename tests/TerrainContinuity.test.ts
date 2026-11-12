import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import {
  CAMERA_FLOOR_CLEARANCE,
  CAMERA_TARGET_LIMIT_XZ,
  CAMERA_WORLD_RADIUS,
  TERRAIN_RADIUS,
  constrainCameraPosition,
  constrainCameraTarget,
  createSeabedGeometry,
  terrainHeightAt,
} from '../src/rendering/terrain';
import { generateTerrainDecor } from '../src/rendering/terrainDecor';

describe('continuous seabed', () => {
  it('preserves the accepted floor height inside the authored reef', () => {
    for (let x = -34; x <= 34; x += 4) {
      for (let z = -34; z <= 34; z += 4) {
        if (Math.hypot(x, z) > 33) continue;
        expect(terrainHeightAt(x, z)).toBe(floorHeightAt(x, z));
      }
    }
  });

  it('is continuous at the shelf transition', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const before = terrainHeightAt(Math.cos(angle) * 33.99, Math.sin(angle) * 33.99);
      const after = terrainHeightAt(Math.cos(angle) * 34.01, Math.sin(angle) * 34.01);
      expect(Math.abs(after - before)).toBeLessThan(0.005);
    }
  });

  it('drops the outer shelf without creating an abrupt step', () => {
    const inner = terrainHeightAt(40, 0);
    const outer = terrainHeightAt(300, 0);
    expect(outer).toBeLessThan(inner - 3);
    expect(Number.isFinite(outer)).toBe(true);
  });

  it('extends beyond the farthest camera plus far-plane reach', () => {
    expect(TERRAIN_RADIUS).toBeGreaterThan(CAMERA_TARGET_LIMIT_XZ + 90 + 400);
  });

  it('builds a wide, finite, upward-normal grid with vertex colours', () => {
    const geometry = createSeabedGeometry();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    expect(bounds).not.toBeNull();
    expect(bounds!.min.x).toBeLessThan(-300);
    expect(bounds!.max.x).toBeGreaterThan(300);
    expect(bounds!.min.z).toBeLessThan(-300);
    expect(bounds!.max.z).toBeGreaterThan(300);

    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const colors = geometry.getAttribute('color');
    expect(normals.count).toBe(positions.count);
    expect(colors.count).toBe(positions.count);
    for (let index = 0; index < positions.count; index += 97) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
      expect(normals.getY(index)).toBeGreaterThan(0);
      const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index));
      expect(length).toBeCloseTo(1, 6);
    }
  });
});

describe('camera world guard', () => {
  it('lifts a camera that would drill under the seabed', () => {
    const position = new Vector3(10, -20, 5);
    expect(constrainCameraPosition(position)).toBe(true);
    expect(position.y).toBeCloseTo(terrainHeightAt(10, 5) + CAMERA_FLOOR_CLEARANCE, 10);
  });

  it('leaves an allowed camera pose unchanged', () => {
    const position = new Vector3(20, 12, 30);
    expect(position.y).toBeGreaterThan(terrainHeightAt(20, 30) + CAMERA_FLOOR_CLEARANCE);
    expect(constrainCameraPosition(position)).toBe(false);
    expect(position.toArray()).toEqual([20, 12, 30]);
  });

  it('keeps the camera inside the generated world', () => {
    const position = new Vector3(CAMERA_WORLD_RADIUS + 50, 12, 0);
    expect(constrainCameraPosition(position)).toBe(true);
    expect(Math.hypot(position.x, position.z)).toBeCloseTo(CAMERA_WORLD_RADIUS, 8);
  });

  it('keeps free panning inside the reef bounds', () => {
    const target = new Vector3(80, -5, -90);
    expect(constrainCameraTarget(target)).toBe(true);
    expect(target.x).toBe(CAMERA_TARGET_LIMIT_XZ);
    expect(target.z).toBe(-CAMERA_TARGET_LIMIT_XZ);
    expect(target.y).toBeGreaterThan(0);
  });
});

describe('terrain decoration', () => {
  it('is deterministic and grounded in the extended terrain', () => {
    const first = generateTerrainDecor();
    const second = generateTerrainDecor();
    expect(first).toEqual(second);
    for (const instance of [...first.midground, ...first.far]) {
      expect(instance.y - instance.scaleY).toBeLessThan(terrainHeightAt(instance.x, instance.z));
    }
  });

  it('groups each distant echo into a larger anchor with lower companions', () => {
    const layout = generateTerrainDecor();
    expect(layout.midground).toHaveLength(10);
    expect(layout.far).toHaveLength(12);
    for (const [layer, maximumSpan] of [['midground', 14], ['far', 46]] as const) {
      const instances = layout[layer];
      for (let clusterIndex = 0; clusterIndex < 4; clusterIndex += 1) {
        const group = instances.filter((instance) => instance.clusterIndex === clusterIndex);
        expect(group.length).toBeGreaterThanOrEqual(2);
        const anchor = group[0];
        for (const companion of group.slice(1)) {
          expect(Math.hypot(companion.x - anchor.x, companion.z - anchor.z))
            .toBeLessThan(maximumSpan);
          expect(companion.scaleY).toBeLessThan(anchor.scaleY);
        }
      }
    }
  });

  it('uses a seed independent of the reef and simulation layouts', () => {
    const shifted = generateTerrainDecor(0x51ed7a4);
    expect(shifted).not.toEqual(generateTerrainDecor());
  });
});
