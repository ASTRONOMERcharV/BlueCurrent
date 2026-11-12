import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

type Scenario = 'calm' | 'encounter' | 'obstacles';
type CameraView = 'overview' | 'school' | 'predator';
type WaterLayer =
  | 'sceneFog'
  | 'waterAttenuation'
  | 'volumetricScattering'
  | 'marineParticles'
  | 'lightShafts'
  | 'caustics'
  | 'surfaceLight';

interface Diagnostics {
  fps: number;
  fpsFromSamples: number;
  renderMs: number;
  p95FrameMs: number;
  averageFrameMs: number;
  frameSampleCount: number;
  fishCount: number;
  totalSteps: number;
  simulationTime: number;
  paused: boolean;
  predatorPosition: [number, number, number];
  predatorVelocity: [number, number, number];
  schoolCenter: [number, number, number];
  drawCalls: number;
  renderTriangles: number;
  waterDebug: Record<WaterLayer, boolean> & { postProcessing: null };
  lighting: { colorSpaceIssues: unknown[] };
}

interface DebugApi {
  ready: boolean;
  pause(): void;
  setScenario(id: Scenario): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setGridVisible(visible: boolean): void;
  setLightingMode(mode: 'full' | 'base'): void;
  setCameraPose(position: readonly [number, number, number], target: readonly [number, number, number]): void;
  setWaterEffects(enabled: boolean): void;
  setWaterDebugLayer(layer: WaterLayer, enabled: boolean): void;
  setWaterDebugLayers(enabled: boolean): void;
  resetPerformanceSamples(): void;
  step(count?: number): Diagnostics;
  getDiagnostics(): Diagnostics;
}

interface CaptureState {
  readonly id: string;
  readonly purpose: string;
  readonly enabled: readonly WaterLayer[];
}

const ALL_LAYERS: readonly WaterLayer[] = [
  'sceneFog',
  'waterAttenuation',
  'volumetricScattering',
  'marineParticles',
  'lightShafts',
  'caustics',
  'surfaceLight',
];
const MEDIUM: readonly WaterLayer[] = ['sceneFog', 'waterAttenuation', 'volumetricScattering'];
const CAPTURE_STATES: readonly CaptureState[] = [
  { id: '01-raw', purpose: 'Raw material and direct-light baseline; every supported water layer off.', enabled: [] },
  { id: '02-transmission-only', purpose: 'Object transmission only; in-scattering is isolated off.', enabled: ['sceneFog', 'waterAttenuation'] },
  { id: '03-medium', purpose: 'Beer-Lambert transmission plus water in-scattering.', enabled: MEDIUM },
  { id: '04-particles', purpose: 'Medium plus the current-advected marine snow.', enabled: [...MEDIUM, 'marineParticles'] },
  { id: '05-full', purpose: 'Complete water composition including shafts, surface and caustics.', enabled: ALL_LAYERS },
];

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
const port = Number(argument('port', '5220'));
const out = argument('out', 'water-clarity-diagnosis');
if (!/^[a-z0-9/-]+$/.test(out)) throw new Error('Invalid --out value.');
const scenario = argument('scenario', 'encounter') as Scenario;
if (!['calm', 'encounter', 'obstacles'].includes(scenario)) throw new Error('Invalid scenario.');
const cameraView = argument('camera', 'predator') as CameraView;
if (!['overview', 'school', 'predator'].includes(cameraView)) throw new Error('Invalid camera.');
const waterModel = argument('water', 'clear');
if (waterModel !== 'clear' && waterModel !== 'legacy') throw new Error('Invalid --water value.');
const steps = Number.parseInt(argument('steps', scenario === 'encounter' ? '18' : '0'), 10);
const performanceFrames = Number.parseInt(argument('frames', '16'), 10);
const labGrid = argument('lab-grid', '0') === '1';
const stateFilter = argument('state', 'all');
const states = stateFilter === 'all'
  ? CAPTURE_STATES
  : CAPTURE_STATES.filter((state) => state.id === stateFilter);
if (states.length === 0) throw new Error(`Unknown --state value: ${stateFilter}`);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/${out}`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/water-clarity-${port}`,
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

function normalize(vector: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cameraPose(diagnostics: Diagnostics): {
  position: [number, number, number];
  target: [number, number, number];
} {
  if (cameraView === 'overview') return { position: [28, 18, 31], target: [-2, 9, 0] };
  if (cameraView === 'school') {
    return {
      position: [diagnostics.schoolCenter[0] + 24, diagnostics.schoolCenter[1] + 13, diagnostics.schoolCenter[2] + 27],
      target: [...diagnostics.schoolCenter],
    };
  }
  const forward = normalize(diagnostics.predatorVelocity);
  const side = normalize([forward[2], 0, -forward[0]]);
  const predator = diagnostics.predatorPosition;
  return {
    position: [
      predator[0] + forward[0] * 4 + side[0] * 8,
      predator[1] + 2.2,
      predator[2] + forward[2] * 4 + side[2] * 8,
    ],
    target: [predator[0] + forward[0] * 0.5, predator[1], predator[2] + forward[2] * 0.5],
  };
}

async function waitForFrames(page: Page, count: number): Promise<void> {
  if (count <= 0) return;
  // Passed as source: esbuild's named-function helper is not serializable into
  // the page, while this browser-side requestAnimationFrame loop is.
  await page.evaluate(`new Promise((resolve) => {
    let remaining = ${Math.floor(count)};
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
}

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?scenario=${scenario}&water=${waterModel}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DebugApi }
  ).__blueCurrent?.ready === true);
  const initial = await page.evaluate(({ id, stepCount }) => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    api.setScenario(id);
    api.setViewMode('observation');
    api.setGridVisible(false);
    api.setLightingMode('full');
    api.setWaterEffects(true);
    if (stepCount > 0) api.step(stepCount);
    document.querySelector('.observatory')?.classList.add('panel-closed');
    return api.getDiagnostics();
  }, { id: scenario, stepCount: steps });
  await page.waitForTimeout(500);
  const pose = cameraPose(initial);
  await page.evaluate((fixedPose) => {
    (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent
      .setCameraPose(fixedPose.position, fixedPose.target);
  }, pose);

  const captures: unknown[] = [];
  for (const state of states) {
    await page.evaluate(({ layers }) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      api.setWaterDebugLayers(false);
      for (const layer of layers) api.setWaterDebugLayer(layer, true);
      api.step(0);
    }, { layers: state.enabled });
    // Compile/warm the current state before resetting the measurement window.
    await waitForFrames(page, 2);
    await page.evaluate(() => {
      (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.resetPerformanceSamples();
    });
    await waitForFrames(page, performanceFrames);
    const result = await page.evaluate(() => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      const diagnostics = api.step(0);
      const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas');
      if (!canvas) throw new Error('Missing WebGL canvas.');
      return { diagnostics, png: canvas.toDataURL('image/png').split(',')[1] };
    });
    if (!result.png) throw new Error(`Canvas capture failed for ${state.id}.`);
    writeFileSync(`${artifacts}/${state.id}.png`, Buffer.from(result.png, 'base64'));
    captures.push({
      ...state,
      disabled: ALL_LAYERS.filter((layer) => !state.enabled.includes(layer)),
      diagnostics: result.diagnostics,
      screenshot: `${state.id}.png`,
    });
    console.log(`${state.id}: ${result.diagnostics.frameSampleCount} samples, ` +
      `${result.diagnostics.fpsFromSamples.toFixed(2)} fps, ` +
      `P95 ${result.diagnostics.p95FrameMs.toFixed(2)} ms`);
  }

  if (labGrid) {
    await page.evaluate(() => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      api.setViewMode('laboratory');
      api.setGridVisible(true);
      api.step(0);
    });
    await waitForFrames(page, 2);
  }
  const finalDiagnostics = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getDiagnostics());
  if (finalDiagnostics.totalSteps !== initial.totalSteps || finalDiagnostics.simulationTime !== initial.simulationTime) {
    throw new Error('Water debug captures changed the paused simulation state.');
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  const report = {
    passed: true,
    scenario,
    steps,
    waterModel,
    camera: { view: cameraView, ...pose },
    renderer: 'SwiftShader software rendering; visual diagnostics only, not hardware GPU performance.',
    postProcessing: 'Not installed; reported as N/A rather than a functional switch.',
    simulationInvariant: {
      totalSteps: initial.totalSteps,
      simulationTime: initial.simulationTime,
      fishCount: initial.fishCount,
    },
    captures,
    browserErrors: errors,
  };
  writeFileSync(`${artifacts}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, out: artifacts, browserErrors: errors }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
