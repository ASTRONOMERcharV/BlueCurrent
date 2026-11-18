import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  fps: number;
  renderMs: number;
  p95FrameMs: number;
  searchMode: 'grid' | 'brute-force';
  predatorState: string;
  occupiedCells: number | null;
  fishCount: number;
  simulationTime: number;
  totalSteps: number;
  captures: number;
  averageNeighbors: number;
  simulationMs: number;
  lastStepMs: number;
  candidatesExamined: number;
  threatenedCount: number;
  shelteredCount: number;
  schoolCount: number;
  droppedSteps: number;
  paused: boolean;
  viewMode: 'observation' | 'laboratory';
  scenarioId: 'calm' | 'encounter' | 'obstacles';
  scenarioSeed: number;
  cameraMode: string;
  debugLayers: Record<string, boolean>;
  sampleFishIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  coralModel: 'off' | 'temperate' | 'full';
  coralInstances: number;
  kelpTriangles: number;
  drawCalls: number;
  renderTriangles: number;
}

interface DebugApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
  pause(): void;
  resume(): void;
  step(count?: number): Diagnostics;
  setScenario(id: Diagnostics['scenarioId']): void;
  setViewMode(mode: Diagnostics['viewMode']): void;
  setCameraMode(mode: 'overview' | 'school' | 'predator' | 'free'): void;
  setGridVisible(visible: boolean): void;
  setSearchMode(mode: Diagnostics['searchMode']): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stageArgument = process.argv.find((argument) => argument.startsWith('--stage='));
const stage = stageArgument?.split('=')[1] ?? 'all';
if (!['all', 'desktop', 'scenarios', 'checks', 'mobile'].includes(stage)) {
  throw new Error(`Unknown acceptance stage: ${stage}`);
}
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) ?? 5181);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid --port value.');
const baseUrl = `http://127.0.0.1:${port}`;
const artifacts = `${projectRoot}test-artifacts/observatory`;
mkdirSync(artifacts, { recursive: true });
const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/observatory-acceptance-${port}`,
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
const report: Record<string, unknown> = {
  stage,
  renderer: 'SwiftShader software renderer (forced by this sandbox); not hardware-GPU performance data',
};

async function evaluate<T>(page: Page, action: (api: DebugApi) => T): Promise<T> {
  return page.evaluate((callback) => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    return new Function('api', `return (${callback})(api)`)(api) as T;
  }, action.toString());
}

async function open(page: Page, scenario = 'encounter'): Promise<void> {
  await page.goto(`${baseUrl}/?scenario=${scenario}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true);
  await evaluate(page, (api) => api.pause());
}

try {
  const mobileOnly = stage === 'mobile';
  const page = await browser.newPage({
    viewport: mobileOnly ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await open(page, mobileOnly ? 'calm' : 'encounter');

  if (stage === 'all' || stage === 'desktop') {
    await evaluate(page, (api) => {
      api.setScenario('encounter');
      api.step(18);
      api.setCameraMode('overview');
    });
    await page.locator('#tab-behavior').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${artifacts}/observation.png`, fullPage: true, timeout: 120000 });
    const observation = await evaluate(page, (api) => api.getDiagnostics());
    assert(observation.coralModel === 'full', 'The default coral tier is not full.');
    assert(observation.coralInstances === 48, 'The full coral layer did not load.');
    assert(observation.shelteredCount >= 0, 'Sheltered count is not a real measurement.');
    assert(observation.kelpTriangles > 0, 'The kelp layer did not load.');

    const widthBefore = (await page.locator('#viewport').boundingBox())!.width;
    await page.locator('#panel-toggle').click();
    await page.waitForFunction(() => document.querySelector('.observatory')?.classList.contains('panel-closed') === true);
    await page.waitForFunction((minimumWidth) => {
      const viewport = document.getElementById('viewport');
      return viewport !== null && viewport.getBoundingClientRect().width > minimumWidth;
    }, widthBefore + 250, { timeout: 20000 });
    const widthAfter = (await page.locator('#viewport').boundingBox())!.width;
    assert(widthAfter > widthBefore + 250, `Collapsed console did not expand the viewport (${widthBefore} -> ${widthAfter}).`);
    await page.locator('#panel-toggle').click();
    await page.waitForTimeout(250);

    await evaluate(page, (api) => {
      api.setViewMode('laboratory');
      api.setGridVisible(true);
      api.setCameraMode('school');
      api.step(2);
    });
    await page.locator('#tab-environment').click();
    await page.waitForTimeout(800);
    const laboratory = await evaluate(page, (api) => api.getDiagnostics());
    assert(laboratory.viewMode === 'laboratory', 'Laboratory mode did not activate.');
    assert(laboratory.sampleFishIndex >= 0, 'No real fish was selected for debug visualization.');
    assert(laboratory.debugLayers.neighbors && laboratory.debugLayers.forces, 'Debug layers are not active.');
    assert((laboratory.occupiedCells ?? 0) > 0, 'Grid visualization has no occupied-cell data.');
    await page.screenshot({ path: `${artifacts}/laboratory.png`, fullPage: true, timeout: 120000 });
    Object.assign(report, { observation, laboratory, viewportCollapse: { widthBefore, widthAfter } });
  }

  if (stage === 'all' || stage === 'scenarios') {
    const scenarioDiagnostics: Record<string, Diagnostics> = {};
    for (const scenario of ['calm', 'encounter', 'obstacles'] as const) {
      await evaluate(page, (api) => {
        api.setViewMode('observation');
        api.setGridVisible(false);
        api.setCameraMode('overview');
      });
      await page.evaluate((id) => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.setScenario(id), scenario);
      if (scenario === 'encounter') await evaluate(page, (api) => api.step(18));
      await page.locator('#tab-behavior').click();
      await page.waitForTimeout(350);
      scenarioDiagnostics[scenario] = await evaluate(page, (api) => api.getDiagnostics());
      assert(scenarioDiagnostics[scenario].scenarioId === scenario, `Scenario ${scenario} did not activate.`);
      await page.screenshot({ path: `${artifacts}/scenario-${scenario}.png`, fullPage: true, timeout: 120000 });
    }
    assert(scenarioDiagnostics.calm.predatorState === 'standby', 'Calm scenario has an active predator.');
    assert(scenarioDiagnostics.encounter.predatorState !== 'standby', 'Encounter scenario has no predator.');

    const cameras: Record<string, string> = {};
    for (const camera of ['overview', 'school', 'predator', 'free'] as const) {
      await page.evaluate((mode) => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.setCameraMode(mode), camera);
      const mode = await evaluate(page, (api) => api.getDiagnostics().cameraMode);
      assert(mode === camera, `Camera ${camera} did not activate (received ${mode}).`);
      cameras[camera] = mode;
    }
    Object.assign(report, { scenarios: scenarioDiagnostics, cameras });
  }

  if (stage === 'all' || stage === 'checks') {
    const observationState = await evaluate(page, (api) => {
      api.setScenario('calm');
      api.setViewMode('observation');
      return api.step(60);
    });
    const laboratoryState = await evaluate(page, (api) => {
      api.setScenario('calm');
      api.setViewMode('laboratory');
      return api.step(60);
    });
    assert(observationState.fishCount === laboratoryState.fishCount, 'View mode changed the fish population.');
    assert(observationState.averageNeighbors === laboratoryState.averageNeighbors, 'View mode changed neighbor behavior.');
    assert(observationState.simulationTime === laboratoryState.simulationTime, 'View mode changed fixed-step time.');
    assert(observationState.candidatesExamined === laboratoryState.candidatesExamined, 'View mode changed search work.');

    const gridPerformance = await evaluate(page, (api) => {
      api.setScenario('obstacles');
      api.setSearchMode('grid');
      return api.step(180);
    });
    const brutePerformance = await evaluate(page, (api) => {
      api.setScenario('obstacles');
      api.setSearchMode('brute-force');
      return api.step(180);
    });
    assert(brutePerformance.occupiedCells === null, 'Brute force should expose N/A grid telemetry.');
    Object.assign(report, {
      modeInvariance: { observation: observationState, laboratory: laboratoryState },
      performanceComparison: {
        note: 'Same Obstacle Navigation seed, 180 additional fixed steps in a blocked browser task. averageStepMs is an EMA; not GPU time.',
        grid: gridPerformance,
        bruteForce: brutePerformance,
      },
    });

    // Two concurrent pages under SwiftShader cannot both finish loading the rich scene in a
    // reasonable budget, so the main page releases its GL context before the opt-in coral page.
    await page.goto('about:blank');
    const fullCoralPage = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    fullCoralPage.setDefaultTimeout(300000);
    try {
      await fullCoralPage.goto(`${baseUrl}/?scenario=calm&coral=full`, { waitUntil: 'networkidle' });
      await fullCoralPage.waitForFunction(
        () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
      );
      const fullCoral = await fullCoralPage.evaluate(
        () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
      );
      assert(fullCoral.coralModel === 'full', '?coral=full did not select the full coral tier.');
      assert(fullCoral.coralInstances === 48, 'The full coral tier did not restore 48 colonies.');
      Object.assign(report, { fullCoral });
    } finally {
      await fullCoralPage.close();
    }
  }

  if (stage === 'all' || stage === 'mobile') {
    if (stage === 'all') {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, 'calm');
    }
    assert(await page.locator('#control-panel').evaluate((element) => getComputedStyle(element).visibility === 'hidden'), 'Mobile drawer should start closed.');
    await page.screenshot({ path: `${artifacts}/mobile-observation.png`, fullPage: true, timeout: 120000 });
    await page.locator('#panel-toggle').click();
    await page.locator('#tab-environment').click();
    await page.waitForTimeout(250);
    assert(await page.locator('#panel-toggle').getAttribute('aria-expanded') === 'true', 'Mobile drawer did not open.');
    await page.screenshot({ path: `${artifacts}/mobile-drawer.png`, fullPage: true, timeout: 120000 });
    await page.locator('#panel-close').click();
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!mobileOverflow, 'Mobile layout has horizontal overflow.');
    Object.assign(report, { mobile: { overflow: mobileOverflow, drawer: 'PASS' } });
  }

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  Object.assign(report, { passed: true, browserErrors: errors });
  writeFileSync(`${artifacts}/results-${stage}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, stage, browserErrors: errors, artifacts }, null, 2));
  if (stage === 'checks') {
    const comparison = report.performanceComparison as { grid: Diagnostics; bruteForce: Diagnostics };
    console.log(JSON.stringify({
      gridAverageStepMs: comparison.grid.simulationMs,
      bruteAverageStepMs: comparison.bruteForce.simulationMs,
    }, null, 2));
  }
} finally {
  await browser.close();
  await server.close();
}
