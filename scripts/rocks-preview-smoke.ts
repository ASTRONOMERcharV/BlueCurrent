import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  assetCount: number;
  triangles: number;
  drawCalls: number;
  focus: string | null;
}

interface PreviewApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'smoke-rocks-preview'),
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

async function shoot(page: import('playwright').Page, path: string): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __rocksPreview?: PreviewApi }).__rocksPreview?.ready === true,
    { timeout: 60000 },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path, fullPage: false, timeout: 60000 });
}

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5176/rocks-preview.html', { waitUntil: 'domcontentloaded' });
  await shoot(page, `${artifacts}/rocks-preview-lineup.png`);
  const lineup = await page.evaluate(
    () => (window as unknown as { __rocksPreview: PreviewApi }).__rocksPreview.getDiagnostics(),
  );
  assert(lineup.assetCount === 13, `Expected 13 assets, received ${lineup.assetCount}.`);
  assert(lineup.triangles === 7869, `Expected 7869 triangles, received ${lineup.triangles}.`);
  assert(lineup.drawCalls >= 13, `Expected at least 13 draw calls, received ${lineup.drawCalls}.`);

  await page.goto('http://127.0.0.1:5176/rocks-preview.html?focus=reef_large_a', {
    waitUntil: 'domcontentloaded',
  });
  await shoot(page, `${artifacts}/rocks-preview-focus.png`);
  const focus = await page.evaluate(
    () => (window as unknown as { __rocksPreview: PreviewApi }).__rocksPreview.getDiagnostics(),
  );
  assert(focus.focus === 'reef_large_a', `Focus mode did not activate (${focus.focus}).`);

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = { passed: true, lineup, focus, browserErrors: errors };
  writeFileSync(`${artifacts}/rocks-preview-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
