import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface CoralStats {
  name: string;
  triangles: number;
  height: number;
  width: number;
  depth: number;
  materialCount: number;
  hasUV: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
}

interface CoralDiagnostics {
  ready: boolean;
  assetCount: number;
  instanceCount: number;
  drawCalls: number;
  triangles: number;
  fps: number;
  atlasMaps: number;
}

interface CoralPreviewApi {
  ready: boolean;
  getDiagnostics(): CoralDiagnostics;
  getAssetStats(): CoralStats[];
}

const EXPECTED_HEIGHT: Record<string, [number, number]> = {
  coral_branching: [1.05, 1.6],
  coral_table: [0.4, 0.7],
  sponge_tube: [0.85, 1.3],
  coral_fan: [0.9, 1.45],
  coral_brain: [0.5, 0.75],
  anemone: [0.65, 1.0],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'smoke-coral'),
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5178/coral-preview.html', { waitUntil: 'networkidle' });
  console.log('stage: coral preview loaded');
  await page.waitForFunction(
    () => (window as unknown as { __coralPreview?: CoralPreviewApi }).__coralPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __coralPreview: CoralPreviewApi }).__coralPreview.getDiagnostics(),
  );
  const stats = await page.evaluate(
    () => (window as unknown as { __coralPreview: CoralPreviewApi }).__coralPreview.getAssetStats(),
  );

  assert(diagnostics.assetCount === 6, `Expected 6 coral assets, received ${diagnostics.assetCount}.`);
  assert(diagnostics.instanceCount >= 40, `Expected at least 40 instances, received ${diagnostics.instanceCount}.`);
  assert(diagnostics.drawCalls > 0, 'Renderer reported zero draw calls.');
  assert(diagnostics.triangles > 0, 'Renderer reported zero triangles.');
  assert(diagnostics.atlasMaps === 3, `Expected 3 shared atlas maps, received ${diagnostics.atlasMaps}.`);
  assert(stats.length === 6, `Expected 6 asset records, received ${stats.length}.`);

  for (const asset of stats) {
    const range = EXPECTED_HEIGHT[asset.name];
    assert(range !== undefined, `Unexpected coral asset ${asset.name}.`);
    assert(asset.triangles >= 1500 && asset.triangles <= 3200,
      `${asset.name} has ${asset.triangles} triangles outside 1500-3200.`);
    assert(asset.height >= range[0] && asset.height <= range[1],
      `${asset.name} height ${asset.height.toFixed(3)} outside ${range[0]}-${range[1]}.`);
    assert(asset.materialCount === 1, `${asset.name} has ${asset.materialCount} materials.`);
    assert(asset.hasUV && asset.hasNormal && asset.hasTangent,
      `${asset.name} is missing UV, NORMAL or TANGENT.`);
  }
  console.log('stage: six coral assets validated');

  await page.screenshot({ path: `${artifacts}/coral-preview.png`, timeout: 60000 });
  console.log('stage: screenshot captured');

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = {
    passed: true,
    diagnostics,
    assets: stats,
    browserErrors: errors,
  };
  writeFileSync(`${artifacts}/coral-asset-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
