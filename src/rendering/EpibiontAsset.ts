import { Box3, BufferGeometry, Mesh, TextureLoader } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CoralName } from './CoralAsset';

/**
 * Simplified epibiont geometry set. Built by
 * assets_src/scripts/build_epibiont_lods.py from the six show-reef corals
 * (2.2k-2.9k tris) down to 620-780 tris. They share the coral atlas material.
 */

export interface EpibiontAsset {
  readonly name: CoralName;
  readonly geometry: BufferGeometry;
  readonly triangles: number;
}

const EPIBIONT_SPECS: readonly { name: CoralName; url: string; min: number; max: number }[] = [
  { name: 'coral_brain', url: '/models/reef/epibiont_coral_brain.glb', min: 500, max: 800 },
  { name: 'coral_table', url: '/models/reef/epibiont_coral_table.glb', min: 500, max: 800 },
  { name: 'coral_branching', url: '/models/reef/epibiont_coral_branching.glb', min: 650, max: 900 },
  { name: 'coral_fan', url: '/models/reef/epibiont_coral_fan.glb', min: 650, max: 900 },
  { name: 'sponge_tube', url: '/models/reef/epibiont_sponge_tube.glb', min: 500, max: 800 },
];

async function loadOne(spec: { name: CoralName; url: string; min: number; max: number }): Promise<EpibiontAsset> {
  const gltf = await new GLTFLoader().loadAsync(spec.url);
  if (gltf.animations.length > 0) {
    throw new Error(`${spec.url} unexpectedly contains animations.`);
  }
  gltf.scene.updateMatrixWorld(true);
  let mesh: Mesh | null = null;
  gltf.scene.traverse((object) => {
    if (!mesh && object instanceof Mesh) mesh = object;
  });
  if (!mesh) throw new Error(`${spec.url} contains no mesh.`);
  const source = mesh as Mesh;
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!position || !normal || !uv) {
    throw new Error(`${spec.url} is missing POSITION/NORMAL/TEXCOORD_0.`);
  }
  const index = geometry.getIndex();
  const triangles = (index ? index.count : position.count) / 3;
  if (triangles < spec.min || triangles > spec.max) {
    throw new Error(`${spec.url} has ${triangles} triangles, outside ${spec.min}-${spec.max}.`);
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new Box3();
  if (Math.abs(bounds.min.y) > 0.03) {
    throw new Error(`${spec.url} base is not on y=0 (${bounds.min.y.toFixed(4)}).`);
  }
  return { name: spec.name, geometry, triangles: Math.round(triangles) };
}

export async function loadEpibiontAssets(): Promise<EpibiontAsset[]> {
  return Promise.all(EPIBIONT_SPECS.map((spec) => loadOne(spec)));
}

/**
 * Fallback path for `?coral=off&reef=sample`: the epibionts still need the
 * shared coral atlas even when no decorative show corals are loaded.
 */
export async function loadEpibiontAtlas(baseUrl = '/textures/coral_atlas_basecolor.jpg') {
  return new TextureLoader().loadAsync(baseUrl);
}
