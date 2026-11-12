import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  fps: number;
  renderMs: number;
  searchMode: string;
  predatorState: string;
  occupiedCells: number | null;
  fishCount: number;
  simulationTime: number;
  totalSteps: number;
  captures: number;
  averageNeighbors: number;
  canvasWidth: number;
  canvasHeight: number;
}

interface DebugApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
  pause(): void;
  resume(): void;
  reset(): void;
  step(count?: number): Diagnostics;
  setFishCount(count: number): void;
  setSearchMode(mode: 'grid' | 'brute-force'): void;
  releasePredator(): void;
  regroupSchool(): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.split('=')[1] ?? 5173);
if (!Number.isInteger(port) || port <= 0) throw new Error('Invalid --port value.');
const server = await createServer({
  root: projectRoot,
  cacheDir: process.env.BLUE_CURRENT_VITE_CACHE ?? join(projectRoot, '.vite', 'smoke-browser'),
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?fish=procedural&clownfish=0&coral=temperate&seaweed=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const api = (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent;
    return api?.ready === true;
  }, { timeout: 30000 });

  const initial = await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics());
  assert(initial.canvasWidth > 0 && initial.canvasHeight > 0, 'The WebGL canvas has no rendered dimensions.');
  assert(initial.fishCount === 500, `Expected 500 initial fish, received ${initial.fishCount}.`);
  await page.waitForTimeout(700);
  const running = await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics());
  assert(running.totalSteps > initial.totalSteps, 'Fixed-step simulation did not advance while running.');
  assert(running.averageNeighbors > 0, 'No real neighbor statistics were produced.');

  const beforePause = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    return api.getDiagnostics();
  });
  const afterSteps = await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.step(120));
  assert(afterSteps.totalSteps === beforePause.totalSteps + 120, 'Debug fixed-step control did not execute exactly 120 steps.');
  assert(afterSteps.fishCount <= beforePause.fishCount, 'Live population increased without a reset.');

  const brute = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.setSearchMode('brute-force');
    return api.step(1);
  });
  assert(brute.searchMode === 'brute-force' && brute.occupiedCells === null, 'Brute-force mode did not expose N/A grid telemetry.');
  assert(await page.locator('#grid-visible').isDisabled(), 'Grid debug toggle should be disabled in brute-force mode.');
  assert(!(await page.locator('#grid-visible').isChecked()), 'Grid debug toggle must not appear active without grid telemetry.');
  const grid = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.setSearchMode('grid');
    return api.step(1);
  });
  assert(grid.searchMode === 'grid' && (grid.occupiedCells ?? 0) > 0, 'Uniform-grid mode did not build occupied cells.');

  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.setFishCount(500);
    api.releasePredator();
    api.step(240);
  });
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.resume();
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${artifacts}/blue-current-desktop.png`, fullPage: true, timeout: 120000 });
  const finalDesktop = await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, 'Desktop layout has horizontal overflow.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true);
  const panelInitiallyHidden = await page.locator('#control-panel').evaluate((element) => getComputedStyle(element).visibility === 'hidden');
  assert(panelInitiallyHidden, 'Mobile parameter drawer should start closed.');
  await page.locator('#panel-toggle').click();
  await page.waitForTimeout(250);
  const panelExpanded = await page.locator('#panel-toggle').getAttribute('aria-expanded');
  assert(panelExpanded === 'true', 'Mobile parameter button did not open the drawer.');
  await page.locator('#panel-close').click();
  await page.waitForTimeout(250);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!mobileOverflow, 'Mobile layout has horizontal overflow.');
  await page.screenshot({ path: `${artifacts}/blue-current-mobile.png`, fullPage: true, timeout: 120000 });

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = { passed: true, initial, running, afterSteps, finalDesktop, browserErrors: errors };
  writeFileSync(`${artifacts}/smoke-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nScreenshots and results written to ${artifacts}`);
} finally {
  await browser.close();
  await server.close();
}
