import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Contract for the Blender-authored School Fish, see docs/ASSET_SPEC.md.
 * The GLB must be +Z forward, ~1.65 local units long, <= 1500 triangles and
 * carry a per-vertex `_TAILWEIGHT` float attribute.
 */
export interface FishAssetStats {
  readonly url: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly materialCount: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly lengthZ: number;
  readonly hasTailWeights: boolean;
  readonly tailWeightMin: number;
  readonly tailWeightMax: number;
  readonly bytes: number | null;
}

export interface FishAsset {
  readonly geometry: BufferGeometry;
  readonly materials: MeshStandardMaterial[];
  readonly stats: FishAssetStats;
}

export interface FishAssetContract {
  readonly minTriangles?: number;
  readonly maxTriangles?: number;
  readonly targetLength?: number;
  readonly lengthTolerance?: number;
  readonly maxMaterials?: number;
}

export const SCHOOL_FISH_CONTRACT: Required<FishAssetContract> = {
  minTriangles: 500,
  maxTriangles: 1500,
  targetLength: 1.65,
  lengthTolerance: 0.05,
  maxMaterials: 2,
};

export const CLOWNFISH_CONTRACT: Required<FishAssetContract> = {
  minTriangles: 1600,
  maxTriangles: 5000,
  targetLength: 1.0,
  lengthTolerance: 0.05,
  maxMaterials: 1,
};

function asStandardMaterial(material: Material | Material[]): MeshStandardMaterial[] {
  const list = Array.isArray(material) ? material : [material];
  return list.map((entry) => {
    if (!(entry instanceof MeshStandardMaterial)) {
      throw new Error(`fish asset uses unsupported material ${entry.type}`);
    }
    return entry;
  });
}

async function readContentLength(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const length = response.headers.get('content-length');
    return length ? Number(length) : null;
  } catch {
    return null;
  }
}

function measureStatistics(
  url: string,
  geometry: BufferGeometry,
  materialCount: number,
  bytes: number | null,
): FishAssetStats {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('fish asset has no POSITION attribute');
  const index = geometry.getIndex();
  const triangles = (index ? index.count : position.count) / 3;
  const tailWeights = geometry.getAttribute('aTailWeight');
  let tailWeightMin = 0;
  let tailWeightMax = 0;
  if (tailWeights) {
    tailWeightMin = Infinity;
    tailWeightMax = -Infinity;
    for (let i = 0; i < tailWeights.count; i += 1) {
      const value = tailWeights.getX(i);
      if (value < tailWeightMin) tailWeightMin = value;
      if (value > tailWeightMax) tailWeightMax = value;
    }
  }
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const lengthZ = box.max.z - box.min.z;
  const stats: FishAssetStats = {
    url,
    triangles,
    vertices: position.count,
    materialCount,
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    lengthZ,
    hasTailWeights: Boolean(tailWeights),
    tailWeightMin,
    tailWeightMax,
    bytes,
  };
  return stats;
}

function validate(
  geometry: BufferGeometry,
  stats: FishAssetStats,
  animations: number,
  contract: Required<FishAssetContract>,
): void {
  const problems: string[] = [];
  if (stats.triangles > contract.maxTriangles) {
    problems.push(`${stats.triangles} triangles > ${contract.maxTriangles}`);
  }
  if (stats.triangles < contract.minTriangles) {
    problems.push(`${stats.triangles} triangles < ${contract.minTriangles}`);
  }
  const allowed = contract.targetLength * contract.lengthTolerance;
  if (Math.abs(stats.lengthZ - contract.targetLength) > allowed) {
    problems.push(
      `length ${stats.lengthZ.toFixed(3)} outside ${contract.targetLength} ± ${allowed.toFixed(3)}`,
    );
  }
  const forwardMinimum = contract.targetLength * 0.3;
  if (stats.max[2] < forwardMinimum || stats.min[2] > -forwardMinimum) {
    problems.push(`forward axis not +Z (head ${stats.max[2].toFixed(3)}, tail ${stats.min[2].toFixed(3)})`);
  }
  if (!stats.hasTailWeights) problems.push('missing aTailWeight attribute');
  if (!geometry.getAttribute('normal')) problems.push('missing NORMAL attribute');
  if (!geometry.getAttribute('uv')) problems.push('missing UV attribute');
  if (stats.materialCount < 1 || stats.materialCount > contract.maxMaterials) {
    problems.push(`${stats.materialCount} materials (expected 1-${contract.maxMaterials})`);
  }
  if (animations > 0) problems.push(`${animations} glTF animations (expected 0)`);

  // The fully weighted vertices must live at the tail end.
  const tailWeights = geometry.getAttribute('aTailWeight');
  if (tailWeights) {
    const position = geometry.getAttribute('position');
    let tailSum = 0;
    let tailCount = 0;
    for (let i = 0; i < tailWeights.count; i += 1) {
      if (tailWeights.getX(i) > 0.9) {
        tailSum += position.getZ(i);
        tailCount += 1;
      }
    }
    if (tailCount > 0 && tailSum / tailCount > -contract.targetLength * 0.3) {
      problems.push('tail weights are not concentrated at -Z');
    }
  }

  if (problems.length > 0) {
    throw new Error(`fish asset failed validation: ${problems.join('; ')}`);
  }
}

/**
 * Load and validate a Blender fish asset. Throws on contract violations so
 * callers can fall back to the procedural geometry.
 */
export async function loadFishAsset(
  url: string,
  contractOverride: FishAssetContract = {},
): Promise<FishAsset> {
  const contract: Required<FishAssetContract> = { ...SCHOOL_FISH_CONTRACT, ...contractOverride };
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  if (meshes.length === 0) throw new Error('fish GLB contains no mesh');

  let geometry: BufferGeometry;
  let materials: MeshStandardMaterial[];
  if (meshes.length === 1 && Array.isArray(meshes[0].material)) {
    geometry = meshes[0].geometry;
    materials = asStandardMaterial(meshes[0].material);
  } else {
    const geometries: BufferGeometry[] = [];
    materials = [];
    for (const mesh of meshes) {
      const clone = mesh.geometry.clone();
      clone.applyMatrix4(mesh.matrixWorld);
      geometries.push(clone);
      materials.push(...asStandardMaterial(mesh.material));
    }
    const merged = mergeGeometries(geometries, true);
    for (const clone of geometries) clone.dispose();
    if (!merged) throw new Error('could not merge fish GLB primitives');
    geometry = merged;
  }

  // GLTFLoader lowercases unknown glTF attribute names: _TAILWEIGHT becomes
  // _tailweight. Rename it to a stable Three.js attribute for the shader.
  for (const key of Object.keys(geometry.attributes)) {
    if (key.toLowerCase() === '_tailweight') {
      const attribute = geometry.getAttribute(key);
      geometry.deleteAttribute(key);
      geometry.setAttribute('aTailWeight', attribute);
      break;
    }
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const bytes = await readContentLength(url);
  const stats = measureStatistics(url, geometry, materials.length, bytes);
  validate(geometry, stats, gltf.animations.length, contract);
  return { geometry, materials, stats };
}
