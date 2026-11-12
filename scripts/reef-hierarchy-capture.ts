import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Deterministic Experiment B hierarchy capture.
 *
 * Usage:
 *   npx tsx scripts/reef-hierarchy-capture.ts --tag=baseline --port=5211
 *   npx tsx scripts/reef-hierarchy-capture.ts --tag=b1 --port=5212
 *
 * All shots use the production Overview camera pose and the same fixed
 * simulation state (encounter, t=17 s, paused). Full-UI 1920x1080 keeps the
 * Console open; scene-only and close-ups hide every HUD layer via CSS.
 */

interface DebugApi {
  ready: boolean;
  pause(): void;
  step(count?: number): unknown;
  setScenario(id: string): void;
  setViewMode(mode: string): void;
  setGridVisible(visible: boolean): void;
  setVisualTime(seconds: number): unknown;
  settleCamera(seconds?: number, frames?: number): unknown;
  setCameraPose(position: [number, number, number], target: [number, number, number]): void;
  getDiagnostics(): {
    canvasWidth: number;
    canvasHeight: number;
    cameraPosition: [number, number, number];
    cameraTarget: [number, number, number];
    simulationTime: number;
    reefSetStats: unknown;
  };
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const tag = argument('tag', 'baseline');
const only = argument('only', 'all');
const port = Number.parseInt(argument('port', '5211'), 10);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/reef-hierarchy/${tag}`;
mkdirSync(artifacts, { recursive: true });

const HIDDEN_UI_CSS = `
  .masthead, .control-panel, .panel-scrim, .viewport-topbar, .depth-rail,
  .predator-watch, .scene-caption, .telemetry-strip, .scene-search-state,
  .viewport-vignette, .capture-toast { display: none !important; }
  .workspace { display: block !important; padding: 0 !important; }
  .viewport-shell { position: fixed !important; inset: 0 !important; border-radius: 0 !important; }
`;

const server = await createServer({
  root: projectRoot,
  cacheDir: join(projectRoot, 'node_modules', `.vite-reef-hierarchy-${port}`),
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    hmr: false,
    watch: null,
  },
});
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
const entries: Record<string, unknown>[] = [];

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`http://127.0.0.1:${port}/?scenario=encounter&lighting=full&reef=set`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DebugApi }
  ).__blueCurrent?.ready === true);

  await page.evaluate(() => {
    const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
    debug.pause();
    debug.setScenario('encounter');
    debug.setViewMode('observation');
    debug.setGridVisible(false);
    debug.step(17 * 60);
    debug.setVisualTime(17);
    debug.settleCamera(0.9, 120);
  });
  await page.waitForTimeout(1200);

  const overviewPose: [[number, number, number], [number, number, number]] = [
    [30, 18, 29],
    [0, 6.5, -2],
  ];

  const draw = async () => {
    await page.evaluate((pose) => {
      const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      debug.setCameraPose(pose[0], pose[1]);
      debug.step(0);
    }, overviewPose);
    await page.waitForTimeout(350);
  };

  const diagnostics = () => page.evaluate(() => (
    window as unknown as { __blueCurrent: DebugApi }
  ).__blueCurrent.getDiagnostics());

  const push = (file: string, extra: Record<string, unknown> = {}) => {
    entries.push({ file, ...extra });
  };

  const shotCanvas = async (name: string) => {
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    await page.screenshot({
      path: `${artifacts}/${name}`,
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      timeout: 180000,
    });
  };

  const captureOverview = only === 'all' || only === 'overview';
  const captureSmall = only === 'all' || only === 'small';
  const captureCloseups = only === 'all' || only === 'hero-closeup' || only === 'd-closeup';

  // 1. Full UI, Console open, 1920x1080.
  if (captureOverview) {
    await page.evaluate((pose) => {
      const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
      debug.setCameraPose(pose[0], pose[1]);
      debug.step(0);
    }, overviewPose);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${artifacts}/overview-full-ui-1920x1080.png`,
      fullPage: false,
      timeout: 120000,
    });
    push('overview-full-ui-1920x1080.png', { ui: 'full', console: 'open', ...(await diagnostics()) });
  }

  // 2. 800x560 scene-only (canvas capture, no HUD).
  if (captureSmall) {
    await page.setViewportSize({ width: 800, height: 560 });
    await page.waitForTimeout(500);
    await page.addStyleTag({ content: HIDDEN_UI_CSS }).catch(() => undefined);
    await draw();
    await page.screenshot({ path: `${artifacts}/overview-scene-800x560.png`, timeout: 180000 });
    push('overview-scene-800x560.png', { ui: 'scene', ...(await diagnostics()) });
  }

  // 3. Close-ups, 1280x800 scene-only.
  if (captureCloseups) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    await page.addStyleTag({ content: HIDDEN_UI_CSS }).catch(() => undefined);
    const closeups: Array<[string, [number, number, number], [number, number, number]]> = [
      ['hero-closeup', [10, 8, 3], [0, 4.6, -9]],
      ['d-closeup', [19.5, 6.2, 1.5], [11, 3.4, -7]],
    ];
    for (const [name, position, target] of closeups) {
      if (only !== 'all' && only !== name) continue;
      await page.evaluate((pose) => {
        const debug = (window as unknown as { __blueCurrent: DebugApi }).__blueCurrent;
        debug.setCameraPose(pose[0], pose[1]);
        debug.step(0);
      }, [position, target] as const);
      await page.waitForTimeout(500);
      await shotCanvas(`${name}.png`);
      push(`${name}.png`, { ui: 'scene', cameraPosition: position, cameraTarget: target });
    }
  }

  writeFileSync(
    `${artifacts}/capture.json`,
    JSON.stringify({ tag, errors, entries, createdAt: new Date().toISOString() }, null, 2),
  );
  if (errors.length > 0) {
    throw new Error(`capture reported ${errors.length} page errors: ${errors[0]}`);
  }
  console.log(`captured ${entries.length} shots into ${artifacts}`);
} finally {
  await browser.close();
  await server.close();
}
