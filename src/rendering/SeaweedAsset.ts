import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Vector2,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Contract for the user-supplied detail seaweed clump, see
 * docs/ASSET_SPEC.md section 17. It is a single Y-up mesh, 1.2 m tall, one
 * double-sided textured material (base color + normal + metallic-roughness),
 * 13.8k triangles and no animations. Sway uses `_SWAYWEIGHT` (per-leaf base to
 * tip) plus `_BLADEPHASE` (one phase per connected leaf component).
 */
export const SEAWEED_SPEC = {
  name: 'seaweed_detail',
  url: '/models/seaweed_detail.glb',
  minHeight: 1.0,
  maxHeight: 1.5,
  minTriangles: 10_000,
  maxTriangles: 20_000,
  amplitude: 0.15,
  frequency: 1.05,
} as const;

export interface SeaweedAssetStats {
  readonly name: string;
  readonly url: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly materialCount: number;
  readonly maps: number;
  readonly hasNormal: boolean;
  readonly hasTangent: boolean;
  readonly hasSwayWeight: boolean;
  readonly hasBladePhase: boolean;
}

export interface SeaweedAsset {
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
  readonly stats: SeaweedAssetStats;
}

const BASE_TOLERANCE = 0.02;

function readAttribute(geometry: BufferGeometry, names: readonly string[]): BufferAttribute | undefined {
  for (const name of names) {
    const attribute = geometry.getAttribute(name);
    if (attribute) return attribute as BufferAttribute;
  }
  return undefined;
}

function validate(
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  animations: number,
): SeaweedAssetStats {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('seaweed_detail: missing POSITION attribute');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const index = geometry.getIndex();
  const materialCount = 1;
  const maps = [material.map, material.normalMap, material.roughnessMap].filter(Boolean).length;
  const stats: SeaweedAssetStats = {
    name: SEAWEED_SPEC.name,
    url: SEAWEED_SPEC.url,
    triangles: (index ? index.count : position.count) / 3,
    vertices: position.count,
    height: box.max.y - box.min.y,
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
    materialCount,
    maps,
    hasNormal: Boolean(geometry.getAttribute('normal')),
    hasTangent: Boolean(geometry.getAttribute('tangent')),
    hasSwayWeight: Boolean(readAttribute(geometry, ['aSwayWeight', '_swayweight', '_SWAYWEIGHT'])),
    hasBladePhase: Boolean(readAttribute(geometry, ['aBladePhase', '_bladephase', '_BLADEPHASE'])),
  };

  const problems: string[] = [];
  if (stats.triangles < SEAWEED_SPEC.minTriangles || stats.triangles > SEAWEED_SPEC.maxTriangles) {
    problems.push(`${stats.triangles} triangles outside ${SEAWEED_SPEC.minTriangles}-${SEAWEED_SPEC.maxTriangles}`);
  }
  if (stats.height < SEAWEED_SPEC.minHeight || stats.height > SEAWEED_SPEC.maxHeight) {
    problems.push(`height ${stats.height.toFixed(3)} outside ${SEAWEED_SPEC.minHeight}-${SEAWEED_SPEC.maxHeight}`);
  }
  if (Math.abs(box.min.y) > BASE_TOLERANCE) {
    problems.push(`base y ${box.min.y.toFixed(4)} is not on 0`);
  }
  if (!stats.hasNormal) problems.push('missing NORMAL attribute');
  if (!stats.hasTangent) problems.push('missing TANGENT attribute');
  if (!stats.hasSwayWeight) problems.push('missing sway-weight attribute');
  if (!stats.hasBladePhase) problems.push('missing blade-phase attribute');
  if (stats.maps !== 3) problems.push(`${stats.maps} PBR maps (expected base color + normal + roughness)`);
  if (animations > 0) problems.push(`${animations} animations (expected 0)`);
  if (problems.length > 0) {
    throw new Error(`seaweed_detail failed validation: ${problems.join('; ')}`);
  }
  return stats;
}

export async function loadSeaweedAsset(url = SEAWEED_SPEC.url): Promise<SeaweedAsset> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  if (meshes.length !== 1) {
    throw new Error(`seaweed_detail: expected 1 mesh, found ${meshes.length}`);
  }
  const mesh = meshes[0];
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();

  const sway = readAttribute(geometry, ['_swayweight', '_SWAYWEIGHT', 'aSwayWeight']);
  const bladePhase = readAttribute(geometry, ['_bladephase', '_BLADEPHASE', 'aBladePhase']);
  if (sway) geometry.setAttribute('aSwayWeight', sway);
  if (bladePhase) geometry.setAttribute('aBladePhase', bladePhase);
  for (const stale of ['_swayweight', '_SWAYWEIGHT', '_bladephase', '_BLADEPHASE']) {
    geometry.deleteAttribute(stale);
  }

  const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!(sourceMaterial instanceof MeshStandardMaterial)) {
    throw new Error('seaweed_detail: expected a MeshStandardMaterial');
  }
  const material = sourceMaterial.clone();
  material.side = DoubleSide;
  material.color.setRGB(1.0, 1.0, 1.0);
  material.metalness = 0.0;
  material.roughness = 1.0;
  material.normalScale = new Vector2(0.9, 0.9);
  material.flatShading = false;
  material.needsUpdate = true;

  const stats = validate(geometry, material, gltf.animations.length);
  return { geometry, material, stats };
}
