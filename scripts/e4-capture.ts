import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { anemoneAnchorForReef } from '../src/environment/AnemoneHabitat';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';

/**
 * Phase E4 capture.
 *
 * `--kind=habitat` compares `?habitat=anemone|legacy` in the calm scenario from
 * one fixed camera above the reef-0 anemone. `--kind=sediment` compares
 * `?sediment=1|0` in the encounter from a low camera under the school, driving
 * the presentation-only sediment field through explicit visual ticks.
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
  getSimulationSnapshot(): { checksum: string };
  getClownfishHabitatDiagnostics(): HabitatDiagnostics;
  getSedimentDiagnostics(): { enabled: boolean; activeParticles: number; capacity: number };
  advanceSediment(seconds: number): { enabled: boolean; activeParticles: number; capacity: number };
}

interface Diagnostics {
  simulationTime: number;
  schoolCenter: [number, number, number];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  drawCalls: number;
  renderTriangles: number;
}

interface HabitatDiagnostics {
  mode: 'anemone' | 'legacy';
  anchorId: string | null;
  center: [number, number, number] | null;
  centroid: [number, number, number];
  distance: number | null;
  withinAttractRadius: number;
  withinCoreRadius: number;
  spread: number;
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const kind = argument('kind', 'habitat') === 'sediment' ? 'sediment' : 'habitat';
const mode = kind === 'habitat'
  ? (argument('mode', 'anemone') === 'legacy' ? 'legacy' : 'anemone')
  : (argument('mode', 'on') === 'off' ? 'off' : 'on');
const out = argument('out', 'e4-capture');
const width = Number(argument('width', '960'));
const height = Number(argument('height', '540'));
const port = Number(argument('port', '5222'));
const software = argument('software', '1') === '1';
const headed = argument('headed', '0') === '1';
const channel = argument('channel', '');
const times = argument('times', kind === 'habitat' ? '17,43,52' : '63,66')
  .split(',')
  .map((value) => Number.parseFloat(value))
  .filter((value) => Number.isFinite(value) && value > 0);

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

const anchor = anemoneAnchorForReef(REEF_OBSTACLES[0], 0);
const habitatPose = {
  position: [anchor.x + 6.2, anchor.hover[1] + 1.4, anchor.z + 6.2] as [number, number, number],
  target: [anchor.x, anchor.hover[1] - 2.0, anchor.z] as [number, number, number],
};
const errors: string[] = [];
const frames: Array<{
  requestedTime: number;
  simulationTime: number;
  checksum: string;
  file: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  habitat?: HabitatDiagnostics;
  sediment?: { enabled: boolean; activeParticles: number; capacity: number };
}> = [];

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  const query = kind === 'habitat'
    ? `scenario=calm&lighting=full&habitat=${mode}`
    : `scenario=encounter&lighting=full&sediment=${mode === 'on' ? '1' : '0'}`;
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: Api }
  ).__blueCurrent?.ready === true, undefined, { polling: 250 });
  const rendererInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = (canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      renderer: String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    };
  });
  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    api.pause();
    api.setViewMode('observation');
    (window as unknown as { requestAnimationFrame: (callback: FrameRequestCallback) => number })
      .requestAnimationFrame = () => 0;
  });

  let currentTime = 0;
  for (const requestedTime of times) {
    const targetFrame = Math.round(requestedTime * 60);
    const state = await page.evaluate(({ frame, kind: captureKind, pose }) => {
      const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
      const current = Math.round(api.getDiagnostics().simulationTime * 60);
      if (frame > current) api.step(frame - current);
      if (captureKind === 'habitat') {
        api.setCameraPose(pose.position, pose.target);
        api.settleVisual(0.6, 6);
        api.step(0);
      } else {
        const diagnostics = api.getDiagnostics();
        const [cx, , cz] = diagnostics.schoolCenter;
        api.setCameraPose([cx + 7, 2.4, cz + 7], [cx, 1.2, cz]);
        api.settleVisual(0.6, 6);
        for (let index = 0; index < 90; index += 1) {
          api.advanceVisualTime(1 / 30);
          api.advanceSediment(1 / 30);
        }
        api.step(0);
      }
      return {
        time: api.getDiagnostics().simulationTime,
        checksum: api.getSimulationSnapshot().checksum,
        cameraPosition: api.getDiagnostics().cameraPosition,
        cameraTarget: api.getDiagnostics().cameraTarget,
        habitat: captureKind === 'habitat' ? api.getClownfishHabitatDiagnostics() : undefined,
        sediment: captureKind === 'sediment' ? api.getSedimentDiagnostics() : undefined,
        dataUrl: document.querySelector('canvas')?.toDataURL('image/png') ?? '',
      };
    }, { frame: targetFrame, kind, pose: habitatPose });
    if (!state.dataUrl.startsWith('data:image/png;base64,')) throw new Error('No PNG frame.');
    const file = `e4-${kind}-${mode}-t${state.time.toFixed(3)}.png`;
    writeFileSync(join(artifacts, file), Buffer.from(state.dataUrl.split(',')[1], 'base64'));
    frames.push({
      requestedTime,
      simulationTime: state.time,
      checksum: state.checksum,
      file,
      cameraPosition: state.cameraPosition,
      cameraTarget: state.cameraTarget,
      habitat: state.habitat,
      sediment: state.sediment,
    });
    currentTime = state.time;
  }
  writeFileSync(join(artifacts, `e4-${kind}-${mode}.json`), `${JSON.stringify({
    kind,
    mode,
    query,
    times,
    viewport: { width, height },
    renderer: rendererInfo,
    rendererNote: software
      ? 'SwiftShader software rendering; functional visual evidence only, never hardware performance.'
      : `Hardware capture (${channel || 'bundled chromium'}); visual review only.`,
    habitatAnchor: anchor,
    habitatPose: kind === 'habitat' ? habitatPose : null,
    frames,
    finalTime: currentTime,
    browserErrors: errors,
  }, null, 2)}\n`);
  console.log(`kind=${kind} mode=${mode} frames=${frames.length} errors=${errors.length}`);
  for (const frame of frames) {
    console.log(
      frame.requestedTime.toFixed(1),
      frame.file,
      frame.habitat ? `distance=${frame.habitat.distance?.toFixed(2)} spread=${frame.habitat.spread.toFixed(2)}` : '',
      frame.sediment ? `particles=${frame.sediment.activeParticles}` : '',
    );
  }
} finally {
  await browser.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
