import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Phase2Stats {
  triangles: number;
  materialCount: number;
  lengthZ: number;
  hasJawWeights: boolean;
  jawWeightMin: number;
  jawWeightMax: number;
  hasTailWeights: boolean;
}

interface Phase2Api {
  ready: boolean;
  predatorModel: string;
  getAssetStats(): Phase2Stats | null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });
const port = 5188;

const server = await createServer({
  root: projectRoot,
  server: { host: '127.0.0.1', port, strictPort: true },
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

  const base = `http://127.0.0.1:${port}/predator-preview.html?predator=phase2&mode=hero`;
  await page.goto(`${base}&jaw=closed`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __predatorPreview?: Phase2Api }).__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  const closedStats = await page.evaluate(
    () => (window as unknown as { __predatorPreview: Phase2Api }).__predatorPreview.getAssetStats(),
  );
  assert(closedStats !== null, 'Phase 2 preview did not expose asset statistics.');
  assert(closedStats.hasJawWeights, 'Phase 2 GLB is missing the _JAW vertex attribute.');
  assert(closedStats.hasTailWeights, 'Phase 2 GLB is missing the _TAILWEIGHT vertex attribute.');
  assert(closedStats.materialCount === 4, `Unexpected material count: ${closedStats.materialCount}.`);
  assert(closedStats.jawWeightMin >= -0.001 && closedStats.jawWeightMax <= 1.001,
    `Jaw weights outside [0,1]: ${closedStats.jawWeightMin}..${closedStats.jawWeightMax}.`);
  await page.screenshot({ path: `${artifacts}/predator-phase2-closed.png`, timeout: 60000 });

  await page.goto(`${base}&jaw=open`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __predatorPreview?: Phase2Api }).__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${artifacts}/predator-phase2-open.png`, timeout: 60000 });

  const closeBase = `http://127.0.0.1:${port}/predator-preview.html?predator=phase2&mode=close`;
  await page.goto(`${closeBase}&jaw=closed`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __predatorPreview?: Phase2Api }).__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${artifacts}/predator-phase2-close-closed.png`, timeout: 60000 });

  await page.goto(`${closeBase}&jaw=open`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __predatorPreview?: Phase2Api }).__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${artifacts}/predator-phase2-close-open.png`, timeout: 60000 });

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = { passed: true, stats: closedStats, browserErrors: errors };
  writeFileSync(`${artifacts}/predator-phase2-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
