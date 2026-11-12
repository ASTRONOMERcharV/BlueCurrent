import {
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Material,
  type Object3D,
  type Texture,
} from 'three';

export interface MaterialColorSpaceIssue {
  readonly material: string;
  readonly slot: string;
  readonly expected: string;
  readonly actual: string;
}

function inspect(
  issues: MaterialColorSpaceIssue[],
  material: MeshStandardMaterial,
  slot: string,
  texture: Texture | null,
  expected: string,
): void {
  if (texture && texture.colorSpace !== expected) {
    issues.push({
      material: material.name || material.uuid,
      slot,
      expected,
      actual: texture.colorSpace,
    });
  }
}

/** Audit loaded PBR maps without changing them or inventing missing metadata. */
export function auditMaterialColorSpaces(root: Object3D): MaterialColorSpaceIssue[] {
  const issues: MaterialColorSpaceIssue[] = [];
  const visited = new Set<Material>();
  root.traverse((object) => {
    const candidate = object as unknown as { material?: Material | Material[] };
    if (!candidate.material) return;
    const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
    for (const material of materials) {
      if (visited.has(material) || !(material instanceof MeshStandardMaterial)) continue;
      visited.add(material);
      inspect(issues, material, 'map', material.map, SRGBColorSpace);
      inspect(issues, material, 'emissiveMap', material.emissiveMap, SRGBColorSpace);
      inspect(issues, material, 'normalMap', material.normalMap, NoColorSpace);
      inspect(issues, material, 'roughnessMap', material.roughnessMap, NoColorSpace);
      inspect(issues, material, 'metalnessMap', material.metalnessMap, NoColorSpace);
      inspect(issues, material, 'aoMap', material.aoMap, NoColorSpace);
    }
  });
  return issues;
}
