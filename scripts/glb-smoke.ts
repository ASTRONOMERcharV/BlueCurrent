import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  glbRocks: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

interface DebugApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
  pause(): void;
  resume(): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'smoke-glb'),
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5174/?glbRocks=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics().glbRocks === true,
    { timeout: 30000 },
  );

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  assert(diagnostics.fishCount === 500, `Expected 500 fish, received ${diagnostics.fishCount}.`);
  assert(diagnostics.canvasWidth > 0 && diagnostics.canvasHeight > 0, 'Canvas has no rendered dimensions.');
  assert(diagnostics.glbRocks, 'GLB rocks flag is false after the loader resolved.');

  await page.waitForTimeout(500);
  await page.screenshot({ path: `${artifacts}/glb-rocks-desktop.png`, fullPage: true });
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = { passed: true, diagnostics, browserErrors: errors };
  writeFileSync(`${artifacts}/glb-rocks-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
