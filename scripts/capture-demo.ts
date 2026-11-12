import { mkdirSync, writeFileSync } from 'node:fs';
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
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const screenshotDirectory = `${projectRoot}screenshots/`;
mkdirSync(screenshotDirectory, { recursive: true });
const server = await createServer({ root: projectRoot, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const browserVersion = browser.version();
const desktopOnly = process.argv.includes('--desktop-only');
const capturedAt = new Date().toISOString();
let webglRenderer = 'Unavailable';

const browserErrors: string[] = [];
const shots: Array<{ file: string; label: string; diagnostics: Diagnostics }> = [];

function writeCaptureReport(finalDiagnostics: Diagnostics | null, desktopComplete: boolean): void {
  const report = {
    capturedAt,
    browser: browserVersion,
    webglRenderer,
    note: 'Captured from the running program. The sandbox renderer is software based; frame-rate values in these images do not represent hardware GPU performance.',
    desktopComplete,
    shots,
    finalDiagnostics,
    browserErrors,
  };
  writeFileSync(`${screenshotDirectory}capture-results.json`, JSON.stringify(report, null, 2));
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const api = (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent;
    return api?.ready === true;
  });
  webglRenderer = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas');
    const context = canvas?.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_debug_renderer_info');
    return context && extension
      ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : 'Unavailable';
  });

  const diagnostics = async (): Promise<Diagnostics> => page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  const step = async (count: number): Promise<Diagnostics> => page.evaluate(
    (amount) => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.step(amount),
    count,
  );
  const setPaused = async (paused: boolean): Promise<void> => {
    await page.evaluate((shouldPause) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      if (shouldPause) api.pause();
      else api.resume();
    }, paused);
  };
  const screenshot = async (file: string, label: string): Promise<void> => {
    await setPaused(false);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${screenshotDirectory}${file}`, fullPage: true });
    const state = await diagnostics();
    await setPaused(true);
    shots.push({ file, label, diagnostics: state });
    writeCaptureReport(null, false);
    console.log(`${file} | ${label} | fish ${state.fishCount} | state ${state.predatorState}`);
  };

  await setPaused(true);
  await page.locator('#predator-enabled').uncheck();
  await page.locator('#reset-button').click();
  await step(600);
  await screenshot('final-01-deepwater-schooling.png', 'Deep-water overview with natural schooling');

  await page.locator('[data-view="school"]').click();
  await screenshot('final-02-follow-school.png', 'Follow-school camera and turning bank angles');

  await page.locator('[data-view="orbit"]').click();
  await page.locator('#separation-weight').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '0.35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await step(300);
  await screenshot('final-03-low-separation.png', 'Live response after lowering separation weight to 0.35');

  await page.locator('#reset-button').click();
  await page.locator('#separation-weight').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '2.40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await step(300);
  await page.locator('#chase-button').click();
  await page.locator('[data-view="predator"]').click();
  await step(120);
  let predatorState = (await diagnostics()).predatorState;
  for (let attempt = 0; attempt < 8 && predatorState !== 'pursuit' && predatorState !== 'attack'; attempt += 1) {
    await step(30);
    predatorState = (await diagnostics()).predatorState;
  }
  await screenshot('final-04-predator-encounter.png', 'Predator encounter in the follow-predator camera');

  await page.mouse.move(620, 500);
  for (let zoomStep = 0; zoomStep < 4; zoomStep += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(90);
  }
  await screenshot('final-04b-predator-close.png', 'Closer predator view showing body, fins and tail motion');

  for (let attempt = 0; attempt < 30 && (await diagnostics()).captures === 0; attempt += 1) await step(30);
  await page.waitForTimeout(250);
  await screenshot('final-05-post-capture.png', 'Live state after the first capture; population has been reduced');

  await page.locator('#regroup-button').click();
  await page.locator('#predator-enabled').uncheck();
  await step(900);
  await page.locator('[data-view="orbit"]').click();
  await screenshot('final-06-school-recovery.png', 'School during the recovery window after the predator departs');

  await page.locator('#reset-button').click();
  await page.locator('#grid-visible').check();
  await page.locator('[data-view="orbit"]').click();
  await step(120);
  await screenshot('final-07-occupied-grid.png', 'Occupied Uniform Grid cells over the live school');

  await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.setFishCount(1500));
  await step(120);
  await screenshot('final-08-fish-1500.png', 'Real-time scene after changing the population to 1,500 fish');

  await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.setSearchMode('brute-force'));
  await step(1);
  await page.waitForTimeout(300);
  await screenshot('final-09-brute-force.png', 'Brute-force search selected; occupied-cell telemetry shows N/A');

  const finalDiagnostics = await diagnostics();

  if (!desktopOnly) {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    mobile.on('pageerror', (error) => browserErrors.push(`mobile pageerror: ${error.message}`));
    await mobile.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
    await mobile.waitForFunction(() => {
      const api = (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent;
      return api?.ready === true;
    });
    await mobile.waitForTimeout(500);
    await mobile.screenshot({ path: `${screenshotDirectory}final-10-mobile.png`, fullPage: true });
    await mobile.close();
  }

  if (browserErrors.length > 0) throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);
  writeCaptureReport(finalDiagnostics, true);
  console.log(`\nWebGL renderer: ${webglRenderer}`);
  console.log(`Captured ${shots.length} desktop screenshots${desktopOnly ? ' (mobile deferred)' : ' plus one mobile screenshot'}.`);
  console.log(`Wrote ${screenshotDirectory}capture-results.json`);
} finally {
  await browser.close();
  await server.close();
}
