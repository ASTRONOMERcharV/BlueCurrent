import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

/**
 * Predator procedural swimming acceptance.
 *
 * Runs the isolated animation test scene and asserts bone motion, turn bend,
 * pitch and pectoral response. The sandbox uses SwiftShader, so the run can
 * be split into `--phase=a` (cruise/turn) and `--phase=b` (vertical/burst)
 * to stay under the command timeout; on hardware `npm run smoke:predator-animation`
 * runs both in one process.
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
  getBoneSnapshot(): Record<string, [number, number, number, number]>;
  setTime(time: number): void;
  setView(view: 'side' | 'top' | 'front'): void;
  setSkeletonVisible(visible: boolean): void;
  setPlaying(playing: boolean): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))?.slice('--phase='.length) ?? 'all';
const runA = phaseArg === 'all' || phaseArg === 'a';
const runB = phaseArg === 'all' || phaseArg === 'b';
if (!runA && !runB) throw new Error(`Unknown phase ${phaseArg}`);

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
const startedAt = Date.now();
function mark(label: string): void {
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${label}`);
}

async function openPage(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return page;
}

async function sample(page: Page, time: number, view: 'side' | 'top' | 'front'): Promise<AnimationDiagnostics> {
  await page.evaluate(({ t, v }) => {
    const api = (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation;
    api.setTime(t);
    api.setView(v);
  }, { t: time, v: view });
  await page.waitForTimeout(120);
  return page.evaluate(
    () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.getDiagnostics(),
  );
}

async function snapshot(page: Page): Promise<Record<string, [number, number, number, number]>> {
  return page.evaluate(
    () => (window as unknown as { __predatorAnimation: AnimationApi }).__predatorAnimation.getBoneSnapshot(),
  );
}

async function openPreview(bones: boolean): Promise<Page> {
  const page = await openPage(1000, 640);
  await page.goto(
    `${baseUrl}predator-animation-preview.html?t=2.5&view=side${bones ? '&bones=1' : ''}`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(
    () => (window as unknown as { __predatorAnimation?: AnimationApi }).__predatorAnimation?.ready === true,
    { timeout: 180000 },
  );
  return page;
}

let cruise: AnimationDiagnostics | undefined;
let leftTurn: AnimationDiagnostics | undefined;
let rightTurn: AnimationDiagnostics | undefined;
let ascend: AnimationDiagnostics | undefined;
let descend: AnimationDiagnostics | undefined;
let burst: AnimationDiagnostics | undefined;
let recover: AnimationDiagnostics | undefined;

try {
  if (runA) {
    const page = await openPreview(false);
    console.log('stage: animation preview loaded (phase a)');
    mark('preview ready');
    cruise = await sample(page, 2.5, 'side');
    mark('cruise sampled');
    assert(cruise.triangles >= 3000 && cruise.triangles <= 20000,
      `Unexpected predator triangle count: ${cruise.triangles}`);
    assert(cruise.bones === 11, `Expected 11 bones, received ${cruise.bones}`);
    assert(finite(cruise.frequency, cruise.phaseDeg, cruise.pitchDeg, cruise.bankDeg,
      cruise.boneAngles.tailFin, cruise.boneAngles.spine04, cruise.boneAngles.spine05),
    'Animation diagnostics contain NaN');
    assert(cruise.frequency >= 0.6 && cruise.frequency <= 2.5,
      `Cruise tail-beat frequency out of range: ${cruise.frequency}`);
    assert(Math.abs(cruise.boneAngles.tailFin) > 0.08,
      `Tail fin is not beating at cruise: ${cruise.boneAngles.tailFin}`);
    assert(Math.abs(cruise.boneAngles.spine05) > 0.005, 'Spine_05 has no pose at cruise');

    // Phase and bone pose must advance continuously (no reset between samples).
    const firstSnapshot = await snapshot(page);
    const early = await sample(page, 2.0, 'side');
    const late = await sample(page, 2.35, 'side');
    const secondSnapshot = await snapshot(page);
    assert(late.phaseDeg > early.phaseDeg, 'Swim phase did not advance monotonically');
    const tailEarly = firstSnapshot.Tail_Fin;
    const tailLate = secondSnapshot.Tail_Fin;
    const dot = tailEarly[0] * tailLate[0] + tailEarly[1] * tailLate[1]
      + tailEarly[2] * tailLate[2] + tailEarly[3] * tailLate[3];
    assert(Math.abs(dot) < 0.9999, 'Tail_Fin quaternion did not change between samples');
    console.log(`stage: cruise verified (f=${cruise.frequency.toFixed(2)} Hz, tail=${cruise.boneAngles.tailFin.toFixed(3)} rad)`);

    leftTurn = await sample(page, 5.5, 'top');
    assert(leftTurn.turn > 0.03, `Left turn signal did not become positive: ${leftTurn.turn}`);
    assert(leftTurn.bankDeg < -0.5, `Left turn did not bank inboard: ${leftTurn.bankDeg}`);
    assert(leftTurn.renderYawDeg > 5 && leftTurn.renderYawDeg < 85,
      `Left turn yaw did not progress: ${leftTurn.renderYawDeg}`);
    assert(leftTurn.tailTurn > 0.02,
      `Left turn did not build a delayed rear-body bend: ${leftTurn.tailTurn}`);
    console.log('stage: left turn verified');

    rightTurn = await sample(page, 11.5, 'top');
    assert(rightTurn.turn < -0.03, `Right turn signal did not become negative: ${rightTurn.turn}`);
    assert(rightTurn.bankDeg > 0.5, `Right turn did not bank inboard: ${rightTurn.bankDeg}`);
    assert(leftTurn.tailTurn - rightTurn.tailTurn > 0.03,
      'Left and right turns do not build opposite delayed rear-body bends');
    console.log('stage: right turn verified');
    await page.close();
  }

  if (runB) {
    const page = await openPreview(false);
    console.log('stage: animation preview loaded (phase b)');
    cruise = cruise ?? await sample(page, 2.5, 'side');

    ascend = await sample(page, 14.5, 'side');
    assert(ascend.pitchDeg > 5, `Ascending pitch too small: ${ascend.pitchDeg}`);
    assert(ascend.boneAngles.pectoralLeft > 0.02,
      `Left pectoral did not raise for ascent: ${ascend.boneAngles.pectoralLeft}`);
    assert(ascend.boneAngles.pectoralRight < -0.02,
      `Right pectoral did not raise for ascent: ${ascend.boneAngles.pectoralRight}`);
    console.log('stage: ascent verified');

    descend = await sample(page, 18.5, 'side');
    assert(descend.pitchDeg < -5, `Descending pitch too small: ${descend.pitchDeg}`);
    assert(descend.boneAngles.pectoralLeft < -0.02,
      `Left pectoral did not lower for descent: ${descend.boneAngles.pectoralLeft}`);
    assert(descend.boneAngles.pectoralRight > 0.02,
      `Right pectoral did not lower for descent: ${descend.boneAngles.pectoralRight}`);
    console.log('stage: descent verified');

    burst = await sample(page, 19.7, 'side');
    assert(burst.attack > 0.5, `Attack envelope did not engage: ${burst.attack}`);
    assert(burst.frequency > cruise.frequency + 0.3,
      `Burst frequency ${burst.frequency} did not exceed cruise ${cruise.frequency}`);
    console.log('stage: burst verified');

    recover = await sample(page, 23.5, 'side');
    assert(recover.attack < 0.2, `Attack envelope did not decay: ${recover.attack}`);
    assert(recover.frequency < burst.frequency - 0.2,
      `Recovery frequency ${recover.frequency} did not fall from burst ${burst.frequency}`);
    assert(recover.pitchDeg > -5 && recover.pitchDeg < 5,
      `Recovery pitch is not level: ${recover.pitchDeg}`);
    console.log('stage: recovery verified');
    await page.close();
  }

  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  const report = {
    passed: true,
    phase: phaseArg,
    cruise,
    leftTurn,
    rightTurn,
    ascend,
    descend,
    burst,
    recover,
    browserErrors: errors,
  };
  const suffix = phaseArg === 'all' ? '' : `-${phaseArg}`;
  writeFileSync(`${artifacts}/results${suffix}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
