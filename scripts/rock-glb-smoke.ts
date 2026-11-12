import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface RockCounts {
  large: number;
  medium: number;
  debris: number;
  dune: number;
}

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  glbRocks: boolean;
  glbRockMode: 'off' | 'legacy' | 'set';
  glbRockInstances: RockCounts;
  glbRockTriangles: number;
  drawCalls: number;
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
  cacheDir: join(projectRoot, '.vite', 'smoke-rocks'),
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

async function capture(
  page: import('playwright').Page,
  label: string,
): Promise<Diagnostics> {
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5175/?glbRocks=2&fishCount=80', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent
      ?.getDiagnostics().glbRockMode === 'set',
    { timeout: 60000 },
  );
  await page.evaluate(() => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.pause());
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${artifacts}/${label}.png`, fullPage: false, timeout: 45000 });
  return page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
}

try {
  const desktop = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const diagnostics = await capture(desktop, 'glb-rock-set-desktop');

  const counts = diagnostics.glbRockInstances;
  assert(diagnostics.fishCount === 80, `Expected 80 fish, received ${diagnostics.fishCount}.`);
  assert(diagnostics.glbRocks, 'GLB rock flag is false after the loader resolved.');
  assert(counts.large === 5, `Expected 5 large reef rocks, received ${counts.large}.`);
  assert(counts.medium >= 12, `Expected at least 12 medium rocks, received ${counts.medium}.`);
  assert(counts.debris >= 25, `Expected at least 25 debris pieces, received ${counts.debris}.`);
  assert(counts.dune === 5, `Expected 5 dune instances, received ${counts.dune}.`);
  assert(
    diagnostics.glbRockTriangles > 7500,
    `Expected the rock set above 7500 triangles, received ${diagnostics.glbRockTriangles}.`,
  );
  assert(diagnostics.canvasWidth > 0 && diagnostics.canvasHeight > 0, 'Canvas has no dimensions.');

  const mobile = process.env.ROCK_SMOKE_MOBILE === '1'
    ? await browser.newPage({ viewport: { width: 390, height: 720 }, deviceScaleFactor: 1 })
    : null;
  const mobileDiagnostics = mobile ? await capture(mobile, 'glb-rock-set-mobile') : null;
  if (mobileDiagnostics) {
    assert(
      mobileDiagnostics.glbRockMode === 'set',
      `Mobile fell back to ${mobileDiagnostics.glbRockMode}.`,
    );
  }

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = { passed: true, diagnostics, mobileDiagnostics, counts, browserErrors: errors };
  writeFileSync(`${artifacts}/glb-rock-set-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
