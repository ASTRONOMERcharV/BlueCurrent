import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  fishModel: 'procedural' | 'blender';
  fishTriangles: number;
  fishWorldLength: [number, number];
  clownfishModel: 'off' | 'blender';
  clownfishCount: number;
  clownfishTriangles: number;
  clownfishWorldLength: [number, number] | null;
  clownfishCenter: [number, number, number];
  coralModel: string;
  coralInstances: number;
  seaweedModel: string;
  seaweedInstances: number;
  kelpModel: string;
  glbRockMode: string;
  lightingMode: string;
  drawCalls: number;
  renderTriangles: number;
  fps: number;
}

interface DebugApi {
  ready: boolean;
  getDiagnostics(): Diagnostics;
  pause(): void;
  setCameraPose(position: readonly [number, number, number], target: readonly [number, number, number]): void;
  advanceVisualTime(seconds: number): Diagnostics;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts`;
mkdirSync(artifacts, { recursive: true });
const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, '.vite', 'smoke-rich'),
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const api = (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent;
    if (!api?.ready) return false;
    const d = api.getDiagnostics();
    return d.fishModel === 'blender'
      && d.clownfishModel === 'blender'
      && d.coralModel === 'full'
      && d.seaweedModel === 'blender'
      && d.kelpModel === 'blender'
      && d.glbRockMode === 'set';
  }, { timeout: 180000 });

  const initial = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  assert(initial.fishModel === 'blender', 'The main school did not use the Blender model by default.');
  assert(initial.fishCount === 500, `Expected 500 school fish, received ${initial.fishCount}.`);
  assert(initial.fishTriangles >= 500 && initial.fishTriangles <= 1500,
    `Unexpected school fish triangle budget: ${initial.fishTriangles}.`);
  assert(initial.fishWorldLength[0] >= 0.88 && initial.fishWorldLength[1] <= 1.12,
    `School fish world length ${initial.fishWorldLength.join('–')} m outside 0.90–1.10 m.`);
  assert(initial.clownfishModel === 'blender', 'The clownfish school is not rendering its Blender model.');
  assert(initial.clownfishCount === 100, `Expected 100 clownfish, received ${initial.clownfishCount}.`);
  assert(initial.clownfishTriangles >= 1600 && initial.clownfishTriangles <= 5000,
    `Unexpected clownfish triangle budget: ${initial.clownfishTriangles}.`);
  assert(initial.clownfishWorldLength !== null
    && initial.clownfishWorldLength[0] >= 0.48
    && initial.clownfishWorldLength[1] <= 0.62,
  `Clownfish world length ${initial.clownfishWorldLength?.join('–')} m outside 0.50–0.60 m.`);
  const fishMid = (initial.fishWorldLength[0] + initial.fishWorldLength[1]) / 2;
  const clownfishMid = initial.clownfishWorldLength
    ? (initial.clownfishWorldLength[0] + initial.clownfishWorldLength[1]) / 2
    : 0;
  const lengthRatio = fishMid / Math.max(1e-6, clownfishMid);
  assert(lengthRatio > 1.5 && lengthRatio < 2.2,
    `School/clownfish length ratio ${lengthRatio.toFixed(2)}:1 outside the 1.5–2.2 target.`);
  assert(initial.coralInstances === 48, `Expected the 48-colony coral tier, received ${initial.coralInstances}.`);
  assert(initial.seaweedInstances === 14, `Expected 14 detail seaweed clumps, received ${initial.seaweedInstances}.`);
  assert(initial.lightingMode === 'full', `Expected full lighting, received ${initial.lightingMode}.`);
  assert(initial.drawCalls > 0, 'Renderer reported zero draw calls.');
  assert(initial.renderTriangles > 500000,
    `The richest scene should render well above 500k triangles, reported ${initial.renderTriangles}.`);

  const center = initial.clownfishCenter;
  await page.evaluate(([x, y, z]) => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    api.setCameraPose([x + 2.8, y + 1.4, z + 3.6], [x, y, z]);
    api.advanceVisualTime(2.4);
  }, center);
  await page.waitForTimeout(600);
  // SwiftShader needs ~90 s for one 640x400 WebGL capture at this scene budget;
  // keep a single deterministic frame so the smoke stays inside CI timeouts.
  await page.screenshot({
    path: `${artifacts}/rich-default-clownfish.png`,
    timeout: 150000,
  });

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);
  const report = { passed: true, initial, browserErrors: errors };
  writeFileSync(`${artifacts}/rich-default-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
