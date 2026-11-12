import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Contract for the Blender-authored Predator, see docs/ASSET_SPEC.md
 * section 12. The GLB must be +Z forward, ~5.28 local units long,
 * 3000-20000 triangles, 3-4 materials (body plus eye/mouth/teeth) and carry
 * a per-vertex `_TAILWEIGHT` float attribute for the body undulation shader.
 */
export interface PredatorAssetStats {
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
  readonly hasJawWeights: boolean;
  readonly jawWeightMin: number;
  readonly jawWeightMax: number;
  readonly hasBaseColorMap: boolean;
  readonly hasNormalMap: boolean;
  readonly hasRoughnessMap: boolean;
  readonly bytes: number | null;
}

export interface PredatorAsset {
  readonly geometry: BufferGeometry;
  readonly materials: MeshStandardMaterial[];
  readonly stats: PredatorAssetStats;
}

const MIN_TRIANGLES = 3000;
const MAX_TRIANGLES = 20000;
const TARGET_LENGTH = 5.28;
const LENGTH_TOLERANCE = 0.05;

function asStandardMaterial(material: Material | Material[]): MeshStandardMaterial[] {
  const list = Array.isArray(material) ? material : [material];
  return list.map((entry) => {
    if (!(entry instanceof MeshStandardMaterial)) {
      throw new Error(`predator asset uses unsupported material ${entry.type}`);
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
  materials: MeshStandardMaterial[],
  bytes: number | null,
): PredatorAssetStats {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('predator asset has no POSITION attribute');
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
  const jawWeights = geometry.getAttribute('aJawWeight');
  let jawWeightMin = 0;
  let jawWeightMax = 0;
  if (jawWeights) {
    jawWeightMin = Infinity;
    jawWeightMax = -Infinity;
    for (let i = 0; i < jawWeights.count; i += 1) {
      const value = jawWeights.getX(i);
      if (value < jawWeightMin) jawWeightMin = value;
      if (value > jawWeightMax) jawWeightMax = value;
    }
  }
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const body = materials.find((material) => material.name === 'predator_body') ?? materials[0];
  return {
    url,
    triangles,
    vertices: position.count,
    materialCount: materials.length,
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    lengthZ: box.max.z - box.min.z,
    hasTailWeights: Boolean(tailWeights),
    tailWeightMin,
    tailWeightMax,
    hasJawWeights: Boolean(jawWeights),
    jawWeightMin,
    jawWeightMax,
    hasBaseColorMap: Boolean(body.map),
    hasNormalMap: Boolean(body.normalMap),
    hasRoughnessMap: Boolean(body.roughnessMap),
    bytes,
  };
}

function validate(
  geometry: BufferGeometry,
  stats: PredatorAssetStats,
  body: MeshStandardMaterial | undefined,
  animations: number,
): void {
  const problems: string[] = [];
  if (stats.triangles < MIN_TRIANGLES) problems.push(`${stats.triangles} triangles < ${MIN_TRIANGLES}`);
  if (stats.triangles > MAX_TRIANGLES) problems.push(`${stats.triangles} triangles > ${MAX_TRIANGLES}`);
  const allowed = TARGET_LENGTH * LENGTH_TOLERANCE;
  if (Math.abs(stats.lengthZ - TARGET_LENGTH) > allowed) {
    problems.push(`length ${stats.lengthZ.toFixed(3)} outside ${TARGET_LENGTH} ± ${allowed.toFixed(3)}`);
  }
  if (stats.max[2] < 2.0 || stats.min[2] > -2.4) {
    problems.push(`forward axis not +Z (head ${stats.max[2].toFixed(3)}, tail ${stats.min[2].toFixed(3)})`);
  }
  if (!stats.hasTailWeights) problems.push('missing aTailWeight attribute');
  if (stats.tailWeightMin < -0.001 || stats.tailWeightMax > 1.001) {
    problems.push(`tail weights outside [0,1]: ${stats.tailWeightMin}..${stats.tailWeightMax}`);
  }
  if (stats.hasJawWeights && (stats.jawWeightMin < -0.001 || stats.jawWeightMax > 1.001)) {
    problems.push(`jaw weights outside [0,1]: ${stats.jawWeightMin}..${stats.jawWeightMax}`);
  }
  if (!geometry.getAttribute('normal')) problems.push('missing NORMAL attribute');
  if (!geometry.getAttribute('uv')) problems.push('missing UV attribute');
  if (stats.materialCount < 3 || stats.materialCount > 4) {
    problems.push(`${stats.materialCount} materials (expected 3-4)`);
  }
  if (body && body.name !== 'predator_body') problems.push('missing predator_body material');
  if (!body?.map) problems.push('body material has no base color map');
  if (!body?.normalMap) problems.push('body material has no normal map');
  if (!body?.roughnessMap) problems.push('body material has no roughness map');
  if (animations > 0) problems.push(`${animations} glTF animations (expected 0)`);

  // The fully weighted vertices must live at the caudal end.
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
    if (tailCount > 0 && tailSum / tailCount > -1.5) {
      problems.push('tail weights are not concentrated at -Z');
    }
  }

  if (problems.length > 0) {
    throw new Error(`predator asset failed validation: ${problems.join('; ')}`);
  }
}

/**
 * Load and validate the Blender Predator. Throws on contract violations so
 * callers can fall back to the procedural predator.
 */
export async function loadPredatorAsset(url: string): Promise<PredatorAsset> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  if (meshes.length === 0) throw new Error('predator GLB contains no mesh');

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
    if (!merged) throw new Error('could not merge predator GLB primitives');
    geometry = merged;
  }

  // GLTFLoader lowercases unknown glTF attribute names: _TAILWEIGHT becomes
  // _tailweight. Rename it to a stable Three.js attribute for the shader.
  for (const key of Object.keys(geometry.attributes)) {
    const lower = key.toLowerCase();
    if (lower !== '_tailweight' && lower !== '_jaw') continue;
    const attribute = geometry.getAttribute(key);
    geometry.deleteAttribute(key);
    geometry.setAttribute(lower === '_tailweight' ? 'aTailWeight' : 'aJawWeight', attribute);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const bytes = await readContentLength(url);
  const stats = measureStatistics(url, geometry, materials, bytes);
  validate(geometry, stats, materials[0], gltf.animations.length);
  return { geometry, materials, stats };
}
