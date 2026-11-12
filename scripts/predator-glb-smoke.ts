import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  captures: number;
  fishModel: 'procedural' | 'blender';
  predatorModel: 'procedural' | 'blender';
  predatorTriangles: number;
  predatorBank: number;
  predatorThrust: number;
  predatorTurn: number;
  predatorTailTurn: number;
  drawCalls: number;
  canvasWidth: number;
  canvasHeight: number;
}

interface PredatorStats {
  triangles: number;
  materialCount: number;
  lengthZ: number;
  hasTailWeights: boolean;
  tailWeightMin: number;
  tailWeightMax: number;
  hasBaseColorMap: boolean;
  hasNormalMap: boolean;
  hasRoughnessMap: boolean;
  bytes: number | null;
}

interface PredatorPreviewApi {
  ready: boolean;
  predatorModel: string;
  getAssetStats(): PredatorStats | null;
  getDiagnostics(): { fishCount: number; predatorState: string; captures: number };
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

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/smoke-predator`,
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  console.log('stage: main scene loaded');
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.getDiagnostics().predatorModel === 'blender',
    { timeout: 120000 },
  );
  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  assert(diagnostics.predatorModel === 'blender', 'The main scene fell back to the procedural predator.');
  assert(diagnostics.predatorTriangles >= 3000 && diagnostics.predatorTriangles <= 20000,
    `Unexpected predator triangle budget: ${diagnostics.predatorTriangles}.`);
  assert(diagnostics.fishCount + diagnostics.captures === 500,
    `Expected 500 initial fish, received ${diagnostics.fishCount} alive + ${diagnostics.captures} captured.`);
  assert(diagnostics.drawCalls > 0, 'Renderer reported zero draw calls.');
  assert(Number.isFinite(diagnostics.predatorBank) && Math.abs(diagnostics.predatorBank) <= 0.601,
    `Predator bank out of range: ${diagnostics.predatorBank}.`);
  assert(diagnostics.predatorThrust >= -1.001 && diagnostics.predatorThrust <= 1.001,
    `Predator thrust out of range: ${diagnostics.predatorThrust}.`);
  assert(diagnostics.predatorTurn >= -1.001 && diagnostics.predatorTurn <= 1.001,
    `Predator turn out of range: ${diagnostics.predatorTurn}.`);
  assert(diagnostics.predatorTailTurn >= -1.001 && diagnostics.predatorTailTurn <= 1.001,
    `Predator tail turn out of range: ${diagnostics.predatorTailTurn}.`);
  console.log('stage: main scene verified');
  await page.close();

  const preview = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  preview.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  preview.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await preview.goto('http://127.0.0.1:5177/predator-preview.html?mode=hero', { waitUntil: 'networkidle' });
  console.log('stage: hero preview loaded');
  await preview.waitForFunction(
    () => (window as unknown as { __predatorPreview?: PredatorPreviewApi }).__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  const stats = await preview.evaluate(
    () => (window as unknown as { __predatorPreview: PredatorPreviewApi }).__predatorPreview.getAssetStats(),
  );
  assert(stats !== null, 'Preview page did not expose asset statistics.');
  assert(stats.hasTailWeights, 'The GLB is missing the tail-weight vertex attribute.');
  assert(stats.tailWeightMin >= -0.001 && stats.tailWeightMax <= 1.001,
    `Tail weights outside [0,1]: ${stats.tailWeightMin}..${stats.tailWeightMax}.`);
  assert(stats.materialCount >= 3 && stats.materialCount <= 4,
    `Unexpected material count: ${stats.materialCount}.`);
  assert(Math.abs(stats.lengthZ - 5.28) <= 0.264,
    `Predator length ${stats.lengthZ.toFixed(3)} is outside the 5.28 ±5% contract.`);
  assert(stats.hasBaseColorMap && stats.hasNormalMap && stats.hasRoughnessMap,
    'The body material is missing one of the PBR maps.');
  await preview.waitForTimeout(800);
  await preview.screenshot({ path: `${artifacts}/predator-asset-hero.png`, timeout: 60000 });
  console.log('stage: hero screenshot captured');
  await preview.close();

  const chase = await browser.newPage({ viewport: { width: 720, height: 480 }, deviceScaleFactor: 1 });
  chase.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  chase.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await chase.goto('http://127.0.0.1:5177/predator-preview.html?mode=chase', { waitUntil: 'networkidle' });
  console.log('stage: chase preview loaded');
  await chase.waitForFunction(
    () => (window as unknown as { __predatorPreview?: PredatorPreviewApi }).__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  await chase.waitForTimeout(1200);
  const chaseDiagnostics = await chase.evaluate(
    () => (window as unknown as { __predatorPreview: PredatorPreviewApi }).__predatorPreview.getDiagnostics(),
  );
  await chase.screenshot({ path: `${artifacts}/predator-chase.png`, timeout: 60000 });
  console.log('stage: chase screenshot captured');
  assert(chaseDiagnostics.fishCount > 0, 'Chase preview has no live fish.');
  assert(['patrol', 'pursuit', 'attack', 'search'].includes(chaseDiagnostics.predatorState),
    `Unexpected predator state: ${chaseDiagnostics.predatorState}.`);
  console.log('stage: chase verified');
  await chase.close();

  const combo = await browser.newPage({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 1 });
  combo.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  combo.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await combo.goto('http://127.0.0.1:5177/?fish=blender&predator=blender&fishCount=150', { waitUntil: 'networkidle' });
  console.log('stage: combo loaded');
  await combo.waitForFunction(
    () => {
      const api = (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent;
      if (api?.ready !== true) return false;
      const diagnostics = api.getDiagnostics();
      return diagnostics.fishModel === 'blender' && diagnostics.predatorModel === 'blender';
    },
    { timeout: 120000 },
  );
  const comboDiagnostics = await combo.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  assert(comboDiagnostics.fishCount === 150, 'Combined GLB scene did not honor fishCount.');
  assert(comboDiagnostics.drawCalls > 0, 'Combined GLB scene reported zero draw calls.');
  console.log('stage: combo verified');
  await combo.close();

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = {
    passed: true,
    diagnostics,
    asset: stats,
    chase: chaseDiagnostics,
    combo: comboDiagnostics,
    browserErrors: errors,
  };
  writeFileSync(`${artifacts}/predator-asset-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
