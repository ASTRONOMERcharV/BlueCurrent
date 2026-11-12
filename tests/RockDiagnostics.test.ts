import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  collectRockDiagnostics,
  type RockTarget,
} from '../src/rendering/lighting/RockDiagnostics';

function target(
  object: Mesh,
  category: RockTarget['category'] = 'rock-scatter-large',
): RockTarget {
  return { object, category, label: category };
}

function sphere(material: MeshStandardMaterial, radius = 1): Mesh {
  const geometry = new SphereGeometry(radius, 8, 6);
  return new Mesh(geometry, material);
}

describe('RockDiagnostics', () => {
  it('reports an outward-facing, unit-normal sphere and its material gates', () => {
    const material = new MeshStandardMaterial({
      name: 'rock_atlas',
      map: Object.assign(new Texture(), { colorSpace: SRGBColorSpace }),
      normalMap: Object.assign(new Texture(), { colorSpace: NoColorSpace }),
      roughness: 0.93,
      metalness: 0,
    });
    const mesh = sphere(material);
    mesh.name = 'reef_large_a';

    const report = collectRockDiagnostics([target(mesh)]);
    const rock = report.objects[0];

    expect(rock.category).toBe('rock-scatter-large');
    expect(rock.geometry.hasNormal).toBe(true);
    expect(rock.geometry.normalCount).toBe(rock.geometry.vertices);
    expect(rock.geometry.orientation).toBe('outward');
    expect(rock.geometry.outwardFraction).toBeGreaterThan(0.95);
    expect(rock.geometry.normalUnitFraction).toBe(1);
    expect(rock.materials[0].sideName).toBe('front');
    expect(rock.materials[0].maps.map.ok).toBe(true);
    expect(rock.materials[0].maps.map.colorSpace).toBe('srgb');
    expect(rock.materials[0].maps.normalMap.ok).toBe(true);
    expect(rock.materials[0].maps.normalMap.colorSpace).toBe('none');
    expect(rock.flags).toEqual([]);
    expect(report.summary.anomalyCount).toBe(0);
    expect(report.summary.triangles).toBeGreaterThan(0);
  });

  it('flags a missing normal attribute instead of inventing normals', () => {
    const mesh = sphere(new MeshStandardMaterial());
    mesh.geometry.deleteAttribute('normal');

    const report = collectRockDiagnostics([target(mesh)]);
    const rock = report.objects[0];

    expect(rock.geometry.hasNormal).toBe(false);
    expect(rock.geometry.orientation).toBe('unknown');
    expect(rock.flags).toContain('geometry:missing-normal');
    expect(report.summary.missingNormals).toBe(1);
  });

  it('detects inward-facing normals as a material/geometry defect', () => {
    const mesh = sphere(new MeshStandardMaterial());
    const normal = mesh.geometry.getAttribute('normal');
    for (let index = 0; index < normal.count; index += 1) {
      normal.setXYZ(index, -normal.getX(index), -normal.getY(index), -normal.getZ(index));
    }

    const report = collectRockDiagnostics([target(mesh)]);
    const rock = report.objects[0];

    expect(rock.geometry.orientation).toBe('inward');
    expect(rock.geometry.outwardFraction).toBeLessThan(0.05);
    expect(rock.flags).toContain('geometry:normals-inward');
  });

  it('detects negative and zero-scale instance matrices', () => {
    const geometry = new SphereGeometry(1, 8, 6);
    const mesh = new InstancedMesh(geometry, new MeshStandardMaterial(), 2);
    mesh.name = 'glb_reef_large_a';
    mesh.setMatrixAt(0, new Matrix4().makeScale(-1, 1, 1));
    mesh.setMatrixAt(1, new Matrix4().makeScale(0, 0, 0));

    const report = collectRockDiagnostics([target(mesh)]);
    const rock = report.objects[0];

    expect(rock.instances?.count).toBe(2);
    expect(rock.instances?.negativeScale).toBe(1);
    expect(rock.instances?.zeroScale).toBe(1);
    expect(rock.instances?.minDeterminant).toBe(-1);
    expect(rock.instances?.maxDeterminant).toBe(0);
    expect(rock.flags).toContain('transform:negative-instance-scale');
    expect(rock.flags).toContain('transform:zero-scale-instances');
    expect(report.summary.negativeDeterminants).toBe(1);
    expect(report.summary.zeroScaleInstances).toBe(1);
  });

  it('flags a dark instance tint on lit reef rock', () => {
    const geometry = new SphereGeometry(1, 8, 6);
    const mesh = new InstancedMesh(geometry, new MeshStandardMaterial(), 2);
    mesh.setColorAt(0, new Color(0x050505));
    mesh.setColorAt(1, new Color(0xb8d1de));

    const report = collectRockDiagnostics([target(mesh)]);
    const rock = report.objects[0];

    expect(rock.instances?.tint.present).toBe(true);
    expect(rock.instances?.tint.darkInstances).toBe(1);
    expect(rock.instances?.tint.minColor).toBe('050505');
    expect(rock.flags).toContain('tint:dark-instances');
    expect(report.summary.darkInstanceTints).toBe(1);
  });

  it('does not flag intentional dark tints on far decorative terrain', () => {
    const geometry = new SphereGeometry(1, 8, 6);
    const mesh = new InstancedMesh(geometry, new MeshStandardMaterial(), 1);
    mesh.setColorAt(0, new Color(0x0a2d39));

    const report = collectRockDiagnostics([target(mesh, 'terrain-decor-far')]);
    const rock = report.objects[0];

    expect(rock.instances?.tint.darkInstances).toBe(1);
    expect(rock.flags).not.toContain('tint:dark-instances');
  });

  it('reports double-sided, transparent and wrong-colorspace maps', () => {
    const material = new MeshStandardMaterial({
      side: DoubleSide,
      transparent: true,
      map: Object.assign(new Texture(), { colorSpace: NoColorSpace }),
      normalMap: Object.assign(new Texture(), { colorSpace: SRGBColorSpace }),
    });
    const mesh = sphere(material);

    const report = collectRockDiagnostics([target(mesh)]);
    const rock = report.objects[0];

    expect(rock.flags).toContain('material:double-sided');
    expect(rock.flags).toContain('material:transparent');
    expect(rock.flags).toContain('material:map-color-space');
    expect(rock.flags).toContain('material:normal-map-color-space');
    expect(report.summary.doubleSided).toBe(1);
    expect(report.summary.transparent).toBe(1);
    expect(report.summary.colorSpaceIssues).toBe(2);
  });

  it('reports negative world scale on a single mesh', () => {
    const mesh = sphere(new MeshStandardMaterial());
    mesh.scale.set(-1, 1, 1);

    const report = collectRockDiagnostics([target(mesh)]);

    expect(report.objects[0].worldDeterminant).toBeLessThan(0);
    expect(report.objects[0].flags).toContain('transform:negative-world-scale');
    expect(report.summary.negativeDeterminants).toBe(1);
  });
});
