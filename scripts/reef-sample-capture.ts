import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Studio evidence for the hero reef sample: studio views, a no-epibiont
 * comparison, and a flat silhouette render for the "still reads as a reef at
 * thumbnail size" acceptance check. Software rendering only; these are visual
 * and contract checks, not FPS evidence.
 */

interface Diagnostics {
  ready: boolean;
  trianglesNear: number;
  trianglesMid: number;
  trianglesFar: number;
  epibiontInstances: number;
  epibiontTriangles: number;
  epibiontMeshes: number;
  epibiontClusters: number;
  epibiontCoverage: number;
  apronPieces: number;
  apronTriangles: number;
  drawCalls: number;
  fps: number;
  cameraDistance: number;
}

interface PreviewApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
  setCameraPose(position: [number, number, number], target: [number, number, number]): Diagnostics;
  setSilhouette(enabled: boolean): void;
  setEpibiontsVisible(visible: boolean): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(projectRoot, 'test-artifacts', 'reef-sample');
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'reef-sample-preview'),
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

async function shoot(page: import('playwright').Page, name: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(artifacts, name), fullPage: false, timeout: 60000 });
}

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5183/reef-sample-preview.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __reefSamplePreview?: PreviewApi }).__reefSamplePreview?.ready === true,
    { timeout: 120000 },
  );

  await page.evaluate(() => {
    (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview
      .setCameraPose([7.6, 4.4, 9.8], [0, 1.75, 0]);
  });
  await shoot(page, 'studio-three-quarter.png');

  await page.evaluate(() => {
    (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview
      .setCameraPose([10.4, 3.4, 2.2], [0, 1.6, 0]);
  });
  await shoot(page, 'studio-front.png');

  await page.evaluate(() => {
    (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview
      .setCameraPose([0.8, 12.5, 4.2], [0, 1.2, 0]);
  });
  await shoot(page, 'studio-top.png');

  await page.evaluate(() => {
    const preview = (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview;
    preview.setCameraPose([7.6, 4.4, 9.8], [0, 1.75, 0]);
    preview.setEpibiontsVisible(false);
  });
  await shoot(page, 'studio-three-quarter-no-epibionts.png');

  await page.evaluate(() => {
    const preview = (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview;
    preview.setEpibiontsVisible(true);
    preview.setSilhouette(true);
    preview.setCameraPose([7.6, 4.4, 9.8], [0, 1.75, 0]);
  });
  await shoot(page, 'silhouette-three-quarter.png');

  await page.evaluate(() => {
    (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview
      .setCameraPose([0.8, 12.5, 4.2], [0, 1.2, 0]);
  });
  await shoot(page, 'silhouette-top.png');

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __reefSamplePreview: PreviewApi }).__reefSamplePreview.getDiagnostics(),
  );
  assert(diagnostics.trianglesNear >= 8000 && diagnostics.trianglesNear <= 15000,
    `near LOD ${diagnostics.trianglesNear} outside 8k-15k.`);
  assert(diagnostics.trianglesMid >= 2000 && diagnostics.trianglesMid <= 5000,
    `mid LOD ${diagnostics.trianglesMid} outside 2k-5k.`);
  assert(diagnostics.trianglesFar >= 300 && diagnostics.trianglesFar <= 1000,
    `far LOD ${diagnostics.trianglesFar} outside 300-1k.`);
  assert(diagnostics.epibiontClusters >= 5 && diagnostics.epibiontClusters <= 8,
    `epibiont cluster count ${diagnostics.epibiontClusters} outside 5-8.`);
  assert(diagnostics.epibiontInstances >= 20,
    `only ${diagnostics.epibiontInstances} epibiont colonies.`);
  assert(diagnostics.epibiontCoverage > 0 && diagnostics.epibiontCoverage < 0.5,
    `epibiont coverage ${diagnostics.epibiontCoverage} should stay below 50%.`);
  assert(diagnostics.apronPieces === 18,
    `rubble apron has ${diagnostics.apronPieces} pieces, expected 18.`);
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = { passed: true, diagnostics, browserErrors: errors };
  writeFileSync(join(artifacts, 'studio-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
