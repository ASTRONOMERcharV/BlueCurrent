import {
  BufferGeometry,
  ClampToEdgeWrapping,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Contract for the six Blender-authored coral base assets, see
 * docs/ASSET_SPEC.md section 13. Each GLB is Y-up with its base on y = 0,
 * 1.5k-3.2k triangles, one material and no embedded images: all six share the
 * runtime atlas in public/textures.
 */
export const CORAL_SPECS = [
  { name: 'coral_branching', url: '/models/coral_branching.glb', minHeight: 1.05, maxHeight: 1.60 },
  { name: 'coral_table', url: '/models/coral_table.glb', minHeight: 0.40, maxHeight: 0.70 },
  { name: 'sponge_tube', url: '/models/sponge_tube.glb', minHeight: 0.85, maxHeight: 1.30 },
  { name: 'coral_fan', url: '/models/coral_fan.glb', minHeight: 0.90, maxHeight: 1.45 },
  { name: 'coral_brain', url: '/models/coral_brain.glb', minHeight: 0.50, maxHeight: 0.75 },
  { name: 'anemone', url: '/models/anemone.glb', minHeight: 0.65, maxHeight: 1.00 },
] as const;

export type CoralName = (typeof CORAL_SPECS)[number]['name'];
export type CoralSpec = (typeof CORAL_SPECS)[number];

/** Two low-profile species used by the default temperate composition. */
export const TEMPERATE_CORAL_SPECS: readonly CoralSpec[] = CORAL_SPECS.filter(
  (spec) => spec.name === 'coral_fan' || spec.name === 'coral_brain',
);

export interface CoralAssetStats {
  readonly name: CoralName;
  readonly url: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly materialCount: number;
  readonly hasUV: boolean;
  readonly hasNormal: boolean;
  readonly hasTangent: boolean;
}

export interface CoralAsset {
  readonly name: CoralName;
  readonly geometry: BufferGeometry;
  readonly stats: CoralAssetStats;
}

export interface CoralAtlas {
  readonly base: Texture;
  readonly normal: Texture;
  readonly roughness: Texture;
}

const MIN_TRIANGLES = 1500;
const MAX_TRIANGLES = 3200;
const BASE_TOLERANCE = 0.012;

function measure(spec: CoralSpec, geometry: BufferGeometry, materialCount: number): CoralAssetStats {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error(`${spec.name}: missing POSITION attribute`);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const index = geometry.getIndex();
  return {
    name: spec.name,
    url: spec.url,
    triangles: (index ? index.count : position.count) / 3,
    vertices: position.count,
    height: box.max.y - box.min.y,
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
    materialCount,
    hasUV: Boolean(geometry.getAttribute('uv')),
    hasNormal: Boolean(geometry.getAttribute('normal')),
    hasTangent: Boolean(geometry.getAttribute('tangent')),
  };
}

function validate(spec: CoralSpec, stats: CoralAssetStats, baseY: number, animations: number): void {
  const problems: string[] = [];
  if (stats.triangles < MIN_TRIANGLES || stats.triangles > MAX_TRIANGLES) {
    problems.push(`${stats.triangles} triangles outside ${MIN_TRIANGLES}-${MAX_TRIANGLES}`);
  }
  if (stats.height < spec.minHeight || stats.height > spec.maxHeight) {
    problems.push(`height ${stats.height.toFixed(3)} outside ${spec.minHeight}-${spec.maxHeight}`);
  }
  if (Math.abs(baseY) > BASE_TOLERANCE) {
    problems.push(`base y ${baseY.toFixed(4)} is not on 0`);
  }
  if (!stats.hasUV) problems.push('missing UV attribute');
  if (!stats.hasNormal) problems.push('missing NORMAL attribute');
  if (!stats.hasTangent) problems.push('missing TANGENT attribute');
  if (stats.materialCount !== 1) problems.push(`${stats.materialCount} materials (expected 1)`);
  if (animations > 0) problems.push(`${animations} animations (expected 0)`);
  if (problems.length > 0) {
    throw new Error(`coral asset ${spec.name} failed validation: ${problems.join('; ')}`);
  }
}

export async function loadCoralAsset(spec: CoralSpec): Promise<CoralAsset> {
  const gltf = await new GLTFLoader().loadAsync(spec.url);
  gltf.scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  if (meshes.length !== 1) {
    throw new Error(`${spec.name}: expected 1 mesh, found ${meshes.length}`);
  }
  const mesh = meshes[0];
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  const materialCount = Array.isArray(mesh.material) ? mesh.material.length : 1;
  const stats = measure(spec, geometry, materialCount);
  validate(spec, stats, geometry.boundingBox!.min.y, gltf.animations.length);
  return { name: spec.name, geometry, stats };
}

export async function loadCoralAssets(
  specs: readonly CoralSpec[] = CORAL_SPECS,
): Promise<CoralAsset[]> {
  return Promise.all(specs.map((spec) => loadCoralAsset(spec)));
}

/**
 * Load the shared 1024 atlas once. The maps are applied to the glTF-style UVs
 * baked by Blender, so flipY must stay false, exactly as GLTFLoader does for
 * embedded textures.
 */
export async function loadCoralAtlas(
  baseUrl = '/textures/coral_atlas_basecolor.jpg',
  normalUrl = '/textures/coral_atlas_normal.png',
  roughnessUrl = '/textures/coral_atlas_roughness.png',
): Promise<CoralAtlas> {
  const loader = new TextureLoader();
  const [base, normal, roughness] = await Promise.all([
    loader.loadAsync(baseUrl),
    loader.loadAsync(normalUrl),
    loader.loadAsync(roughnessUrl),
  ]);
  for (const texture of [base, normal, roughness]) {
    texture.flipY = false;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
  }
  base.colorSpace = SRGBColorSpace;
  normal.colorSpace = NoColorSpace;
  roughness.colorSpace = NoColorSpace;
  return { base, normal, roughness };
}

export function createCoralMaterial(atlas: CoralAtlas): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: atlas.base,
    normalMap: atlas.normal,
    roughnessMap: atlas.roughness,
    normalScale: new Vector2(0.85, 0.85),
    metalness: 0.0,
    roughness: 1.0,
  });
}
