import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Laboratory collision-debug captures for Experiment A.
 *
 * Usage:
 *   npx tsx scripts/reef-collision-capture.ts --serve-dist=dist-reef-collision
 *
 * Serves the production build statically (SwiftShader page loads are far
 * cheaper than the Vite dev graph) and captures the five proxy wireframes,
 * margin shells, D twin gap and Hero top. Software rendering only: these are
 * visual/contract checks, not GPU performance evidence.
 */

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(projectRoot, 'test-artifacts', 'reef-collision');
mkdirSync(artifacts, { recursive: true });

const argument = (name: string, fallback: string): string => {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const serveDist = argument('serve-dist', 'dist-reef-collision');
const port = Number(argument('port', '5199'));

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const root = normalize(join(projectRoot, serveDist));
const rootPrefix = `${root}/`;
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
      console.warn('[static 404]', request.url);
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(readFileSync(filePath));
  } catch (error) {
    console.error('[static 500]', request.url, error);
    response.writeHead(500);
    response.end(error instanceof Error ? error.message : String(error));
  }
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
console.log(`static server ready on ${port} (${root})`);

interface DebugApi {
  ready: boolean;
  getDiagnostics(): {
    ready: boolean;
    reefSet: boolean;
    reefProxyActive: boolean;
    obstacleShapeMode: string;
    fishCount: number;
    fps: number;
    drawCalls: number;
  };
  pause(): void;
  setViewMode(mode: 'observation' | 'laboratory'): void;
  setCollisionDebugLayers(enabled: boolean): void;
  setCollisionDebugLayer(layer: 'proxy' | 'margin' | 'sdf' | 'penetration', enabled: boolean): void;
  setObstacleShapeMode(mode: 'sphere' | 'reefProxy'): void;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  settleCamera(seconds?: number, frames?: number): unknown;
  settleVisual(seconds?: number, frames?: number): unknown;
  getObstacleDiagnostics(): unknown;
  getSimulationSnapshot(): { fish: { positions: number[]; alive: number[] } };
  setDebugSampleFish(index: number): void;
  getFishProxyInfo(index: number): {
    reefId: string | null;
    signedDistance: number;
    clearance: number;
  } | null;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
const captured: Array<{ name: string; pose: string }> = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
    console.error('[pageerror]', error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
      console.error('[console]', message.text());
    } else {
      console.log('[browser]', message.text());
    }
  });

  const query = [
    'reef=set',
    'obstacleShape=reefProxy',
    'collisiondebug=1',
    'obstacleMetrics=1',
    'fish=procedural',
    'predator=procedural',
    'coral=0',
    'seaweed=0',
    'kelp=0',
    'fishCount=300',
    'clownfish=0',
  ].join('&');
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: 'domcontentloaded' });
  console.log('page loaded, waiting for the scene');
  await page.waitForFunction(
    () => (window as unknown as { __blueCurrent?: DebugApi }).__blueCurrent?.ready === true,
    { timeout: 180000, polling: 500 },
  );
  console.log('scene ready, checking the reef proxy set');
  const initial = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  if (!initial.reefSet || !initial.reefProxyActive) {
    throw new Error(
      `Reef proxy not active after boot: reefSet=${initial.reefSet} proxy=${initial.reefProxyActive}`,
    );
  }
  console.log('reef proxies active');

  await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    api.pause();
    api.setViewMode('laboratory');
    api.setCollisionDebugLayers(true);
    api.setObstacleShapeMode('reefProxy');
  });
  await page.waitForTimeout(1200);

  const shoot = async (
    name: string,
    position: [number, number, number],
    target: [number, number, number],
  ): Promise<void> => {
    await page.evaluate(({ position, target }) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      api.setCameraPose(position, target);
      api.settleCamera(0.4, 8);
      api.settleVisual(0.5, 8);
    }, { position, target });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(artifacts, name), timeout: 90000 });
    captured.push({ name, pose: `${position.join(',')} -> ${target.join(',')}` });
    writeFileSync(
      join(artifacts, 'capture-progress.json'),
      `${JSON.stringify({ captured, browserErrors: errors }, null, 2)}\n`,
    );
    console.log('captured', name);
  };

  const selectFishNear = async (
    point: [number, number, number],
    reefId?: string,
  ): Promise<number> => (
    page.evaluate(({ target, reefId: wantedReef }) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      const snapshot = api.getSimulationSnapshot();
      const { positions, alive } = snapshot.fish;
      let best = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      let fallback = -1;
      let fallbackDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < alive.length; index += 1) {
        if (alive[index] === 0) continue;
        const offset = index * 3;
        const dx = positions[offset] - target[0];
        const dy = positions[offset + 1] - target[1];
        const dz = positions[offset + 2] - target[2];
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < fallbackDistance) {
          fallbackDistance = distance;
          fallback = index;
        }
        if (!wantedReef) continue;
        const info = api.getFishProxyInfo(index);
        if (!info || info.reefId !== wantedReef) continue;
        const score = distance + Math.max(0, info.signedDistance) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = index;
        }
      }
      const chosen = best >= 0 ? best : fallback;
      if (chosen >= 0) api.setDebugSampleFish(chosen);
      return chosen;
    }, { target: point, reefId: reefId })
  );

  const only = new Set(argument('only', '').split(',').filter(Boolean));
  const shots: Array<{
    name: string;
    position: [number, number, number];
    target: [number, number, number];
    sampleNear?: [number, number, number];
    reef?: string;
    margin?: boolean;
  }> = [
    {
      name: 'debug-overview.png',
      position: [26, 16, 24],
      target: [0, 4.5, 0],
      sampleNear: [5, 3.5, 4],
      reef: 'c',
      margin: true,
    },
    {
      name: 'debug-spire-b.png',
      position: [-13.5, 9.5, 6],
      target: [-7, 3.4, -3],
      sampleNear: [-7, 4, -3],
      reef: 'b',
    },
    {
      name: 'debug-platform-c.png',
      position: [12, 8.5, 13],
      target: [5, 2.5, 4],
      sampleNear: [5, 3.5, 4],
      reef: 'c',
    },
    {
      name: 'debug-hero.png',
      position: [10.5, 14, 1],
      target: [0, 5.2, -9],
      sampleNear: [0, 6, -9],
      reef: 'hero',
    },
    {
      name: 'debug-hero-margin.png',
      position: [11.5, 15, 2],
      target: [0, 5.2, -9],
      sampleNear: [-1.2, 8.2, -8.8],
      reef: 'hero',
      margin: true,
    },
    {
      name: 'debug-hero-top.png',
      position: [4.5, 14.5, -2.5],
      target: [-0.8, 8.4, -8.8],
      sampleNear: [-1.2, 8.2, -8.8],
      reef: 'hero',
    },
    {
      name: 'debug-twin-d.png',
      position: [16.5, 7.5, -1.0],
      target: [11, 3.2, -7],
      sampleNear: [11, 4.5, -7],
      reef: 'd',
    },
    {
      name: 'debug-twin-gap.png',
      position: [13.8, 4.8, -2.0],
      target: [11, 3.4, -7],
      sampleNear: [11, 4, -6.5],
      reef: 'd',
    },
    {
      name: 'debug-terraces-e.png',
      position: [-4.5, 8, 17],
      target: [-12, 2.6, 9],
      sampleNear: [-12, 3.5, 9],
      reef: 'e',
    },
  ];
  for (const shot of shots) {
    if (only.size > 0 && !only.has(shot.name)) continue;
    await page.evaluate((margin) => {
      const api = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      api.setCollisionDebugLayer('margin', margin);
    }, shot.margin === true);
    if (shot.sampleNear) await selectFishNear(shot.sampleNear, shot.reef);
    await shoot(shot.name, shot.position, shot.target);
  }

  const diagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getDiagnostics(),
  );
  const obstacleDiagnostics = await page.evaluate(
    () => (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent.getObstacleDiagnostics(),
  );
  writeFileSync(
    join(artifacts, 'capture-results.json'),
    `${JSON.stringify({ passed: errors.length === 0, diagnostics, obstacleDiagnostics, captured, browserErrors: errors }, null, 2)}\n`,
  );
  if (errors.length > 0) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ passed: true, diagnostics, screenshots: captured.length }, null, 2));
} finally {
  if (process.env.BLUE_CURRENT_CAPTURE_FORCE_EXIT === '1') {
    process.exit(errors.length === 0 ? 0 : 1);
  }
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
