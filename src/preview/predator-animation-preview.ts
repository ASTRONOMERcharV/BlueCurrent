import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  GridHelper,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SkeletonHelper,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createUnderwaterEnvironment } from '../rendering/UnderwaterEnvironment';
import { loadPredatorRigAsset } from '../rendering/PredatorRigAsset';
import type { PredatorRigAsset } from '../rendering/PredatorRigAsset';
import {
  PredatorAnimationController,
  type PredatorRigBinding,
} from '../rendering/PredatorAnimationController';
import type { PredatorState } from '../simulation/PredatorSystem';

const DURATION = 25;
const FIXED_STEP = 1 / 60;
type ViewName = 'side' | 'top' | 'front' | 'quarter';

interface MotionSample {
  velocity: [number, number, number];
  state: PredatorState;
  label: string;
  speed: number;
  heading: number;
  pitch: number;
}

interface BoneAngles {
  spine04: number;
  spine05: number;
  tailFin: number;
  pectoralLeft: number;
  pectoralRight: number;
}

interface AnimationDiagnostics {
  ready: boolean;
  time: number;
  segment: string;
  speed: number;
  headingDeg: number;
  renderYawDeg: number;
  pitchDeg: number;
  bankDeg: number;
  frequency: number;
  phaseDeg: number;
  turn: number;
  tailTurn: number;
  attack: number;
  triangles: number;
  bones: number;
  boneAngles: BoneAngles;
}

interface PredatorAnimationApi {
  readonly ready: boolean;
  getDiagnostics(): AnimationDiagnostics;
  getBoneSnapshot(): Record<string, [number, number, number, number]>;
  setTime(time: number): void;
  setPlaying(playing: boolean): void;
  setView(view: ViewName): void;
  setSkeletonVisible(visible: boolean): void;
  capture(): string;
}

declare global {
  interface Window {
    __predatorAnimation: PredatorAnimationApi;
  }
}

function smooth01(x: number): number {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function ramp(time: number, start: number, end: number, from: number, to: number): number {
  return MathUtils.lerp(from, to, smooth01((time - start) / (end - start)));
}

function headingAt(time: number): number {
  if (time < 4) return 0;
  if (time < 7) return (Math.PI / 2) * smooth01((time - 4) / 3);
  if (time < 10) return Math.PI / 2;
  if (time < 13) return (Math.PI / 2) * (1 - smooth01((time - 10) / 3));
  return 0;
}

function pitchAt(time: number): number {
  if (time < 13) return 0;
  if (time < 15) return 0.42 * smooth01((time - 13) / 2);
  if (time < 16) return 0.42;
  if (time < 19) return 0.42 - 0.84 * smooth01((time - 16) / 3);
  if (time < 20) return -0.42 * (1 - smooth01((time - 19) / 1));
  return 0;
}

function speedAt(time: number): number {
  if (time < 13) return 3.0;
  if (time < 14) return ramp(time, 13, 14, 3.0, 3.6);
  if (time < 19) return 3.6;
  if (time < 19.8) return ramp(time, 19, 19.8, 3.6, 7.2);
  if (time < 21) return 7.2;
  if (time < 22.5) return ramp(time, 21, 22.5, 7.2, 3.0);
  return 3.0;
}

function segmentAt(time: number): string {
  if (time < 4) return 'cruise';
  if (time < 7) return 'left 90°';
  if (time < 10) return 'cruise (+90°)';
  if (time < 13) return 'right 90°';
  if (time < 16) return 'ascend';
  if (time < 19) return 'descend';
  if (time < 21) return 'burst / attack';
  return 'recover';
}

function motionAt(time: number): MotionSample {
  const heading = headingAt(time);
  const pitch = pitchAt(time);
  const speed = speedAt(time);
  const horizontal = speed * Math.cos(pitch);
  const velocity: [number, number, number] = [
    horizontal * Math.sin(heading),
    speed * Math.sin(pitch),
    horizontal * Math.cos(heading),
  ];
  const attacking = time >= 19.3 && time < 20.1;
  const state: PredatorState = attacking
    ? 'attack'
    : time >= 19 && time < 21.2 ? 'pursuit' : 'patrol';
  return { velocity, state, label: segmentAt(time), speed, heading, pitch };
}

const params = new URLSearchParams(window.location.search);
const hudHidden = params.get('hud') === '0';
const viewport = document.getElementById('preview-viewport')!;
const statsList = document.getElementById('stats')!;
const loading = document.getElementById('preview-loading')!;
const timelineFill = document.getElementById('timeline-fill')!;
const segmentLabel = document.getElementById('segment')!;
const viewButtons = document.querySelectorAll<HTMLButtonElement>('#view-buttons [data-view]');
const skeletonButton = document.getElementById('toggle-skeleton') as HTMLButtonElement;
const playButton = document.getElementById('toggle-play') as HTMLButtonElement;
const restartButton = document.getElementById('restart') as HTMLButtonElement;
if (hudHidden) {
  (document.getElementById('hud') as HTMLElement).style.display = 'none';
}

let ready = false;
let playing = true;
let simTime = 0;
let accumulator = 0;
let assetStats: PredatorRigAsset['stats'] | null = null;
let controller: PredatorAnimationController | null = null;
let skeletonHelper: SkeletonHelper | null = null;
let applyPose: () => void = () => {};
let seekTo: (time: number) => void = () => {};
let setViewImpl: (view: ViewName) => void = () => {};
let setSkeletonVisibleImpl: (visible: boolean) => void = () => {};
const boneSnapshotNames = [
  'Spine_04',
  'Spine_05',
  'Caudal_Peduncle',
  'Tail_Fin',
  'Pectoral_L_Root',
  'Pectoral_R_Root',
];

function setLoadingDone(): void {
  loading.classList.add('hidden');
  ready = true;
}

function showFatal(error: unknown): void {
  loading.classList.remove('hidden');
  loading.classList.add('error');
  loading.textContent = `Preview failed: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
}

function bindingsFor(asset: PredatorRigAsset): {
  spine04: PredatorRigBinding;
  spine05: PredatorRigBinding;
  tailFin: PredatorRigBinding;
  pectoralLeft: PredatorRigBinding;
  pectoralRight: PredatorRigBinding;
} {
  return {
    spine04: asset.rig.spine[4],
    spine05: asset.rig.spine[5],
    tailFin: asset.rig.tailFin,
    pectoralLeft: asset.rig.pectoralLeft,
    pectoralRight: asset.rig.pectoralRight,
  };
}

function signedBend(binding: PredatorRigBinding): number {
  const inverseRest = binding.restQuaternion.clone().invert();
  const delta = binding.bone.quaternion.clone().premultiply(inverseRest);
  const angle = 2 * Math.acos(MathUtils.clamp(Math.abs(delta.w), 0, 1));
  const sign = delta.x * binding.bendAxis.x
    + delta.y * binding.bendAxis.y
    + delta.z * binding.bendAxis.z;
  return sign >= 0 ? angle : -angle;
}

async function main(): Promise<void> {
  const asset = await loadPredatorRigAsset('/models/predator_shayu_rigged.glb');
  assetStats = asset.stats;
  const bendBindings = bindingsFor(asset);

  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    // Lets the acceptance script read the canvas directly; page screenshots
    // under SwiftShader are far too slow for many fixed-frame captures.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  viewport.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x062d39);
  scene.fog = new FogExp2(0x062d39, 0.016);
  scene.environment = createUnderwaterEnvironment(renderer);
  scene.environmentIntensity = 0.62;
  scene.add(new HemisphereLight(0x9de8e0, 0x04161c, 1.3));
  const key = new DirectionalLight(0xd9fff5, 2.9);
  key.position.set(4.0, 6.0, 5.0);
  scene.add(key);
  const rim = new DirectionalLight(0x2a7d93, 1.4);
  rim.position.set(-5.0, 2.0, -4.0);
  scene.add(rim);

  const floor = new Mesh(
    new PlaneGeometry(90, 90),
    new MeshStandardMaterial({ color: 0x0a2a31, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.6;
  scene.add(floor);
  const grid = new GridHelper(40, 40, 0x1c4f57, 0x123a42);
  grid.position.y = -2.59;
  scene.add(grid);

  const modelGroup = new Group();
  modelGroup.add(asset.scene);
  scene.add(modelGroup);
  skeletonHelper = new SkeletonHelper(asset.scene);
  skeletonHelper.visible = false;
  scene.add(skeletonHelper);

  const camera = new PerspectiveCamera(40, 1, 0.05, 160);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.5;
  controls.maxDistance = 40;
  controls.target.set(0, 0, 0);

  const viewPositions: Record<ViewName, Vector3> = hudHidden
    ? {
      side: new Vector3(-9.8, 1.7, 0),
      top: new Vector3(0.001, 11.0, 0.001),
      front: new Vector3(0.001, 1.4, 9.8),
      quarter: new Vector3(-8.6, 0.9, 4.6),
    }
    : {
      side: new Vector3(-9.8, 1.7, -1.8),
      top: new Vector3(-1.5, 11.0, 0.001),
      front: new Vector3(0.001, 1.4, 9.8),
      quarter: new Vector3(-8.6, 0.9, 2.8),
    };
  const viewTargets: Record<ViewName, Vector3> = hudHidden
    ? {
      side: new Vector3(0, 0.2, 0),
      top: new Vector3(0, 0, 0),
      front: new Vector3(0, 0.2, 0),
      quarter: new Vector3(0, 0.2, 0),
    }
    : {
      side: new Vector3(0, 0.2, -1.8),
      top: new Vector3(-1.5, 0, 0),
      front: new Vector3(0, 0.2, 0),
      quarter: new Vector3(0, 0.2, -1.0),
    };
  setViewImpl = (view: ViewName): void => {
    camera.position.copy(viewPositions[view]);
    controls.target.copy(viewTargets[view]);
    controls.update();
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    }
  };
  setSkeletonVisibleImpl = (visible: boolean): void => {
    if (skeletonHelper) skeletonHelper.visible = visible;
    skeletonButton.setAttribute('aria-pressed', String(visible));
  };
  setViewImpl(params.get('view') === 'top'
    ? 'top'
    : params.get('view') === 'front' ? 'front' : 'side');
  setSkeletonVisibleImpl(params.get('bones') === '1');

  const resize = (): void => {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  controller = new PredatorAnimationController(asset.rig);
  applyPose = (): void => {
    if (!controller) return;
    modelGroup.quaternion.copy(controller.rootQuaternion);
  };

  const stepOnce = (dt: number): void => {
    if (!controller) return;
    const sample = motionAt(simTime);
    controller.update(dt, sample.velocity, sample.state);
    simTime += dt;
    if (simTime > DURATION) {
      // Loop the scripted manoeuvre without resetting the swim phase or the
      // bone pose; only the motion profile wraps.
      simTime = 0;
    }
  };

  seekTo = (time: number): void => {
    if (!controller) return;
    controller.reset();
    const target = MathUtils.clamp(time, 0, DURATION);
    let cursor = 0;
    simTime = 0;
    while (cursor + FIXED_STEP <= target) {
      stepOnce(FIXED_STEP);
      cursor += FIXED_STEP;
    }
    const remainder = target - cursor;
    if (remainder > 1e-6) stepOnce(remainder);
    simTime = target;
    accumulator = 0;
    applyPose();
  };

  let fps = 0;
  let frameCount = 0;
  let fpsElapsed = 0;

  const updateHud = (): void => {
    if (!controller || !assetStats) return;
    const sample = motionAt(simTime);
    const angles: BoneAngles = {
      spine04: signedBend(bendBindings.spine04),
      spine05: signedBend(bendBindings.spine05),
      tailFin: signedBend(bendBindings.tailFin),
      pectoralLeft: signedBend(bendBindings.pectoralLeft),
      pectoralRight: signedBend(bendBindings.pectoralRight),
    };
    const rows: Array<[string, string, string?]> = [
      ['model', 'rigged shayu', 'ok'],
      ['bones / tris', `${assetStats.boneCount} / ${assetStats.triangles}`],
      ['time', `${simTime.toFixed(2)} / ${DURATION}s`],
      ['speed', `${sample.speed.toFixed(2)} u/s`],
      ['heading', `${MathUtils.radToDeg(sample.heading).toFixed(0)}° → ${MathUtils.radToDeg(controller.yaw).toFixed(0)}°`],
      ['pitch', `${MathUtils.radToDeg(controller.pitch).toFixed(1)}°`],
      ['bank', `${MathUtils.radToDeg(controller.bank).toFixed(1)}°`],
      ['tail beat', `${controller.frequency.toFixed(2)} Hz`],
      ['phase', `${MathUtils.radToDeg(controller.phase).toFixed(0)}°`],
      ['turn / tail', `${controller.turn.toFixed(2)} / ${controller.tailTurn.toFixed(2)}`],
      ['tail fin', `${MathUtils.radToDeg(angles.tailFin).toFixed(1)}°`],
      ['spine 04/05', `${MathUtils.radToDeg(angles.spine04).toFixed(1)}° / ${MathUtils.radToDeg(angles.spine05).toFixed(1)}°`],
      ['pectoral L/R', `${MathUtils.radToDeg(angles.pectoralLeft).toFixed(1)}° / ${MathUtils.radToDeg(angles.pectoralRight).toFixed(1)}°`],
      ['fps', fps.toFixed(0)],
    ];
    statsList.innerHTML = rows
      .map(([label, value, tone]) => `<dt>${label}</dt><dd class="${tone ?? ''}">${value}</dd>`)
      .join('');
    timelineFill.style.width = `${(simTime / DURATION) * 100}%`;
    segmentLabel.textContent = `${sample.label} · ${sample.state}`;
  };

  for (const button of viewButtons) {
    button.addEventListener('click', () => setViewImpl(button.dataset.view as ViewName));
  }
  skeletonButton.addEventListener('click', () => {
    setSkeletonVisibleImpl(!(skeletonHelper?.visible ?? false));
  });
  playButton.addEventListener('click', () => {
    playing = !playing;
    playButton.textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-pressed', String(playing));
  });
  restartButton.addEventListener('click', () => {
    seekTo(0);
    playing = true;
    playButton.textContent = 'Pause';
    playButton.setAttribute('aria-pressed', 'true');
  });

  let last = performance.now();

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const rawDelta = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      accumulator += rawDelta;
      while (accumulator >= FIXED_STEP) {
        stepOnce(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }
    }
    applyPose();
    controls.update();
    renderer.render(scene, camera);

    frameCount += 1;
    fpsElapsed += rawDelta;
    if (fpsElapsed >= 0.5) {
      fps = frameCount / fpsElapsed;
      frameCount = 0;
      fpsElapsed = 0;
    }
    updateHud();
    if (!ready) setLoadingDone();
  };

  const fixedTime = Number(params.get('t'));
  if (params.has('t') && Number.isFinite(fixedTime)) {
    seekTo(MathUtils.clamp(fixedTime, 0, DURATION));
    playing = false;
    playButton.textContent = 'Play';
    playButton.setAttribute('aria-pressed', 'false');
  } else {
    seekTo(0);
  }
  requestAnimationFrame(frame);

  window.__predatorAnimation = {
    get ready() { return ready; },
    getDiagnostics: () => {
      if (!controller || !assetStats) {
        throw new Error('predator animation not ready');
      }
      const sample = motionAt(simTime);
      return {
        ready,
        time: simTime,
        segment: sample.label,
        speed: sample.speed,
        headingDeg: MathUtils.radToDeg(sample.heading),
        renderYawDeg: MathUtils.radToDeg(controller.yaw),
        pitchDeg: MathUtils.radToDeg(controller.pitch),
        bankDeg: MathUtils.radToDeg(controller.bank),
        frequency: controller.frequency,
        phaseDeg: MathUtils.radToDeg(controller.phase),
        turn: controller.turn,
        tailTurn: controller.tailTurn,
        attack: controller.attack,
        triangles: assetStats.triangles,
        bones: assetStats.boneCount,
        boneAngles: {
          spine04: signedBend(bendBindings.spine04),
          spine05: signedBend(bendBindings.spine05),
          tailFin: signedBend(bendBindings.tailFin),
          pectoralLeft: signedBend(bendBindings.pectoralLeft),
          pectoralRight: signedBend(bendBindings.pectoralRight),
        },
      };
    },
    getBoneSnapshot: () => {
      const snapshot: Record<string, [number, number, number, number]> = {};
      for (const name of boneSnapshotNames) {
        const bone = asset.bones.get(name);
        if (!bone) continue;
        snapshot[name] = [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
      }
      return snapshot;
    },
    setTime: (time: number) => {
      seekTo(MathUtils.clamp(time, 0, DURATION));
      playing = false;
      playButton.textContent = 'Play';
      playButton.setAttribute('aria-pressed', 'false');
    },
    setPlaying: (value: boolean) => {
      playing = value;
      playButton.textContent = playing ? 'Pause' : 'Play';
      playButton.setAttribute('aria-pressed', String(playing));
    },
    setView: (view: ViewName) => setViewImpl(view),
    setSkeletonVisible: (visible: boolean) => setSkeletonVisibleImpl(visible),
    capture: () => {
      // Render synchronously with the current pose/camera so a fixed-frame
      // capture cannot read the previous view under a slow software renderer.
      applyPose();
      controls.update();
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.92);
    },
  };
}

void main().catch(showFatal);
