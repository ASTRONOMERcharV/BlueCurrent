import {
  Box3,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads the three hero reef LODs and the dedicated 1024 texture set produced by
 * assets_src/scripts/{build,bake,finalize,compose}_reef_sample*.py.
 *
 * The near mesh is the authored 8k-15k structure; mid and far are decimations
 * of the same surface with the same UVs. All three share one material, so the
 * LOD switch changes geometry only, never material identity.
 */

export type ReefSampleLodName = 'near' | 'mid' | 'far';

const LOD_SPECS: Record<ReefSampleLodName, { url: string; min: number; max: number }> = {
  near: { url: '/models/reef/reef_sample_near.glb', min: 8000, max: 15000 },
  mid: { url: '/models/reef/reef_sample_mid.glb', min: 2000, max: 5000 },
  far: { url: '/models/reef/reef_sample_far.glb', min: 300, max: 1000 },
};

export const REEF_SAMPLE_LOD_ORDER: readonly ReefSampleLodName[] = ['near', 'mid', 'far'];

export interface ReefSampleLod {
  readonly name: ReefSampleLodName;
  readonly geometry: BufferGeometry;
  readonly triangles: number;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
}

export interface ReefSampleTextures {
  readonly basecolor: Texture;
  readonly normal: Texture;
  readonly ao: Texture;
  readonly roughness: Texture;
}

export interface ReefSampleStats {
  readonly lods: Record<ReefSampleLodName, number>;
  readonly trianglesTotal: number;
  readonly textures: number;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
}

export interface ReefSampleAssets {
  readonly lods: ReadonlyMap<ReefSampleLodName, ReefSampleLod>;
  readonly material: MeshStandardMaterial;
  readonly textures: ReefSampleTextures;
  readonly stats: ReefSampleStats;
  dispose(): void;
}

function measure(name: ReefSampleLodName, geometry: BufferGeometry, prefix: string): ReefSampleLod {
  const spec = LOD_SPECS[name];
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!position || !normal || !uv) {
    throw new Error(`${prefix}_${name}.glb is missing POSITION/NORMAL/TEXCOORD_0.`);
  }
  const index = geometry.getIndex();
  const triangles = (index ? index.count : position.count) / 3;
  if (triangles < spec.min || triangles > spec.max) {
    throw new Error(`${prefix}_${name}.glb has ${triangles} triangles, outside ${spec.min}-${spec.max}.`);
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new Box3();
  if (Math.abs(bounds.min.y) > 0.03) {
    throw new Error(`${prefix}_${name}.glb base is not on y=0 (${bounds.min.y.toFixed(4)}).`);
  }
  return {
    name,
    geometry,
    triangles: Math.round(triangles),
    height: bounds.max.y - bounds.min.y,
    width: bounds.max.x - bounds.min.x,
    depth: bounds.max.z - bounds.min.z,
  };
}

async function loadLod(name: ReefSampleLodName, basePath: string, prefix: string): Promise<ReefSampleLod> {
  const gltf = await new GLTFLoader().loadAsync(`${basePath}/${prefix}_${name}.glb`);
  if (gltf.animations.length > 0) {
    throw new Error(`${prefix}_${name}.glb unexpectedly contains animations.`);
  }
  gltf.scene.updateMatrixWorld(true);
  let mesh: Mesh | null = null;
  gltf.scene.traverse((object) => {
    if (!mesh && object instanceof Mesh) mesh = object;
  });
  if (!mesh) throw new Error(`${prefix}_${name}.glb contains no mesh.`);
  const source = mesh as Mesh;
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  return measure(name, geometry, prefix);
}

function loadTextures(basePath: string, prefix: string): Promise<ReefSampleTextures> {
  const loader = new TextureLoader();
  return Promise.all([
    loader.loadAsync(`${basePath}/${prefix}_basecolor.jpg`),
    loader.loadAsync(`${basePath}/${prefix}_normal.png`),
    loader.loadAsync(`${basePath}/${prefix}_ao.png`),
    loader.loadAsync(`${basePath}/${prefix}_roughness.png`),
  ]).then(([basecolor, normal, ao, roughness]) => {
    // glTF UVs carry the Blender flip, exactly as the coral atlas does.
    for (const texture of [basecolor, normal, ao, roughness]) {
      texture.flipY = false;
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.needsUpdate = true;
    }
    basecolor.colorSpace = SRGBColorSpace;
    normal.colorSpace = NoColorSpace;
    ao.colorSpace = NoColorSpace;
    roughness.colorSpace = NoColorSpace;
    // Three's aoMap defaults to UV channel 1; the GLB only has TEXCOORD_0.
    ao.channel = 0;
    roughness.channel = 0;
    return { basecolor, normal, ao, roughness };
  });
}

export function createReefSampleMaterial(textures: ReefSampleTextures): MeshStandardMaterial {
  return new MeshStandardMaterial({
    name: 'reef_sample_atlas',
    map: textures.basecolor,
    normalMap: textures.normal,
    aoMap: textures.ao,
    roughnessMap: textures.roughness,
    normalScale: new Vector2(1.0, 1.0),
    aoMapIntensity: 0.72,
    metalness: 0,
    roughness: 1,
    // Slightly cool the neutral limestone so it sits in the blue-green water.
    color: new Color(0xf1f7f4),
  });
}

export async function loadReefSampleAssets(
  assetPrefix = 'reef_sample',
  modelBase = '/models/reef',
  textureBase = '/textures',
): Promise<ReefSampleAssets> {
  const [near, mid, far, textures] = await Promise.all([
    loadLod('near', modelBase, assetPrefix),
    loadLod('mid', modelBase, assetPrefix),
    loadLod('far', modelBase, assetPrefix),
    loadTextures(textureBase, assetPrefix),
  ]);
  const lods = new Map<ReefSampleLodName, ReefSampleLod>([
    ['near', near],
    ['mid', mid],
    ['far', far],
  ]);
  const material = createReefSampleMaterial(textures);
  const trianglesTotal = near.triangles + mid.triangles + far.triangles;
  return {
    lods,
    material,
    textures,
    stats: {
      lods: { near: near.triangles, mid: mid.triangles, far: far.triangles },
      trianglesTotal,
      textures: 4,
      height: near.height,
      width: near.width,
      depth: near.depth,
    },
    dispose(): void {
      for (const lod of lods.values()) lod.geometry.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
      material.dispose();
    },
  };
}
