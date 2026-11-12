import {
  Box3,
  type Bone,
  BufferGeometry,
  Group,
  type Material,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createPredatorRigBindings,
  type PredatorRigBindings,
} from './PredatorAnimationController';

/**
 * Contract for the rigged shayu predator, see docs/PREDATOR_ANIMATION_ANALYSIS.md.
 * The GLB must be +Z forward, ~5.28 local units long, 3000-20000 triangles,
 * 3-4 materials (body plus mouth/teeth), one skin with the 11 named bones and
 * no animation clips. The runtime drives the bones procedurally.
 */
export interface PredatorRigStats {
  readonly url: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly materialCount: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly lengthZ: number;
  readonly boneCount: number;
  readonly boneNames: readonly string[];
  readonly weightedVertices: number;
  readonly maxInfluences: number;
  readonly tailWeightedVertices: number;
  readonly hasBaseColorMap: boolean;
  readonly hasNormalMap: boolean;
  readonly hasRoughnessMap: boolean;
  readonly bytes: number | null;
}

export interface PredatorRigAsset {
  readonly scene: Group;
  readonly skinnedMeshes: SkinnedMesh[];
  readonly skeleton: Skeleton;
  readonly bones: ReadonlyMap<string, Bone>;
  readonly rig: PredatorRigBindings;
  readonly materials: MeshStandardMaterial[];
  readonly stats: PredatorRigStats;
}

const MIN_TRIANGLES = 3000;
const MAX_TRIANGLES = 20000;
const TARGET_LENGTH = 5.28;
const LENGTH_TOLERANCE = 0.05;
const EXPECTED_BONES = [
  'Predator_Root',
  'Spine_00',
  'Spine_01',
  'Spine_02',
  'Spine_03',
  'Spine_04',
  'Spine_05',
  'Caudal_Peduncle',
  'Tail_Fin',
  'Pectoral_L_Root',
  'Pectoral_R_Root',
];

export function isPredatorRigAsset(asset: unknown): asset is PredatorRigAsset {
  return Boolean(
    asset
    && typeof asset === 'object'
    && 'rig' in asset
    && 'skeleton' in asset
    && 'skinnedMeshes' in asset,
  );
}

function asStandardMaterial(material: Material | Material[]): MeshStandardMaterial[] {
  const list = Array.isArray(material) ? material : [material];
  return list.map((entry) => {
    if (!(entry instanceof MeshStandardMaterial)) {
      throw new Error(`predator rig uses unsupported material ${entry.type}`);
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

function validateSkinGeometry(
  geometry: BufferGeometry,
  boneCount: number,
  problems: string[],
): { weightedVertices: number; maxInfluences: number; tailWeighted: number; tailZSum: number } {
  const skinWeight = geometry.getAttribute('skinWeight');
  const skinIndex = geometry.getAttribute('skinIndex');
  if (!skinWeight || !skinIndex) {
    problems.push('missing skinWeight/skinIndex');
    return { weightedVertices: 0, maxInfluences: 0, tailWeighted: 0, tailZSum: 0 };
  }
  let weightedVertices = 0;
  let maxInfluences = 0;
  let tailWeighted = 0;
  let tailZSum = 0;
  for (let i = 0; i < skinWeight.count; i += 1) {
    const weights = [
      skinWeight.getX(i),
      skinWeight.getY(i),
      skinWeight.getZ(i),
      skinWeight.getW(i),
    ];
    const sum = weights[0] + weights[1] + weights[2] + weights[3];
    if (Math.abs(sum - 1) > 0.01) {
      problems.push(`skin weights do not sum to 1 at vertex ${i} (${sum.toFixed(3)})`);
      break;
    }
    let influences = 0;
    for (let k = 0; k < 4; k += 1) {
      if (weights[k] > 0.0001) influences += 1;
    }
    maxInfluences = Math.max(maxInfluences, influences);
    const joints = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
    for (let k = 0; k < 4; k += 1) {
      if (joints[k] >= boneCount) {
        problems.push(`skin joint index ${joints[k]} out of range at vertex ${i}`);
        return { weightedVertices, maxInfluences, tailWeighted, tailZSum };
      }
    }
    weightedVertices += 1;
  }
  return { weightedVertices, maxInfluences, tailWeighted, tailZSum };
}

function validate(
  stats: PredatorRigStats,
  meshes: SkinnedMesh[],
  bones: ReadonlyMap<string, Bone>,
  kinematics: { weightedVertices: number; maxInfluences: number; tailWeighted: number; tailZSum: number },
  animations: number,
  problems: string[],
): void {
  if (stats.triangles < MIN_TRIANGLES) problems.push(`${stats.triangles} triangles < ${MIN_TRIANGLES}`);
  if (stats.triangles > MAX_TRIANGLES) problems.push(`${stats.triangles} triangles > ${MAX_TRIANGLES}`);
  const allowed = TARGET_LENGTH * LENGTH_TOLERANCE;
  if (Math.abs(stats.lengthZ - TARGET_LENGTH) > allowed) {
    problems.push(`length ${stats.lengthZ.toFixed(3)} outside ${TARGET_LENGTH} ± ${allowed.toFixed(3)}`);
  }
  if (stats.max[2] < 2.0 || stats.min[2] > -2.4) {
    problems.push(`forward axis not +Z (head ${stats.max[2].toFixed(3)}, tail ${stats.min[2].toFixed(3)})`);
  }
  if (meshes.length < 1 || meshes.length > 4) {
    problems.push(`${meshes.length} skinned meshes (expected 1-4)`);
  }
  if (stats.materialCount < 3 || stats.materialCount > 4) {
    problems.push(`${stats.materialCount} materials (expected 3-4)`);
  }
  for (const name of EXPECTED_BONES) {
    if (!bones.has(name)) problems.push(`missing bone ${name}`);
  }
  if (bones.size !== EXPECTED_BONES.length) {
    problems.push(`${bones.size} bones (expected ${EXPECTED_BONES.length})`);
  }
  const pectoralLeft = bones.get('Pectoral_L_Root');
  const pectoralRight = bones.get('Pectoral_R_Root');
  if (pectoralLeft?.parent?.name !== 'Spine_02') {
    problems.push('Pectoral_L_Root is not parented to Spine_02');
  }
  if (pectoralRight?.parent?.name !== 'Spine_02') {
    problems.push('Pectoral_R_Root is not parented to Spine_02');
  }
  if (bones.get('Tail_Fin')?.parent?.name !== 'Caudal_Peduncle') {
    problems.push('Tail_Fin is not parented to Caudal_Peduncle');
  }
  if (kinematics.weightedVertices === 0) problems.push('no weighted vertices');
  if (kinematics.maxInfluences > 4) {
    problems.push(`max influences ${kinematics.maxInfluences} > 4`);
  }
  if (kinematics.tailWeighted === 0) {
    problems.push('no vertices weighted to Tail_Fin');
  } else if (kinematics.tailZSum / kinematics.tailWeighted > -1.5) {
    problems.push('Tail_Fin weights are not at the caudal end');
  }
  if (animations > 0) problems.push(`${animations} glTF animations (expected 0)`);
}

/**
 * Load and validate the rigged Blender Predator. Throws on contract violations
 * so callers can fall back to the static shayu asset.
 */
export async function loadPredatorRigAsset(url: string): Promise<PredatorRigAsset> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  const skinnedMeshes: SkinnedMesh[] = [];
  const materials: MeshStandardMaterial[] = [];
  gltf.scene.traverse((object) => {
    if (!(object as SkinnedMesh).isSkinnedMesh) return;
    const mesh = object as SkinnedMesh;
    skinnedMeshes.push(mesh);
    mesh.frustumCulled = false;
    materials.push(...asStandardMaterial(mesh.material));
  });
  if (skinnedMeshes.length === 0) throw new Error('predator rig GLB contains no SkinnedMesh');

  const skeleton = skinnedMeshes[0].skeleton;
  const bones = new Map<string, Bone>();
  for (const bone of skeleton.bones) bones.set(bone.name, bone);

  // Bounding box in bind pose.
  const box = new Box3();
  let triangles = 0;
  let vertices = 0;
  let weightedVertices = 0;
  let maxInfluences = 0;
  let tailWeighted = 0;
  let tailZSum = 0;
  const problems: string[] = [];
  for (const mesh of skinnedMeshes) {
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    triangles += (index ? index.count : position.count) / 3;
    vertices += position.count;
    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      box.union(geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    const kinematics = validateSkinGeometry(geometry, skeleton.bones.length, problems);
    weightedVertices += kinematics.weightedVertices;
    maxInfluences = Math.max(maxInfluences, kinematics.maxInfluences);
    // Count Tail_Fin influence for the caudal-end sanity check.
    const skinWeight = geometry.getAttribute('skinWeight');
    const skinIndex = geometry.getAttribute('skinIndex');
    const tailIndex = skeleton.bones.findIndex((bone) => bone.name === 'Tail_Fin');
    if (skinWeight && skinIndex && tailIndex >= 0) {
      for (let i = 0; i < skinWeight.count; i += 1) {
        const joints = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
        const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
        for (let k = 0; k < 4; k += 1) {
          if (joints[k] === tailIndex && weights[k] > 0.5) {
            tailWeighted += 1;
            tailZSum += position.getZ(i);
          }
        }
      }
    }
  }

  const body = materials.find((material) => material.name === 'predator_body') ?? materials[0];
  const stats: PredatorRigStats = {
    url,
    triangles,
    vertices,
    materialCount: materials.length,
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    lengthZ: box.max.z - box.min.z,
    boneCount: skeleton.bones.length,
    boneNames: skeleton.bones.map((bone) => bone.name),
    weightedVertices,
    maxInfluences,
    tailWeightedVertices: tailWeighted,
    hasBaseColorMap: Boolean(body.map),
    hasNormalMap: Boolean(body.normalMap),
    hasRoughnessMap: Boolean(body.roughnessMap),
    bytes: await readContentLength(url),
  };
  if (!body?.map) problems.push('body material has no base color map');
  if (!body?.normalMap) problems.push('body material has no normal map');
  if (!body?.roughnessMap) problems.push('body material has no roughness map');

  validate(
    stats,
    skinnedMeshes,
    bones,
    { weightedVertices, maxInfluences, tailWeighted, tailZSum },
    gltf.animations.length,
    problems,
  );
  if (problems.length > 0) {
    throw new Error(`predator rig failed validation: ${problems.join('; ')}`);
  }

  // Bindings must be derived while the scene is still at the origin.
  const rig = createPredatorRigBindings(bones, stats.max[2], stats.lengthZ);
  return { scene: gltf.scene, skinnedMeshes, skeleton, bones, rig, materials, stats };
}
