import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

/**
 * Frame-time comparison for the procedural fish vs the Blender GLB fish.
 *
 *   npm run perf:fish -- --mode=blender --counts=500,1000,2000
 *   npm run perf:fish -- --mode=procedural --counts=500,1000,2000
 *   npm run perf:fish -- --mode=blender --gpu        # local hardware browser
 *
 * Without --gpu Playwright uses SwiftShader in this sandbox; those numbers are
 * software-rendering smoke data, NOT hardware GPU results.
 */

interface Diagnostics {
  fishModel: 'procedural' | 'blender';
  fishTriangles: number;
  drawCalls: number;
  fishCount: number;
  fps: number;
  renderMs: number;
}

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match) args.set(match[1], match[2]);
  else if (arg.startsWith('--')) args.set(arg.slice(2), 'true');
}
const mode = args.get('mode') === 'procedural' ? 'procedural' : 'blender';
const gpu = args.get('gpu') === 'true';
const counts = (args.get('counts') ?? '500,1000,2000')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value >= 10 && value <= 2000);

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = `${root}benchmarks`;
mkdirSync(artifacts, { recursive: true });

const server = await createServer({ root, server: { host: '127.0.0.1', port: 5191, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  headless: !gpu,
  args: gpu ? [] : ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

interface Sample {
  count: number;
  diagnostics: Diagnostics;
  medianFrameMs: number;
  p95FrameMs: number;
  meanFrameMs: number;
  fps: number;
  frames: number;
  sufficientFrames: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index]!;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
  });

  const url = mode === 'blender' ? 'http://127.0.0.1:5191/?fish=blender' : 'http://127.0.0.1:5191/';
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction("() => window.__blueCurrent?.ready === true", { timeout: 180000 });

  const environment = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      renderer: gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      vendor: gl && ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown',
    };
  });

  const samples: Sample[] = [];
  for (const count of counts) {
    await page.evaluate((nextCount) => {
      (window as unknown as { __blueCurrent: { setFishCount(count: number): void } })
        .__blueCurrent.setFishCount(nextCount);
    }, count);
    await page.waitForTimeout(900);

    // A plain string avoids esbuild's keepNames helper (`__name`) leaking into
    // the browser context through page.evaluate.
    const sampleFrames = async (durationMs: number): Promise<number[]> => page.evaluate<number[]>(`(async () => {
      const durationMs = ${durationMs};
      const times = [];
      await new Promise((resolve) => {
        let last = performance.now();
        const start = last;
        const loop = (now) => {
          times.push(now - last);
          last = now;
          if (now - start < durationMs) requestAnimationFrame(loop);
          else resolve();
        };
        requestAnimationFrame(loop);
      });
      if (times.length > 2) times.shift();
      return times;
    })()`);
    let frames = await sampleFrames(1600);
    if (frames.length < 2) frames = await sampleFrames(4000);

    const diagnostics = await page.evaluate(() =>
      (window as unknown as { __blueCurrent: { getDiagnostics(): Diagnostics } }).__blueCurrent.getDiagnostics());
    const sorted = [...frames].sort((a, b) => a - b);
    const mean = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    samples.push({
      count,
      diagnostics,
      frames: frames.length,
      sufficientFrames: frames.length >= 10,
      medianFrameMs: percentile(sorted, 0.5),
      p95FrameMs: percentile(sorted, 0.95),
      meanFrameMs: mean,
      fps: mean > 0 ? 1000 / mean : 0,
    });
    console.log(`${mode} ${count}: ${samples.at(-1)!.fps.toFixed(1)} fps, ` +
      `p95 ${samples.at(-1)!.p95FrameMs.toFixed(1)} ms, ` +
      `${diagnostics.fishModel}/${diagnostics.fishTriangles} tris, ` +
      `${diagnostics.drawCalls} draw calls`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    softwareRendering: !gpu,
    environment,
    pageErrors,
    samples,
  };
  const file = `${artifacts}/fish-asset-${mode}${gpu ? '-gpu' : ''}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Wrote ${file}`);
  if (pageErrors.length > 0) throw new Error(pageErrors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
