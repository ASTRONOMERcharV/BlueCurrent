import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Pre-registered F2-2R 1440x900 design-viewport gate (D030).
 *
 * V1 control: three 1280x720 telemetry-off standard samples, each D028
 * (P50 <= 16.7 ms, P95 <= 33 ms, 0 dropped), P50 spread <= 1.25.
 * V2 environment: Intel Iris Xe D3D11 without a software renderer, no browser
 * errors, page visible/focused before and after, canvas matching the requested
 * viewport at effective DPR 1, one consistent console state, and a running
 * simulation.
 * V3 verdict: three valid 1440x900 samples (>= 120 frames, >= 10 s), P50
 * spread <= 1.25, simulation EMA <= 1.05x the control median.
 * D1 PASS_1440: all three P50 <= 16.7, P95 <= 33, 0 dropped.
 * D2 ONE_TIER: median P50 <= 22.8, P95 <= 33 in at least 2/3, dropped <= 1 each.
 * D3 TWO_TIER: the conservative complement of D1/D2.
 *
 * The D2 median must exceed 16.7 by the pre-registered wording; when D1 misses
 * on one sample but the median stays at or below 22.8, the evaluator classifies
 * it as ONE_TIER rather than leaving the case undefined. Any V1-V3 failure is
 * INVALID on attempt 1 (rerun once) and INCONCLUSIVE on attempt 2.
 */

export type GateVerdict = 'PASS_1440' | 'ONE_TIER' | 'TWO_TIER' | 'INVALID' | 'INCONCLUSIVE';
export type GateNextSpend = 'cpu-prune-eligible' | 'render-gpu-investigation' | 'stop';
export type GateAttempt = 1 | 2;

export interface GateVisibility {
  visibility: string;
  focused: boolean;
}

export interface GateCanvas {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  devicePixelRatio: number;
  effectivePixelRatio: number | null;
}

export interface GateViewport {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

export interface GateRefresh {
  estimateMs: number | null;
  estimateHz: number | null;
  method: string;
}

export interface GateSample {
  row: string;
  repeat: number;
  mode: 'off' | 'gpu' | 'full';
  width: number;
  height: number;
  telemetry: boolean;
  frameCount: number;
  durationMs: number;
  p50Ms: number;
  p95Ms: number;
  droppedSteps: number;
  simulationMs: number;
  renderer: { vendor: string; renderer: string } | null;
  browserErrors: string[];
  visibility: { before: GateVisibility; after: GateVisibility };
  viewport: GateViewport;
  canvas: GateCanvas | null;
  panelClosed: boolean | null;
  refresh: GateRefresh | null;
  totalSteps: number;
  stepsPerFrameMean: number | null;
}

export interface GateInput {
  controls: GateSample[];
  verdicts: GateSample[];
  attempt?: GateAttempt;
}

export interface GateCheck {
  id: string;
  pass: boolean;
  detail: string;
}

export interface GateEvaluation {
  verdict: GateVerdict;
  nextSpend: GateNextSpend;
  rerunRecommended: boolean;
  checks: GateCheck[];
  reasons: string[];
  control: {
    count: number;
    d028Passes: number;
    p50Ms: number[];
    p95Ms: number[];
    spread: number | null;
    simulationMsMedian: number | null;
  };
  verdictDetail: {
    count: number;
    p50Ms: number[];
    p95Ms: number[];
    spread: number | null;
    medianP50Ms: number | null;
    d1Passes: number;
    p95Passes: number;
    maxDroppedSteps: number;
    simulationMsMedian: number | null;
    simulationRatio: number | null;
  };
}

const D028_P50_MS = 16.7;
const D028_P95_MS = 33;
const ONE_TIER_P50_MS = 22.8;
const P50_SPREAD_LIMIT = 1.25;
const SIM_RATIO_LIMIT = 1.05;
const MIN_FRAMES = 120;
const MIN_DURATION_MS = 10000;
const EFFECTIVE_DPR_TOLERANCE = 0.01;
const SOFTWARE_RENDERERS = ['swiftshader', 'llvmpipe', 'basic render'];

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function spread(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return Math.max(...values) / Math.min(...values);
}

function rendererPass(renderer: GateSample['renderer']): boolean {
  if (!renderer) return false;
  const text = `${renderer.vendor} ${renderer.renderer}`.toLowerCase();
  return text.includes('intel')
    && text.includes('iris')
    && text.includes('d3d11')
    && !SOFTWARE_RENDERERS.some((name) => text.includes(name));
}

function visibilityPass(visibility: GateVisibility | undefined): boolean {
  return visibility?.visibility === 'visible' && visibility.focused === true;
}

function sampleEnvironmentPass(sample: GateSample): boolean {
  return rendererPass(sample.renderer)
    && sample.browserErrors.length === 0
    && visibilityPass(sample.visibility.before)
    && visibilityPass(sample.visibility.after);
}

function sampleSamplesPass(sample: GateSample): boolean {
  return sample.frameCount >= MIN_FRAMES && sample.durationMs >= MIN_DURATION_MS;
}

function viewportPass(sample: GateSample): boolean {
  return sample.viewport.innerWidth === sample.width
    && sample.viewport.innerHeight === sample.height
    && sample.viewport.devicePixelRatio === 1;
}

function canvasPass(sample: GateSample): boolean {
  const canvas = sample.canvas;
  if (!canvas) return false;
  return canvas.width > 0
    && canvas.height > 0
    && Math.abs(canvas.width - canvas.clientWidth) <= 1
    && Math.abs(canvas.height - canvas.clientHeight) <= 1
    && canvas.effectivePixelRatio !== null
    && Math.abs(canvas.effectivePixelRatio - 1) <= EFFECTIVE_DPR_TOLERANCE;
}

function canvasArea(sample: GateSample): number | null {
  return sample.canvas ? sample.canvas.width * sample.canvas.height : null;
}

function runPass(sample: GateSample): boolean {
  return Number.isFinite(sample.totalSteps)
    && sample.totalSteps > 0
    && sample.stepsPerFrameMean !== null
    && Number.isFinite(sample.stepsPerFrameMean)
    && sample.stepsPerFrameMean > 0;
}

function formatNumbers(values: readonly number[]): string {
  return values.map((value) => value.toFixed(2)).join(', ');
}

export function evaluatePhaseFGate(input: GateInput): GateEvaluation {
  const attempt = input.attempt ?? 1;
  const controls = input.controls;
  const verdicts = input.verdicts;
  const all = [...controls, ...verdicts];
  const checks: GateCheck[] = [];

  const controlD028Passes = controls.filter((sample) => (
    sample.p50Ms <= D028_P50_MS
    && sample.p95Ms <= D028_P95_MS
    && sample.droppedSteps === 0
  )).length;
  const controlSpread = spread(controls.map((sample) => sample.p50Ms));
  const controlSimulation = median(controls.map((sample) => sample.simulationMs));

  checks.push({
    id: 'V1-count',
    pass: controls.length === 3,
    detail: `expected 3 controls, got ${controls.length}`,
  });
  checks.push({
    id: 'V1-viewport',
    pass: controls.length === 3 && controls.every((sample) => sample.width === 1280 && sample.height === 720 && !sample.telemetry),
    detail: `controls: ${controls.map((sample) => `${sample.width}x${sample.height} telemetry=${sample.telemetry}`).join('; ')}`,
  });
  checks.push({
    id: 'V1-samples',
    pass: controls.length === 3 && controls.every(sampleSamplesPass),
    detail: `controls frames/duration: ${controls.map((sample) => `${sample.frameCount}/${sample.durationMs.toFixed(0)}ms`).join('; ')}`,
  });
  checks.push({
    id: 'V1-d028',
    pass: controls.length === 3 && controlD028Passes === 3,
    detail: `${controlD028Passes}/3 control samples meet P50 <= ${D028_P50_MS}, P95 <= ${D028_P95_MS}, 0 dropped`,
  });
  checks.push({
    id: 'V1-spread',
    pass: controlSpread !== null && controlSpread <= P50_SPREAD_LIMIT,
    detail: `control P50 spread ${controlSpread?.toFixed(3) ?? 'N/A'} (limit ${P50_SPREAD_LIMIT}); P50 ${formatNumbers(controls.map((sample) => sample.p50Ms))}`,
  });

  const environmentFailures = all.filter((sample) => !sampleEnvironmentPass(sample));
  checks.push({
    id: 'V2-renderer',
    pass: all.length > 0 && all.every((sample) => rendererPass(sample.renderer)),
    detail: all.map((sample) => `${sample.row}r${sample.repeat}: ${sample.renderer?.renderer ?? 'missing renderer'}`).join('; '),
  });
  checks.push({
    id: 'V2-errors',
    pass: all.length > 0 && all.every((sample) => sample.browserErrors.length === 0),
    detail: all.map((sample) => `${sample.row}r${sample.repeat}: ${sample.browserErrors.length} errors`).join('; '),
  });
  checks.push({
    id: 'V2-visibility',
    pass: all.length > 0 && all.every((sample) => (
      visibilityPass(sample.visibility.before) && visibilityPass(sample.visibility.after)
    )),
    detail: all.map((sample) => `${sample.row}r${sample.repeat}: before=${sample.visibility.before.visibility}/${sample.visibility.before.focused} after=${sample.visibility.after.visibility}/${sample.visibility.after.focused}`).join('; '),
  });
  checks.push({
    id: 'V2-viewport',
    pass: all.length > 0 && all.every(viewportPass),
    detail: all.map((sample) => `${sample.row}r${sample.repeat}: requested ${sample.width}x${sample.height}, inner ${sample.viewport.innerWidth}x${sample.viewport.innerHeight}, dpr ${sample.viewport.devicePixelRatio}`).join('; '),
  });
  checks.push({
    id: 'V2-canvas',
    pass: all.length > 0 && all.every(canvasPass),
    detail: all.map((sample) => `${sample.row}r${sample.repeat}: ${sample.canvas ? `buffer ${sample.canvas.width}x${sample.canvas.height}, client ${sample.canvas.clientWidth.toFixed(0)}x${sample.canvas.clientHeight.toFixed(0)}, effective dpr ${sample.canvas.effectivePixelRatio?.toFixed(3) ?? 'N/A'}` : 'missing canvas'}`).join('; '),
  });
  const panelStates = new Set(all.map((sample) => String(sample.panelClosed)));
  checks.push({
    id: 'V2-panel-consistent',
    pass: all.length > 0 && all.every((sample) => typeof sample.panelClosed === 'boolean') && panelStates.size === 1,
    detail: `panelClosed values: ${[...panelStates].join(', ')}`,
  });
  checks.push({
    id: 'V2-run',
    pass: all.length > 0 && all.every(runPass),
    detail: all.map((sample) => `${sample.row}r${sample.repeat}: totalSteps=${sample.totalSteps} stepsPerFrame=${sample.stepsPerFrameMean?.toFixed(3) ?? 'N/A'}`).join('; '),
  });
  if (environmentFailures.length > 0) {
    checks.push({
      id: 'V2-environment-summary',
      pass: false,
      detail: `${environmentFailures.length} sample(s) fail renderer/errors/visibility`,
    });
  }

  const verdictSpread = spread(verdicts.map((sample) => sample.p50Ms));
  const verdictSimulation = median(verdicts.map((sample) => sample.simulationMs));
  const simulationRatio = controlSimulation !== null && controlSimulation > 0 && verdictSimulation !== null
    ? verdictSimulation / controlSimulation
    : null;
  const controlCanvasArea = median(controls.map(canvasArea).filter((value): value is number => value !== null));
  const verdictCanvasArea = median(verdicts.map(canvasArea).filter((value): value is number => value !== null));

  checks.push({
    id: 'V3-count',
    pass: verdicts.length === 3,
    detail: `expected 3 verdict samples, got ${verdicts.length}`,
  });
  checks.push({
    id: 'V3-viewport',
    pass: verdicts.length === 3 && verdicts.every((sample) => sample.width === 1440 && sample.height === 900),
    detail: `verdicts: ${verdicts.map((sample) => `${sample.width}x${sample.height}`).join('; ')}`,
  });
  checks.push({
    id: 'V3-samples',
    pass: verdicts.length === 3 && verdicts.every(sampleSamplesPass),
    detail: `verdict frames/duration: ${verdicts.map((sample) => `${sample.frameCount}/${sample.durationMs.toFixed(0)}ms`).join('; ')}`,
  });
  checks.push({
    id: 'V3-spread',
    pass: verdictSpread !== null && verdictSpread <= P50_SPREAD_LIMIT,
    detail: `verdict P50 spread ${verdictSpread?.toFixed(3) ?? 'N/A'} (limit ${P50_SPREAD_LIMIT}); P50 ${formatNumbers(verdicts.map((sample) => sample.p50Ms))}`,
  });
  checks.push({
    id: 'V3-sim-ratio',
    pass: simulationRatio !== null && simulationRatio <= SIM_RATIO_LIMIT,
    detail: `verdict/control simulation EMA ratio ${simulationRatio?.toFixed(3) ?? 'N/A'} (limit ${SIM_RATIO_LIMIT}); control ${controlSimulation?.toFixed(3) ?? 'N/A'} ms, verdict ${verdictSimulation?.toFixed(3) ?? 'N/A'} ms`,
  });
  checks.push({
    id: 'V3-canvas-growth',
    pass: controlCanvasArea !== null && verdictCanvasArea !== null && verdictCanvasArea > controlCanvasArea,
    detail: `median canvas area control ${controlCanvasArea?.toFixed(0) ?? 'N/A'} px, verdict ${verdictCanvasArea?.toFixed(0) ?? 'N/A'} px; the 1440 page viewport must increase the rendered canvas area`,
  });

  const verdictP50 = verdicts.map((sample) => sample.p50Ms);
  const medianP50 = median(verdictP50);
  const d1Passes = verdicts.filter((sample) => sample.p50Ms <= D028_P50_MS).length;
  const p95Passes = verdicts.filter((sample) => sample.p95Ms <= D028_P95_MS).length;
  const maxDroppedSteps = Math.max(0, ...verdicts.map((sample) => sample.droppedSteps));
  const d1 = verdicts.length === 3 && verdicts.every((sample) => (
    sample.p50Ms <= D028_P50_MS
    && sample.p95Ms <= D028_P95_MS
    && sample.droppedSteps === 0
  ));
  const oneTier = !d1
    && medianP50 !== null
    && medianP50 <= ONE_TIER_P50_MS
    && p95Passes >= 2
    && maxDroppedSteps <= 1;
  checks.push({
    id: 'D-classification',
    pass: true,
    detail: d1
      ? 'D1 PASS_1440'
      : oneTier
        ? 'D2 ONE_TIER (median P50 within one-tier band; D1 missed on at least one sample)'
        : 'D3 TWO_TIER (conservative complement of D1/D2)',
  });

  const failed = checks.filter((check) => !check.pass);
  const invalid = failed.length > 0;
  let verdict: GateVerdict;
  let nextSpend: GateNextSpend;
  let rerunRecommended = false;
  if (invalid) {
    verdict = attempt === 1 ? 'INVALID' : 'INCONCLUSIVE';
    nextSpend = 'stop';
    rerunRecommended = attempt === 1;
  } else {
    verdict = d1 ? 'PASS_1440' : oneTier ? 'ONE_TIER' : 'TWO_TIER';
    nextSpend = verdict === 'PASS_1440' ? 'cpu-prune-eligible' : 'render-gpu-investigation';
  }

  const reasons = failed.map((check) => `${check.id}: ${check.detail}`);
  if (!invalid) {
    reasons.push(
      verdict === 'PASS_1440'
        ? 'D1: all 1440x900 samples meet D028; the funded pressure/extreme diagnostic headroom is the remaining reason to continue CPU prune work.'
        : `${verdict}: 1440x900 cost needs a render/GPU investigation before any fused CPU pass is funded.`,
    );
  } else if (rerunRecommended) {
    reasons.push('Gate data are invalid; rerun the clean six-sample gate once before declaring INCONCLUSIVE.');
  } else {
    reasons.push('Second gate attempt remains invalid; record INCONCLUSIVE and spend no code budget.');
  }

  return {
    verdict,
    nextSpend,
    rerunRecommended,
    checks,
    reasons,
    control: {
      count: controls.length,
      d028Passes: controlD028Passes,
      p50Ms: controls.map((sample) => sample.p50Ms),
      p95Ms: controls.map((sample) => sample.p95Ms),
      spread: controlSpread,
      simulationMsMedian: controlSimulation,
    },
    verdictDetail: {
      count: verdicts.length,
      p50Ms: verdictP50,
      p95Ms: verdicts.map((sample) => sample.p95Ms),
      spread: verdictSpread,
      medianP50Ms: medianP50,
      d1Passes,
      p95Passes,
      maxDroppedSteps,
      simulationMsMedian: verdictSimulation,
      simulationRatio,
    },
  };
}

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, '/') ?? '';
  return /scripts\/phase-f-gate-rule\.(ts|js)$/.test(entry);
}

if (invokedDirectly()) {
  const paths = argument('results', '').split(',').map((value) => value.trim()).filter(Boolean);
  if (paths.length !== 3) {
    console.error('usage: npx tsx scripts/phase-f-gate-rule.ts --results=<control+spot results.json>,... (three files) [--attempt=1|2] [--out=gate.json]');
    process.exitCode = 1;
  } else {
    const controls: GateSample[] = [];
    const verdicts: GateSample[] = [];
    for (const path of paths) {
      const payload = JSON.parse(readFileSync(path, 'utf8')) as { samples?: GateSample[] };
      for (const sample of payload.samples ?? []) {
        if (sample.row === 'standard-control') controls.push(sample);
        if (sample.row === 'standard-spot') verdicts.push(sample);
      }
    }
    const attempt = Number(argument('attempt', '1')) === 2 ? 2 : 1;
    const result = evaluatePhaseFGate({ controls, verdicts, attempt });
    const output = argument('out', '');
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify({
        schemaVersion: 'phase-f-f2-gate-v1',
        evaluatedAt: new Date().toISOString(),
        attempt,
        inputs: paths,
        counts: { controls: controls.length, verdicts: verdicts.length },
        samples: { controls, verdicts },
        result,
      }, null, 2)}\n`);
    }
    console.log(JSON.stringify({
      verdict: result.verdict,
      nextSpend: result.nextSpend,
      rerunRecommended: result.rerunRecommended,
      control: result.control,
      verdictDetail: result.verdictDetail,
      failedChecks: result.checks.filter((check) => !check.pass),
      reasons: result.reasons,
    }, null, 2));
    if (result.verdict === 'INVALID' || result.verdict === 'INCONCLUSIVE') process.exitCode = 1;
  }
}
