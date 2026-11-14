import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface ComboDiagnostics {
  ready: boolean;
  glbRockMode: 'off' | 'legacy' | 'set';
  kelpModel: 'off' | 'blender';
  coralModel: 'off' | 'temperate' | 'full';
  seaweedModel: 'off' | 'blender';
  seaweedInstances: number;
  seaweedTriangles: number;
  drawCalls: number;
}

interface MainApi {
  readonly ready: boolean;
  getDiagnostics(): ComboDiagnostics;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.tmp/blue-current-vite-seaweed-combo`,
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(150000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5183/?seaweed=1&fishCount=20', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __blueCurrent?: MainApi }).__blueCurrent;
      if (!api || !api.ready) return false;
      const d = api.getDiagnostics();
      return d.ready && d.glbRockMode === 'set' && d.kelpModel === 'blender'
        && d.coralModel === 'full' && d.seaweedModel === 'blender';
    },
    { timeout: 150000 },
  );
  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: MainApi }).__blueCurrent.getDiagnostics(),
  );
  assert(diagnostics.seaweedInstances === 14, `Expected 14 seaweed instances, received ${diagnostics.seaweedInstances}.`);
  assert(diagnostics.seaweedTriangles === 13_792 * 14, `Unexpected seaweed triangle count ${diagnostics.seaweedTriangles}.`);
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ passed: true, diagnostics, browserErrors: errors }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
