import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type BufferGeometry,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ROCK_DIMENSIONS, ROCK_NAMES, type RockName } from './rockPlacement';

/**
 * Loads the 13 rock/dune GLBs and the shared 2048 atlas.
 *
 * The GLBs are deliberately texture-free (see assets_src/scripts/finalize_rocks.py):
 * one atlas serves all assets and one material instance serves every instance of
 * a category, so the whole set adds 13 instanced draw calls and 3 textures.
 */

const TRIANGLE_BUDGET: Record<RockName, readonly [number, number]> = {
  reef_large_a: [900, 1300],
  reef_large_b: [1000, 1400],
  reef_large_c: [900, 1300],
  reef_medium_a: [400, 700],
  reef_medium_b: [400, 700],
  reef_medium_c: [500, 800],
  reef_medium_d: [450, 750],
  reef_debris_a: [150, 300],
  reef_debris_b: [120, 240],
  reef_debris_c: [140, 260],
  reef_debris_d: [150, 280],
  seabed_dune_a: [600, 1000],
  seabed_dune_b: [550, 900],
};

export interface RockAssetStats {
  readonly triangles: number;
  readonly assets: number;
  readonly textures: number;
}

export interface RockAssets {
  readonly geometries: ReadonlyMap<RockName, BufferGeometry>;
  readonly rockMaterial: MeshStandardMaterial;
  readonly duneMaterial: MeshStandardMaterial;
  readonly stats: RockAssetStats;
  dispose(): void;
}

function loadAtlasTextures(basePath: string): Promise<[Texture, Texture, Texture]> {
  const loader = new TextureLoader();
  return Promise.all([
    loader.loadAsync(`${basePath}_basecolor.jpg`),
    loader.loadAsync(`${basePath}_normal.png`),
    loader.loadAsync(`${basePath}_ao.png`),
  ]).then(([baseColor, normal, ao]) => {
    // glTF UVs use a top-left texture origin and are exported with V flipped
    // relative to Blender. Loading with the three.js default (flipY = true)
    // would sample the atlas upside down (wrong tile for every asset).
    baseColor.flipY = false;
    normal.flipY = false;
    ao.flipY = false;
    baseColor.colorSpace = SRGBColorSpace;
    normal.colorSpace = NoColorSpace;
    ao.colorSpace = NoColorSpace;
    ao.channel = 0;
    return [baseColor, normal, ao] as [Texture, Texture, Texture];
  });
}

function validateGeometry(name: RockName, geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!position || !normal || !uv) {
    throw new Error(`${name}.glb is missing POSITION/NORMAL/TEXCOORD_0.`);
  }
  const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3;
  const [minimum, maximum] = TRIANGLE_BUDGET[name];
  if (triangles < minimum || triangles > maximum) {
    throw new Error(`${name}.glb has ${triangles} triangles, outside ${minimum}-${maximum}.`);
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new Box3();
  const height = bounds.max.y - bounds.min.y;
  const expected = ROCK_DIMENSIONS[name].height;
  if (Math.abs(bounds.min.y) > 0.02) {
    throw new Error(`${name}.glb base is not on y=0 (${bounds.min.y.toFixed(4)}).`);
  }
  if (Math.abs(height - expected) > expected * 0.1) {
    throw new Error(`${name}.glb height ${height.toFixed(3)} does not match ${expected}.`);
  }
  return Math.round(triangles);
}

export async function loadRockAssets(
  modelBase = '/models/rocks',
  atlasBase = '/textures/rock_atlas',
): Promise<RockAssets> {
  const loader = new GLTFLoader();
  const texturePromise = loadAtlasTextures(atlasBase);
  const geometries = new Map<RockName, BufferGeometry>();
  let totalTriangles = 0;

  for (const name of ROCK_NAMES) {
    const gltf = await loader.loadAsync(`${modelBase}/${name}.glb`);
    if (gltf.animations.length > 0) {
      throw new Error(`${name}.glb unexpectedly contains animations.`);
    }
    let mesh: Mesh | null = null;
    gltf.scene.traverse((object) => {
      if (!mesh && object instanceof Mesh) mesh = object;
    });
    if (!mesh) throw new Error(`${name}.glb contains no mesh.`);
    const geometry = (mesh as Mesh).geometry as BufferGeometry;
    totalTriangles += validateGeometry(name, geometry);
    geometries.set(name, geometry);
  }

  const [baseColor, normal, ao] = await texturePromise;

  const rockMaterial = new MeshStandardMaterial({
    name: 'rock_atlas',
    map: baseColor,
    normalMap: normal,
    aoMap: ao,
    roughness: 0.93,
    metalness: 0,
    normalScale: new Vector2(0.55, 0.55),
    aoMapIntensity: 0.72,
  });
  const duneMaterial = rockMaterial.clone();
  duneMaterial.name = 'dune_atlas';
  duneMaterial.roughness = 0.97;
  duneMaterial.normalScale.set(0.32, 0.32);
  duneMaterial.aoMapIntensity = 0.4;

  return {
    geometries,
    rockMaterial,
    duneMaterial,
    stats: { triangles: totalTriangles, assets: geometries.size, textures: 3 },
    dispose(): void {
      for (const geometry of geometries.values()) geometry.dispose();
      baseColor.dispose();
      normal.dispose();
      ao.dispose();
      rockMaterial.dispose();
      duneMaterial.dispose();
    },
  };
}
