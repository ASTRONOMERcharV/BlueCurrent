import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface MainDiagnostics {
  ready: boolean;
  predatorModel: 'procedural' | 'blender';
  predatorRigged: boolean;
  predatorTriangles: number;
  predatorBank: number;
  predatorTurn: number;
  predatorTailTurn: number;
  predatorPitch: number;
  fishCount: number;
  drawCalls: number;
}

interface MainApi {
  ready: boolean;
  getDiagnostics(): MainDiagnostics;
  setCameraMode(mode: string): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/predator-animation`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/smoke-predator-animation-main`,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${baseUrl}?environment=bare&fishCount=120`, { waitUntil: 'networkidle' });
  console.log('stage: main scene loaded');
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __blueCurrent?: MainApi }).__blueCurrent;
      return api?.ready === true && api.getDiagnostics().predatorRigged;
    },
    { timeout: 180000 },
  );
  await page.evaluate(
    () => (window as unknown as { __blueCurrent: MainApi }).__blueCurrent.setCameraMode('predator'),
  );
  await page.waitForTimeout(1200);
  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: MainApi }).__blueCurrent.getDiagnostics(),
  );
  assert(diagnostics.predatorModel === 'blender', 'Main scene fell back to the procedural predator');
  assert(diagnostics.predatorRigged, 'Main scene did not use the rigged predator path');
  assert(diagnostics.predatorTriangles >= 3000 && diagnostics.predatorTriangles <= 20000,
    `Main scene predator triangle count out of range: ${diagnostics.predatorTriangles}`);
  assert(diagnostics.drawCalls > 0, 'Main scene reported zero draw calls');
  assert(Number.isFinite(diagnostics.predatorBank) && Math.abs(diagnostics.predatorBank) <= 0.601,
    `Predator bank out of range: ${diagnostics.predatorBank}`);
  assert(Number.isFinite(diagnostics.predatorPitch),
    `Predator pitch is not finite: ${diagnostics.predatorPitch}`);
  assert(diagnostics.predatorTurn >= -1.001 && diagnostics.predatorTurn <= 1.001,
    `Predator turn out of range: ${diagnostics.predatorTurn}`);
  assert(diagnostics.predatorTailTurn >= -1.001 && diagnostics.predatorTailTurn <= 1.001,
    `Predator tail turn out of range: ${diagnostics.predatorTailTurn}`);
  await page.screenshot({ path: `${artifacts}/09-main-scene-rigged.png` });
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ passed: true, diagnostics, browserErrors: errors }, null, 2));
  writeFileSync(
    `${artifacts}/main-results.json`,
    JSON.stringify({ passed: true, diagnostics, browserErrors: errors }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
