import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface DemoState {
  active: boolean;
  complete: boolean;
  elapsedSeconds: number;
  durationSeconds: number;
  shotIndex: number;
  shot: {
    id: string;
    title: string;
    presentation: 'cinematic' | 'technical';
    viewMode: 'observation' | 'laboratory';
    searchMode: 'grid' | 'brute-force';
    gridVisible: boolean;
  };
}

interface DemoApi {
  ready: boolean;
  pause(): void;
  seekDemo(seconds: number): DemoState;
  getDemoState(): DemoState;
  getDiagnostics(): {
    canvasWidth: number;
    canvasHeight: number;
    searchMode: string;
    demo: DemoState | null;
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${projectRoot}test-artifacts/demo-mode`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({
  root: projectRoot,
  cacheDir: `${projectRoot}.vite/demo-smoke`,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const browserErrors: string[] = [];
const checks: Array<{ name: string; passed: boolean; value: unknown }> = [];

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  await page.goto(`${baseUrl}?demo=cinematic`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window as unknown as { __blueCurrent?: DemoApi }
  ).__blueCurrent?.ready === true, undefined, { polling: 250 });
  await page.evaluate(() => (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent.pause());
  await page.waitForTimeout(400);

  const initial = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.observatory')!;
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas')!;
    const panel = document.querySelector<HTMLElement>('.control-panel')!;
    const rect = canvas.getBoundingClientRect();
    return {
      className: root.className,
      demoMode: root.dataset.demoMode ?? null,
      panelDisplay: getComputedStyle(panel).display,
      canvasCssSize: [rect.width, rect.height],
      state: (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent.getDemoState(),
    };
  });
  checks.push({
    name: 'cinematic chrome is hidden',
    passed: initial.className.includes('demo-cinematic') && initial.panelDisplay === 'none',
    value: initial,
  });
  checks.push({
    name: 'cinematic canvas fills the 1920x1080 viewport',
    passed: Math.abs(initial.canvasCssSize[0] - 1920) < 2
      && Math.abs(initial.canvasCssSize[1] - 1080) < 2,
    value: initial.canvasCssSize,
  });
  await page.screenshot({ path: `${artifacts}/cinematic-opening.png` });

  const technical = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    const state = api.seekDemo(53);
    return { state, diagnostics: api.getDiagnostics() };
  });
  await page.waitForTimeout(700);
  const technicalDom = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.observatory')!;
    return {
      className: root.className,
      demoMode: root.dataset.demoMode ?? null,
      viewMode: root.dataset.viewMode,
      gridChecked: (document.getElementById('grid-visible') as HTMLInputElement).checked,
    };
  });
  checks.push({
    name: 'technical cue enables laboratory grid',
    passed: technical.state.shot.id === 'technical-grid'
      && technicalDom.className.includes('demo-technical')
      && technicalDom.viewMode === 'laboratory'
      && technicalDom.gridChecked,
    value: { technical, technicalDom },
  });
  await page.screenshot({ path: `${artifacts}/technical-grid.png` });

  const bruteForce = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    const state = api.seekDemo(62);
    return { state, diagnostics: api.getDiagnostics() };
  });
  await page.waitForTimeout(400);
  checks.push({
    name: 'technical cue exposes brute-force comparison',
    passed: bruteForce.state.shot.id === 'technical-brute-force'
      && bruteForce.diagnostics.searchMode === 'brute-force',
    value: bruteForce,
  });
  await page.screenshot({ path: `${artifacts}/technical-brute-force.png` });

  const finale = await page.evaluate(() => {
    const api = (window as unknown as { __blueCurrent: DemoApi }).__blueCurrent;
    const state = api.seekDemo(90);
    return { state, diagnostics: api.getDiagnostics() };
  });
  checks.push({
    name: 'timeline completes at 90 seconds',
    passed: finale.state.complete && finale.state.elapsedSeconds === 90,
    value: finale,
  });
  await page.screenshot({ path: `${artifacts}/cinematic-finale.png` });

  const passed = checks.every((check) => check.passed) && browserErrors.length === 0;
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({
    capturedAt: new Date().toISOString(),
    url: `${baseUrl}?demo=cinematic`,
    renderer: await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas');
      const context = canvas?.getContext('webgl2');
      const extension = context?.getExtension('WEBGL_debug_renderer_info');
      return context && extension
        ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
        : 'Unavailable';
    }),
    note: 'SwiftShader software evidence for layout and timeline behavior; not a hardware FPS result.',
    passed,
    checks,
    browserErrors,
  }, null, 2));
  if (!passed) throw new Error('Demo Mode smoke checks failed.');
  console.log(`Demo Mode smoke passed: ${checks.length} checks, 0 browser errors.`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
