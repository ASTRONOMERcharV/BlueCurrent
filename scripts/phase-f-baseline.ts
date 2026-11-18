import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * Phase F Round 1 baseline matrix.
 *
 * Runs rich-default encounter rows with explicit main/clown counts at a fixed
 * camera, equal simulated warm-up, fresh performance samples, and raw rAF
 * frame arrays. Pressure/extreme use a single predator as a documented proxy.
 * Hardware only by default; SwiftShader requires --allow-software for smoke.
 */

interface Diagnostics {
  fishCount: number;
  clownfishCount: number;
  predatorState: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  canvasWidth: number;
  canvasHeight: number;
  drawCalls: number;
  renderTriangles: number;
  simulationMs: number;
  lastStepMs: number;
  totalSteps: number;
  droppedSteps: number;
  averageNeighbors: number;
  candidatesExamined: number;
  fps: number;
  fpsFromSamples: number;
  renderMs: number;
  p95FrameMs: number;
  frameSampleCount: number;
  averageFrameMs: number;
  fishModel: string;
  clownfishModel: string;
  predatorModel: string;
  coralModel: string;
  kelpModel: string;
  seaweedModel: string;
  schoolCenter: [number, number, number];
}

interface PerformanceSnapshot {
  enabled: boolean;
  sampleSteps: number;
  totalMs: number;
  phases: Record<string, number>;
  otherMs: number;
}

interface PerformanceDiagnostics {
  simulation: PerformanceSnapshot;
  render: PerformanceSnapshot;
  renderer: {
    memory: { geometries: number; textures: number } | null;
    programs: number | null;
    gpuTimer: {
      available: boolean;
      extension: string | null;
      measured: boolean;
      frameMs: number | null;
      sampleCount: number;
      emaMs: number | null;
      disjointSamples: number;
    };
  };
  memory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
  droppedSteps: number;
  frameSampleCount: number;
  simulationMs: number;
  renderMs: number;
}

interface Api {
  ready: boolean;
  pause(): void;
  resume(): void;
  step(count?: number): Diagnostics;
  setFishCount(count: number): void;
  setClownfishCount(count: number): void;
  updateConfig(patch: { predatorEnabled?: boolean }): void;
  releasePredator(): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  resetPerformanceSamples(): void;
  getDiagnostics(): Diagnostics;
  getPerformanceDiagnostics(): PerformanceDiagnostics;
}

interface PageVisibility {
  visibility: string;
  focused: boolean;
}

/** `gpu` is reserved for a future GPU-only capture; current telemetry is off/full. */
type SampleMode = 'off' | 'gpu' | 'full';

interface CanvasInfo {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  devicePixelRatio: number;
  effectivePixelRatio: number | null;
}

interface PageViewport {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

interface RefreshEstimate {
  estimateMs: number | null;
  estimateHz: number | null;
  method: string;
}

interface BuildIdentity {
  packageVersion: string;
  commit: string | null;
  dirty: boolean | null;
  distIndexMtime: string | null;
}

interface RowSpec {
  id: string;
  main: number;
  clownfish: number;
  intendedPredators: number;
  measuredPredators: number;
  sampleMs: number;
  minFrames: number;
  maxSampleMs: number;
}

interface SampleSummary {
  row: string;
  repeat: number;
  width: number;
  height: number;
  telemetry: boolean;
  mode: SampleMode;
  intended: { main: number; clownfish: number; predators: number };
  measured: { main: number; clownfish: number; predators: number; predatorState: string };
  camera: { position: number[]; target: number[] };
  frameCount: number;
  durationMs: number;
  fpsMean: number;
  fpsMedian: number;
  frameMeanMs: number;
  frameMedianMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  droppedSteps: number;
  drawCalls: number;
  renderTriangles: number;
  averageNeighbors: number;
  candidatesExamined: number;
  simulationMs: number;
  lastStepMs: number;
  renderMs: number;
  totalSteps: number;
  stepsPerFrameMean: number | null;
  renderer: { vendor: string; renderer: string } | null;
  viewport: PageViewport | null;
  canvas: CanvasInfo | null;
  panelClosed: boolean | null;
  refresh: RefreshEstimate | null;
  build: BuildIdentity;
  simulationPhases: PerformanceSnapshot | null;
  renderPhases: PerformanceSnapshot | null;
  rendererStats: PerformanceDiagnostics['renderer'] | null;
  memory: PerformanceDiagnostics['memory'];
  visibility: { before: PageVisibility; after: PageVisibility };
  framesFile: string;
  screenshot: string | null;
  browserErrors: string[];
}

interface RunOptions {
  width: number;
  height: number;
  telemetry: boolean;
  sampleMs?: number;
  minFrames?: number;
  maxSampleMs?: number;
  label: string;
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const ROWS: RowSpec[] = [
  { id: 'base', main: 200, clownfish: 50, intendedPredators: 1, measuredPredators: 1, sampleMs: 10000, minFrames: 120, maxSampleMs: 30000 },
  { id: 'standard', main: 500, clownfish: 100, intendedPredators: 1, measuredPredators: 1, sampleMs: 10000, minFrames: 120, maxSampleMs: 30000 },
  { id: 'pressure', main: 1000, clownfish: 200, intendedPredators: 3, measuredPredators: 1, sampleMs: 30000, minFrames: 60, maxSampleMs: 90000 },
  { id: 'extreme', main: 2000, clownfish: 300, intendedPredators: 5, measuredPredators: 1, sampleMs: 30000, minFrames: 60, maxSampleMs: 90000 },
];

const out = argument('out', 'phase-f-baseline');
const repeats = Math.max(1, Math.min(10, Math.floor(Number(argument('repeats', '3')))));
const cooldownMs = Math.max(0, Math.min(600000, Math.floor(Number(argument('cooldown-ms', '0')))));
const repeatIndexOverride = Math.max(0, Math.floor(Number(argument('repeat-index', '0'))));
const width = Math.max(640, Math.floor(Number(argument('width', '1280'))));
const height = Math.max(360, Math.floor(Number(argument('height', '720'))));
const spotWidth = Math.max(width, Math.floor(Number(argument('spot-width', '1440'))));
const spotHeight = Math.max(height, Math.floor(Number(argument('spot-height', '900'))));
const port = Number(argument('port', '5225'));
const channel = argument('channel', '');
const headed = argument('headed', '1') === '1';
const allowSoftware = argument('allow-software', '0') === '1';
const software = argument('software', '0') === '1';
const runSpot = argument('spot', '1') === '1';
const runControl = argument('control', '1') === '1';
const quick = argument('quick', '0') === '1';
const onlyRow = argument('row', '');
const rowsArg = argument('rows', '');
const rowFilter = rowsArg
  ? new Set(rowsArg.split(',').map((value) => value.trim()).filter(Boolean))
  : null;
const telemetryEnabled = argument('telemetry', '1') === '1';
const sampleOverride = Number(argument('sample-ms', '0'));
const minFramesOverride = Number(argument('min-frames', '0'));
const maxSampleOverride = Number(argument('max-sample-ms', '0'));

const selectedRows = ROWS.filter((row) => (
  (!onlyRow || row.id === onlyRow) && (!rowFilter || rowFilter.has(row.id))
));
const effectiveRows = selectedRows.map((row) => ({
  ...row,
  sampleMs: sampleOverride > 0 ? sampleOverride : (quick ? 3000 : row.sampleMs),
  minFrames: minFramesOverride > 0 ? minFramesOverride : (quick ? 60 : row.minFrames),
  maxSampleMs: maxSampleOverride > 0 ? maxSampleOverride : (quick ? 15000 : row.maxSampleMs),
}));

const root = normalize(resolve('dist'));
const rootPrefix = `${root}${sep}`;
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.hdr': 'application/octet-stream',
  '.json': 'application/json',
};
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
    let filePath = normalize(join(root, requested));
    if (!filePath.startsWith(rootPrefix) && filePath !== root) {
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
    response.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(await readFile(filePath));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const artifacts = out.replace(/\\/g, '/').startsWith('test-artifacts/')
  ? resolve(out)
  : resolve('test-artifacts', out);
const sleep = (milliseconds: number): Promise<void> => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, milliseconds);
});
mkdirSync(join(artifacts, 'frames'), { recursive: true });
mkdirSync(join(artifacts, 'screenshots'), { recursive: true });
mkdirSync(join(artifacts, 'logs'), { recursive: true });

const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const buildIdentity = readBuildIdentity(packageVersion);
const append = argument('append', '0') === '1';
let previous: { startedAt?: string; samples?: SampleSummary[] } | null = null;
if (append) {
  try {
    previous = JSON.parse(readFileSync(join(artifacts, 'results.json'), 'utf8')) as {
      startedAt?: string;
      samples?: SampleSummary[];
    };
  } catch {
    previous = null;
  }
}
const startedAt = previous?.startedAt ?? new Date().toISOString();
const browser = await chromium.launch({
  headless: !headed,
  channel: channel || undefined,
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
  ],
});
const refreshEstimate = await estimateDisplayRefresh(browser);
const results: SampleSummary[] = previous?.samples ? [...previous.samples] : [];
let rendererInfo: { vendor: string; renderer: string } | null = null;
let environment: Record<string, unknown> | null = null;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function frameStats(frames: readonly number[]): {
  mean: number; median: number; p50: number; p95: number; p99: number;
} {
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
  return {
    mean,
    median: percentile(sorted, 0.5),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function assertRenderer(renderer: { vendor: string; renderer: string } | null): void {
  if (!renderer) return;
  const name = `${renderer.vendor} ${renderer.renderer}`.toLowerCase();
  const software = name.includes('swiftshader') || name.includes('llvmpipe') || name.includes('basic render');
  if (software && !allowSoftware) {
    throw new Error(`Software renderer ${renderer.renderer}; pass --allow-software for smoke only.`);
  }
}

async function readRenderer(page: Page): Promise<{ vendor: string; renderer: string } | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      renderer: String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    };
  });
}

function readBuildIdentity(packageVersion: string): BuildIdentity {
  let commit: string | null = null;
  let dirty: boolean | null = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    commit = null;
    dirty = null;
  }
  let distIndexMtime: string | null = null;
  try {
    distIndexMtime = statSync(join(resolve('dist'), 'index.html')).mtime.toISOString();
  } catch {
    distIndexMtime = null;
  }
  return { packageVersion, commit, dirty, distIndexMtime };
}

async function estimateDisplayRefresh(browser: Browser): Promise<RefreshEstimate> {
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  page.setDefaultTimeout(15000);
  try {
    await page.bringToFront();
    const frames = await Promise.race([
      page.evaluate<number[]>(`(async () => {
        const deltas = [];
        let last = performance.now();
        await new Promise((resolveFrames) => {
          const tick = (now) => {
            deltas.push(Math.max(0, now - last));
            last = now;
            if (deltas.length >= 60) resolveFrames();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return deltas;
      })()`),
      new Promise<number[]>((resolveTimeout) => setTimeout(() => resolveTimeout([]), 5000)),
    ]);
    const sorted = frames.filter((value) => value > 0).sort((a, b) => a - b);
    const estimateMs = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;
    return {
      estimateMs,
      estimateHz: estimateMs !== null && estimateMs > 0 ? 1000 / estimateMs : null,
      method: sorted.length > 0 ? 'blank-page-rAF-median-60' : 'blank-page-rAF-timeout',
    };
  } finally {
    await page.close();
  }
}

async function readPageMetrics(page: Page): Promise<{
  canvas: CanvasInfo | null;
  panelClosed: boolean | null;
  viewport: PageViewport | null;
}> {
  return page.evaluate<{
    canvas: CanvasInfo | null;
    panelClosed: boolean | null;
    viewport: PageViewport | null;
  }>(`(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect() ?? null;
    return {
      canvas: canvas && rect
        ? {
          width: canvas.width,
          height: canvas.height,
          clientWidth: rect.width,
          clientHeight: rect.height,
          devicePixelRatio: window.devicePixelRatio,
          effectivePixelRatio: rect.width > 0 ? canvas.width / rect.width : null,
        }
        : null,
      panelClosed: document.querySelector('.observatory')?.classList.contains('panel-closed') ?? null,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
    };
  })()`);
}

async function sampleFrames(page: Page, sampleMs: number, minFrames: number, maxSampleMs: number): Promise<number[]> {
  const script = `(async () => {
    const frames = [];
    const start = performance.now();
    let last = start;
    await new Promise((resolveSample) => {
      const tick = (now) => {
        frames.push(Math.max(0, now - last));
        last = now;
        const elapsed = now - start;
        const enoughTime = elapsed >= ${sampleMs} && frames.length >= ${minFrames};
        if (enoughTime || elapsed >= ${maxSampleMs}) resolveSample();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return frames;
  })()`;
  return page.evaluate<number[]>(script);
}

async function runSample(
  page: Page,
  row: RowSpec,
  repeat: number,
  options: RunOptions,
): Promise<SampleSummary> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  const query = `?scenario=encounter&lighting=full&obstacleShape=sphere&predator=blender`
    + `&perfTelemetry=${options.telemetry ? '1' : '0'}`;
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: Api }
  ).__blueCurrent?.ready === true, undefined, { polling: 250 });
  await page.waitForFunction(() => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    const diagnostics = api.getDiagnostics();
    return diagnostics.fishModel === 'blender'
      && diagnostics.clownfishModel === 'blender'
      && diagnostics.predatorModel === 'blender'
      && diagnostics.coralModel !== 'off'
      && diagnostics.kelpModel === 'blender'
      && diagnostics.seaweedModel === 'blender';
  }, undefined, { timeout: 180000, polling: 500 });
  await page.bringToFront();
  const visibilityBefore = await page.evaluate(() => ({
    visibility: document.visibilityState,
    focused: document.hasFocus(),
  }));

  const pageRenderer = await readRenderer(page);
  assertRenderer(pageRenderer);
  if (!rendererInfo) rendererInfo = pageRenderer;
  if (!environment) {
    environment = await page.evaluate(async () => {
      const battery = await (navigator as unknown as {
        getBattery?: () => Promise<{ charging: boolean; level: number }>;
      }).getBattery?.();
      const nav = navigator as unknown as {
        hardwareConcurrency?: number;
        deviceMemory?: number;
      };
      return {
        userAgent: navigator.userAgent,
        hardwareConcurrency: nav.hardwareConcurrency ?? null,
        deviceMemory: nav.deviceMemory ?? null,
        screen: {
          width: screen.width,
          height: screen.height,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight,
        },
        battery: battery ? { charging: battery.charging, level: battery.level } : null,
      };
    });
  }

  await page.evaluate(`(async () => {
    await new Promise((resolveWarm) => {
      let count = 0;
      const tick = () => {
        count += 1;
        if (count >= 60) resolveWarm();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  })()`);

  const prepared = await page.evaluate(({ rowSpec }) => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    api.pause();
    api.setFishCount(rowSpec.main);
    api.setClownfishCount(rowSpec.clownfish);
    api.updateConfig({ predatorEnabled: false });
    api.step(150);
    api.releasePredator();
    api.step(180);
    api.setCameraPose([30, 18, 29], [0, 6.5, -2]);
    api.settleCamera(0.6, 8);
    api.resetPerformanceSamples();
    return api.getDiagnostics();
  }, { rowSpec: { main: row.main, clownfish: row.clownfish } });

  await page.evaluate(() => (window as unknown as { __blueCurrent: Api }).__blueCurrent.resume());
  const sampleMs = options.sampleMs ?? row.sampleMs;
  const minFrames = options.minFrames ?? row.minFrames;
  const maxSampleMs = options.maxSampleMs ?? row.maxSampleMs;
  const frames = await sampleFrames(page, sampleMs, minFrames, maxSampleMs);
  const final = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    api.pause();
    return {
      diagnostics: api.getDiagnostics(),
      performance: api.getPerformanceDiagnostics(),
    };
  });
  const stats = frameStats(frames);
  const pageMetrics = await readPageMetrics(page);
  const framesFile = `frames/${options.label}-r${repeat}.json`;
  writeFileSync(join(artifacts, framesFile), `${JSON.stringify({
    row: row.id,
    repeat,
    label: options.label,
    sampleMs,
    frames,
  })}\n`);
  const screenshotFile = `screenshots/${options.label}-r${repeat}-${options.width}x${options.height}.png`;
  await page.screenshot({ path: join(artifacts, screenshotFile) });

  if (prepared.clownfishCount !== row.clownfish) {
    throw new Error(`clownfish count ${prepared.clownfishCount} != ${row.clownfish}`);
  }
  if (prepared.predatorState === 'standby') {
    throw new Error('predator was not released before sampling');
  }
  const after = final.performance;
  return {
    row: row.id,
    repeat,
    width: options.width,
    height: options.height,
    telemetry: options.telemetry,
    mode: options.telemetry ? 'full' : 'off',
    intended: { main: row.main, clownfish: row.clownfish, predators: row.intendedPredators },
    measured: {
      main: final.diagnostics.fishCount,
      clownfish: final.diagnostics.clownfishCount,
      predators: 1,
      predatorState: final.diagnostics.predatorState,
    },
    camera: {
      position: final.diagnostics.cameraPosition,
      target: final.diagnostics.cameraTarget,
    },
    frameCount: frames.length,
    durationMs: frames.reduce((sum, value) => sum + value, 0),
    fpsMean: stats.mean > 0 ? 1000 / stats.mean : 0,
    fpsMedian: stats.median > 0 ? 1000 / stats.median : 0,
    frameMeanMs: stats.mean,
    frameMedianMs: stats.median,
    p50Ms: stats.p50,
    p95Ms: stats.p95,
    p99Ms: stats.p99,
    droppedSteps: final.diagnostics.droppedSteps,
    drawCalls: final.diagnostics.drawCalls,
    renderTriangles: final.diagnostics.renderTriangles,
    averageNeighbors: final.diagnostics.averageNeighbors,
    candidatesExamined: final.diagnostics.candidatesExamined,
    simulationMs: final.diagnostics.simulationMs,
    lastStepMs: final.diagnostics.lastStepMs,
    renderMs: final.diagnostics.renderMs,
    totalSteps: final.diagnostics.totalSteps,
    stepsPerFrameMean: frames.length > 0
      ? (final.diagnostics.totalSteps - prepared.totalSteps) / frames.length
      : null,
    renderer: pageRenderer,
    viewport: pageMetrics.viewport,
    canvas: pageMetrics.canvas,
    panelClosed: pageMetrics.panelClosed,
    refresh: refreshEstimate,
    build: buildIdentity,
    simulationPhases: options.telemetry ? after.simulation : null,
    renderPhases: options.telemetry ? after.render : null,
    rendererStats: after.renderer,
    memory: after.memory,
    visibility: {
      before: visibilityBefore,
      after: await page.evaluate(() => ({
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      })),
    },
    framesFile,
    screenshot: screenshotFile,
    browserErrors: errors,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function aggregate(rows: readonly SampleSummary[]) {
  const rowIds = [...new Set(rows.map((sample) => sample.row))]
    .filter((row) => ROWS.some((spec) => spec.id === row));
  return rowIds.map((row) => {
    const samples = rows.filter((sample) => sample.row === row);
    const fps = samples.map((sample) => sample.fpsMean);
    const gpuValues = samples
      .map((sample) => sample.rendererStats?.gpuTimer.emaMs)
      .filter((value): value is number => typeof value === 'number');
    return {
      row,
      repeats: samples.length,
      width: samples[0]?.width ?? null,
      height: samples[0]?.height ?? null,
      medianFps: median(fps),
      medianMeanMs: median(samples.map((sample) => sample.frameMeanMs)),
      worstP95Ms: Math.max(...samples.map((sample) => sample.p95Ms), 0),
      fpsSpread: fps.length > 0 ? Math.max(...fps) / Math.max(1e-9, Math.min(...fps)) : null,
      droppedSteps: Math.max(...samples.map((sample) => sample.droppedSteps), 0),
      drawCalls: median(samples.map((sample) => sample.drawCalls)),
      renderTriangles: median(samples.map((sample) => sample.renderTriangles)),
      simulationMs: median(samples.map((sample) => sample.simulationMs)),
      renderMs: median(samples.map((sample) => sample.renderMs)),
      gpuEmaMs: gpuValues.length > 0 ? median(gpuValues) : null,
      gpuSamples: samples.reduce((sum, sample) => sum + (sample.rendererStats?.gpuTimer.sampleCount ?? 0), 0),
      sufficient: samples.every((sample) => sample.frameCount >= 60),
      allErrors: samples.flatMap((sample) => sample.browserErrors),
    };
  });
}

function writeSummary(): void {
  const aggregates = aggregate(results);
  const spot = results.find((sample) => sample.row === 'standard-spot');
  const control = results.find((sample) => sample.row === 'standard-control');
  const lines: string[] = [];
  lines.push('# Phase F Round 1 — hardware baseline', '');
  lines.push(`- Started: ${startedAt}`);
  lines.push(`- Finished: ${new Date().toISOString()}`);
  lines.push(`- Package: ${packageVersion}`);
  lines.push(`- Renderer: ${rendererInfo?.renderer ?? 'unknown'}`);
  lines.push(`- Vendor: ${rendererInfo?.vendor ?? 'unknown'}`);
  lines.push(`- Primary viewport: ${width}x${height} DPR1`);
  lines.push('- Method: fresh page per sample, 60 warm frames, deterministic 150+180-step replay, fixed overview pose, resetPerformanceSamples before sampling.');
  lines.push(`- Build: ${buildIdentity.commit ?? 'unknown git commit'}${buildIdentity.dirty === true ? ' (dirty tree)' : ''}; dist/index.html ${buildIdentity.distIndexMtime ?? 'N/A'}; refresh probe ${refreshEstimate.estimateHz?.toFixed(2) ?? 'N/A'} Hz via ${refreshEstimate.method}.`);
  lines.push('- Gate fields: per-sample mode, canvas/client size, device/effective DPR, panel state, total steps, steps per frame and renderer are in `results.json`.');
  lines.push('- Pressure/extreme use one predator as a documented proxy for 3/5; multi-predator is not implemented.');
  lines.push('');
  lines.push('## Matrix');
  lines.push('');
  lines.push('| Row | Repeats | Median FPS | Median mean ms | Worst P95 ms | GPU EMA ms | FPS spread | Dropped | Draws | Sim EMA ms | Render EMA ms | Errors |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of aggregates) {
    lines.push(`| ${row.row} | ${row.repeats} | ${row.medianFps.toFixed(1)} | ${row.medianMeanMs.toFixed(2)} | ${row.worstP95Ms.toFixed(2)} | ${row.gpuEmaMs?.toFixed(2) ?? 'N/A'} | ${row.fpsSpread?.toFixed(3) ?? 'N/A'} | ${row.droppedSteps} | ${row.drawCalls.toFixed(0)} | ${row.simulationMs.toFixed(2)} | ${row.renderMs.toFixed(2)} | ${row.allErrors.length} |`);
  }
  if (spot) {
    lines.push(`| standard 1440x900 spot | 1 | ${spot.fpsMean.toFixed(1)} | ${spot.frameMeanMs.toFixed(2)} | ${spot.p95Ms.toFixed(2)} | ${spot.rendererStats?.gpuTimer.emaMs?.toFixed(2) ?? 'N/A'} | N/A | ${spot.droppedSteps} | ${spot.drawCalls} | ${spot.simulationMs.toFixed(2)} | ${spot.renderMs.toFixed(2)} | ${spot.browserErrors.length} |`);
  }
  if (control) {
    lines.push(`| standard telemetry-off control | 1 | ${control.fpsMean.toFixed(1)} | ${control.frameMeanMs.toFixed(2)} | ${control.p95Ms.toFixed(2)} | N/A | N/A | ${control.droppedSteps} | ${control.drawCalls} | ${control.simulationMs.toFixed(2)} | ${control.renderMs.toFixed(2)} | ${control.browserErrors.length} |`);
  }
  lines.push('');
  lines.push('## Simulation phases (EMA, ms)');
  lines.push('');
  lines.push('| Row | boidsMain | boidsClown | predator | metrics | obstacleQuery | other |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of aggregates) {
    const samples = results.filter((sample) => sample.row === row.row && sample.telemetry && sample.simulationPhases);
    if (samples.length === 0) continue;
    const phases = (key: string) => median(samples.map((sample) => sample.simulationPhases?.phases[key] ?? 0));
    lines.push(`| ${row.row} | ${phases('boidsMain').toFixed(2)} | ${phases('boidsClown').toFixed(2)} | ${phases('predator').toFixed(2)} | ${phases('metrics').toFixed(2)} | ${phases('obstacleQuery').toFixed(2)} | ${median(samples.map((sample) => sample.simulationPhases?.otherMs ?? 0)).toFixed(2)} |`);
  }
  lines.push('');
  lines.push('## Render phases (EMA, ms)');
  lines.push('');
  lines.push('| Row | fish | clownfish | predator | debug | camera | environment | draw | other |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of aggregates) {
    const samples = results.filter((sample) => sample.row === row.row && sample.telemetry && sample.renderPhases);
    if (samples.length === 0) continue;
    const phases = (key: string) => median(samples.map((sample) => sample.renderPhases?.phases[key] ?? 0));
    lines.push(`| ${row.row} | ${phases('fish').toFixed(2)} | ${phases('clownfish').toFixed(2)} | ${phases('predator').toFixed(2)} | ${phases('debug').toFixed(2)} | ${phases('camera').toFixed(2)} | ${phases('environment').toFixed(2)} | ${phases('draw').toFixed(2)} | ${median(samples.map((sample) => sample.renderPhases?.otherMs ?? 0)).toFixed(2)} |`);
  }
  lines.push('');
  lines.push('## Memory and GPU');
  lines.push('');
  const sampleWithStats = results.find((sample) => sample.rendererStats);
  if (sampleWithStats?.rendererStats) {
    const stats = sampleWithStats.rendererStats;
    lines.push(`- renderer.info.memory: ${stats.memory ? `${stats.memory.geometries} geometries / ${stats.memory.textures} textures` : 'N/A'}`);
    lines.push(`- programs: ${stats.programs ?? 'N/A'}`);
    lines.push(`- GPU timer: ${stats.gpuTimer.available ? stats.gpuTimer.extension : 'not available'}; measured=${stats.gpuTimer.measured}; ema=${stats.gpuTimer.emaMs?.toFixed(2) ?? 'N/A'} ms; samples=${stats.gpuTimer.sampleCount}; disjoint=${stats.gpuTimer.disjointSamples}`);
  }
  const heap = sampleWithStats?.memory;
  lines.push(`- performance.memory heap used: ${heap ? `${(heap.usedJSHeapSize / 1048576).toFixed(1)} MiB` : 'N/A'}`);
  lines.push('');
  lines.push('## Limitations');
  lines.push('');
  lines.push('- SwiftShader is never hardware performance; hardware runs must show Intel Iris Xe / D3D11.');
  lines.push('- GPU frame time is measured with a disjoint timer query when the extension is usable; otherwise N/A. renderMs is still CPU submission, not GPU time.');
  lines.push('- Pressure/extreme measure 1 predator, not the roadmap 3/5; this gap must be closed before a full Phase F matrix sign-off.');
  lines.push('- Single machine, single session; thermal drift is mitigated by interleaved repeats and recorded battery state.');
  lines.push('');
  lines.push('Raw frame arrays are in `frames/`, per-sample summaries in `results.json`, environment in `metadata.json`.');
  writeFileSync(join(artifacts, 'summary.md'), `${lines.join('\n')}\n`);
  return;
}

try {
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const order = [...effectiveRows.slice((repeat - 1) % Math.max(1, effectiveRows.length)), ...effectiveRows.slice(0, (repeat - 1) % Math.max(1, effectiveRows.length))];
    for (const row of order) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(180000);
      try {
        const effectiveRepeat = repeatIndexOverride > 0 ? repeatIndexOverride : repeat;
        const label = `${row.id}-${width}`;
        results.push(await runSample(page, row, effectiveRepeat, {
          width,
          height,
          telemetry: telemetryEnabled,
          label,
        }));
        console.log(`${row.id} r${effectiveRepeat} done`);
      } finally {
        await page.close();
      }
      if (cooldownMs > 0) {
        console.log(`cooldown ${cooldownMs} ms`);
        await sleep(cooldownMs);
      }
    }
  }

  if (runSpot) {
    if (cooldownMs > 0) await sleep(cooldownMs);
    const standard = effectiveRows.find((row) => row.id === 'standard') ?? ROWS[1];    const page = await browser.newPage({ viewport: { width: spotWidth, height: spotHeight }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180000);
    try {
      const sample = await runSample(page, { ...standard, id: 'standard-spot' }, 1, {
        width: spotWidth,
        height: spotHeight,
        telemetry: telemetryEnabled,
        label: 'standard-spot',
      });
      results.push(sample);
      console.log('standard 1440x900 spot done');
    } finally {
      await page.close();
    }
  }

  if (runControl) {
    if (cooldownMs > 0) await sleep(cooldownMs);
    const standard = effectiveRows.find((row) => row.id === 'standard') ?? ROWS[1];
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180000);
    try {
      const sample = await runSample(page, { ...standard, id: 'standard-control' }, 1, {
        width,
        height,
        telemetry: false,
        label: 'standard-control',
      });
      results.push(sample);
      console.log('standard telemetry-off control done');
    } finally {
      await page.close();
    }
  }

  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify({
    schemaVersion: 'phase-f-baseline-v1',
    startedAt,
    finishedAt: new Date().toISOString(),
    packageVersion,
    build: buildIdentity,
    refresh: refreshEstimate,
    primaryViewport: { width, height, dpr: 1 },
    spotViewport: { width: spotWidth, height: spotHeight, dpr: 1 },
    rows: effectiveRows,
    samples: results,
    aggregates: aggregate(results),
  }, null, 2)}\n`);
  writeFileSync(join(artifacts, 'metadata.json'), `${JSON.stringify({
    packageVersion,
    build: buildIdentity,
    refresh: refreshEstimate,
    startedAt,
    finishedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    renderer: rendererInfo,
    environment,
    argv: process.argv.slice(2),
    method: {
      query: '?scenario=encounter&lighting=full&obstacleShape=sphere&predator=blender&perfTelemetry=<0|1>',
      warmFrames: 60,
      cooldownMs,
      simulatedWarmup: 'setFishCount + setClownfishCount, 150 steps predator-disabled, releasePredator, 180 steps',
      camera: { position: [30, 18, 29], target: [0, 6.5, -2] },
      resetPerformanceSamplesBeforeSampling: true,
    },
    power: 'record AC/battery and thermal state manually; navigator.getBattery when available',
    gpuTimer: results.find((sample) => sample.rendererStats)?.rendererStats?.gpuTimer ?? null,
  }, null, 2)}\n`);
  writeSummary();
  console.log(`wrote ${artifacts}`);
} finally {
  await browser.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
