import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * In-game capture for the reef sample / variant set at identical camera
 * positions, seed, fish count and paused simulation time. ?reef=off is the
 * untouched baseline; ?reef=sample replaces obstacle 2; ?reef=set replaces all
 * five anchored large rocks.
 *
 * Images come from the debug captureCameraSheet() path: it renders explicitly
 * into the canvas and returns a PNG data URL, avoiding SwiftShader composites
 * that stall Playwright's normal screenshot op.
 */

type Pose = readonly [number, number, number];

interface ReefStats {
  id: string;
  label: string;
  anchorIndex: number;
  trianglesNear: number;
  trianglesMid: number;
  trianglesFar: number;
  height: number;
  width: number;
  depth: number;
  epibiontInstances: number;
  epibiontTriangles: number;
  epibiontCoverage: number;
  apronPieces: number;
  apronTriangles: number;
}

interface Diagnostics {
  reefSample: boolean;
  reefSampleStats: ReefStats | null;
  reefSet: boolean;
  reefSetStats: ReefStats[];
  glbRockMode: string;
  glbRockInstances: Record<string, number>;
  glbRockTriangles: number;
  coralModel: string;
  coralInstances: number;
  coralTriangles: number;
  drawCalls: number;
  renderTriangles: number;
  cameraMode: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  simulationTime: number;
  fishCount: number;
  scenarioSeed: number;
  browserErrors?: string[];
}

interface DebugApi {
  ready: boolean;
  pause(): void;
  step(count?: number): Diagnostics;
  setVisualTime(seconds: number): Diagnostics;
  regroupSchool(): void;
  setCameraMode(mode: 'overview' | 'school' | 'predator' | 'free'): void;
  setCameraPose(position: readonly [number, number, number], target: readonly [number, number, number]): Diagnostics;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  getDiagnostics(): Diagnostics;
  captureCameraSheet(
    poses: readonly { position: Pose; target: Pose }[],
    columns: number,
    rows: number,
    width?: number,
    height?: number,
  ): string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const modeArgument = process.argv.find((value) => value.startsWith('--mode='));
const requestedMode = modeArgument?.split('=')[1];
if (requestedMode !== 'off' && requestedMode !== 'sample' && requestedMode !== 'set' && requestedMode !== 'default') {
  throw new Error('Run with --mode=off, --mode=sample, --mode=set or --mode=default (one mode per process to fit the shell cap).');
}
const mode: 'off' | 'sample' | 'set' | 'default' = requestedMode;

type VariantId = 'hero' | 'b' | 'c' | 'd' | 'e';
const variantArgument = process.argv.find((value) => value.startsWith('--variant='));
const variant = (variantArgument?.split('=')[1] ?? 'hero') as VariantId;
if (!['hero', 'b', 'c', 'd', 'e'].includes(variant)) {
  throw new Error('--variant must be hero, b, c, d or e.');
}

const CLOSE_POSES: Record<VariantId, { position: Pose; target: Pose }> = {
  hero: { position: [-7.5, 6.0, -1.0], target: [0, 4.2, -9] },
  b: { position: [-2.0, 9.0, 4.0], target: [-7, 4.2, -3] },
  c: { position: [10.5, 8.0, 9.5], target: [5, 3.8, 4] },
  d: { position: [15.5, 7.5, -1.0], target: [11, 3.8, -7] },
  e: { position: [-7.0, 8.5, 15.0], target: [-12, 4.2, 9] },
};

const viewArgument = process.argv.find((value) => value.startsWith('--view='));
const view = viewArgument?.split('=')[1] ?? 'both';
if (view !== 'both' && view !== 'overview' && view !== 'close') {
  throw new Error('--view must be both, overview or close.');
}
const sizeArgument = process.argv.find((value) => value.startsWith('--size='));
const sizeValue = sizeArgument?.split('=')[1] ?? '900x640';
const [captureWidth, captureHeight] = sizeValue.split('x').map((value) => Number(value));
if (!Number.isFinite(captureWidth) || !Number.isFinite(captureHeight)) {
  throw new Error('--size must look like 900x640.');
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(projectRoot, 'test-artifacts', 'reef-sample');
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: process.env.BLUE_CURRENT_VITE_CACHE ?? join(projectRoot, '.vite', 'reef-sample-game'),
  server: { host: '127.0.0.1', port: 5184, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const coralArgument = process.argv.find((value) => value.startsWith('--coral='));
const coralMode = coralArgument?.split('=')[1] ?? 'temperate';
if (coralMode !== 'temperate' && coralMode !== 'full' && coralMode !== 'off') {
  throw new Error('--coral must be temperate, full or off.');
}
const coralParam = coralMode === 'off' ? '0' : coralMode;
const bare = process.argv.includes('--bare');
const common = `scenario=calm&fishCount=${bare ? 0 : 60}&clownfish=${bare ? 0 : 100}&coral=${coralParam}&kelp=${bare ? 0 : 1}&seaweed=${bare ? 0 : 1}`;
const viewSuffix = bare ? '-bare' : '';

async function capture(
  page: import('playwright').Page,
  label: string,
  pose: { position: Pose; target: Pose },
  diag: Diagnostics,
  width: number,
  height: number,
): Promise<void> {
  const dataUrl = await page.evaluate((sheetPose) => {
    const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    return debug.captureCameraSheet([sheetPose], 1, 1, sheetPose.width, sheetPose.height);
  }, { ...pose, width, height });
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  writeFileSync(join(artifacts, label), Buffer.from(base64, 'base64'));
  writeFileSync(join(artifacts, `${label.replace('.png', '')}-diagnostics.json`), JSON.stringify(diag, null, 2));
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    if (message.text().startsWith('Reef sample')) console.log(message.text());
    if (message.text().startsWith('Hero reef sample')) console.log(message.text());
    if (message.text().startsWith('Reef set active')) console.log(message.text());
    if (message.text().startsWith('Reef ')) console.log(message.text());
  });

  const results: Record<string, Diagnostics> = {};

  const reefQuery = mode === 'default' ? '' : `&reef=${mode}`;
  await page.goto(`http://127.0.0.1:5184/index.html?${common}${reefQuery}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
    { timeout: 180000 },
  );
  await page.evaluate(() => {
    const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    debug.pause();
    debug.regroupSchool();
  });
  await page.evaluate(() => {
    (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.setVisualTime(18);
  });

  if (view !== 'close') {
    const overview = await page.evaluate(() => {
      const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      debug.setCameraMode('overview');
      debug.settleCamera(3.0, 30);
      return debug.getDiagnostics();
    });
    const overviewLabel = mode === 'set' || mode === 'default'
      ? `game-${mode}-${variant}-overview${viewSuffix}.png`
      : `game-${mode}-overview${viewSuffix}.png`;
    await capture(
      page,
      overviewLabel,
      { position: overview.cameraPosition, target: overview.cameraTarget },
      overview,
      captureWidth,
      captureHeight,
    );
    results['overview'] = overview;
  }

  if (view !== 'overview') {
    // Close three-quarter at the selected reef.
    const closePose = CLOSE_POSES[variant];
    const close = await page.evaluate((pose) => {
      const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      debug.setCameraPose(pose.position, pose.target);
      debug.settleCamera(0.0, 2);
      return debug.getDiagnostics();
    }, closePose);
    const closeLabel = mode === 'set' || mode === 'default'
      ? `game-${mode}-${variant}-close${viewSuffix}.png`
      : `game-${mode}-close${viewSuffix}.png`;
    await capture(page, closeLabel, closePose, close, captureWidth, captureHeight);
    results['close'] = close;
  }

  const diag = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  assert(errors.length === 0, `Browser errors at ${mode}:\n${errors.join('\n')}`);
  if (mode === 'off') {
    assert(!diag.reefSample, 'reef=off unexpectedly has the hero sample.');
    assert(!diag.reefSet, 'reef=off unexpectedly has the reef set.');
  } else if (mode === 'sample') {
    assert(diag.reefSample, 'reef=sample did not activate the hero sample.');
    assert(diag.reefSampleStats?.trianglesNear === 11976,
      `sample near LOD ${diag.reefSampleStats?.trianglesNear} is not the authored 11976.`);
    assert(diag.glbRockInstances.large === 5,
      'archetype instance count changed; collision/layout bookkeeping must stay identical.');
  } else {
    assert(diag.reefSet, `reef=${mode} did not activate the reef set.`);
    assert(diag.reefSetStats.length === 5, `reef set has ${diag.reefSetStats.length} reefs, expected 5.`);
    const expected: Record<string, number> = { hero: 11976, b: 11800, c: 11496, d: 11400, e: 11674 };
    for (const stats of diag.reefSetStats) {
      assert(stats.trianglesNear === expected[stats.id],
        `reef ${stats.id} near LOD ${stats.trianglesNear} is not the authored ${expected[stats.id]}.`);
    }
    assert(diag.glbRockInstances.large === 5,
      'archetype instance count changed; collision/layout bookkeeping must stay identical.');
  }

  const report = {
    passed: true,
    mode,
    variant: mode === 'set' || mode === 'default' ? variant : null,
    common,
    views: results,
    final: diag,
    browserErrors: errors,
  };
  const reportName = mode === 'set' || mode === 'default'
    ? `game-${mode}-${variant}${viewSuffix}-results.json`
    : `game-${mode}${viewSuffix}-results.json`;
  writeFileSync(join(artifacts, reportName), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
