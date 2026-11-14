import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

/**
 * Phase E3 evidence capture: step the encounter scenario in fixed increments,
 * read the real predation event stream, and capture the moment each event
 * appears. No target, capture or FSM state is forced.
 *
 * Frames are read from the page canvas (`step(1)` + `toDataURL`) instead of
 * `page.screenshot`: under SwiftShader the compositor screenshot path stalls
 * for minutes while the rAF loop renders continuously. The canvas readback
 * grabs the frame the simulation just rendered, in the same task.
 */

/**
 * Phase E3 evidence capture: step the encounter scenario in fixed increments,
 * read the real predation event stream, and screenshot the moment each event
 * appears. No target, capture or FSM state is forced.
 */

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}

const out = argument('out', 'predation-event');
const seconds = Number(argument('seconds', '70'));
const width = Number(argument('width', '960'));
const height = Number(argument('height', '540'));
const port = Number(argument('port', '5219'));
const channel = argument('channel', '');
const headed = argument('headed', '0') === '1';
const software = argument('software', channel ? '0' : '1') === '1';
const stepsPerPoll = Math.max(1, Math.floor(Number(argument('step', '6'))));
const captureEnabled = argument('capture', '1') === '1';
const startSeconds = Math.max(0, Number(argument('start', '0')));
const uiShot = argument('ui-shot', '0') === '1';

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
  '.hdr': 'application/octet-stream',
  '.woff2': 'font/woff2',
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
    response.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    response.end(await readFile(filePath));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const artifacts = resolve('test-artifacts', out);
mkdirSync(artifacts, { recursive: true });
const rendererNote = software
  ? 'SwiftShader software rendering; functional UI evidence only, never hardware performance data.'
  : `Hardware capture (${channel || 'bundled chromium'}); screenshots for visual review, not a benchmark.`;

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

await page.goto(`http://127.0.0.1:${port}/?scenario=encounter&lighting=full`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForFunction(() => (
  window as unknown as { __blueCurrent?: { ready?: boolean } }
).__blueCurrent?.ready === true, undefined, { polling: 250 });
await page.evaluate(() => {
  const api = (window as unknown as { __blueCurrent: Record<string, (...args: never[]) => unknown> }).__blueCurrent;
  (api.pause as () => void)();
  (api.setViewMode as (mode: string) => void)('observation');
  (api.setCameraMode as (mode: string) => void)('predator');
});

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

interface CapturedEvent {
  sequence: number;
  kind: string;
  simulationTime: number;
  state: string;
  targetIndex: number;
  message: string;
}

const allEvents: CapturedEvent[] = [];
const screenshots: Array<{ sequence: number; kind: string; file: string }> = [];
const captureErrors: Array<{ sequence: number; kind: string; error: string }> = [];
const uiScreenshots: Array<{ sequence: number; kind: string; file: string }> = [];
let uiProbe: unknown = null;
let lastSequence = 0;
const totalSteps = Math.max(1, Math.round(seconds * 60));

const initial = await page.evaluate(() => {
  const api = (window as unknown as { __blueCurrent: {
    getSimulationSnapshot: () => { checksum: string; captures: number; predatorState: string };
    getDiagnostics: () => { simulationTime: number };
  } }).__blueCurrent;
  return { snapshot: api.getSimulationSnapshot(), diagnostics: api.getDiagnostics() };
});

if (startSeconds > 0) {
  await page.evaluate((frame) => {
    const api = (window as unknown as { __blueCurrent: {
      step: (value: number) => unknown;
      getDiagnostics: () => { simulationTime: number };
    } }).__blueCurrent;
    const current = Math.round(api.getDiagnostics().simulationTime * 60);
    if (frame > current) api.step(frame - current);
  }, Math.round(startSeconds * 60));
}

function writeResults(final: unknown): void {
  writeFileSync(join(artifacts, 'predation-events.json'), `${JSON.stringify({
    scenario: 'encounter',
    seconds,
    startSeconds,
    stepsPerPoll,
    viewport: { width, height },
    renderer: gpuInfo,
    rendererNote,
    initial,
    events: allEvents,
    screenshots,
    uiScreenshots,
    captureErrors,
    ui: uiProbe,
    final,
    browserErrors: errors,
  }, null, 2)}\n`);
}

try {
  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += stepsPerPoll) {
    const newEvents = await page.evaluate((count) => {
      const api = (window as unknown as { __blueCurrent: {
        step: (value: number) => unknown;
        getPredationEvents: (limit: number) => Array<{
          sequence: number;
          kind: string;
          simulationTime: number;
          state: string;
          targetIndex: number;
          message: string;
        }>;
      } }).__blueCurrent;
      api.step(count);
      return api.getPredationEvents(24);
    }, stepsPerPoll);
    const fresh = newEvents.filter((event) => event.sequence > lastSequence);
    if (fresh.length === 0) continue;
    lastSequence = Math.max(lastSequence, ...fresh.map((event) => event.sequence));
    for (const event of fresh) allEvents.push(event);
    writeResults({ pending: true, simulationTime: fresh[fresh.length - 1].simulationTime });
    if (!captureEnabled) continue;
    const kind = fresh[0].kind;
    const camera = kind.startsWith('group') ? 'school' : 'predator';
    try {
      await page.evaluate((mode) => {
        const api = (window as unknown as { __blueCurrent: { setCameraMode: (value: string) => void } }).__blueCurrent;
        api.setCameraMode(mode);
      }, camera);
      await page.waitForTimeout(650);
      const dataUrl = await page.evaluate(() => {
        const api = (window as unknown as { __blueCurrent: { step: (value: number) => unknown } }).__blueCurrent;
        api.step(1);
        return document.querySelector('canvas')?.toDataURL('image/png') ?? '';
      });
      const base64 = dataUrl.split(',')[1] ?? '';
      if (!base64) throw new Error('empty canvas readback');
      const file = `event-${String(fresh[0].sequence).padStart(3, '0')}-${kind}.png`;
      writeFileSync(join(artifacts, file), Buffer.from(base64, 'base64'));
      screenshots.push({ sequence: fresh[0].sequence, kind, file });
      if (uiShot && (kind === 'capture' || kind === 'recovery' || kind === 'target-switch')) {
        await page.waitForTimeout(1200);
        const uiFile = `ui-${String(fresh[0].sequence).padStart(3, '0')}-${kind}.png`;
        await page.screenshot({ path: join(artifacts, uiFile), timeout: 150000 });
        uiScreenshots.push({ sequence: fresh[0].sequence, kind, file: uiFile });
      }
    } catch (error) {
      captureErrors.push({ sequence: fresh[0].sequence, kind, error: String(error) });
    }
    console.log(`event ${fresh[0].sequence} ${kind} @ ${fresh[fresh.length - 1].simulationTime.toFixed(2)}s`);
  }
} catch (error) {
  errors.push(`loop: ${String(error)}`);
}

let final: unknown = null;
try {
  final = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: {
      getDiagnostics: () => { captures: number; predatorState: string; simulationTime: number };
      getSimulationSnapshot: () => { checksum: string; captures: number; predatorState: string };
      getPredationEvents: (limit: number) => unknown[];
    } }).__blueCurrent;
    const snapshot = api.getSimulationSnapshot();
    return {
      diagnostics: api.getDiagnostics(),
      snapshot,
      events: api.getPredationEvents(24),
    };
  });
} catch (error) {
  errors.push(`final: ${String(error)}`);
}

// UI evidence: the event line renders real tracker state on desktop and stays
// hidden with the rest of predator-watch on a narrow screen.
try {
  await page.waitForTimeout(800);
  const desktop = await page.evaluate(() => {
    const watch = document.getElementById('predator-watch');
    const event = document.getElementById('predator-watch-event');
    return {
      watchDisplay: watch ? getComputedStyle(watch).display : null,
      watchVisibility: watch ? getComputedStyle(watch).visibility : null,
      watchText: watch?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      eventText: event?.textContent ?? null,
      eventDisplay: event ? getComputedStyle(event).display : null,
      captionTitle: document.getElementById('scene-caption-title')?.textContent ?? null,
      captionCopy: document.getElementById('scene-caption-copy')?.textContent ?? null,
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const narrow = await page.evaluate(() => {
    const watch = document.getElementById('predator-watch');
    const event = document.getElementById('predator-watch-event');
    return {
      watchDisplay: watch ? getComputedStyle(watch).display : null,
      watchVisibility: watch ? getComputedStyle(watch).visibility : null,
      eventDisplay: event ? getComputedStyle(event).display : null,
      eventText: event?.textContent ?? null,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  uiProbe = { desktop, narrow };
} catch (error) {
  errors.push(`ui: ${String(error)}`);
}

writeResults(final);
const finalCaptures = (final as { snapshot?: { captures?: number } } | null)?.snapshot?.captures;
console.log(`events ${allEvents.length}, screenshots ${screenshots.length}, captures ${finalCaptures ?? 'N/A'}, errors ${errors.length}`);

await browser.close();
await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
