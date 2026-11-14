import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

/**
 * Phase E1 supplementary clip: a deterministic frame-stepped walk of the
 * shipping presentation around t=16.5 s of the encounter. The render loop is
 * frozen, every frame is an explicit debug render read back from the canvas,
 * and the frames are assembled into a WebM by tools/make-video.py. The clip is
 * slow motion (one 1/60 s simulation step per 1/fps video frame) and is
 * functional visual evidence only, never a real-time performance capture.
 */

interface Api {
  ready: boolean;
  pause(): void;
  setScenario(id: string): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setCameraMode(mode: 'overview' | 'free' | 'orbit' | 'school' | 'predator'): void;
  settleCamera(seconds?: number, frames?: number): void;
  settleVisual(seconds?: number, frames?: number): void;
  step(count?: number): { simulationTime: number };
  advanceVisualTime(seconds: number): { simulationTime: number };
  setVisualTime(seconds: number): void;
  getSimulationSnapshot(): { checksum: string; captures: number };
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const out = argument('out', 'fish-motion-video');
const width = Math.max(320, Number.parseInt(argument('width', '800'), 10));
const height = Math.max(180, Number.parseInt(argument('height', '500'), 10));
const port = Number.parseInt(argument('port', '5217'), 10);
const seconds = Math.max(2, Number.parseFloat(argument('seconds', '10')));
const fps = Math.max(5, Number.parseInt(argument('fps', '25'), 10));
const startSeconds = Number.parseFloat(argument('start', '16.5'));
const frames = Math.max(2, Math.round(seconds * fps));

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

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  await page.goto(`http://127.0.0.1:${port}/?scenario=encounter&lighting=full`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: Api }
  ).__blueCurrent?.ready === true, undefined, { polling: 250 });

  const start = await page.evaluate((begin) => {
    const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
    api.pause();
    api.setScenario('encounter');
    api.setViewMode('observation');
    const frame = Math.round(begin * 60);
    const current = Math.round(api.step(0).simulationTime * 60);
    if (frame > current) api.step(frame - current);
    api.setVisualTime(frame / 60);
    api.setCameraMode('school');
    api.settleCamera(2.4, 14);
    api.settleVisual(1.2, 12);
    api.step(0);
    return {
      simulationTime: api.step(0).simulationTime,
      snapshot: api.getSimulationSnapshot(),
    };
  }, startSeconds);

  const manifest: Array<{ frame: number; simulationTime: number; checksum?: string }> = [];
  for (let index = 0; index < frames; index += 1) {
    const shot = await page.evaluate(() => {
      const api = (window as unknown as { __blueCurrent: Api }).__blueCurrent;
      api.step(1);
      api.advanceVisualTime(1 / 60);
      const canvas = document.querySelector('canvas');
      return {
        dataUrl: canvas?.toDataURL('image/png') ?? '',
        simulationTime: api.step(0).simulationTime,
        checksum: api.getSimulationSnapshot().checksum,
      };
    });
    if (!shot.dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error(`Frame ${index} produced no canvas image.`);
    }
    writeFileSync(
      `${artifacts}/frame-${String(index).padStart(4, '0')}.png`,
      Buffer.from(shot.dataUrl.slice('data:image/png;base64,'.length), 'base64'),
    );
    manifest.push({
      frame: index,
      simulationTime: shot.simulationTime,
      ...(index % 25 === 0 || index === frames - 1 ? { checksum: shot.checksum } : {}),
    });
    if (index > 0 && index % 50 === 0) console.log(`captured ${index}/${frames} frames`);
  }
  const end = manifest[manifest.length - 1];
  writeFileSync(
    `${artifacts}/video-frames.json`,
    JSON.stringify({
      renderer: 'SwiftShader software renderer',
      mode: 'frame-stepped canvas readback; one fixed simulation step per video frame',
      viewport: { width, height },
      fps,
      frames,
      videoSeconds: frames / fps,
      simulationSeconds: (end.simulationTime - start.simulationTime),
      start,
      end,
      manifest,
    }, null, 2),
  );
  console.log(`frames saved: ${frames} -> ${artifacts}`);
} finally {
  await browser.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
