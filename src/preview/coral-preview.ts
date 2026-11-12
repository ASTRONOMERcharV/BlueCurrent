import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Matrix4,
  Quaternion,
  Euler,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CORAL_SPECS,
  createCoralMaterial,
  loadCoralAssets,
  loadCoralAtlas,
  type CoralAsset,
  type CoralAssetStats,
  type CoralName,
} from '../rendering/CoralAsset';

interface CoralPreviewDiagnostics {
  readonly ready: boolean;
  readonly assetCount: number;
  readonly instanceCount: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly fps: number;
  readonly atlasMaps: number;
}

interface CoralPreviewDebug {
  readonly ready: boolean;
  getDiagnostics(): CoralPreviewDiagnostics;
  getAssetStats(): CoralAssetStats[];
}

declare global {
  interface Window {
    __coralPreview: CoralPreviewDebug;
  }
}

const viewport = document.getElementById('preview-viewport')!;
const statsElement = document.getElementById('stats')!;
const loading = document.getElementById('preview-loading')!;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x07242f);
scene.fog = new FogExp2(0x07242f, 0.055);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 140);
camera.position.set(6.4, 3.4, 10.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.75, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3;
controls.maxDistance = 34;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new HemisphereLight(0x9fd0f0, 0x18342f, 1.10);
scene.add(hemi);
const sun = new DirectionalLight(0xfff0d4, 1.90);
sun.position.set(6, 11, 4);
scene.add(sun);
const fill = new DirectionalLight(0x3fb6c9, 0.55);
fill.position.set(-6, 3.5, -4);
scene.add(fill);

// Gentle dune plane.
const seabedGeometry = new PlaneGeometry(90, 90, 72, 72);
const seabedPositions = seabedGeometry.getAttribute('position');
for (let index = 0; index < seabedPositions.count; index += 1) {
  const x = seabedPositions.getX(index);
  const y = seabedPositions.getY(index);
  const dune = 0.055 * Math.sin(x * 0.34) * Math.cos(y * 0.27)
    + 0.025 * Math.sin(x * 1.1 + y * 0.6);
  seabedPositions.setZ(index, dune);
}
seabedGeometry.computeVertexNormals();
const seabed = new Mesh(
  seabedGeometry,
  new MeshStandardMaterial({ color: 0x1b3532, roughness: 0.98, metalness: 0 }),
);
seabed.rotation.x = -Math.PI / 2;
seabed.position.y = -0.03;
scene.add(seabed);

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const CLUSTERS = [
  { x: -5.0, z: -1.4, radius: 1.95 },
  { x: 5.0, z: -1.9, radius: 1.75 },
  { x: -2.1, z: 3.7, radius: 2.05 },
  { x: 3.2, z: 4.1, radius: 1.75 },
];

const PLACEMENT: Record<CoralName, { count: number; min: number; max: number }> = {
  coral_branching: { count: 2, min: 0.62, max: 0.92 },
  coral_table: { count: 1, min: 0.66, max: 0.92 },
  sponge_tube: { count: 2, min: 0.72, max: 1.02 },
  coral_fan: { count: 2, min: 0.68, max: 0.94 },
  coral_brain: { count: 1, min: 0.82, max: 1.12 },
  anemone: { count: 2, min: 0.72, max: 1.00 },
};

let ready = false;
let instances = 0;
let assets: CoralAsset[] = [];
let fps = 0;
let atlasMaps = 0;

function updateHud(): void {
  const rows: Array<[string, string]> = [
    ['status', ready ? 'ready' : 'loading'],
    ['assets', `${assets.length} / ${CORAL_SPECS.length}`],
    ['instances', String(instances)],
    ['triangles', renderer.info.render.triangles.toLocaleString()],
    ['draw calls', String(renderer.info.render.calls)],
    ['fps', String(fps)],
  ];
  statsElement.innerHTML = rows
    .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
    .join('');
}

function buildCoralField(loaded: CoralAsset[], material: MeshStandardMaterial): Group {
  const group = new Group();
  const rng = mulberry32(20261109);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scaleVector = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const tint = new Color();

  for (const asset of loaded) {
    const placement = PLACEMENT[asset.name];
    const total = placement.count * CLUSTERS.length;
    const mesh = new InstancedMesh(asset.geometry, material, total);
    let cursor = 0;
    for (const cluster of CLUSTERS) {
      for (let index = 0; index < placement.count; index += 1) {
        const angle = rng() * Math.PI * 2;
        const distance = Math.sqrt(rng()) * cluster.radius;
        position.set(
          cluster.x + Math.cos(angle) * distance,
          0,
          cluster.z + Math.sin(angle) * distance,
        );
        const scale = MathUtils.lerp(placement.min, placement.max, rng());
        euler.set((rng() - 0.5) * 0.10, rng() * Math.PI * 2, (rng() - 0.5) * 0.10);
        quaternion.setFromEuler(euler);
        scaleVector.set(scale, scale, scale);
        matrix.compose(position, quaternion, scaleVector);
        mesh.setMatrixAt(cursor, matrix);
        const lightness = 0.88 + rng() * 0.18;
        tint.setRGB(lightness, lightness * 0.99, lightness * 0.95);
        mesh.setColorAt(cursor, tint);
        cursor += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `instances_${asset.name}`;
    group.add(mesh);
    instances += total;
  }
  return group;
}

async function addReefRocks(): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync('/models/reef_rock_a.glb');
    const meshes: Mesh[] = [];
    gltf.scene.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });
    if (meshes.length === 0) return;
    const source = meshes[0];
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
    if (!sourceMaterial) return;
    let rockMaterial = sourceMaterial;
    if (sourceMaterial instanceof MeshStandardMaterial) {
      const clone = sourceMaterial.clone();
      clone.color.multiplyScalar(0.55);
      clone.roughness = 0.95;
      rockMaterial = clone;
    }
    const rock = new InstancedMesh(geometry, rockMaterial, 12);
    const rng = mulberry32(9091);
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const euler = new Euler();
    const scaleVector = new Vector3();
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + rng() * 0.35;
      const distance = 7.4 + rng() * 4.0;
      const scale = 0.28 + rng() * 0.55;
      position.set(Math.cos(angle) * distance, scale * 0.45, Math.sin(angle) * distance);
      euler.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
      quaternion.setFromEuler(euler);
      scaleVector.set(scale, scale * (0.65 + rng() * 0.4), scale);
      matrix.compose(position, quaternion, scaleVector);
      rock.setMatrixAt(index, matrix);
    }
    rock.instanceMatrix.needsUpdate = true;
    rock.computeBoundingSphere();
    rock.name = 'reef_rocks';
    scene.add(rock);
  } catch (error) {
    console.warn('reef rock preview skipped', error);
  }
}

async function boot(): Promise<void> {
  try {
    const [loaded, atlas] = await Promise.all([loadCoralAssets(), loadCoralAtlas()]);
    assets = loaded;
    const material = createCoralMaterial(atlas);
    atlasMaps = material.map && material.normalMap && material.roughnessMap ? 3 : 0;
    scene.add(buildCoralField(assets, material));
    await addReefRocks();
    ready = true;
    loading.classList.add('hidden');
    updateHud();
    console.log(`coral preview ready: ${assets.length} assets, ${instances} instances`);
  } catch (error) {
    loading.textContent = `Coral preview failed: ${(error as Error).message}`;
    loading.classList.add('error');
    console.error(error);
  }
}

window.__coralPreview = {
  get ready() {
    return ready;
  },
  getDiagnostics: () => ({
    ready,
    assetCount: assets.length,
    instanceCount: instances,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    fps,
    atlasMaps,
  }),
  getAssetStats: () => assets.map((asset) => asset.stats),
};

let frames = 0;
let fpsWindow = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  frames += 1;
  if (now - fpsWindow > 500) {
    fps = Math.round((frames * 1000) / (now - fpsWindow));
    frames = 0;
    fpsWindow = now;
    if (ready) updateHud();
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

void boot();
requestAnimationFrame(animate);
