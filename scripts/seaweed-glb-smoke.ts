import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface SeaweedStats {
  name: string;
  url: string;
  triangles: number;
  vertices: number;
  height: number;
  width: number;
  depth: number;
  materialCount: number;
  maps: number;
  hasNormal: boolean;
  hasTangent: boolean;
  hasSwayWeight: boolean;
  hasBladePhase: boolean;
}

interface SeaweedDiagnostics {
  ready: boolean;
  assetCount: number;
  instanceCount: number;
  drawCalls: number;
  triangles: number;
  fps: number;
  swayTime: number;
  maps: number;
}

interface SeaweedPreviewApi {
  ready: boolean;
  getDiagnostics(): SeaweedDiagnostics;
  getAssetStats(): SeaweedStats[];
}

const EXPECTED_TRIS = 13_792;
const INSTANCES = 5;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.tmp/blue-current-vite-seaweed`,
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
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

  await page.goto('http://127.0.0.1:5180/preview/seaweed-preview.html', { waitUntil: 'networkidle' });
  console.log('stage: seaweed preview loaded');
  await page.waitForFunction(
    () => (window as unknown as { __seaweedPreview?: SeaweedPreviewApi }).__seaweedPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __seaweedPreview: SeaweedPreviewApi }).__seaweedPreview.getDiagnostics(),
  );
  const stats = await page.evaluate(
    () => (window as unknown as { __seaweedPreview: SeaweedPreviewApi }).__seaweedPreview.getAssetStats(),
  );

  assert(diagnostics.assetCount === 1, `Expected 1 seaweed asset, received ${diagnostics.assetCount}.`);
  assert(diagnostics.instanceCount === INSTANCES, `Expected ${INSTANCES} instances, received ${diagnostics.instanceCount}.`);
  assert(diagnostics.drawCalls > 0, 'Renderer reported zero draw calls.');
  assert(diagnostics.triangles > EXPECTED_TRIS * INSTANCES, `Preview triangles too low: ${diagnostics.triangles}.`);
  assert(diagnostics.maps === 3, `Expected 3 PBR maps, received ${diagnostics.maps}.`);
  assert(diagnostics.swayTime > 0.5, `Sway time did not advance (${diagnostics.swayTime}).`);
  assert(stats.length === 1, `Expected 1 asset record, received ${stats.length}.`);

  const asset = stats[0];
  assert(asset.triangles === EXPECTED_TRIS, `${asset.name} has ${asset.triangles} triangles, expected ${EXPECTED_TRIS}.`);
  assert(asset.height >= 1.0 && asset.height <= 1.5, `${asset.name} height ${asset.height.toFixed(3)} outside 1.0-1.5.`);
  assert(asset.materialCount === 1, `${asset.name} has ${asset.materialCount} materials.`);
  assert(asset.maps === 3, `${asset.name} has ${asset.maps} PBR maps.`);
  assert(asset.hasNormal && asset.hasTangent && asset.hasSwayWeight && asset.hasBladePhase,
    `${asset.name} is missing NORMAL, TANGENT, sway weight or blade phase.`);
  console.log('stage: detail seaweed asset validated');

  const canvas = page.locator('canvas');
  const frameBefore = await canvas.screenshot({ path: `${artifacts}/seaweed-sway-a.png` });
  await page.waitForTimeout(1300);
  const frameAfter = await canvas.screenshot({ path: `${artifacts}/seaweed-sway-b.png` });
  assert(!frameBefore.equals(frameAfter), 'Seaweed canvas did not change between frames; sway shader may be inactive.');
  console.log('stage: sway changed the rendered canvas');

  await page.screenshot({ path: `${artifacts}/seaweed-preview.png`, timeout: 30000 });
  console.log('stage: preview screenshot captured');

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = {
    passed: true,
    diagnostics,
    assets: stats,
    browserErrors: errors,
  };
  writeFileSync(`${artifacts}/seaweed-asset-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
