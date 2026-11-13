import { mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Records the full predator manoeuvre sequence (cruise, turns, climb, dive,
 * burst, recovery) from the isolated test scene as a WebM clip.
 */

interface AnimationApi {
  ready: boolean;
  setTime(time: number): void;
  setPlaying(playing: boolean): void;
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/predator-animation`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/smoke-predator-animation`,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const context = await browser.newContext({
    viewport: { width: 800, height: 500 },
    deviceScaleFactor: 1,
    recordVideo: { dir: artifacts, size: { width: 800, height: 500 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`${baseUrl}preview/predator-animation-preview.html?view=quarter&hud=0`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(
    () => (window as unknown as { __predatorAnimation?: AnimationApi }).__predatorAnimation?.ready === true,
    { timeout: 180000 },
  );
  await page.evaluate(() => {
    const api = (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation;
    api.setTime(0);
    api.setPlaying(true);
  });
  console.log('stage: recording 26 s manoeuvre sequence');
  await page.waitForTimeout(26000);
  const video = page.video();
  await context.close();
  if (video) {
    const raw = await video.path();
    renameSync(raw, `${artifacts}/sequence.webm`);
    console.log(`video saved: ${artifacts}/sequence.webm`);
  } else {
    console.warn('No video was produced by the browser context.');
  }
} finally {
  await browser.close();
  await server.close();
}
