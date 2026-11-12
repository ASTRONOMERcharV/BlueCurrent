import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });
const outputName = process.env.TURN_SHOT ?? 'predator-turn-current.png';
const inspectionView = process.env.TURN_VIEW === 'top' ? '&view=top' : '';
const variant = process.env.PREDATOR_VARIANT ?? 'shayu';
const port = 5193;
const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/smoke-predator-turn`,
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
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // sin(t * 0.55) peaks here: the same strong-turn pose before/after edits.
  await page.goto(
    `http://127.0.0.1:${port}/predator-preview.html?mode=hero&predator=${variant}&poseTime=2.856${inspectionView}`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(
    () => (window as unknown as { __predatorPreview?: { ready?: boolean } })
      .__predatorPreview?.ready === true,
    { timeout: 120000 },
  );
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
  });
  await page.screenshot({ path: `${artifacts}/${outputName}`, timeout: 60000 });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log(`saved ${artifacts}/${outputName}; 0 browser errors`);
} finally {
  await browser.close();
  await server.close();
}
