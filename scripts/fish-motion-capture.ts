import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

/**
 * Phase E1 evidence capture.
 *
 * One run captures either the shipping presentation (smooth pitch / turn bend)
 * or `?fishMotion=legacy` (pre-E1 instantaneous pitch, no bend). Both runs step
 * the same deterministic encounter simulation frame by frame and photograph it
 * from the same two fixed poses at the same simulation times, so every pair
 * shares state, camera and visual time. The render loop is frozen and every
 * frame is an explicit debug render; screenshots are canvas readbacks, never
 * wall-clock captures. Software rendering is functional evidence only.
 */

type MotionMode = 'smooth' | 'legacy';

interface Diagnostics {
  simulationTime: number;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraMode: string;
  predatorState: string;
  predatorPosition: [number, number, number];
  predatorTargetIndex: number | null;
  predatorTargetPosition: [number, number, number] | null;
  schoolCenter: [number, number, number];
  canvasWidth: number;
  canvasHeight: number;
  drawCalls: number;
  renderTriangles: number;
}

interface MotionDiagnostics {
  meanAbsPitch: number;
  maxAbsPitch: number;
  meanAbsBank: number;
  maxAbsBank: number;
  meanAbsTurn: number;
  maxAbsTurn: number;
  meanSpeed: number;
  meanFear: number;
  maxTargetPitchIndex: number;
  maxTargetPitchPosition: readonly [number, number, number] | null;
}

interface Snapshot {
  checksum: string;
  captures: number;
  predatorState: string;
}

interface CaptureApi {
  ready: boolean;
  pause(): void;
  setScenario(id: string): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setGridVisible(visible: boolean): void;
  setCameraMode(mode: 'overview' | 'free' | 'orbit' | 'school' | 'predator'): void;
  setCameraPose(
    position: [number, number, number],
    target: [number, number, number],
  ): Diagnostics;
  settleCamera(seconds?: number, frames?: number): Diagnostics;
  settleVisual(seconds?: number, frames?: number): Diagnostics;
  step(count?: number): Diagnostics;
  advanceVisualTime(seconds: number): Diagnostics;
  setVisualTime(seconds: number): Diagnostics;
  getDiagnostics(): Diagnostics;
  getFishMotionDiagnostics(): {
    school: MotionDiagnostics;
    clownfish: MotionDiagnostics | null;
  };
  getSimulationSnapshot(): Snapshot;
}

interface CaptureResult {
  dataUrl: string;
  diagnostics: Diagnostics;
  motion: { school: MotionDiagnostics; clownfish: MotionDiagnostics | null };
  snapshot: Snapshot;
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const out = argument('out', 'fish-motion');
const motion = argument('motion', 'smooth') as MotionMode;
if (motion !== 'smooth' && motion !== 'legacy') throw new Error('--motion must be smooth or legacy.');
const width = Math.max(320, Number.parseInt(argument('width', '960'), 10));
const height = Math.max(180, Number.parseInt(argument('height', '540'), 10));
const port = Number.parseInt(argument('port', '5218'), 10);
const software = argument('software', '1') === '1';
const headed = argument('headed', '0') === '1';
const channel = argument('channel', '');
const serveDist = argument('serve-dist', 'dist');
const startSeconds = Number.parseFloat(argument('start', '16.9'));
const times = argument('times', '17.00,17.12,17.24,17.36')
  .split(',')
  .map((value) => Number.parseFloat(value))
  .filter((value) => Number.isFinite(value) && value > 0)
  .sort((first, second) => first - second);
if (times.length === 0) throw new Error('--times did not contain a positive number.');

const root = normalize(resolve(serveDist));
const rootPrefix = `${root}${sep}`;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.json': 'application/json',
};

const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
    let filePath = normalize(join(root, requested));
    if (!filePath.startsWith(rootPrefix) && filePath !== root) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(await readFile(filePath));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const artifacts = resolve('test-artifacts', out);
mkdirSync(artifacts, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  channel: channel || undefined,
  args: software
    ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const query = [
  'scenario=encounter',
  'lighting=full',
  motion === 'legacy' ? 'fishMotion=legacy' : '',
].filter((part) => part.length > 0).join('&');

await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (
  window as unknown as { __blueCurrent?: CaptureApi }
).__blueCurrent?.ready === true, undefined, { polling: 250 });

const gpuInfo = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')) as WebGLRenderingContext | null;
  if (!gl) return null;
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: String(extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    renderer: String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
  };
});

const environmentCss = `
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
`;
await page.addStyleTag({ content: environmentCss });
await page.waitForTimeout(600);

await page.evaluate(() => {
  const api = (window as unknown as { __blueCurrent: CaptureApi }).__blueCurrent;
  api.pause();
  api.setScenario('encounter');
  api.setViewMode('observation');
  api.setGridVisible(false);
});
await page.waitForTimeout(400);

// Freeze the animation loop; every frame below is an explicit debug render.
await page.evaluate(() => {
  (window as unknown as { requestAnimationFrame: (callback: FrameRequestCallback) => number })
    .requestAnimationFrame = () => 0;
});
await page.waitForTimeout(300);

const bufferToSave = (dataUrl: string): Buffer => {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Capture did not return PNG data.');
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
};

const startFrame = Math.round(startSeconds * 60);
const stateBefore = await page.evaluate((frame) => {
  const api = (window as unknown as { __blueCurrent: CaptureApi }).__blueCurrent;
  const current = Math.round(api.getDiagnostics().simulationTime * 60);
  if (current > frame) throw new Error(`Simulation already at ${current} frames, past ${frame}.`);
  if (frame > current) api.step(frame - current);
  api.setVisualTime(frame / 60);
  api.setCameraMode('school');
  api.settleCamera(2.4, 14);
  api.settleVisual(1.2, 12);
  api.step(0);
  return {
    diagnostics: api.getDiagnostics(),
    motion: api.getFishMotionDiagnostics(),
    snapshot: api.getSimulationSnapshot(),
  };
}, startFrame);

const basePosition = stateBefore.diagnostics.cameraPosition;
const baseTarget = stateBefore.diagnostics.cameraTarget;
const deltaX = basePosition[0] - baseTarget[0];
const deltaZ = basePosition[2] - baseTarget[2];
const baseDistance = Math.max(2, Math.hypot(deltaX, deltaZ));
const azimuth = Math.atan2(deltaX, deltaZ);
const quarterAzimuth = azimuth + Math.PI / 4;
// A true close-up: the school rig sits ~30 m out, so a fraction of its
// distance would still frame the whole school and hide body attitude.
const quarterDistance = Math.max(5, Math.min(9, baseDistance * 0.27));
const schoolPose = {
  position: [basePosition[0], basePosition[1], basePosition[2]] as [number, number, number],
  target: [baseTarget[0], baseTarget[1], baseTarget[2]] as [number, number, number],
};
const quarterPose = {
  position: [
    baseTarget[0] + Math.sin(quarterAzimuth) * quarterDistance,
    baseTarget[1] + (basePosition[1] - baseTarget[1]) * 0.2 + 0.6,
    baseTarget[2] + Math.cos(quarterAzimuth) * quarterDistance,
  ] as [number, number, number],
  target: [baseTarget[0], baseTarget[1] + 0.3, baseTarget[2]] as [number, number, number],
};

interface Entry {
  pose: string;
  requestedTime: number;
  simulationTime: number;
  frame: number;
  file: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  predatorState: string;
  drawCalls: number;
  renderTriangles: number;
  motion: { school: MotionDiagnostics; clownfish: MotionDiagnostics | null };
  snapshot: Snapshot;
}

const entries: Entry[] = [];
const motionSlug = motion;
let currentFrame = startFrame;

for (const requestedTime of times) {
  const targetFrame = Math.round(requestedTime * 60);
  const stepCount = targetFrame - currentFrame;
  if (stepCount < 0) throw new Error('--times must be increasing.');
  const advanced = await page.evaluate(({ frames }) => {
    const api = (window as unknown as { __blueCurrent: CaptureApi }).__blueCurrent;
    for (let index = 0; index < frames; index += 1) {
      api.step(1);
      api.advanceVisualTime(1 / 60);
    }
    return api.getDiagnostics().simulationTime;
  }, { frames: stepCount });
  currentFrame = targetFrame;

  // Close-up anchor: the fish whose velocity demands the steepest pitch. It is
  // velocity-derived, so both motion modes focus the same fish; the camera is
  // perpendicular to the shark-to-fish line to keep the predator out of the
  // subject frame. `step(0)` renders without advancing, so the fish stays put.
  const anchors = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: CaptureApi }).__blueCurrent;
    const diagnostics = api.getDiagnostics();
    const motion = api.getFishMotionDiagnostics().school;
    return {
      focus: motion.maxTargetPitchPosition,
      predator: diagnostics.predatorPosition,
    };
  });
  const posesForTime: Array<{
    name: string;
    pose: { position: [number, number, number]; target: [number, number, number] };
  }> = [
    { name: 'school', pose: schoolPose },
    { name: 'quarter', pose: quarterPose },
  ];
  if (anchors.focus) {
    const [fx, fy, fz] = anchors.focus;
    const [px, , pz] = anchors.predator;
    const awayX = fx - px;
    const awayZ = fz - pz;
    const awayLength = Math.hypot(awayX, awayZ);
    const sideAzimuth = (awayLength > 1e-4 ? Math.atan2(awayX, awayZ) : 0) + Math.PI / 2;
    posesForTime.push({
      name: 'focus',
      pose: {
        position: [
          fx + Math.sin(sideAzimuth) * 3.2,
          fy + 0.5,
          fz + Math.cos(sideAzimuth) * 3.2,
        ],
        target: [fx, fy + 0.1, fz],
      },
    });
  }

  for (const { name: poseName, pose } of posesForTime) {
    const result: CaptureResult = await page.evaluate(({ target, position }) => {
      const api = (window as unknown as { __blueCurrent: CaptureApi }).__blueCurrent;
      api.setCameraPose(position, target);
      api.settleVisual(0.6, 6);
      api.step(0);
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Missing WebGL canvas.');
      return {
        dataUrl: canvas.toDataURL('image/png'),
        diagnostics: api.getDiagnostics(),
        motion: api.getFishMotionDiagnostics(),
        snapshot: api.getSimulationSnapshot(),
      };
    }, { position: pose.position, target: pose.target });

    const actualTime = Math.round(advanced * 1000) / 1000;
    const file = `${motionSlug}-t${actualTime.toFixed(3)}-${poseName}.png`;
    writeFileSync(join(artifacts, file), bufferToSave(result.dataUrl));
    entries.push({
      pose: poseName,
      requestedTime,
      simulationTime: result.diagnostics.simulationTime,
      frame: Math.round(result.diagnostics.simulationTime * 60),
      file,
      cameraPosition: result.diagnostics.cameraPosition,
      cameraTarget: result.diagnostics.cameraTarget,
      predatorState: result.diagnostics.predatorState,
      drawCalls: result.diagnostics.drawCalls,
      renderTriangles: result.diagnostics.renderTriangles,
      motion: result.motion,
      snapshot: result.snapshot,
    });
    console.log(
      `[${motion}] t=${actualTime.toFixed(3)}s ${poseName} pitch(max)=${result.motion.school.maxAbsPitch.toFixed(3)} `
      + `turn(max)=${result.motion.school.maxAbsTurn.toFixed(3)} captures=${result.snapshot.captures}`,
    );
  }
}

const final = await page.evaluate(() => {
  const api = (window as unknown as { __blueCurrent: CaptureApi }).__blueCurrent;
  return {
    diagnostics: api.getDiagnostics(),
    motion: api.getFishMotionDiagnostics(),
    snapshot: api.getSimulationSnapshot(),
  };
});

writeFileSync(join(artifacts, `fish-motion-${motion}.json`), `${JSON.stringify({
  scenario: 'encounter',
  motion,
  query,
  captureTimes: times,
  actualTimes: entries.map((entry) => entry.simulationTime),
  stepping: 'one fixed 1/60 s simulation step plus one 1/60 s visual-time step per frame; render loop frozen; every capture is an explicit debug render read back from the canvas',
  viewport: { width, height },
  rendererNote: software
    ? 'SwiftShader software rendering; functional visual evidence only, never hardware performance data.'
    : `Hardware capture (${channel || 'bundled chromium'}); screenshots for visual review, not a benchmark.`,
  rendererInfo: gpuInfo,
  poses: { school: schoolPose, quarter: quarterPose },
  initial: stateBefore,
  entries,
  final,
  browserErrors: errors,
}, null, 2)}\n`);

console.log(`[${motion}] ${entries.length} captures, ${errors.length} browser errors`);

await browser.close();
await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
