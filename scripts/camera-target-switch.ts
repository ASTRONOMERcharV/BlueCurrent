import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Dedicated predator target-switch trace.
 *
 * Starts from the boot scenario (no reset) so the predator's target timeline
 * matches the deterministic probe, then records 4 s of per-frame camera state
 * across the 34.5-38.5 s window where the probe observed index changes.
 */

interface Diagnostics {
  simulationTime: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraAngularChange: number;
  cameraTranslationSpeed: number;
  cameraTerrainClearance: number;
  predatorState: string;
  predatorForwardSource: string;
  predatorPosition: [number, number, number];
  predatorTargetIndex: number | null;
  predatorTargetPosition: [number, number, number] | null;
  predatorScreenPosition: [number, number] | null;
  headingSource: string;
  schoolVisibleFraction: number;
  [key: string]: unknown;
}

interface WindowWithApi {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  __blueCurrent: {
    ready: boolean;
    pause(): void;
    setScenario(id: string): void;
    setViewMode(mode: string): void;
    setGridVisible(visible: boolean): void;
    setCameraMode(mode: string): void;
    settleCamera(seconds?: number, frames?: number): Diagnostics;
    step(count?: number): Diagnostics;
    setVisualTime(seconds: number): Diagnostics;
    getDiagnostics(): Diagnostics;
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const port = Number.parseInt(process.argv.find((value) => value.startsWith('--port='))?.slice(7) ?? '5214', 10);
const outputName = process.argv.find((value) => value.startsWith('--out='))?.slice(6) ?? 'camera-target-switch';
const artifacts = join(projectRoot, 'test-artifacts', outputName);
mkdirSync(artifacts, { recursive: true });
const startedAt = Date.now();
const stage = (message: string) => console.log(`[target ${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, 'node_modules', '.vite-world', `camera-target-${port}`),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
});
await server.listen();
stage(`vite server listening on ${port}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const browserErrors: string[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?scenario=encounter&lighting=full`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as unknown as WindowWithApi).__blueCurrent?.ready === true);
  await page.evaluate(() => {
    const api = (window as unknown as WindowWithApi).__blueCurrent;
    api.pause();
    api.setScenario('encounter');
    api.setViewMode('observation');
    api.setGridVisible(false);
    (window as unknown as WindowWithApi).requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(500);

  const advanceTo = async (seconds: number) => {
    const current = await page.evaluate(() => (window as unknown as WindowWithApi).__blueCurrent.getDiagnostics());
    const count = Math.round(seconds * 60) - Math.round(current.simulationTime * 60);
    if (count > 0) {
      await page.evaluate((steps) => (window as unknown as WindowWithApi).__blueCurrent.step(steps), count);
    }
    await page.evaluate((time) => (window as unknown as WindowWithApi).__blueCurrent.setVisualTime(time), seconds);
    stage(`simulation time ${seconds}s ready`);
  };

  await advanceTo(34.5);
  const settled = await page.evaluate(() => {
    const api = (window as unknown as WindowWithApi).__blueCurrent;
    api.setCameraMode('predator');
    return api.settleCamera(2.4, 30);
  });
  stage(`predator camera settled at index ${String(settled.predatorTargetIndex)}`);

  const samples = await page.evaluate(() => {
    const api = (window as unknown as WindowWithApi).__blueCurrent;
    const values: Diagnostics[] = [];
    for (let frame = 0; frame < 240; frame += 1) {
      api.step(1);
      values.push(api.settleCamera(1 / 60, 1));
    }
    return values;
  });

  const transitions: Record<string, unknown>[] = [];
  let previousIndex: number | null = null;
  let maxAngular = 0;
  let maxSpeed = 0;
  let minClearance = Number.POSITIVE_INFINITY;
  let maxVerticalRatio = 0;
  for (const [frame, sample] of samples.entries()) {
    maxAngular = Math.max(maxAngular, sample.cameraAngularChange);
    maxSpeed = Math.max(maxSpeed, sample.cameraTranslationSpeed);
    minClearance = Math.min(minClearance, sample.cameraTerrainClearance);
    if (sample.predatorTargetPosition) {
      const [px, py, pz] = sample.predatorPosition;
      const [tx, ty, tz] = sample.predatorTargetPosition;
      const distance = Math.hypot(tx - px, ty - py, tz - pz);
      if (distance > 1e-6) maxVerticalRatio = Math.max(maxVerticalRatio, Math.abs(ty - py) / distance);
    }
    if (sample.predatorTargetIndex !== previousIndex) {
      if (previousIndex !== null) {
        transitions.push({
          frame,
          simulationTime: sample.simulationTime,
          from: previousIndex,
          to: sample.predatorTargetIndex,
          state: sample.predatorState,
          forward: sample.predatorForwardSource,
          angular: sample.cameraAngularChange,
          speed: sample.cameraTranslationSpeed,
          clearance: sample.cameraTerrainClearance,
          predatorScreen: sample.predatorScreenPosition,
        });
      }
      previousIndex = sample.predatorTargetIndex;
    }
  }

  const report = {
    scenario: 'encounter',
    window: [34.5, 38.5],
    samples: samples.length,
    transitions,
    maxAngular,
    maxSpeed,
    minClearance,
    maxVerticalRatio,
    angular: samples.map((sample) => sample.cameraAngularChange),
    speed: samples.map((sample) => sample.cameraTranslationSpeed),
    clearance: samples.map((sample) => sample.cameraTerrainClearance),
    targetIndex: samples.map((sample) => sample.predatorTargetIndex),
    browserErrors,
  };
  writeFileSync(join(artifacts, 'camera-target-switch.json'), `${JSON.stringify(report, null, 2)}\n`);
  stage(`transitions=${transitions.length} maxAngular=${maxAngular.toFixed(4)}`
    + ` maxSpeed=${maxSpeed.toFixed(3)} minClearance=${minClearance.toFixed(3)}`
    + ` vertical=${maxVerticalRatio.toFixed(4)} errors=${browserErrors.length}`);
  for (const transition of transitions) {
    console.log(`[target] ${String(transition.simulationTime)}s ${String(transition.from)}->${String(transition.to)}`
      + ` state=${String(transition.state)} forward=${String(transition.forward)}`
      + ` angular=${(transition.angular as number).toFixed(4)} speed=${(transition.speed as number).toFixed(3)}`);
  }
  if (browserErrors.length > 0) throw new Error('Browser errors occurred during target-switch capture.');
} finally {
  await browser.close();
  await server.close();
}
