import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCoralAtlas, createCoralMaterial } from '../rendering/CoralAsset';
import { loadEpibiontAssets } from '../rendering/EpibiontAsset';
import { loadReefSampleAssets } from '../rendering/ReefSampleAsset';
import { ReefSample } from '../rendering/ReefSample';
import { REEF_VARIANT_SPECS } from '../rendering/reefVariantSpecs';
import { loadRockAssets } from '../rendering/RockAsset';
import { floorHeightAt } from '../rendering/rockPlacement';

/**
 * Studio gallery for the approved hero sample and its four variants. All five
 * are laid out left-to-right at authored scale on the same seabed function, so
 * height and mass differences are directly comparable.
 */

type Pose = readonly [number, number, number];

interface GalleryDiagnostics {
  readonly ready: boolean;
  readonly reefCount: number;
  readonly nearTriangles: number;
  readonly epibiontInstances: number;
  readonly epibiontTriangles: number;
  readonly drawCalls: number;
  readonly fps: number;
  readonly cameraPosition: [number, number, number];
  readonly cameraTarget: [number, number, number];
}

interface GalleryDebug {
  readonly ready: boolean;
  getDiagnostics(): GalleryDiagnostics;
  setCameraPose(position: Pose, target: Pose): GalleryDiagnostics;
  setPreset(preset: 'front' | 'threeQuarter'): GalleryDiagnostics;
  setSilhouette(enabled: boolean): void;
  setLodLocked(locked: boolean): void;
  captureView(width: number, height: number): string;
}

declare global {
  interface Window {
    __reefVariantsPreview: GalleryDebug;
  }
}

const viewport = document.getElementById('app')!;
const statsElement = document.getElementById('stats')!;
const loading = document.getElementById('loading')!;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x0a2b32);
scene.fog = new FogExp2(0x0a2b32, 0.010);

const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 3.6, 20);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

scene.add(new HemisphereLight(0xbfe6df, 0x081d1c, 1.15));
const sun = new DirectionalLight(0xfff2df, 2.4);
sun.position.set(8, 13, 6);
scene.add(sun);
const fill = new DirectionalLight(0x52b8c9, 0.7);
fill.position.set(-9, 5, -7);
scene.add(fill);

const floorGeometry = new PlaneGeometry(90, 90, 100, 100);
floorGeometry.rotateX(-Math.PI / 2);
const floorPositions = floorGeometry.getAttribute('position');
for (let index = 0; index < floorPositions.count; index += 1) {
  const x = floorPositions.getX(index);
  const z = floorPositions.getZ(index);
  floorPositions.setY(index, floorHeightAt(x, z));
}
floorGeometry.computeVertexNormals();
const floor = new Mesh(floorGeometry, new MeshStandardMaterial({
  color: 0x2a4642,
  roughness: 0.97,
  metalness: 0,
}));
floor.name = 'previewSeabed';
scene.add(floor);

const samples: ReefSample[] = [];
let ready = false;
let silhouette = false;
let frameCount = 0;
let fpsTime = 0;
let fps = 0;
const silhouetteMaterial = new MeshBasicMaterial({ color: 0x050708 });

function applySilhouette(): void {
  scene.overrideMaterial = silhouette ? silhouetteMaterial : null;
  floor.visible = !silhouette;
  scene.fog = silhouette ? null : new FogExp2(0x0a2b32, 0.010);
  scene.background = new Color(silhouette ? 0xf2f4f1 : 0x0a2b32);
  for (const sample of samples) {
    sample.apron.visible = !silhouette;
    sample.contact.visible = !silhouette;
    sample.epibionts.setVisible(!silhouette);
  }
}

function setCameraPose(position: Pose, target: Pose): GalleryDiagnostics {
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
  return diagnostics();
}

function setPreset(preset: 'front' | 'threeQuarter'): GalleryDiagnostics {
  if (preset === 'front') {
    return setCameraPose([0, 5.5, 25.5], [0, 4.4, 0]);
  }
  return setCameraPose([19.0, 11.5, 24.5], [0, 4.0, 0]);
}

function renderStats(): void {
  const nearTriangles = samples.reduce((sum, sample) => sum + sample.stats.trianglesNear, 0);
  const epibiontInstances = samples.reduce((sum, sample) => sum + sample.stats.epibiontInstances, 0);
  const epibiontTriangles = samples.reduce((sum, sample) => sum + sample.stats.epibiontTriangles, 0);
  const rows = [
    ['reefs', `${samples.length} · ${REEF_VARIANT_SPECS.map((spec) => spec.label).join(' / ')}`],
    ['near LOD total', `${nearTriangles.toLocaleString()} tris`],
    ['epibionts', `${epibiontInstances} · ${epibiontTriangles.toLocaleString()} tris`],
    ['height range', `${Math.min(...samples.map((sample) => sample.stats.height)).toFixed(2)}–${Math.max(...samples.map((sample) => sample.stats.height)).toFixed(2)} m`],
    ['width range', `${Math.min(...samples.map((sample) => sample.stats.width)).toFixed(2)}–${Math.max(...samples.map((sample) => sample.stats.width)).toFixed(2)} m`],
  ];
  statsElement.innerHTML = rows
    .map(([label, value]) => `<li><code>${label}</code><span>${value}</span></li>`)
    .join('');
}

async function boot(): Promise<void> {
  try {
    const [loadedSets, epibiontAssets, coralAtlas, rockAssets] = await Promise.all([
      Promise.all(REEF_VARIANT_SPECS.map((spec) => loadReefSampleAssets(spec.assetPrefix))),
      loadEpibiontAssets(),
      loadCoralAtlas(),
      loadRockAssets(),
    ]);
    const coralMaterial = createCoralMaterial(coralAtlas);
    coralMaterial.normalScale.set(0.85, 0.85);
    const apronMaterial = new MeshStandardMaterial({
      map: rockAssets.rockMaterial.map,
      normalMap: rockAssets.rockMaterial.normalMap,
      aoMap: rockAssets.rockMaterial.aoMap,
      roughness: 0.95,
      metalness: 0,
      color: 0x6f8480,
    });

    const gap = 1.5;
    const totalWidth = REEF_VARIANT_SPECS.reduce((sum, spec) => sum + spec.targetWidth, 0)
      + gap * (REEF_VARIANT_SPECS.length - 1);
    let cursor = -totalWidth * 0.5;
    loadedSets.forEach((assets, index) => {
      const spec = REEF_VARIANT_SPECS[index];
      const centerX = cursor + spec.targetWidth * 0.5;
      cursor += spec.targetWidth + gap;
      const sample = new ReefSample(
        assets,
        epibiontAssets,
        coralMaterial,
        rockAssets,
        { center: [centerX, 0, 0], radius: spec.obstacleRadius, variant: index },
        {
          id: spec.id,
          label: spec.label,
          anchorIndex: index,
          yawDegrees: spec.yawDegrees,
          tiltXDegrees: spec.tiltXDegrees,
          tiltZDegrees: spec.tiltZDegrees,
          embedDepth: spec.embedDepth,
          visualScale: [
            spec.targetWidth / assets.stats.width,
            spec.targetHeight / assets.stats.height,
            spec.targetDepth / assets.stats.depth,
          ] as const,
          lodDistances: spec.lodDistances,
          planSeed: spec.epibiontSeed,
          planOptions: spec.epibiontOptions,
          apronSeed: spec.apronSeed,
          apronMaterial,
        },
      );
      scene.add(sample.group);
      scene.add(sample.apron);
      scene.add(sample.contact);
      samples.push(sample);
    });
    renderStats();
    loading.classList.add('hidden');
    ready = true;
  } catch (error) {
    loading.classList.add('error');
    loading.textContent = `Could not load the reef variants. ${error instanceof Error ? error.message : ''}`;
    throw error;
  }
}

let lastTime = performance.now();

function frame(now: number): void {
  const delta = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  fpsTime += delta;
  frameCount += 1;
  if (fpsTime >= 0.5) {
    fps = frameCount / fpsTime;
    frameCount = 0;
    fpsTime = 0;
  }
  controls.update();
  for (const sample of samples) {
    sample.update(camera);
    if (silhouette) {
      sample.apron.visible = false;
      sample.contact.visible = false;
      sample.epibionts.setVisible(false);
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function diagnostics(): GalleryDiagnostics {
  return {
    ready,
    reefCount: samples.length,
    nearTriangles: samples.reduce((sum, sample) => sum + sample.stats.trianglesNear, 0),
    epibiontInstances: samples.reduce((sum, sample) => sum + sample.stats.epibiontInstances, 0),
    epibiontTriangles: samples.reduce((sum, sample) => sum + sample.stats.epibiontTriangles, 0),
    drawCalls: renderer.info.render.calls,
    fps,
    cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
    cameraTarget: [controls.target.x, controls.target.y, controls.target.z],
  };
}

function captureView(width: number, height: number): string {
  const previousWidth = renderer.domElement.width;
  const previousHeight = renderer.domElement.height;
  const previousAspect = camera.aspect;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  renderer.setSize(previousWidth, previousHeight, false);
  camera.aspect = previousAspect;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return dataUrl;
}

window.__reefVariantsPreview = {
  get ready() { return ready; },
  getDiagnostics: diagnostics,
  setCameraPose,
  setPreset,
  setSilhouette: (enabled) => {
    silhouette = enabled;
    applySilhouette();
  },
  setLodLocked: (locked) => {
    for (const sample of samples) {
      sample.lod.autoUpdate = !locked;
      if (locked) {
        // Force the authored near mesh; the gallery camera is beyond the
        // default LOD distance, but the studio shot should show full detail.
        for (const level of sample.lod.levels) {
          level.object.visible = level.distance === 0;
        }
      }
    }
  },
  captureView,
};

void boot();
requestAnimationFrame(frame);
