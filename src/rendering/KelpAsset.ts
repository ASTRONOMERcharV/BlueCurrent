import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Contract for the two Blender-authored kelp base assets, see
 * docs/ASSET_SPEC.md section 15. Each GLB is Y-up with its base on y = 0,
 * 2-4 m tall, <= 200 triangles, one double-sided material and no embedded
 * images/animations. Sway is a vertex shader driven by `_SWAYWEIGHT` and
 * `_BLADEPHASE`, never by bones.
 */
export const KELP_SPECS = [
  {
    name: 'kelp_a',
    url: '/models/kelp_a.glb',
    minHeight: 3.0,
    maxHeight: 4.0,
    amplitude: 0.38,
    frequency: 1.35,
  },
  {
    name: 'kelp_b',
    url: '/models/kelp_b.glb',
    minHeight: 2.0,
    maxHeight: 3.0,
    amplitude: 0.30,
    frequency: 1.55,
  },
] as const;

export type KelpName = (typeof KELP_SPECS)[number]['name'];
export type KelpSpec = (typeof KELP_SPECS)[number];

export interface KelpAssetStats {
  readonly name: KelpName;
  readonly url: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly materialCount: number;
  readonly hasNormal: boolean;
  readonly hasSwayWeight: boolean;
  readonly hasBladePhase: boolean;
}

export interface KelpAsset {
  readonly name: KelpName;
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
  readonly stats: KelpAssetStats;
}

const MIN_TRIANGLES = 100;
const MAX_TRIANGLES = 200;
const BASE_TOLERANCE = 0.02;

function readAttribute(geometry: BufferGeometry, names: readonly string[]): BufferAttribute | undefined {
  for (const name of names) {
    const attribute = geometry.getAttribute(name);
    if (attribute) return attribute as BufferAttribute;
  }
  return undefined;
}

function measure(spec: KelpSpec, geometry: BufferGeometry, materialCount: number): KelpAssetStats {
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
    hasNormal: Boolean(geometry.getAttribute('normal')),
    hasSwayWeight: Boolean(readAttribute(geometry, ['aSwayWeight', '_swayweight', '_SWAYWEIGHT'])),
    hasBladePhase: Boolean(readAttribute(geometry, ['aBladePhase', '_bladephase', '_BLADEPHASE'])),
  };
}

function validate(spec: KelpSpec, stats: KelpAssetStats, baseY: number, animations: number): void {
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
  if (!stats.hasNormal) problems.push('missing NORMAL attribute');
  if (!stats.hasSwayWeight) problems.push('missing sway-weight attribute');
  if (!stats.hasBladePhase) problems.push('missing blade-phase attribute');
  if (stats.materialCount !== 1) problems.push(`${stats.materialCount} materials (expected 1)`);
  if (animations > 0) problems.push(`${animations} animations (expected 0)`);
  if (problems.length > 0) {
    throw new Error(`kelp asset ${spec.name} failed validation: ${problems.join('; ')}`);
  }
}

export async function loadKelpAsset(spec: KelpSpec): Promise<KelpAsset> {
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

  // GLTFLoader lowercases custom attributes; normalise them once so the
  // shader can use stable names.
  const sway = readAttribute(geometry, ['_swayweight', '_SWAYWEIGHT', 'aSwayWeight']);
  const bladePhase = readAttribute(geometry, ['_bladephase', '_BLADEPHASE', 'aBladePhase']);
  if (sway) geometry.setAttribute('aSwayWeight', sway);
  if (bladePhase) geometry.setAttribute('aBladePhase', bladePhase);
  for (const stale of ['_swayweight', '_SWAYWEIGHT', '_bladephase', '_BLADEPHASE']) {
    if (stale !== 'aSwayWeight' && stale !== 'aBladePhase') geometry.deleteAttribute(stale);
  }

  const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!(sourceMaterial instanceof MeshStandardMaterial)) {
    throw new Error(`${spec.name}: expected a MeshStandardMaterial`);
  }
  const material = sourceMaterial.clone();
  material.side = DoubleSide;
  material.color.setRGB(0.42, 0.56, 0.36);
  material.roughness = 0.84;
  material.metalness = 0.0;
  material.flatShading = false;
  material.needsUpdate = true;

  const stats = measure(spec, geometry, Array.isArray(mesh.material) ? mesh.material.length : 1);
  validate(spec, stats, geometry.boundingBox!.min.y, gltf.animations.length);
  return { name: spec.name, geometry, material, stats };
}

export async function loadKelpAssets(): Promise<KelpAsset[]> {
  return Promise.all(KELP_SPECS.map((spec) => loadKelpAsset(spec)));
}
