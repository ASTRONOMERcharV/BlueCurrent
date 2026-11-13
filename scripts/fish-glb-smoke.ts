import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  fishModel: 'procedural' | 'blender';
  fishTriangles: number;
  drawCalls: number;
  canvasWidth: number;
  canvasHeight: number;
}

interface AssetStats {
  triangles: number;
  materialCount: number;
  lengthZ: number;
  hasTailWeights: boolean;
  tailWeightMin: number;
  tailWeightMax: number;
  bytes: number | null;
}

interface PreviewApi {
  ready: boolean;
  fishModel: string;
  getAssetStats(): AssetStats | null;
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
  cacheDir: join(projectRoot, '.vite', 'smoke-fish'),
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 520 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5176/?fish=blender', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.getDiagnostics().fishModel === 'blender',
    { timeout: 120000 },
  );
  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  assert(diagnostics.fishModel === 'blender', 'The main scene fell back to the procedural fish.');
  assert(diagnostics.fishTriangles >= 500 && diagnostics.fishTriangles <= 1500,
    `Unexpected fish triangle budget: ${diagnostics.fishTriangles}.`);
  assert(diagnostics.fishCount === 500, `Expected 500 fish, received ${diagnostics.fishCount}.`);
  assert(diagnostics.drawCalls > 0, 'Renderer reported zero draw calls.');
  // The 500-fish integration is verified through diagnostics above. SwiftShader
  // screenshots of the full main scene are too slow to be a reliable CI gate;
  // the hero screenshot below covers the visual asset.
  await page.close();

  const preview = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  preview.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  preview.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await preview.goto('http://127.0.0.1:5176/preview/fish-preview.html?mode=hero', { waitUntil: 'networkidle' });
  await preview.waitForFunction(
    () => (window as unknown as { __fishPreview?: PreviewApi }).__fishPreview?.ready === true,
    { timeout: 120000 },
  );
  const stats = await preview.evaluate(
    () => (window as unknown as { __fishPreview: PreviewApi }).__fishPreview.getAssetStats(),
  );
  assert(stats !== null, 'Preview page did not expose asset statistics.');
  assert(stats.hasTailWeights, 'The GLB is missing the tail-weight vertex attribute.');
  assert(stats.tailWeightMin >= -0.001 && stats.tailWeightMax <= 1.001,
    `Tail weights outside [0,1]: ${stats.tailWeightMin}..${stats.tailWeightMax}.`);
  assert(stats.materialCount >= 1 && stats.materialCount <= 2,
    `Unexpected material count: ${stats.materialCount}.`);
  assert(Math.abs(stats.lengthZ - 1.65) <= 0.0825,
    `Fish length ${stats.lengthZ.toFixed(3)} is outside the 1.65 ±5% contract.`);
  await preview.screenshot({ path: `${artifacts}/fish-asset-hero.png`, timeout: 60000 });
  console.log('hero screenshot captured');

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = { passed: true, diagnostics, asset: stats, browserErrors: errors };
  writeFileSync(`${artifacts}/fish-asset-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
