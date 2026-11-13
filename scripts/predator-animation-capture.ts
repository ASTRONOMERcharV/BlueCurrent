import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

/**
 * Fixed-frame evidence capture for the predator swim animation test scene.
 * Uses direct WebGL canvas capture because Playwright page screenshots are
 * extremely slow under the sandbox's SwiftShader renderer.
 */

interface BoneAngles {
  spine04: number;
  spine05: number;
  tailFin: number;
  pectoralLeft: number;
  pectoralRight: number;
}

interface AnimationDiagnostics {
  ready: boolean;
  time: number;
  segment: string;
  speed: number;
  headingDeg: number;
  renderYawDeg: number;
  pitchDeg: number;
  bankDeg: number;
  frequency: number;
  phaseDeg: number;
  turn: number;
  tailTurn: number;
  attack: number;
  triangles: number;
  bones: number;
  boneAngles: BoneAngles;
}

interface AnimationApi {
  ready: boolean;
  getDiagnostics(): AnimationDiagnostics;
  setTime(time: number): void;
  setView(view: 'side' | 'top' | 'front' | 'quarter'): void;
  setSkeletonVisible(visible: boolean): void;
  capture(): string;
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
const errors: string[] = [];
const records: Array<{ file: string; diagnostics: AnimationDiagnostics }> = [];

async function capture(page: Page, file: string): Promise<void> {
  const started = Date.now();
  const dataUrl = await page.evaluate(
    () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.capture(),
  );
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Canvas capture returned no data URL');
  writeFileSync(`${artifacts}/${file}`, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  const diagnostics = await page.evaluate(
    () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.getDiagnostics(),
  );
  records.push({ file, diagnostics });
  console.log(`captured ${file} @ ${diagnostics.time.toFixed(1)}s ${diagnostics.segment} `
    + `(${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

async function pose(
  page: Page,
  time: number,
  view: 'side' | 'top' | 'front' | 'quarter',
): Promise<AnimationDiagnostics> {
  await page.evaluate(({ t, v }) => {
    const api = (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation;
    api.setTime(t);
    api.setView(v);
  }, { t: time, v: view });
  await page.waitForTimeout(150);
  return page.evaluate(
    () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.getDiagnostics(),
  );
}

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${baseUrl}preview/predator-animation-preview.html?t=2.5&view=side&hud=0`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(
    () => (window as unknown as { __predatorAnimation?: AnimationApi }).__predatorAnimation?.ready === true,
    { timeout: 180000 },
  );
  console.log('stage: capture preview ready');

  const schedule: Array<[string, number, 'side' | 'top' | 'front' | 'quarter']> = [
    ['01-cruise-side.jpg', 2.5, 'side'],
    ['02-cruise-top.jpg', 2.7, 'top'],
    ['03-cruise-front.jpg', 2.7, 'front'],
    ['04-left-turn-top.jpg', 5.5, 'top'],
    ['05-right-turn-top.jpg', 11.5, 'top'],
    ['06-ascend-quarter.jpg', 14.5, 'quarter'],
    ['07-descend-quarter.jpg', 18.5, 'quarter'],
    ['08-burst-quarter.jpg', 19.7, 'quarter'],
    ['09-recover-side.jpg', 23.5, 'side'],
  ];
  const startArg = process.argv.find((arg) => arg.startsWith('--start='));
  const countArg = process.argv.find((arg) => arg.startsWith('--count='));
  const startIndex = startArg ? Number(startArg.slice('--start='.length)) : 0;
  const count = countArg ? Number(countArg.slice('--count='.length)) : schedule.length;
  const selection = schedule.slice(startIndex, startIndex + count);
  for (const [file, time, view] of selection) {
    await pose(page, time, view);
    await capture(page, file);
  }

  if (startIndex === 0 && !process.argv.includes('--no-skeleton')) {
    await pose(page, 2.5, 'quarter');
    await page.evaluate(
      () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.setSkeletonVisible(true),
    );
    await page.waitForTimeout(150);
    await capture(page, '10-cruise-skeleton.jpg');
    await page.evaluate(
      () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.setSkeletonVisible(false),
    );
  }

  if (errors.length > 0) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  writeFileSync(
    `${artifacts}/capture-results.json`,
    JSON.stringify({ passed: true, records, browserErrors: errors }, null, 2),
  );
  console.log(`captured ${records.length} frames`);
} finally {
  await browser.close();
  await server.close();
}
