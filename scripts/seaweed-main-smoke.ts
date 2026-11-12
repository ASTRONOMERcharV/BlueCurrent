import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface MainDiagnostics {
  ready: boolean;
  seaweedModel: 'off' | 'blender';
  seaweedInstances: number;
  seaweedTriangles: number;
  drawCalls: number;
  renderTriangles: number;
}

interface MainApi {
  readonly ready: boolean;
  getDiagnostics(): MainDiagnostics;
}

const EXPECTED_TRIS = 13_792;
const MAIN_INSTANCES = 6;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: '/tmp/blue-current-vite-seaweed-main',
  server: { host: '127.0.0.1', port: 5181, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(150000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  // Keep the CPU/GPU load low in software rendering; this checks the real
  // flag/runtime path without loading rocks, corals and the 49-kelp layer.
  await page.goto('http://127.0.0.1:5181/?seaweed=1&environment=bare&fishCount=50', {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __blueCurrent?: MainApi }).__blueCurrent;
      if (!api || !api.ready) return false;
      const diagnostics = api.getDiagnostics();
      return diagnostics.ready && diagnostics.seaweedModel === 'blender';
    },
    { timeout: 150000 },
  );
  await page.waitForTimeout(900);

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: MainApi }).__blueCurrent.getDiagnostics(),
  );
  assert(diagnostics.seaweedInstances === MAIN_INSTANCES,
    `Expected ${MAIN_INSTANCES} main-scene seaweed instances, received ${diagnostics.seaweedInstances}.`);
  assert(diagnostics.seaweedTriangles === EXPECTED_TRIS * MAIN_INSTANCES,
    `Expected ${EXPECTED_TRIS * MAIN_INSTANCES} seaweed triangles, received ${diagnostics.seaweedTriangles}.`);
  assert(diagnostics.drawCalls > 0, 'Renderer reported zero draw calls.');
  console.log('stage: main scene seaweed validated');

  await page.locator('#viewport canvas').screenshot({
    path: `${artifacts}/seaweed-main-scene.png`,
    timeout: 120000,
  });
  console.log('stage: main scene seaweed canvas captured');

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = { passed: true, diagnostics, browserErrors: errors };
  writeFileSync(`${artifacts}/seaweed-main-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
