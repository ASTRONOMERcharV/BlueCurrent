import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';
import { floorHeightAt } from '../src/rendering/rockPlacement';
import { UNDERWATER_SUN_DIRECTION } from '../src/rendering/lighting/UnderwaterLightingConfig';

/**
 * P2.0 fixed lighting baseline + P2.1 rock evidence.
 *
 * Ten fixed poses (four presets, one close-up per reef core from the backlit
 * side, one top-down) are captured in three water configurations:
 * - base:  `?lighting=base`, true base mode from the URL contract.
 * - fog:   sceneFog + waterAttenuation + volumetricScattering only.
 * - final: every water layer and local effect on (the shipping default).
 *
 * The render loop is frozen and each frame is drawn through an explicit debug
 * render, so SwiftShader screenshots show the paused 17 s state. In final mode
 * a visible-rock mask is rendered too, and the page itself computes the
 * black-pixel / highlight-clipping statistics that P2.2 will be judged on.
 * Software-rendered pixels are functional evidence, never performance data.
 */

type Mode = 'base' | 'fog' | 'final';
type PresetMode = 'overview' | 'school' | 'predator';

interface PoseDefinition {
  name: string;
  kind: 'preset' | 'fixed';
  cameraMode?: PresetMode;
  position?: [number, number, number];
  target?: [number, number, number];
}

interface Diagnostics {
  simulationTime: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraDistance: number;
  drawCalls: number;
  renderTriangles: number;
  fishCount: number;
  predatorState: string;
  predatorTargetIndex: number | null;
  predatorTargetPosition: [number, number, number] | null;
  canvasWidth: number;
  canvasHeight: number;
  cameraMode: string;
  lightingMode: string;
  rockDebugMode: string;
  waterDebug: Record<string, boolean | null>;
  lighting: Record<string, unknown>;
}

interface MaskCapture {
  dataUrl: string;
  width: number;
  height: number;
  coveredPixels: number;
}

interface MaskStats {
  width: number;
  height: number;
  maskPixels: number;
  maskCoverage: number;
  pureBlackPixels: number;
  pureBlackRatioOfMask: number | null;
  nearBlackRatioOfMask: number | null;
  rockClippedPixels: number;
  rockClippedRatioOfMask: number | null;
  frameClippedPixels: number;
  frameClippedRatio: number;
  meanLuminance: number;
  leftMeanLuminance: number | null;
  rightMeanLuminance: number | null;
}

interface DebugApi {
  ready: boolean;
  pause(): void;
  reset(): void;
  setScenario(id: string): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setGridVisible(visible: boolean): void;
  setCameraMode(mode: PresetMode | 'free' | 'orbit'): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  step(count?: number): Diagnostics;
  setVisualTime(seconds: number): Diagnostics;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  settleVisual(seconds?: number, frames?: number): Diagnostics;
  setLightingMode(mode: 'full' | 'base'): void;
  setWaterEffects(enabled: boolean): void;
  setWaterDebugLayers(enabled: boolean): void;
  setWaterDebugLayer(layer: string, enabled: boolean): void;
  getDiagnostics(): Diagnostics;
  getLightingDiagnostics(): Record<string, unknown>;
  getRockDiagnostics(): Record<string, unknown>;
  getSimulationSnapshot(): Record<string, unknown>;
  captureRockMask(): MaskCapture;
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const outputName = argument('out', 'lighting-p2-baseline');
if (!/^[a-z0-9/-]+$/.test(outputName)) throw new Error('Invalid --out value.');
const tag = argument('tag', 'baseline');
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid --tag value.');
const scenario = argument('scenario', 'encounter');
if (scenario !== 'encounter') {
  throw new Error('P2 baseline is fixed to the Encounter scenario; --scenario must be encounter.');
}
const captureTime = Number.parseFloat(argument('time', '17'));
if (!Number.isFinite(captureTime) || captureTime < 0) throw new Error('Invalid --time value.');
const requestedModes = argument('modes', 'base,fog,final')
  .split(',')
  .filter((mode) => ['base', 'fog', 'final'].includes(mode)) as Mode[];
if (requestedModes.length === 0) throw new Error('--modes needs at least one of base,fog,final.');
const poseFilter = argument('poses', 'all')
  .split(',')
  .filter((name) => name.length > 0);
const width = Math.max(320, Number.parseInt(argument('width', '960'), 10));
const height = Math.max(180, Number.parseInt(argument('height', '540'), 10));
const port = Number.parseInt(argument('port', '5197'), 10);
const extraQuery = argument('extra-query', '');
const withMasks = argument('masks', '1') === '1';
const withStats = argument('stats', '1') === '1';
const maskPoseFilter = argument('mask-poses', 'all')
  .split(',')
  .filter((name) => name.length > 0);
const serveDist = argument('serve-dist', '');
const waitUntil = serveDist ? 'domcontentloaded' : 'networkidle';
const channel = argument('channel', '');
const softwareRendering = argument('software', channel ? '0' : '1') === '1';
const rendererNote = softwareRendering
  ? 'SwiftShader software rendering; screenshots only, not hardware performance data.'
  : `Hardware capture (${channel || 'bundled chromium'}); screenshots for visual review, not a benchmark.`;

const presetPoses: PoseDefinition[] = [
  { name: 'overview', kind: 'preset', cameraMode: 'overview' },
  { name: 'school', kind: 'preset', cameraMode: 'school' },
  { name: 'predator', kind: 'preset', cameraMode: 'predator' },
];

{
  // Same fixed far orbit as the P1 baseline: 90 m at 45°, target (-2, 9, 0).
  const azimuth = (45 * Math.PI) / 180;
  const distance = 90;
  const target: [number, number, number] = [-2, 9, 0];
  presetPoses.push({
    name: 'free',
    kind: 'fixed',
    position: [
      target[0] + distance * Math.sin(azimuth),
      target[1],
      target[2] + distance * Math.cos(azimuth),
    ],
    target,
  });
}

const sunX = UNDERWATER_SUN_DIRECTION[0];
const sunZ = UNDERWATER_SUN_DIRECTION[2];
// Camera sits opposite the sun in the horizontal plane, so the reef core is
// backlit and the diagnostic sees the same dark side the user reported.
const backlitAzimuth = Math.atan2(-sunX, -sunZ);
const reefPoses: PoseDefinition[] = REEF_OBSTACLES.map((obstacle, index) => {
  const [cx, cy, cz] = obstacle.center;
  const azimuth = backlitAzimuth + (index - 2) * (12 * Math.PI) / 180;
  // Keep the whole reef body in frame from above the kelp/coral crowns: a
  // 9 m eye-level pose sits inside the epibiont field and hides the rock.
  const distance = 11.5 + obstacle.radius * 0.5;
  const x = cx + Math.sin(azimuth) * distance;
  const z = cz + Math.cos(azimuth) * distance;
  const y = Math.max(floorHeightAt(x, z) + 1.1, cy + 3.2);
  return {
    name: `reef-${index}`,
    kind: 'fixed',
    position: [x, y, z],
    target: [cx, cy + 0.3, cz],
  };
});

const topPose: PoseDefinition = {
  name: 'top',
  kind: 'fixed',
  position: [-2, 46, 0.1],
  target: [-2, 4, 0],
};

const allPoses = [...presetPoses, ...reefPoses, topPose];
const poses = poseFilter.includes('all')
  ? allPoses
  : allPoses.filter((pose) => poseFilter.includes(pose.name));
if (poses.length === 0) throw new Error('--poses did not match any pose name.');

const startedAt = Date.now();
const stage = (message: string) => console.log(`[lighting ${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/${outputName}`;
mkdirSync(artifacts, { recursive: true });

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
};

/**
 * Production-build static server. Vite's dev transform graph costs ~90 s per
 * SwiftShader page load in this environment; serving `dist/` drops that to
 * ~20 s, which is the difference between a workable software baseline and a
 * run that cannot finish inside one shell call.
 */
async function startStaticServer(root: string, listenPort: number) {
  const rootPrefix = `${normalize(root)}/`;
  const server = createHttpServer(async (request, response) => {
    try {
      const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
      let filePath = normalize(join(root, requested));
      if (!filePath.startsWith(rootPrefix) && filePath !== normalize(root)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        info = await stat(filePath).catch(() => null);
      }
      if (!info) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      const data = await readFile(filePath);
      response.writeHead(200, {
        'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(data);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', resolve);
  });
  return server;
}

let closeServer: () => Promise<void>;
if (serveDist) {
  const staticRoot = resolvePath(projectRoot, serveDist);
  const staticServer = await startStaticServer(staticRoot, port);
  closeServer = () => new Promise((resolve) => staticServer.close(() => resolve()));
  stage(`static server listening on ${port} (${staticRoot})`);
} else {
  const server = await createServer({
    root: projectRoot,
    cacheDir: join(tmpdir(), 'blue-current-vite', `lighting-baseline-${port}`),
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen();
  closeServer = () => server.close();
  stage(`vite server listening on ${port}`);
}

const browser = await chromium.launch({
  headless: true,
  channel: channel || undefined,
  args: softwareRendering
    ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--no-sandbox'],
});
if (!softwareRendering) stage(`hardware browser channel ${channel || 'bundled chromium'}`);

const environmentCss = `
  .masthead,
  .control-panel,
  .panel-scrim,
  .viewport-topbar,
  .depth-rail,
  .predator-watch,
  .scene-caption,
  .telemetry-strip,
  .scene-search-state,
  .viewport-vignette,
  .capture-toast {
    display: none !important;
  }
  .workspace {
    display: block !important;
    padding: 0 !important;
  }
  .viewport-shell {
    position: fixed !important;
    inset: 0 !important;
    border-radius: 0 !important;
  }
`;

function saveDataUrl(filePath: string, dataUrl: string): void {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error(`Capture did not return PNG data: ${filePath}`);
  writeFileSync(filePath, Buffer.from(dataUrl.slice(prefix.length), 'base64'));
}

async function captureMode(mode: Mode): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  const entries: Record<string, unknown>[] = [];
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const query = [
    `scenario=${scenario}`,
    `lighting=${mode === 'base' ? 'base' : 'full'}`,
    extraQuery,
  ].filter((part) => part.length > 0).join('&');

  stage(`[${mode}] page.goto`);
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DebugApi }
  ).__blueCurrent?.ready === true);
  stage(`[${mode}] app ready`);

  await page.addStyleTag({ content: environmentCss });
  await page.waitForTimeout(600);

  await page.evaluate(({ mode: currentMode }) => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    api.setScenario('encounter');
    api.setViewMode('observation');
    api.setGridVisible(false);
    if (currentMode === 'base') {
      api.setLightingMode('base');
      api.setWaterEffects(false);
    } else if (currentMode === 'fog') {
      api.setLightingMode('full');
      api.setWaterDebugLayers(false);
      api.setWaterDebugLayer('sceneFog', true);
      api.setWaterDebugLayer('waterAttenuation', true);
      api.setWaterDebugLayer('volumetricScattering', true);
    } else {
      api.setLightingMode('full');
      api.setWaterDebugLayers(true);
    }
  }, { mode });
  stage(`[${mode}] scene configured`);

  // Freeze the animation loop; every frame below is an explicit debug render.
  await page.evaluate(() => {
    (window as unknown as { requestAnimationFrame: (callback: FrameRequestCallback) => number })
      .requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(500);

  const diagnostics = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getDiagnostics());
  const targetStep = Math.round(captureTime * 60);
  const currentStep = Math.round(diagnostics.simulationTime * 60);
  if (currentStep > targetStep) {
    throw new Error(`Simulation already at ${diagnostics.simulationTime}s, past ${captureTime}s.`);
  }
  if (targetStep > currentStep) {
    await page.evaluate((steps) => (
      window as unknown as { __blueCurrent: DebugApi }
    ).__blueCurrent.step(steps), targetStep - currentStep);
  }
  await page.evaluate((time) => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.setVisualTime(time), captureTime);
  stage(`[${mode}] simulation time ${captureTime}s ready`);

  const lighting = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getLightingDiagnostics());
  const rockDiagnostics = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getRockDiagnostics());
  const simulationSnapshot = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getSimulationSnapshot());

  const jsonPath = `${artifacts}/${tag}-${mode}.json`;
  const poseOrder = new Map(allPoses.map((pose, index) => [pose.name, index]));
  const persisted = new Map<string, Record<string, unknown>>();
  if (existsSync(jsonPath)) {
    try {
      const previous = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        entries?: Record<string, unknown>[];
      };
      for (const entry of previous.entries ?? []) persisted.set(String(entry.pose), entry);
    } catch {
      persisted.clear();
    }
  }

  // Chunked software runs resume by merging entries for the poses they cover;
  // a checkpoint is written after every pose so a killed SwiftShader call does
  // not lose the completed captures.
  const writeModeJson = (
    currentEntries: Record<string, unknown>[],
    currentErrors: string[],
  ): Record<string, unknown> => {
    for (const entry of currentEntries) persisted.set(String(entry.pose), entry);
    const mergedEntries = [...persisted.values()].sort(
      (first, second) => (poseOrder.get(String(first.pose)) ?? 99)
        - (poseOrder.get(String(second.pose)) ?? 99),
    );
    const payload = {
      scenario,
      captureTime,
      mode,
      tag,
      viewport: { width, height },
      ui: 'environment (canvas only)',
      poses: allPoses.map((pose) => ({
        name: pose.name,
        kind: pose.kind,
        cameraMode: pose.cameraMode ?? null,
        position: pose.position ?? null,
        target: pose.target ?? null,
      })),
      capturedPoses: mergedEntries.map((entry) => entry.pose),
      renderer: rendererNote,
      lightingDiagnostics: lighting,
      rockDiagnostics,
      simulationSnapshot,
      entries: mergedEntries,
      browserErrors: currentErrors,
    };
    writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  };

  for (const pose of poses) {
    const result = await page.evaluate(async ({ poseDefinition, captureMask, computeStats }) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      if (poseDefinition.kind === 'preset' && poseDefinition.cameraMode) {
        api.setCameraMode(poseDefinition.cameraMode);
        api.settleCamera(2.4, 14);
      } else if (poseDefinition.position && poseDefinition.target) {
        api.setCameraPose(poseDefinition.position, poseDefinition.target);
      }
      api.settleVisual(1.2, 12);
      const frameDiagnostics = api.step(0);
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Missing WebGL canvas.');
      const dataUrl = canvas.toDataURL('image/png');

      let mask: MaskCapture | null = null;
      let stats: MaskStats | null = null;
      if (captureMask && computeStats) {
        mask = api.captureRockMask();
        const [finalImage, maskImage] = await Promise.all([
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Could not decode the final capture image.'));
            image.src = dataUrl;
          }),
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Could not decode the rock mask image.'));
            image.src = mask?.dataUrl ?? '';
          }),
        ]);
        const statsCanvas = document.createElement('canvas');
        statsCanvas.width = finalImage.width;
        statsCanvas.height = finalImage.height;
        const context = statsCanvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create the statistics canvas.');
        context.drawImage(finalImage, 0, 0);
        const finalPixels = context.getImageData(0, 0, statsCanvas.width, statsCanvas.height).data;
        context.clearRect(0, 0, statsCanvas.width, statsCanvas.height);
        context.drawImage(maskImage, 0, 0);
        const maskPixelsData = context.getImageData(0, 0, statsCanvas.width, statsCanvas.height).data;

        let maskPixels = 0;
        let pureBlackPixels = 0;
        let nearBlackPixels = 0;
        let rockClippedPixels = 0;
        let frameClippedPixels = 0;
        let luminanceSum = 0;
        let leftSum = 0;
        let leftCount = 0;
        let rightSum = 0;
        let rightCount = 0;
        const total = statsCanvas.width * statsCanvas.height;
        for (let offset = 0; offset < finalPixels.length; offset += 4) {
          const red = finalPixels[offset];
          const green = finalPixels[offset + 1];
          const blue = finalPixels[offset + 2];
          const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          luminanceSum += luminance;
          const pixelX = (offset / 4) % statsCanvas.width;
          if (pixelX < statsCanvas.width / 2) {
            leftSum += luminance;
            leftCount += 1;
          } else {
            rightSum += luminance;
            rightCount += 1;
          }
          const clipped = red >= 250 || green >= 250 || blue >= 250;
          if (clipped) frameClippedPixels += 1;
          if (maskPixelsData[offset] > 127) {
            maskPixels += 1;
            if (red <= 2 && green <= 2 && blue <= 2) pureBlackPixels += 1;
            if (red <= 8 && green <= 8 && blue <= 8) nearBlackPixels += 1;
            if (clipped) rockClippedPixels += 1;
          }
        }
        stats = {
          width: statsCanvas.width,
          height: statsCanvas.height,
          maskPixels,
          maskCoverage: maskPixels / total,
          pureBlackPixels,
          pureBlackRatioOfMask: maskPixels > 0 ? pureBlackPixels / maskPixels : null,
          nearBlackRatioOfMask: maskPixels > 0 ? nearBlackPixels / maskPixels : null,
          rockClippedPixels,
          rockClippedRatioOfMask: maskPixels > 0 ? rockClippedPixels / maskPixels : null,
          frameClippedPixels,
          frameClippedRatio: frameClippedPixels / total,
          meanLuminance: luminanceSum / total,
          leftMeanLuminance: leftCount > 0 ? leftSum / leftCount : null,
          rightMeanLuminance: rightCount > 0 ? rightSum / rightCount : null,
        };
      }
      return { diagnostics: frameDiagnostics, dataUrl, mask, stats };
    }, {
      poseDefinition: pose,
      captureMask: mode === 'final'
        && withMasks
        && (maskPoseFilter.includes('all') || maskPoseFilter.includes(pose.name)),
      computeStats: withStats,
    });

    const filename = `${tag}-${mode}-${pose.name}.png`;
    saveDataUrl(`${artifacts}/${filename}`, result.dataUrl);
    let maskFile: string | null = null;
    if (result.mask) {
      maskFile = `${tag}-${mode}-${pose.name}-mask.png`;
      saveDataUrl(`${artifacts}/${maskFile}`, result.mask.dataUrl);
    }
    entries.push({
      mode,
      pose: pose.name,
      poseKind: pose.kind,
      requestedPose: pose.kind === 'fixed' ? { position: pose.position, target: pose.target } : null,
      file: filename,
      maskFile,
      cameraMode: result.diagnostics.cameraMode,
      cameraPosition: result.diagnostics.cameraPosition,
      cameraTarget: result.diagnostics.cameraTarget,
      cameraDistance: result.diagnostics.cameraDistance,
      drawCalls: result.diagnostics.drawCalls,
      renderTriangles: result.diagnostics.renderTriangles,
      simulationTime: result.diagnostics.simulationTime,
      fishCount: result.diagnostics.fishCount,
      predatorState: result.diagnostics.predatorState,
      predatorTargetIndex: result.diagnostics.predatorTargetIndex,
      predatorTargetPosition: result.diagnostics.predatorTargetPosition,
      lightingMode: result.diagnostics.lightingMode,
      rockDebugMode: result.diagnostics.rockDebugMode,
      waterDebug: result.diagnostics.waterDebug,
      mask: result.mask
        ? {
          file: maskFile,
          width: result.mask.width,
          height: result.mask.height,
          coveredPixels: result.mask.coveredPixels,
        }
        : null,
      maskStats: result.stats,
    });
    const blackPercent = result.stats?.pureBlackRatioOfMask;
    stage(
      `[${mode}] captured ${pose.name}`
      + (blackPercent !== null && blackPercent !== undefined
        ? ` (rock black ${(blackPercent * 100).toFixed(3)}%)`
        : ''),
    );
    writeModeJson(entries, []);
  }

  await page.close().catch(() => undefined);
  const payload = writeModeJson(entries, errors);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  stage(`[${mode}] wrote ${tag}-${mode}.json (${persisted.size} poses)`);
  return payload;
}

let failed = false;
try {
  for (const mode of requestedModes) {
    await captureMode(mode);
  }
} catch (error) {
  failed = true;
  console.error(error);
  throw error;
} finally {
  if (process.env.BLUE_CURRENT_CAPTURE_FORCE_EXIT === '1') {
    process.exit(failed ? 1 : 0);
  }
  await browser.close();
  await closeServer();
}
