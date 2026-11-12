import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

type Scenario = 'calm' | 'encounter' | 'obstacles';

interface DebugApi {
  ready: boolean;
  pause(): void;
  setScenario(id: Scenario): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setGridVisible(visible: boolean): void;
  setCameraMode(mode: 'overview' | 'school' | 'predator' | 'free'): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  step(count?: number): Record<string, unknown>;
  advanceVisualTime(seconds: number): Record<string, unknown>;
  setVisualTime(seconds: number): Record<string, unknown>;
  getDiagnostics(): Record<string, unknown>;
}

const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='));
const scenario = (scenarioArgument?.split('=')[1] ?? 'calm') as Scenario;
if (!['calm', 'encounter', 'obstacles'].includes(scenario)) throw new Error('Invalid scenario.');
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.split('=')[1] ?? 5191);
const viewArgument = process.argv.find((argument) => argument.startsWith('--view='));
const view = viewArgument?.split('=')[1] ?? 'console';
if (view !== 'console' && view !== 'environment') throw new Error('Invalid --view value.');
const outArgument = process.argv.find((argument) => argument.startsWith('--out='));
const out = outArgument?.split('=')[1] ?? 'visual-quality-v1';
if (!/^[a-z0-9/-]+$/.test(out)) throw new Error('Invalid --out value.');
const cameraArgument = process.argv.find((argument) => argument.startsWith('--camera='));
const camera = (cameraArgument?.split('=')[1] ?? 'overview') as
  'overview' | 'school' | 'predator' | 'free';
if (!['overview', 'school', 'predator', 'free'].includes(camera)) {
  throw new Error('Invalid --camera value.');
}
const poseArgument = process.argv.find((argument) => argument.startsWith('--pose='));
const pose = poseArgument
  ? poseArgument.split('=')[1].split(',').map((value) => Number.parseFloat(value))
  : null;
if (pose && (pose.length !== 6 || pose.some((value) => !Number.isFinite(value)))) {
  throw new Error('Invalid --pose value; expected x,y,z,tx,ty,tz.');
}
const temporalArgument = process.argv.find((argument) => argument.startsWith('--temporal='));
const temporalOffsets = temporalArgument
  ? temporalArgument.split('=')[1].split(',').map((value) => Number.parseFloat(value))
  : [];
if (temporalOffsets.some((value) => !Number.isFinite(value) || value < 0)) {
  throw new Error('Invalid --temporal value; expected comma-separated seconds.');
}
const visualTimeArgument = process.argv.find((argument) => argument.startsWith('--visual-time='));
const visualTime = visualTimeArgument
  ? Number.parseFloat(visualTimeArgument.split('=')[1])
  : null;
if (visualTime !== null && (!Number.isFinite(visualTime) || visualTime < 0)) {
  throw new Error('Invalid --visual-time value; expected non-negative seconds.');
}
const stepsArgument = process.argv.find((argument) => argument.startsWith('--steps='));
const steps = Number.parseInt(stepsArgument?.split('=')[1] ?? '', 10);
const lightingArgument = process.argv.find((argument) => argument.startsWith('--lighting='));
const lighting = lightingArgument?.split('=')[1] ?? 'full';
if (lighting !== 'full' && lighting !== 'base') throw new Error('Invalid --lighting value.');
const captureStart = Date.now();
const stage = (message: string) => console.log(`[capture ${((Date.now() - captureStart) / 1000).toFixed(1)}s] ${message}`);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/${out}`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  // Vite's dep re-optimization unlinks stale cache files, which fails on the
  // mounted project drive (EPERM). Keep this throwaway cache in the OS temp
  // dir instead of `.vite/` so a re-run can never trip over undeletable files.
  cacheDir: join(tmpdir(), 'blue-current-vite', `visual-quality-${port}`),
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
stage(`vite server listening on ${port}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  stage('page.goto');
  await page.goto(`http://127.0.0.1:${port}/?scenario=${scenario}&lighting=${lighting}`, { waitUntil: 'networkidle' });
  stage('page loaded');
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DebugApi }
  ).__blueCurrent?.ready === true);
  stage('app ready');
  await page.evaluate(({ id, cameraMode, stepCount, cameraPose, fixedVisualTime }) => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    api.setScenario(id);
    api.setViewMode('observation');
    api.setGridVisible(false);
    api.setCameraMode(cameraMode);
    if (cameraPose) {
      api.setCameraPose(
        [cameraPose[0], cameraPose[1], cameraPose[2]],
        [cameraPose[3], cameraPose[4], cameraPose[5]],
      );
    }
    const advance = stepCount > 0 ? stepCount : id === 'encounter' ? 18 : 0;
    if (advance > 0) api.step(advance);
    if (fixedVisualTime !== null) api.setVisualTime(fixedVisualTime);
  }, {
    id: scenario,
    cameraMode: camera,
    stepCount: Number.isFinite(steps) ? steps : 0,
    cameraPose: pose,
    fixedVisualTime: visualTime,
  });
  stage('scene configured');
  await page.waitForTimeout(800);
  // Wait on the real render-loop counter, not wall time: SwiftShader frames can
  // take over a second and a fixed delay may screenshot a cleared buffer.
  const waitForRenderedFrames = async (count: number) => {
    const from = await page.evaluate(() => (
      window as unknown as { __blueCurrent: DebugApi }
    ).__blueCurrent.getDiagnostics().frameSampleCount as number);
    await page.waitForFunction(({ target, previous }) => (
      ((window as unknown as { __blueCurrent: DebugApi })
        .__blueCurrent.getDiagnostics().frameSampleCount as number) > previous + target
    ), { target: count, previous: from });
    await page.waitForTimeout(300);
  };
  await waitForRenderedFrames(2);
  stage('frames rendered');

  if (view === 'environment') {
    await page.locator('#panel-toggle').click();
    await page.waitForFunction(() => (
      document.querySelector('.observatory')?.classList.contains('panel-closed') === true
    ));
    await page.waitForTimeout(400);
    await waitForRenderedFrames(3);
  }
  // Software-rendered Chromium spends ~60 s per screenshot while the app keeps
  // re-rendering. Freezing the loop after the scene is fully configured keeps
  // the exact same frame but lets the compositor hand it over in ~half the
  // time; temporal frames re-render synchronously through advanceVisualTime.
  const frozen = process.env.BLUE_CURRENT_CAPTURE_FREEZE === '1';
  if (frozen) {
    await page.evaluate(() => {
      (window as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
        .requestAnimationFrame = () => 0;
    });
    await page.waitForTimeout(900);
    // The panel-close repaint can clear the (preserveDrawingBuffer=false)
    // canvas after the loop stops, so draw one fresh frame at the exact same
    // paused state before the screenshot.
    await page.evaluate((fixedVisualTime) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      api.step(0);
      if (fixedVisualTime !== null) api.setVisualTime(fixedVisualTime);
    }, visualTime);
    await page.waitForTimeout(400);
    stage('render loop frozen');
  }
  const label = camera === 'overview' ? scenario : `${scenario}-${camera}`;
  stage('taking screenshot');
  await page.screenshot({
    path: `${artifacts}/${label}-${view}.png`,
    fullPage: true,
    timeout: 120000,
  });
  let previousOffset = 0;
  for (const offset of temporalOffsets) {
    await page.evaluate((seconds) => (
      (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.advanceVisualTime(seconds)
    ), offset - previousOffset);
    previousOffset = offset;
    if (frozen) {
      await page.waitForTimeout(600);
    } else {
      await waitForRenderedFrames(2);
    }
    stage(`temporal frame ready (+${offset}s)`);
    await page.screenshot({
      path: `${artifacts}/${label}-${view}-t${offset.toFixed(2)}.png`,
      fullPage: true,
      timeout: 120000,
    });
  }
  stage('screenshot saved');
  const diagnostics = await page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getDiagnostics());
  if (errors.length > 0) throw new Error(errors.join('\n'));
  writeFileSync(
    `${artifacts}/${label}-${view}.json`,
    `${JSON.stringify({
      scenario,
      camera,
      pose,
      temporalOffsets,
      visualTime,
      view,
      lighting,
      renderer: 'SwiftShader software rendering; screenshots only, not hardware performance data.',
      diagnostics,
      browserErrors: errors,
    }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ scenario, diagnostics, browserErrors: errors }, null, 2));
} finally {
  // Software-rendered Chromium can take minutes to tear down (SwiftShader
  // teardown waits on the last composited frames). All evidence is already on
  // disk at this point, so an opt-in force exit keeps each capture well inside
  // unattended relay time boxes without changing what was captured.
  if (process.env.BLUE_CURRENT_CAPTURE_FORCE_EXIT === '1') {
    process.exit(0);
  }
  await browser.close();
  await server.close();
}
