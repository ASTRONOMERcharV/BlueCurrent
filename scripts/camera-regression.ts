import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Deterministic camera-stability regression.
 *
 * Records frame-by-frame camera metrics for preset modes, mode transitions,
 * viewport widths, pause/resume and irregular deltas. The render loop is
 * frozen; every camera update is issued through the debug API, so results do
 * not depend on wall-clock frame rate.
 */

type CameraMode = 'overview' | 'school' | 'predator';

interface Diagnostics {
  simulationTime: number;
  cameraMode: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraLookTarget: [number, number, number];
  cameraQuaternion: [number, number, number, number];
  cameraUp: [number, number, number];
  cameraAngularChange: number;
  cameraTranslationSpeed: number;
  cameraTerrainClearance: number;
  cameraDistance: number;
  schoolVisibleFraction: number;
  schoolScreenBounds: [number, number, number, number] | null;
  schoolFitScale: number;
  schoolFitRawScale: number;
  schoolFitPercentile: number;
  schoolFitSampleCount: number;
  schoolFitPredictedVisibleFraction: number;
  headingCoherence: number;
  headingReliability: number;
  headingSource: string;
  predatorState: string;
  predatorForwardSource: string;
  predatorTargetDistance: number | null;
  predatorPosition: [number, number, number];
  predatorTargetPosition: [number, number, number] | null;
  predatorTargetIndex: number | null;
  predatorScreenPosition: [number, number] | null;
  targetFishScreenPosition: [number, number] | null;
  fishCount: number;
  [key: string]: unknown;
}

interface DebugApi {
  ready: boolean;
  pause(): void;
  resume(): void;
  setScenario(id: string): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setGridVisible(visible: boolean): void;
  setCameraMode(mode: CameraMode): void;
  reset(): void;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  step(count?: number): Diagnostics;
  setVisualTime(seconds: number): Diagnostics;
  getDiagnostics(): Diagnostics;
}

interface WindowWithApi {
  __blueCurrent: DebugApi;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const outputName = argument('out', 'camera-regression');
const port = Number.parseInt(argument('port', '5202'), 10);
const width = Number.parseInt(argument('width', '1440'), 10);
const height = Number.parseInt(argument('height', '900'), 10);
const times = argument('times', '17,43,44.15,52,60,63')
  .split(',')
  .map((value) => Number.parseFloat(value))
  .filter((value) => Number.isFinite(value) && value >= 0);
if (times.length === 0) throw new Error('Invalid --times value.');

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(projectRoot, 'test-artifacts', outputName);
mkdirSync(artifacts, { recursive: true });
const startedAt = Date.now();
const stage = (message: string) => console.log(`[camera ${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, 'node_modules', '.vite-world', `camera-regression-${port}`),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
});
await server.listen();
stage(`vite server listening on ${port}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const browserErrors: string[] = [];
const invariants: string[] = [];

function checkDiagnostics(label: string, diagnostics: Diagnostics): void {
  const finite = (values: readonly number[]) => values.every((value) => Number.isFinite(value));
  if (!finite(diagnostics.cameraPosition)) invariants.push(`${label}: cameraPosition not finite`);
  if (!finite(diagnostics.cameraTarget)) invariants.push(`${label}: cameraTarget not finite`);
  if (!finite(diagnostics.cameraLookTarget)) invariants.push(`${label}: cameraLookTarget not finite`);
  if (!finite(diagnostics.cameraQuaternion)) invariants.push(`${label}: cameraQuaternion not finite`);
  if (!finite(diagnostics.cameraUp)) invariants.push(`${label}: cameraUp not finite`);
  if (!Number.isFinite(diagnostics.cameraTerrainClearance) || diagnostics.cameraTerrainClearance < 1.09) {
    invariants.push(`${label}: terrain clearance ${diagnostics.cameraTerrainClearance}`);
  }
  if (diagnostics.cameraMode === 'school') {
    if (!Number.isFinite(diagnostics.schoolFitScale)
      || diagnostics.schoolFitScale < 1
      || diagnostics.schoolFitScale > 1.4) {
      invariants.push(`${label}: school fit scale ${diagnostics.schoolFitScale}`);
    }
    if (!Number.isFinite(diagnostics.schoolVisibleFraction)) {
      invariants.push(`${label}: school visibility not finite`);
    }
  }
}

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
    console.log(`[camera] pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  stage('page.goto');
  await page.goto(`http://127.0.0.1:${port}/?scenario=encounter&lighting=full`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(() => (
    window as unknown as WindowWithApi
  ).__blueCurrent?.ready === true);
  await page.evaluate(() => {
    const api = (window as unknown as WindowWithApi).__blueCurrent;
    api.pause();
    api.setScenario('encounter');
    api.setViewMode('observation');
    api.setGridVisible(false);
  });
  await page.addStyleTag({
    content: `
      .masthead,
      .control-panel,
      .panel-scrim,
      .viewport-topbar,
      .depth-rail,
      .predator-watch,
      .scene-caption,
      .telemetry-strip,
      .scene-search-state,
      .viewport-vignette,
      .capture-toast {
        display: none !important;
      }
      .workspace {
        display: block !important;
        padding: 0 !important;
      }
      .viewport-shell {
        position: fixed !important;
        inset: 0 !important;
        border-radius: 0 !important;
      }
    `,
  });
  await page.evaluate(() => {
    (window as unknown as WindowWithApi).requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(500);
  stage('render loop frozen');

  const currentDiagnostics = () => page.evaluate(() => (
    window as unknown as WindowWithApi
  ).__blueCurrent.getDiagnostics());

  const advanceTo = async (seconds: number) => {
    const diagnostics = await currentDiagnostics();
    const count = Math.round(seconds * 60) - Math.round(diagnostics.simulationTime * 60);
    if (count > 0) {
      await page.evaluate((steps) => (
        window as unknown as WindowWithApi
      ).__blueCurrent.step(steps), count);
    }
    await page.evaluate((time) => (
      window as unknown as WindowWithApi
    ).__blueCurrent.setVisualTime(time), seconds);
    stage(`simulation time ${seconds}s ready`);
  };

  const settle = async (mode: CameraMode, seconds = 2.4, frames = 30) => {
    const diagnostics = await page.evaluate(({ mode: next, seconds: duration, frames: count }) => {
      const api = (window as unknown as WindowWithApi).__blueCurrent;
      api.setCameraMode(next);
      return api.settleCamera(duration, count);
    }, { mode, seconds, frames });
    checkDiagnostics(`${mode}@${diagnostics.simulationTime.toFixed(2)}`, diagnostics);
    return diagnostics;
  };

  const presets: Record<string, unknown>[] = [];
  const transitions: Record<string, unknown>[] = [];

  for (const time of times) {
    await advanceTo(time);
    const byMode: Record<string, Diagnostics> = {};
    for (const mode of ['overview', 'school', 'predator'] as CameraMode[]) {
      const diagnostics = await settle(mode);
      byMode[mode] = diagnostics;
      presets.push({ time, mode, diagnostics });
    }

    for (const [from, to] of [
      ['overview', 'school'],
      ['school', 'predator'],
      ['predator', 'overview'],
    ] as [CameraMode, CameraMode][]) {
      await settle(from, 2.4, 24);
      const samples = await page.evaluate(({ next }) => {
        const api = (window as unknown as WindowWithApi).__blueCurrent;
        api.setCameraMode(next);
        const values: Diagnostics[] = [];
        for (let frame = 0; frame < 90; frame += 1) {
          values.push(api.settleCamera(1 / 60, 1));
        }
        return values;
      }, { next: to });
      let maxAngular = 0;
      let maxSpeed = 0;
      let minClearance = Number.POSITIVE_INFINITY;
      let modeSwitchAngular = 0;
      for (const [frame, sample] of samples.entries()) {
        maxAngular = Math.max(maxAngular, sample.cameraAngularChange);
        maxSpeed = Math.max(maxSpeed, sample.cameraTranslationSpeed);
        minClearance = Math.min(minClearance, sample.cameraTerrainClearance);
        if (frame === 0) modeSwitchAngular = sample.cameraAngularChange;
        checkDiagnostics(`${from}->${to}@${time}+${frame}`, sample);
      }
      transitions.push({
        time,
        from,
        to,
        maxAngular,
        modeSwitchAngular,
        maxSpeed,
        minClearance,
        finalMode: samples.at(-1)?.cameraMode,
        finalPosition: samples.at(-1)?.cameraPosition,
        finalTarget: samples.at(-1)?.cameraLookTarget,
      });
    }
  }

  const viewportTests: Record<string, unknown>[] = [];
  for (const [label, viewportWidth, viewportHeight] of [
    ['narrow', 1024, 900],
    ['wide', 1920, 700],
  ] as const) {
    await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
    await page.waitForTimeout(500);
    for (const mode of ['school', 'predator'] as CameraMode[]) {
      const diagnostics = await settle(mode, 2.4, 30);
      const canvas = await page.evaluate(() => {
        const element = document.querySelector('canvas');
        return element ? [element.width, element.height] : null;
      });
      viewportTests.push({
        label,
        requested: [viewportWidth, viewportHeight],
        canvas,
        mode,
        diagnostics,
      });
    }
  }
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);

  await settle('overview', 2.4, 24);
  const pauseProbe = await page.evaluate(() => {
    const api = (window as unknown as WindowWithApi).__blueCurrent;
    api.pause();
    const before = api.getDiagnostics();
    api.settleCamera(0.5, 5);
    const after = api.getDiagnostics();
    api.resume();
    return { before, after };
  });
  checkDiagnostics('pause', pauseProbe.after);

  const irregularDeltas: Record<string, unknown>[] = [];
  await settle('school', 2.4, 24);
  for (const seconds of [0.003, 0.016, 0.12, 0.2]) {
    const diagnostics = await page.evaluate((duration) => {
      const api = (window as unknown as WindowWithApi).__blueCurrent;
      return api.settleCamera(duration, 1);
    }, seconds);
    checkDiagnostics(`delta-${seconds}`, diagnostics);
    irregularDeltas.push({ seconds, diagnostics });
  }

  const runTrace = async (
    label: string,
    mode: CameraMode,
    start: number,
    frames: number,
  ) => {
    await page.evaluate(() => {
      const api = (window as unknown as WindowWithApi).__blueCurrent;
      api.reset();
      api.pause();
      api.setScenario('encounter');
      api.setViewMode('observation');
      api.setGridVisible(false);
    });
    await advanceTo(start);
    await settle(mode, 2.4, 30);
    const samples = await page.evaluate(({ count }) => {
      const api = (window as unknown as WindowWithApi).__blueCurrent;
      const values: Diagnostics[] = [];
      for (let frame = 0; frame < count; frame += 1) {
        api.step(1);
        values.push(api.settleCamera(1 / 60, 1));
      }
      return values;
    }, { count: frames });
    let maxAngular = 0;
    let maxSpeed = 0;
    let minClearance = Number.POSITIVE_INFINITY;
    let maxVerticalRatio = 0;
    let minCoherence = Number.POSITIVE_INFINITY;
    let minVisible = Number.POSITIVE_INFINITY;
    let maxFitScale = 0;
    let targetChanges = 0;
    let previousIndex: number | null = null;
    const targetTransitions: Record<string, unknown>[] = [];
    const headingSources = new Set<string>();
    for (const [frame, sample] of samples.entries()) {
      maxAngular = Math.max(maxAngular, sample.cameraAngularChange);
      maxSpeed = Math.max(maxSpeed, sample.cameraTranslationSpeed);
      minClearance = Math.min(minClearance, sample.cameraTerrainClearance);
      if (Number.isFinite(sample.headingCoherence)) {
        minCoherence = Math.min(minCoherence, sample.headingCoherence);
      }
      if (Number.isFinite(sample.schoolVisibleFraction)) {
        minVisible = Math.min(minVisible, sample.schoolVisibleFraction);
      }
      maxFitScale = Math.max(maxFitScale, sample.schoolFitScale);
      headingSources.add(sample.headingSource);
      if (sample.predatorTargetPosition) {
        const [px, py, pz] = sample.predatorPosition;
        const [tx, ty, tz] = sample.predatorTargetPosition;
        const vertical = Math.abs(ty - py);
        const distance = Math.hypot(tx - px, ty - py, tz - pz);
        if (distance > 1e-6) maxVerticalRatio = Math.max(maxVerticalRatio, vertical / distance);
      }
      if (sample.predatorTargetIndex !== previousIndex) {
        if (previousIndex !== null) {
          targetChanges += 1;
          targetTransitions.push({
            frame,
            simulationTime: sample.simulationTime,
            from: previousIndex,
            to: sample.predatorTargetIndex,
            state: sample.predatorState,
            angular: sample.cameraAngularChange,
            speed: sample.cameraTranslationSpeed,
          });
        }
        previousIndex = sample.predatorTargetIndex;
      }
      checkDiagnostics(`${label}@${sample.simulationTime.toFixed(3)}`, sample);
    }
    stage(`trace ${label}: ${samples.length} frames, ${targetChanges} target changes`);
    return {
      label,
      mode,
      start,
      frames,
      maxAngular,
      maxSpeed,
      minClearance,
      maxVerticalRatio,
      minCoherence: Number.isFinite(minCoherence) ? minCoherence : null,
      minVisibleFraction: Number.isFinite(minVisible) ? minVisible : null,
      maxFitScale,
      headingSources: [...headingSources],
      targetChanges,
      targetTransitions,
      angular: samples.map((sample) => sample.cameraAngularChange),
      speed: samples.map((sample) => sample.cameraTranslationSpeed),
      clearance: samples.map((sample) => sample.cameraTerrainClearance),
      coherence: samples.map((sample) => sample.headingCoherence),
      visibleFraction: samples.map((sample) => sample.schoolVisibleFraction),
      fitScale: samples.map((sample) => sample.schoolFitScale),
      targetDistance: samples.map((sample) => sample.predatorTargetDistance),
    };
  };

  const traces = [
    await runTrace('vertical-pursuit', 'predator', 43.5, 90),
    await runTrace('target-change', 'predator', 34.5, 150),
    await runTrace('low-coherence-school', 'school', 42.4, 100),
  ];

  const report = {
    scenario: 'encounter',
    viewport: { width, height },
    times,
    presets,
    transitions,
    viewportTests,
    traces,
    pause: {
      before: pauseProbe.before.cameraPosition,
      after: pauseProbe.after.cameraPosition,
      displacement: Math.hypot(
        pauseProbe.after.cameraPosition[0] - pauseProbe.before.cameraPosition[0],
        pauseProbe.after.cameraPosition[1] - pauseProbe.before.cameraPosition[1],
        pauseProbe.after.cameraPosition[2] - pauseProbe.before.cameraPosition[2],
      ),
    },
    irregularDeltas,
    invariants,
    browserErrors,
  };
  writeFileSync(join(artifacts, 'camera-regression.json'), `${JSON.stringify(report, null, 2)}\n`);

  for (const preset of presets) {
    const diagnostics = preset.diagnostics as Diagnostics;
    if (preset.mode === 'school') {
      console.log(
        `[camera] t${preset.time} school visible=${diagnostics.schoolVisibleFraction.toFixed(3)}`
        + ` fit=${diagnostics.schoolFitScale.toFixed(3)} raw=${diagnostics.schoolFitRawScale.toFixed(3)}`
        + ` coherence=${diagnostics.headingCoherence.toFixed(3)} source=${diagnostics.headingSource}`
        + ` angular=${diagnostics.cameraAngularChange.toFixed(4)}`,
      );
    } else if (preset.mode === 'predator') {
      console.log(
        `[camera] t${preset.time} predator state=${diagnostics.predatorState}`
        + ` forward=${diagnostics.predatorForwardSource} distance=${String(diagnostics.predatorTargetDistance)}`
        + ` screen=${JSON.stringify(diagnostics.predatorScreenPosition)}`
        + ` angular=${diagnostics.cameraAngularChange.toFixed(4)}`,
      );
    } else {
      console.log(
        `[camera] t${preset.time} overview clearance=${diagnostics.cameraTerrainClearance.toFixed(3)}`,
      );
    }
  }
  for (const transition of transitions) {
    console.log(
      `[camera] t${transition.time} ${transition.from}->${transition.to}`
      + ` maxAngular=${(transition.maxAngular as number).toFixed(4)}`
      + ` maxSpeed=${(transition.maxSpeed as number).toFixed(3)}`
      + ` minClearance=${(transition.minClearance as number).toFixed(3)}`,
    );
  }
  console.log(`[camera] invariants=${invariants.length}`);
  invariants.slice(0, 10).forEach((entry) => console.log(`  ${entry}`));
  console.log(`[camera] browserErrors=${browserErrors.length}`);
  browserErrors.slice(0, 5).forEach((entry) => console.log(`  ${entry}`));
  stage(`wrote ${join(artifacts, 'camera-regression.json')}`);
  if (browserErrors.length > 0) throw new Error('Browser errors occurred during camera regression.');
  if (invariants.length > 0) throw new Error('Camera invariants failed.');
} finally {
  await browser.close();
  await server.close();
}
