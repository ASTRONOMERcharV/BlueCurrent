import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

/**
 * Phase E2 school-structure capture.
 *
 * Runs the encounter with `?schoolDynamics=dynamic|legacy`, polls the read-only
 * structure telemetry every fixed number of steps, records split/merge/startle
 * history, and reads back canvas frames at structure events and fixed times.
 * Software rendering is functional evidence only; the same script accepts
 * `--channel=chrome --headed=1 --software=0` for hardware review.
 */

interface Api {
  ready: boolean;
  pause(): void;
  setScenario(id: string): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setCameraMode(mode: 'school' | 'overview' | 'predator' | 'free'): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): unknown;
  settleCamera(seconds?: number, frames?: number): unknown;
  settleVisual(seconds?: number, frames?: number): unknown;
  step(count?: number): Diagnostics;
  advanceVisualTime(seconds: number): Diagnostics;
  setVisualTime(seconds: number): void;
  getDiagnostics(): Diagnostics;
  getSimulationSnapshot(): { checksum: string; captures: number };
  getSchoolStructure(limit?: number): StructureState;
}

interface Diagnostics {
  simulationTime: number;
  schoolCenter: [number, number, number];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  schoolCount: number;
  drawCalls: number;
  renderTriangles: number;
  predatorState: string;
}

interface StructureEvent {
  sequence: number;
  simulationTime: number;
  kind: string;
  message: string;
  values?: Record<string, number>;
}

interface StructureState {
  events: StructureEvent[];
  schools: number;
  medianSchoolSize: number;
  largestSchool: number;
  largestPolarization: number;
  startleCount: number;
  startleCentroid: [number, number, number] | null;
  startleRadius: number;
  edgePressureCount: number;
  histogram: number[];
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const out = argument('out', 'school-structure');
const mode = argument('mode', 'dynamic') === 'legacy' ? 'legacy' : 'dynamic';
const seconds = Math.max(5, Number(argument('seconds', '70')));
const stepsPerPoll = Math.max(1, Math.floor(Number(argument('step', '30'))));
const startSeconds = Math.max(0, Number(argument('start', '0')));
const width = Number(argument('width', '960'));
const height = Number(argument('height', '540'));
const port = Number(argument('port', '5221'));
const software = argument('software', '1') === '1';
const headed = argument('headed', '0') === '1';
const channel = argument('channel', '');
const captureEnabled = argument('capture', '1') === '1';
const times = argument('times', '17,43,52,60,63')
  .split(',')
  .map((value) => Number.parseFloat(value))
  .filter((value) => Number.isFinite(value) && value > 0);
/** World-fixed three-quarter pose so both behaviour modes share a camera. */
const FIXED_POSE = {
  position: [16, 14, 16] as [number, number, number],
  target: [0, 8, 0] as [number, number, number],
};

const root = normalize(resolve('dist'));
const rootPrefix = `${root}${sep}`;
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.hdr': 'application/octet-stream',
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

const artifacts = out.replace(/\\/g, '/').startsWith('test-artifacts/')
  ? resolve(out)
  : resolve('test-artifacts', out);
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: !headed,
  channel: channel || undefined,
  args: software
    ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--no-sandbox'],
});
const errors: string[] = [];
const screenshots: Array<{ sequence: number; kind: string; simulationTime: number; file: string }> = [];
const samples: Array<{
  simulationTime: number;
  checksum: string;
  structure: StructureState;
}> = [];
const fixedFrames: Array<{
  requestedTime: number;
  simulationTime: number;
  checksum: string;
  file: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}> = [];
let rendererInfo: { vendor: string; renderer: string } | null = null;

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?scenario=encounter&lighting=full&schoolDynamics=${mode}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: Api }
  ).__blueCurrent?.ready === true, undefined, { polling: 250 });
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    api.pause();
    api.setScenario('encounter');
    api.setViewMode('observation');
    api.setCameraPose([16, 14, 16], [0, 8, 0]);
    api.settleVisual(1.2, 12);
    (window as unknown as { requestAnimationFrame: (callback: FrameRequestCallback) => number })
      .requestAnimationFrame = () => 0;
  });
  rendererInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      renderer: String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    };
  });
  const startFrame = Math.round(startSeconds * 60);
  await page.evaluate((frame) => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    const current = Math.round(api.getDiagnostics().simulationTime * 60);
    if (frame > current) api.step(frame - current);
    api.setVisualTime(frame / 60);
    api.step(0);
  }, startFrame);

  const captureFrame = async (file: string) => {
    const dataUrl = await page.evaluate(() => {
      const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
      api.step(0);
      return document.querySelector('canvas')?.toDataURL('image/png') ?? '';
    });
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error(`No PNG for ${file}`);
    writeFileSync(join(artifacts, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  };

  let lastSequence = 0;
  let capturedEvents = 0;
  let nextTimeIndex = 0;
  const targetFrame = startFrame + Math.round(seconds * 60);
  while (true) {
    const poll = await page.evaluate((count) => {
      const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
      api.step(count);
      return {
        time: api.getDiagnostics().simulationTime,
        checksum: api.getSimulationSnapshot().checksum,
        structure: api.getSchoolStructure(24),
      };
    }, stepsPerPoll);
    const fresh = poll.structure.events.filter((event) => event.sequence > lastSequence);
    for (const event of fresh) {
      lastSequence = Math.max(lastSequence, event.sequence);
      if (
        captureEnabled
        && capturedEvents < 16
        && ['split', 'merge', 'subgroup-emerged', 'subgroup-dissolved'].includes(event.kind)
      ) {
        const file = `e2-${mode}-event-${String(event.sequence).padStart(3, '0')}-${event.kind}.png`;
        await captureFrame(file);
        screenshots.push({
          sequence: event.sequence,
          kind: event.kind,
          simulationTime: event.simulationTime,
          file,
        });
        capturedEvents += 1;
      }
    }
    samples.push({
      simulationTime: poll.time,
      checksum: poll.checksum,
      structure: poll.structure,
    });
    while (nextTimeIndex < times.length && poll.time + 1e-6 >= times[nextTimeIndex]) {
      const requestedTime = times[nextTimeIndex];
      const frame = await page.evaluate((pose) => {
        const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
        api.setCameraPose(pose.position, pose.target);
        api.settleVisual(0.6, 6);
        api.step(0);
        return {
          time: api.getDiagnostics().simulationTime,
          checksum: api.getSimulationSnapshot().checksum,
          cameraPosition: api.getDiagnostics().cameraPosition,
          cameraTarget: api.getDiagnostics().cameraTarget,
        };
      }, FIXED_POSE);
      const file = `e2-${mode}-t${frame.time.toFixed(3)}-school.png`;
      await captureFrame(file);
      fixedFrames.push({
        requestedTime,
        simulationTime: frame.time,
        checksum: frame.checksum,
        cameraPosition: frame.cameraPosition,
        cameraTarget: frame.cameraTarget,
        file,
      });
      nextTimeIndex += 1;
    }
    if (poll.time >= targetFrame / 60 - 1e-6) break;
    if (samples.length > 2000) throw new Error('poll loop exceeded safety limit');
  }

  const final = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    return {
      diagnostics: api.getDiagnostics(),
      structure: api.getSchoolStructure(24),
      snapshot: api.getSimulationSnapshot(),
    };
  });
  writeFileSync(join(artifacts, `school-structure-${mode}.json`), `${JSON.stringify({
    scenario: 'encounter',
    mode,
    query: `?scenario=encounter&lighting=full&schoolDynamics=${mode}`,
    seconds,
    stepsPerPoll,
    viewport: { width, height },
    renderer: rendererInfo,
    rendererNote: software
      ? 'SwiftShader software rendering; functional visual evidence only, never hardware performance.'
      : `Hardware capture (${channel || 'bundled chromium'}); visual review only.`,
    samples,
    screenshots,
    fixedFrames,
    final,
    browserErrors: errors,
  }, null, 2)}\n`);
  console.log(`samples=${samples.length} screenshots=${screenshots.length} fixed=${fixedFrames.length} errors=${errors.length}`);
  console.log(`final schools=${final.structure.schools} median=${final.structure.medianSchoolSize} checksum=${final.snapshot.checksum}`);
} finally {
  await browser.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
