import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

interface ShayuStats {
  url: string;
  triangles: number;
  materialCount: number;
  lengthZ: number;
  hasTailWeights: boolean;
  tailWeightMin: number;
  tailWeightMax: number;
  hasJawWeights: boolean;
  hasBaseColorMap: boolean;
  hasNormalMap: boolean;
  hasRoughnessMap: boolean;
  bytes: number | null;
}

interface PreviewApi {
  ready: boolean;
  predatorModel: string;
  getAssetStats(): ShayuStats | null;
  getDiagnostics(): { fishCount: number; predatorState: string; captures: number };
}

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  predatorModel: 'procedural' | 'blender';
  predatorTriangles: number;
  predatorBank: number;
  predatorThrust: number;
  predatorTurn: number;
  predatorTailTurn: number;
  drawCalls: number;
}

interface DebugApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });
const port = 5189;
const stage = process.env.STAGE ?? 'all';

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/smoke-predator-shayu`,
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
let stats: ShayuStats | null = null;
let chaseDiagnostics: { fishCount: number; predatorState: string; captures: number } | null = null;
let mainDiagnostics: Diagnostics | null = null;

function watch(page: Page): void {
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

try {
  if (stage === 'all' || stage === 'preview') {
    console.log('stage: preview');
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
    watch(page);
    await page.goto(`http://127.0.0.1:${port}/predator-preview.html?mode=hero&predator=shayu`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () => (window as unknown as { __predatorPreview?: PreviewApi }).__predatorPreview?.ready === true,
      { timeout: 120000 },
    );
    await page.waitForTimeout(1000);
    stats = await page.evaluate(
      () => (window as unknown as { __predatorPreview: PreviewApi }).__predatorPreview.getAssetStats(),
    );
    assert(stats !== null, 'Shayu preview did not expose asset statistics.');
    assert(stats.url.includes('predator_shayu.glb'), `Unexpected asset URL: ${stats.url}.`);
    assert(stats.triangles === 9826, `Unexpected triangle count: ${stats.triangles}.`);
    assert(stats.materialCount === 3, `Unexpected material count: ${stats.materialCount}.`);
    assert(Math.abs(stats.lengthZ - 5.28) <= 0.264,
      `Shayu length ${stats.lengthZ.toFixed(3)} is outside the 5.28 ±5% contract.`);
    assert(stats.hasTailWeights, 'Shayu GLB is missing _TAILWEIGHT.');
    assert(stats.tailWeightMin >= -0.001 && stats.tailWeightMax <= 1.001,
      `Tail weights outside [0,1]: ${stats.tailWeightMin}..${stats.tailWeightMax}.`);
    assert(!stats.hasJawWeights, 'Shayu is expected to have no jaw weights (static mouth).');
    assert(stats.hasBaseColorMap && stats.hasNormalMap && stats.hasRoughnessMap,
      'Shayu body material is missing one of the PBR maps.');
    await page.screenshot({ path: `${artifacts}/predator-shayu-hero.png`, timeout: 60000 });
    console.log('stage: hero done');

    await page.goto(`http://127.0.0.1:${port}/predator-preview.html?mode=close&predator=shayu`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () => (window as unknown as { __predatorPreview?: PreviewApi }).__predatorPreview?.ready === true,
      { timeout: 120000 },
    );
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${artifacts}/predator-shayu-close.png`, timeout: 60000 });
    await page.close();
    console.log('stage: close done');
  }

  if (stage === 'all' || stage === 'chase') {
    console.log('stage: chase');
    const chase = await browser.newPage({ viewport: { width: 720, height: 480 }, deviceScaleFactor: 1 });
    watch(chase);
    await chase.goto(`http://127.0.0.1:${port}/predator-preview.html?mode=chase&predator=shayu`, {
      waitUntil: 'networkidle',
    });
    await chase.waitForFunction(
      () => (window as unknown as { __predatorPreview?: PreviewApi }).__predatorPreview?.ready === true,
      { timeout: 120000 },
    );
    await chase.waitForTimeout(1200);
    chaseDiagnostics = await chase.evaluate(
      () => (window as unknown as { __predatorPreview: PreviewApi }).__predatorPreview.getDiagnostics(),
    );
    await chase.evaluate(() => {
      const api = (window as unknown as {
        __predatorPreview: { focusPredator(distance?: number): void };
      }).__predatorPreview;
      api.focusPredator(14);
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';
    });
    await chase.waitForTimeout(300);
    await chase.screenshot({ path: `${artifacts}/predator-shayu-chase.png`, timeout: 60000 });
    assert(chaseDiagnostics.fishCount > 0, 'Shayu chase preview has no live fish.');
    assert(['patrol', 'pursuit', 'attack', 'search'].includes(chaseDiagnostics.predatorState),
      `Unexpected predator state: ${chaseDiagnostics.predatorState}.`);
    await chase.close();
    console.log('stage: chase done');
  }

  if (stage === 'all' || stage === 'main') {
    console.log('stage: main');
    const main = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 1 });
    watch(main);
    await main.goto(`http://127.0.0.1:${port}/?fishCount=150`, { waitUntil: 'networkidle' });
    await main.waitForFunction(
      () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
      { timeout: 120000 },
    );
    await main.waitForFunction(
      () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent
        ?.getDiagnostics().predatorModel === 'blender',
      { timeout: 120000 },
    );
    await main.waitForTimeout(800);
    mainDiagnostics = await main.evaluate(
      () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
    );
    await main.screenshot({ path: `${artifacts}/predator-shayu-main.png`, timeout: 60000 });
    assert(mainDiagnostics.predatorTriangles === 9826,
      `Main scene predator triangles: ${mainDiagnostics.predatorTriangles}.`);
    assert(Number.isFinite(mainDiagnostics.predatorBank), 'Predator bank is not finite.');
    assert(mainDiagnostics.predatorTailTurn >= -1.001 && mainDiagnostics.predatorTailTurn <= 1.001,
      `Predator tail turn out of range: ${mainDiagnostics.predatorTailTurn}.`);
    assert(mainDiagnostics.drawCalls > 0, 'Main scene reported zero draw calls.');
    await main.close();
    console.log('stage: main done');
  }

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = { passed: true, stage, asset: stats, chase: chaseDiagnostics, main: mainDiagnostics, browserErrors: errors };
  writeFileSync(`${artifacts}/predator-shayu-results-${stage}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
