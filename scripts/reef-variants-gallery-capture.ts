import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Studio gallery capture for the five-reef set. Loads the dedicated preview
 * page (no fish, kelp or water absorption), then asks the page for explicit
 * canvas renders. This avoids Playwright's compositor path, which is unreliable
 * under SwiftShader.
 */

interface GalleryDiagnostics {
  ready: boolean;
  reefCount: number;
  nearTriangles: number;
  epibiontInstances: number;
  epibiontTriangles: number;
  drawCalls: number;
  fps: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}

interface GalleryApi {
  ready: boolean;
  getDiagnostics(): GalleryDiagnostics;
  setPreset(preset: 'front' | 'threeQuarter'): GalleryDiagnostics;
  setSilhouette(enabled: boolean): void;
  setLodLocked(locked: boolean): void;
  captureView(width: number, height: number): string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(projectRoot, 'test-artifacts', 'reef-variants');
mkdirSync(artifacts, { recursive: true });

const viewArgument = process.argv.find((value) => value.startsWith('--view='));
const view = viewArgument?.split('=')[1] ?? 'all';
if (view !== 'all' && view !== 'front' && view !== 'threeQuarter' && view !== 'silhouette') {
  throw new Error('--view must be all, front, threeQuarter or silhouette.');
}

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'reef-variants-gallery'),
  server: { host: '127.0.0.1', port: 5185, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function capture(
  page: import('playwright').Page,
  label: string,
  preset: 'front' | 'threeQuarter',
  width: number,
  height: number,
  silhouette: boolean,
): Promise<GalleryDiagnostics> {
  const diag = await page.evaluate((options) => {
    const api = (window as unknown as { __reefVariantsPreview: GalleryApi }).__reefVariantsPreview;
    api.setLodLocked(true);
    api.setSilhouette(options.silhouette);
    api.setPreset(options.preset);
    return api.getDiagnostics();
  }, { preset, silhouette });
  await page.waitForTimeout(250);
  const dataUrl = await page.evaluate((options) => {
    const api = (window as unknown as { __reefVariantsPreview: GalleryApi }).__reefVariantsPreview;
    return api.captureView(options.width, options.height);
  }, { width, height });
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  writeFileSync(join(artifacts, label), Buffer.from(base64, 'base64'));
  writeFileSync(
    join(artifacts, `${label.replace('.png', '')}-diagnostics.json`),
    JSON.stringify(diag, null, 2),
  );
  return diag;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    if (message.text().startsWith('Reef ')) console.log(message.text());
  });

  await page.goto('http://127.0.0.1:5185/preview/reef-variants-preview.html', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForFunction(
    () => (window as unknown as { __reefVariantsPreview?: GalleryApi }).__reefVariantsPreview?.ready === true,
    { timeout: 180000 },
  );

  const front = view === 'all' || view === 'front'
    ? await capture(page, 'gallery-front.png', 'front', 1400, 600, false)
    : null;
  const threeQuarter = view === 'all' || view === 'threeQuarter'
    ? await capture(page, 'gallery-three-quarter.png', 'threeQuarter', 1400, 700, false)
    : null;
  const silhouette = view === 'all' || view === 'silhouette'
    ? await capture(page, 'gallery-silhouette.png', 'front', 1400, 600, true)
    : null;
  const primary = front ?? silhouette ?? threeQuarter;
  assert(primary, `No gallery view was captured for ${view}.`);

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  assert(primary.reefCount === 5, `gallery has ${primary.reefCount} reefs, expected 5.`);
  assert(primary.nearTriangles === 58346,
    `near LOD total ${primary.nearTriangles}, expected 58,346.`);
  assert(primary.epibiontInstances === 299,
    `epibiont instances ${primary.epibiontInstances}, expected 299.`);
  assert(primary.epibiontTriangles === 194992,
    `epibiont triangles ${primary.epibiontTriangles}, expected 194,992.`);

  const report = {
    passed: true,
    views: { front, threeQuarter, silhouette },
    browserErrors: errors,
  };
  writeFileSync(join(artifacts, 'gallery-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
