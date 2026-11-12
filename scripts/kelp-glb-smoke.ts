import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface KelpStats {
  name: string;
  triangles: number;
  vertices: number;
  height: number;
  width: number;
  depth: number;
  materialCount: number;
  hasNormal: boolean;
  hasSwayWeight: boolean;
  hasBladePhase: boolean;
}

interface KelpDiagnostics {
  ready: boolean;
  assetCount: number;
  instanceCount: number;
  kelpCounts: { kelp_a: number; kelp_b: number };
  drawCalls: number;
  triangles: number;
  fps: number;
  swayTime: number;
}

interface KelpPreviewApi {
  ready: boolean;
  getDiagnostics(): KelpDiagnostics;
  getAssetStats(): KelpStats[];
}

interface MainDiagnostics {
  ready: boolean;
  kelpModel: 'off' | 'blender';
  kelpInstances: { kelp_a: number; kelp_b: number };
  kelpTriangles: number;
  drawCalls: number;
}

interface MainApi {
  getDiagnostics(): MainDiagnostics;
}

const EXPECTED_HEIGHT: Record<string, [number, number]> = {
  kelp_a: [3.0, 4.0],
  kelp_b: [2.0, 3.0],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'smoke-kelp'),
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5179/kelp-preview.html', { waitUntil: 'networkidle' });
  console.log('stage: kelp preview loaded');
  await page.waitForFunction(
    () => (window as unknown as { __kelpPreview?: KelpPreviewApi }).__kelpPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __kelpPreview: KelpPreviewApi }).__kelpPreview.getDiagnostics(),
  );
  const stats = await page.evaluate(
    () => (window as unknown as { __kelpPreview: KelpPreviewApi }).__kelpPreview.getAssetStats(),
  );

  assert(diagnostics.assetCount === 2, `Expected 2 kelp assets, received ${diagnostics.assetCount}.`);
  assert(diagnostics.instanceCount >= 12, `Expected at least 12 instances, received ${diagnostics.instanceCount}.`);
  assert(diagnostics.drawCalls > 0, 'Renderer reported zero draw calls.');
  assert(diagnostics.triangles > 0, 'Renderer reported zero triangles.');
  assert(diagnostics.swayTime > 0.5, `Sway time did not advance (${diagnostics.swayTime}).`);
  assert(stats.length === 2, `Expected 2 asset records, received ${stats.length}.`);

  for (const asset of stats) {
    const range = EXPECTED_HEIGHT[asset.name];
    assert(range !== undefined, `Unexpected kelp asset ${asset.name}.`);
    assert(asset.triangles >= 100 && asset.triangles <= 200,
      `${asset.name} has ${asset.triangles} triangles outside 100-200.`);
    assert(asset.height >= range[0] && asset.height <= range[1],
      `${asset.name} height ${asset.height.toFixed(3)} outside ${range[0]}-${range[1]}.`);
    assert(asset.materialCount === 1, `${asset.name} has ${asset.materialCount} materials.`);
    assert(asset.hasNormal && asset.hasSwayWeight && asset.hasBladePhase,
      `${asset.name} is missing NORMAL, sway weight or blade phase.`);
  }
  console.log('stage: two kelp assets validated');

  const canvas = page.locator('canvas');
  const frameBefore = await canvas.screenshot({ path: `${artifacts}/kelp-sway-a.png` });
  await page.waitForTimeout(1300);
  const frameAfter = await canvas.screenshot({ path: `${artifacts}/kelp-sway-b.png` });
  assert(!frameBefore.equals(frameAfter), 'Kelp canvas did not change between frames; sway shader may be inactive.');
  console.log('stage: sway changed the rendered canvas');

  const swayAfter = await page.evaluate(
    () => (window as unknown as { __kelpPreview: KelpPreviewApi }).__kelpPreview.getDiagnostics().swayTime,
  );
  assert(swayAfter > diagnostics.swayTime + 0.8, 'Sway time stopped advancing.');

  await page.screenshot({ path: `${artifacts}/kelp-preview.png`, timeout: 60000 });
  console.log('stage: preview screenshot captured');

  const mainPage = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  mainPage.setDefaultTimeout(120000);
  mainPage.on('pageerror', (error) => errors.push(`main pageerror: ${error.message}`));
  mainPage.on('console', (message) => {
    if (message.type() === 'error') errors.push(`main console: ${message.text()}`);
  });
  await mainPage.goto('http://127.0.0.1:5179/?kelp=1', { waitUntil: 'networkidle' });
  await mainPage.waitForFunction(
    () => {
      const api = (window as unknown as { __blueCurrent?: MainApi }).__blueCurrent;
      if (!api) return false;
      if (!(api as unknown as { ready?: boolean }).ready) return false;
      const diagnostics = api.getDiagnostics();
      return diagnostics.ready && diagnostics.kelpModel === 'blender';
    },
    { timeout: 120000 },
  );
  await mainPage.waitForTimeout(900);
  const mainDiagnostics = await mainPage.evaluate(
    () => (window as unknown as { __blueCurrent: MainApi }).__blueCurrent.getDiagnostics(),
  );
  assert(mainDiagnostics.kelpInstances.kelp_a > 0, 'Main scene has no kelp_a instances.');
  assert(mainDiagnostics.kelpInstances.kelp_b > 0, 'Main scene has no kelp_b instances.');
  assert(mainDiagnostics.kelpTriangles > 0, 'Main scene reports zero kelp triangles.');
  await mainPage.screenshot({ path: `${artifacts}/kelp-main-scene.png`, timeout: 60000 });
  console.log('stage: main scene kelp screenshot captured');
  await mainPage.close();

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = {
    passed: true,
    diagnostics,
    swayAfter,
    assets: stats,
    main: mainDiagnostics,
    browserErrors: errors,
  };
  writeFileSync(`${artifacts}/kelp-asset-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
