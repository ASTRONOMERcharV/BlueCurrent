import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { createServer } from 'vite';

/**
 * Local hardware-GPU acceptance for Blue Current.
 *
 * Run on the Windows host, not in the sandbox:
 *
 *   npm run accept:gpu
 *
 * The script opens a headed Chromium window, verifies that WebGL is using a
 * hardware renderer (not SwiftShader), then measures four asset configurations
 * at 500 / 1000 / 2000 fish. Results, screenshots and a Markdown summary are
 * written to test-artifacts/gpu-acceptance/<timestamp>/ and latest.*.
 *
 * Flags:
 *   --counts=500,1000,2000   fish counts to sample
 *   --scenarios=predator-glb,combo-glb  optional scenario-id filter
 *   --warmup-ms=3000         discarded warm-up before each sample
 *   --sample-ms=10000        minimum measurement window
 *   --max-sample-ms=60000    hard cap while waiting for --min-frames
 *   --min-frames=120         minimum valid rAF samples
 *   --repeats=1              independent reset/sample passes per fish count
 *   --screenshot-timeout=60000  per-screenshot timeout in ms; 0 disables screenshots
 *   --uncapped               disable frame-rate limit/vsync (headroom runs, not display acceptance)
 *   --headless               run headless (sandbox validation only)
 *   --allow-software         run even when SwiftShader is detected
 *   --channel=chrome         use installed Chrome instead of bundled Chromium
 *   --port=5182              Vite port
 */

interface Diagnostics {
  ready: boolean;
  fishCount: number;
  fishModel: 'procedural' | 'blender';
  fishTriangles: number;
  clownfishModel?: 'off' | 'blender';
  clownfishCount?: number;
  clownfishTriangles?: number;
  coralModel?: string;
  coralInstances?: number;
  seaweedModel?: string;
  seaweedInstances?: number;
  predatorModel: 'procedural' | 'blender';
  predatorTriangles: number;
  drawCalls: number;
  canvasWidth: number;
  canvasHeight: number;
  predatorState: string;
  captures: number;
  searchMode: string;
  averageNeighbors: number;
  simulationMs: number;
  renderMs: number;
  candidatesExamined: number;
  droppedSteps: number;
  renderTriangles: number;
}

interface Sample {
  fishCount: number;
  repeat: number;
  fps: number;
  meanFrameMs: number;
  medianFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  frames: number;
  minimumFrames: number;
  sampleMs: number;
  sufficientFrames: boolean;
  diagnostics: Diagnostics;
}

interface Aggregate {
  fishCount: number;
  repeats: number;
  medianFps: number;
  worstP95FrameMs: number;
  medianMeanFrameMs: number;
  allSamplesSufficient: boolean;
}

interface ScenarioResult {
  id: string;
  label: string;
  query: Record<string, string>;
  samples: Sample[];
  aggregates: Aggregate[];
  screenshot: string | null;
}

interface EnvironmentInfo {
  userAgent: string;
  platform: string;
  renderer: string;
  vendor: string;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
}

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match) args.set(match[1], match[2]);
  else if (arg.startsWith('--')) args.set(arg.slice(2), 'true');
}

const headless = args.get('headless') === 'true';
const allowSoftware = args.get('allow-software') === 'true';
const uncapped = args.get('uncapped') === 'true';
const channel = args.get('channel');
const port = Number.parseInt(args.get('port') ?? '5182', 10);
const lighting = args.get('lighting') ?? 'full';
if (lighting !== 'full' && lighting !== 'base') {
  throw new Error('--lighting must be full or base.');
}

function integerArgument(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(args.get(name) ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`--${name} must be an integer in [${minimum}, ${maximum}].`);
  }
  return parsed;
}

const warmupMs = integerArgument('warmup-ms', 3000, 0, 60000);
const sampleMs = integerArgument('sample-ms', 10000, 250, 180000);
const maxSampleMs = integerArgument('max-sample-ms', 60000, sampleMs, 180000);
const minimumFrames = integerArgument('min-frames', 120, 10, 10000);
const repeats = integerArgument('repeats', 1, 1, 10);
const screenshotTimeout = integerArgument('screenshot-timeout', 60000, 0, 180000);
const counts = (args.get('counts') ?? '500,1000,2000')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value >= 10 && value <= 2000);
if (counts.length === 0) throw new Error('No valid fish counts supplied.');

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(root, 'test-artifacts', 'gpu-acceptance', stamp);
const latestDir = join(root, 'test-artifacts', 'gpu-acceptance');
mkdirSync(outputDir, { recursive: true });

const scenarios = [
  {
    id: 'procedural',
    label: 'Procedural fish + procedural predator',
    query: { fish: 'procedural', clownfish: '0', predator: 'procedural' } as Record<string, string>,
  },
  {
    id: 'fish-glb',
    label: 'Blender fish + procedural predator',
    query: { fish: 'blender', clownfish: '0', predator: 'procedural' },
  },
  {
    id: 'predator-glb',
    label: 'Procedural fish + shayu predator',
    query: { fish: 'procedural', clownfish: '0', predator: 'blender' },
  },
  {
    id: 'combo-glb',
    label: 'Blender fish + shayu predator',
    query: { fish: 'blender', clownfish: '0', predator: 'blender' },
  },
  {
    id: 'rich-default',
    label: 'Richest default reef + 100 clownfish',
    query: { clownfish: '100', predator: 'blender' },
  },
];
const requestedScenarios = (args.get('scenarios') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const activeScenarios = requestedScenarios.length > 0
  ? scenarios.filter((scenario) => requestedScenarios.includes(scenario.id))
  : scenarios;
if (activeScenarios.length === 0) throw new Error('No matching --scenarios ids.');

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index]!;
}

function urlFor(query: Record<string, string>, fishCount: number): string {
  const params = new URLSearchParams({
    ...query,
    fishCount: String(fishCount),
    lighting,
  });
  return `http://127.0.0.1:${port}/?${params.toString()}`;
}

async function sampleFrames(
  page: import('playwright').Page,
  measurementMs: number,
  targetFrames: number,
  maximumMs: number,
): Promise<{ frames: number[]; elapsedMs: number }> {
  // A plain string avoids esbuild's keepNames helper leaking into the page.
  return page.evaluate<{ frames: number[]; elapsedMs: number }>(`(async () => {
    const measurementMs = ${measurementMs};
    const targetFrames = ${targetFrames};
    const maximumMs = ${maximumMs};
    const times = [];
    let elapsedMs = 0;
    await new Promise((resolve) => {
      let last = performance.now();
      const start = last;
      const timer = setTimeout(() => resolve(undefined), maximumMs + 1000);
      const loop = (now) => {
        times.push(now - last);
        last = now;
        elapsedMs = now - start;
        const enoughTime = elapsedMs >= measurementMs && times.length >= targetFrames + 1;
        if (elapsedMs < maximumMs && !enoughTime) {
          requestAnimationFrame(loop);
        } else {
          clearTimeout(timer);
          resolve(undefined);
        }
      };
      requestAnimationFrame(loop);
    });
    if (times.length > 2) times.shift();
    return { frames: times, elapsedMs };
  })()`);
}

const launchArgs = headless
  ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : [
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
    ];

const server = await createServer({
  root,
  cacheDir: join(root, '.vite', `gpu-acceptance-${port}`),
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();

let browser: Browser | undefined;
const results: ScenarioResult[] = [];
const browserErrors: string[] = [];
const artifactWarnings: string[] = [];
let fatal: string | null = null;
let environment: EnvironmentInfo | null = null;
let hardwareGpu = false;

try {
  browser = await chromium.launch({
    headless,
    channel: channel as 'chrome' | 'msedge' | undefined,
    args: launchArgs,
  });
  const probe = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await probe.goto('about:blank');
  environment = await probe.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      renderer: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      vendor: gl && ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : 'unknown',
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  await probe.close();

  const renderer = environment.renderer.toLowerCase();
  const software = /swiftshader|llvmpipe|software rasterizer|microsoft basic render/.test(renderer);
  hardwareGpu = !software;

  console.log(`Renderer: ${environment.renderer}`);
  console.log(`Vendor  : ${environment.vendor}`);
  console.log(`GPU     : ${hardwareGpu ? 'hardware' : 'SOFTWARE (invalid for acceptance)'}`);

  if (software && !allowSoftware) {
    fatal = 'SwiftShader/software renderer detected. Run on the Windows host with GPU acceleration enabled, or pass --allow-software only for a smoke test.';
  } else {
    for (const scenario of activeScenarios) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(180000);
      page.on('pageerror', (error) => browserErrors.push(`${scenario.id}: pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(`${scenario.id}: console: ${message.text()}`);
      });

      const scenarioSamples: Sample[] = [];
      let screenshot: string | null = null;
      try {
        await page.goto(urlFor(scenario.query, counts[0]!), { waitUntil: 'networkidle' });
        await page.waitForFunction(
          () => (window as unknown as { __blueCurrent?: { ready?: boolean } }).__blueCurrent?.ready === true,
          { timeout: 180000 },
        );
        await page.bringToFront();

        for (const count of counts) {
          for (let repeat = 1; repeat <= repeats; repeat += 1) {
            await page.evaluate((nextCount) => {
              (window as unknown as {
                __blueCurrent: { setFishCount(count: number): void };
              }).__blueCurrent.setFishCount(nextCount);
            }, count);
            if (warmupMs > 0) await page.waitForTimeout(warmupMs);
            await page.bringToFront();

            const measurement = await sampleFrames(page, sampleMs, minimumFrames, maxSampleMs);
            const frames = measurement.frames;
            const sorted = [...frames].sort((a, b) => a - b);
            const mean = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
            const diagnostics = await page.evaluate(() =>
              (window as unknown as {
                __blueCurrent: { getDiagnostics(): Diagnostics };
              }).__blueCurrent.getDiagnostics());
            const sample: Sample = {
              fishCount: count,
              repeat,
              fps: mean > 0 ? 1000 / mean : 0,
              meanFrameMs: mean,
              medianFrameMs: percentile(sorted, 0.5),
              p95FrameMs: percentile(sorted, 0.95),
              p99FrameMs: percentile(sorted, 0.99),
              frames: frames.length,
              minimumFrames,
              sampleMs: measurement.elapsedMs,
              sufficientFrames: frames.length >= minimumFrames,
              diagnostics,
            };
            scenarioSamples.push(sample);
            console.log(
              `${scenario.id} ${count} #${repeat}: ${sample.fps.toFixed(1)} fps, ` +
              `p95 ${sample.p95FrameMs.toFixed(1)} ms, ${sample.frames} frames/${(sample.sampleMs / 1000).toFixed(1)} s, ` +
              `${diagnostics.drawCalls} draws, ${diagnostics.fishTriangles}+${diagnostics.predatorTriangles} tris` +
              `${sample.sufficientFrames ? '' : ' [INSUFFICIENT FRAMES]'}`,
            );

            if (count === 500 && repeat === 1) {
              if (screenshotTimeout > 0) {
                const file = join(outputDir, `${scenario.id}-500.png`);
                try {
                  await page.screenshot({ path: file, timeout: screenshotTimeout });
                  screenshot = file;
                } catch (error) {
                  // A screenshot is supporting evidence, not a measurement input;
                  // never let it discard valid frame samples.
                  artifactWarnings.push(
                    `${scenario.id}: screenshot: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              } else {
                artifactWarnings.push(`${scenario.id}: screenshots disabled by --screenshot-timeout=0`);
              }
            }
          }
        }
      } finally {
        await page.close();
      }
      const aggregates = counts.map((count): Aggregate => {
        const samples = scenarioSamples.filter((sample) => sample.fishCount === count);
        const sortedFps = samples.map((sample) => sample.fps).sort((a, b) => a - b);
        const sortedMean = samples.map((sample) => sample.meanFrameMs).sort((a, b) => a - b);
        return {
          fishCount: count,
          repeats: samples.length,
          medianFps: percentile(sortedFps, 0.5),
          worstP95FrameMs: Math.max(...samples.map((sample) => sample.p95FrameMs)),
          medianMeanFrameMs: percentile(sortedMean, 0.5),
          allSamplesSufficient: samples.every((sample) => sample.sufficientFrames),
        };
      });
      results.push({ ...scenario, samples: scenarioSamples, aggregates, screenshot });
    }

    if (!headless) {
      try {
        const hero = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        hero.setDefaultTimeout(180000);
        hero.on('pageerror', (error) => browserErrors.push(`hero: pageerror: ${error.message}`));
        hero.on('console', (message) => {
          if (message.type() === 'error') browserErrors.push(`hero: console: ${message.text()}`);
        });
        try {
          await hero.goto(`http://127.0.0.1:${port}/preview/predator-preview.html?mode=hero&predator=blender`, { waitUntil: 'networkidle' });
          await hero.waitForFunction(
            () => (window as unknown as { __predatorPreview?: { ready?: boolean } }).__predatorPreview?.ready === true,
            { timeout: 180000 },
          );
          await hero.waitForTimeout(1000);
          await hero.bringToFront();
          await hero.screenshot({ path: join(outputDir, 'predator-hero.png'), timeout: 60000 });
        } finally {
          await hero.close();
        }
      } catch (error) {
        browserErrors.push(`hero: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
} catch (error) {
  fatal = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  await browser?.close();
  await server.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  hardwareGpu,
  softwareRendering: !hardwareGpu,
  headless,
  uncapped,
  counts,
  lighting,
  acceptanceConfig: {
    warmupMs,
    sampleMs,
    maxSampleMs,
    minimumFrames,
    repeats,
    screenshotTimeout,
  },
  environment,
  scenarios: results,
  browserErrors,
  artifactWarnings,
  fatal,
};
writeFileSync(join(outputDir, 'results.json'), JSON.stringify(report, null, 2));
writeFileSync(join(latestDir, 'latest.json'), JSON.stringify(report, null, 2));

const rows = results.flatMap((scenario) =>
  scenario.samples.map((sample) =>
    `| ${scenario.id} | ${sample.fishCount} | ${sample.repeat} | ${sample.fps.toFixed(1)} | ` +
    `${sample.meanFrameMs.toFixed(2)} | ${sample.medianFrameMs.toFixed(2)} | ` +
    `${sample.p95FrameMs.toFixed(2)} | ${sample.p99FrameMs.toFixed(2)} | ${sample.diagnostics.drawCalls} | ` +
    `${sample.diagnostics.fishTriangles} | ${sample.diagnostics.predatorTriangles} |`));
const aggregateRows = results.flatMap((scenario) =>
  scenario.aggregates.map((aggregate) =>
    `| ${scenario.id} | ${aggregate.fishCount} | ${aggregate.repeats} | ` +
    `${aggregate.medianFps.toFixed(1)} | ${aggregate.medianMeanFrameMs.toFixed(2)} | ` +
    `${aggregate.worstP95FrameMs.toFixed(2)} | ${aggregate.allSamplesSufficient ? 'yes' : 'NO'} |`));
const diagnosticRows = results.flatMap((scenario) =>
  scenario.samples.map((sample) =>
    `| ${scenario.id} | ${sample.fishCount} | ${sample.repeat} | ${sample.diagnostics.simulationMs.toFixed(2)} | ` +
    `${sample.diagnostics.renderMs.toFixed(2)} | ${sample.diagnostics.candidatesExamined.toLocaleString()} | ` +
    `${sample.diagnostics.droppedSteps} | ${sample.frames} | ${sample.sufficientFrames ? 'yes' : 'NO'} |`));
const insufficientSamples = results.reduce(
  (count, scenario) => count + scenario.samples.filter((sample) => !sample.sufficientFrames).length,
  0,
);
const summary = [
  '# Blue Current — local GPU acceptance',
  '',
  `- Generated: ${report.generatedAt}`,
  `- Platform: ${report.platform}`,
  `- Renderer: ${environment?.renderer ?? 'unknown'}`,
  `- Vendor: ${environment?.vendor ?? 'unknown'}`,
  `- Hardware GPU: ${hardwareGpu ? 'yes' : 'no'}`,
  `- Headless: ${headless}`,
  `- Frame-rate cap: ${uncapped ? 'disabled (headroom run)' : 'display/vsync'}`,
  `- Viewport: ${environment ? `${environment.viewport.width}x${environment.viewport.height} @ DPR ${environment.devicePixelRatio}` : 'unknown'}`,
  `- Counts: ${counts.join(', ')}`,
  `- Lighting layer: ${lighting}`,
  `- Warm-up / sample: ${warmupMs} ms / ${sampleMs} ms, at least ${minimumFrames} frames, max ${maxSampleMs} ms`,
  `- Repeats: ${repeats}`,
  `- Screenshot timeout: ${screenshotTimeout > 0 ? `${screenshotTimeout} ms` : 'disabled'}`,
  `- Insufficient-frame samples: ${insufficientSamples}`,
  '',
  '## Aggregate (median across repeats)',
  '',
  '| Scenario | Fish | Repeats | Median FPS | Median mean ms | Worst P95 ms | All samples sufficient |',
  '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ...aggregateRows,
  '',
  '## Individual samples',
  '',
  '| Scenario | Fish | Repeat | FPS | Mean ms | P50 ms | P95 ms | P99 ms | Draw calls | Fish tris / instance | Predator tris |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows,
  '',
  '## Simulation diagnostics',
  '',
  'Render CPU is JavaScript/WebGL submission time, not a GPU timestamp. Candidate checks and dropped steps explain CPU-side scaling.',
  '',
  `| Scenario | Fish | Repeat | Sim step ms (EMA) | Render CPU ms | Candidates / latest step | Dropped steps | Frames | ≥${minimumFrames} frames |`,
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ...diagnosticRows,
  '',
  'FPS is measured with requestAnimationFrame. When the frame-rate cap is enabled, 60 FPS means display-limited rather than headroom. ' +
  'P95 is the useful tail metric only when every sample has sufficient frames. Keep the browser window visible and the laptop plugged in. ' +
  'Screenshots are in the same directory.',
  '',
  ...(insufficientSamples > 0
    ? [`**Warning:** ${insufficientSamples} sample(s) did not reach ${minimumFrames} frames; treat their P95 as provisional.`, '']
    : []),
  ...(fatal ? [`**FAILED:** ${fatal}`, ''] : []),
  ...(artifactWarnings.length > 0
    ? ['**Artifact warnings (do not invalidate frame samples):**', ...artifactWarnings.map((warning) => `- ${warning}`), '']
    : []),
  ...(browserErrors.length > 0 ? ['**Browser errors:**', ...browserErrors.map((error) => `- ${error}`), ''] : []),
].join('\n');
writeFileSync(join(outputDir, 'summary.md'), summary);
writeFileSync(join(latestDir, 'latest.md'), summary);

console.log(`\nWrote ${join(outputDir, 'results.json')}`);
console.log(`Wrote ${join(outputDir, 'summary.md')}`);
console.log(summary);

if (fatal) process.exitCode = 1;
else if (browserErrors.length > 0) process.exitCode = 1;
else if (!hardwareGpu && !allowSoftware) process.exitCode = 2;
