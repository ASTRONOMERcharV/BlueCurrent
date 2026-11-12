import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { NeighborSearchMode } from '../src/simulation/SimulationConfig';

interface Options {
  counts: number[];
  steps: number;
  warmup: number;
  repeats: number;
}

interface Measurement {
  count: number;
  mode: NeighborSearchMode;
  repeat: number;
  meanStepMs: number;
  medianStepMs: number;
  p95StepMs: number;
  estimatedSimulationFps: number;
  averageNeighbors: number;
  averageCandidates: number;
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const options: Options = quick
    ? { counts: [100, 250, 500], steps: 60, warmup: 20, repeats: 2 }
    : { counts: [100, 250, 500, 1000, 2000], steps: 300, warmup: 60, repeats: 5 };
  for (const argument of args) {
    const [key, value] = argument.replace(/^--/, '').split('=');
    if (key === 'counts') options.counts = value.split(',').map(Number).filter((count) => count >= 10 && count <= 2000);
    if (key === 'steps') options.steps = Math.max(1, Math.floor(Number(value)));
    if (key === 'warmup') options.warmup = Math.max(0, Math.floor(Number(value)));
    if (key === 'repeats') options.repeats = Math.max(1, Math.floor(Number(value)));
  }
  return options;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function measure(count: number, mode: NeighborSearchMode, repeat: number, options: Options): Measurement {
  const world = new SimulationWorld();
  world.detailedMetricsEnabled = false;
  world.config.predatorEnabled = false;
  world.setFishCount(count);
  world.setSearchMode(mode);
  for (let step = 0; step < options.warmup; step += 1) world.step();

  const durations = new Float64Array(options.steps);
  let candidates = 0;
  for (let step = 0; step < options.steps; step += 1) {
    const started = performance.now();
    world.step();
    durations[step] = performance.now() - started;
    candidates += world.boids.candidatesExamined;
  }
  const sorted = Array.from(durations).sort((a, b) => a - b);
  const mean = Array.from(durations).reduce((sum, value) => sum + value, 0) / options.steps;
  return {
    count,
    mode,
    repeat,
    meanStepMs: mean,
    medianStepMs: percentile(sorted, 0.5),
    p95StepMs: percentile(sorted, 0.95),
    estimatedSimulationFps: 1000 / mean,
    averageNeighbors: world.metrics.averageNeighbors,
    averageCandidates: candidates / options.steps,
  };
}

const options = parseOptions();
const measurements: Measurement[] = [];
for (const count of options.counts) {
  for (const mode of ['brute-force', 'grid'] as const) {
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      const result = measure(count, mode, repeat, options);
      measurements.push(result);
      console.log(
        `${String(count).padStart(4)} fish | ${mode.padEnd(11)} | run ${repeat}/${options.repeats} | ` +
        `mean ${result.meanStepMs.toFixed(3)} ms | p95 ${result.p95StepMs.toFixed(3)} ms`,
      );
    }
  }
}

const summaries = options.counts.flatMap((count) => (['brute-force', 'grid'] as const).map((mode) => {
  const runs = measurements.filter((measurement) => measurement.count === count && measurement.mode === mode);
  const means = runs.map((run) => run.meanStepMs).sort((a, b) => a - b);
  const p95s = runs.map((run) => run.p95StepMs).sort((a, b) => a - b);
  return {
    count,
    mode,
    repeats: runs.length,
    medianMeanStepMs: percentile(means, 0.5),
    medianP95StepMs: percentile(p95s, 0.5),
    minMeanStepMs: means[0],
    maxMeanStepMs: means[means.length - 1],
    averageNeighbors: runs[runs.length - 1].averageNeighbors,
    averageCandidates: runs[runs.length - 1].averageCandidates,
  };
}));

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(`${projectRoot}benchmark`, { recursive: true });
const environment = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  release: release(),
  cpu: cpus()[0]?.model ?? 'Unknown',
  logicalCores: cpus().length,
  options,
  notes: [
    'CPU simulation only; no Three.js rendering is included.',
    'Predator is disabled to keep population constant. Reef avoidance and soft boundaries remain enabled.',
    'Detailed school metrics are disabled during measurement to isolate the fixed-step neighbor/behavior update.',
    'Each repeat resets the same seeded initial state. Values are measured, not theoretical complexity estimates.',
  ],
};
writeFileSync(`${projectRoot}benchmark/latest-results.json`, JSON.stringify({ environment, summaries, measurements }, null, 2));
const csv = [
  'fish_count,search_mode,repeats,median_mean_step_ms,median_p95_step_ms,min_mean_step_ms,max_mean_step_ms,estimated_simulation_fps,average_neighbors,average_candidates_per_step',
  ...summaries.map((row) => [
    row.count, row.mode, row.repeats,
    row.medianMeanStepMs.toFixed(6), row.medianP95StepMs.toFixed(6),
    row.minMeanStepMs.toFixed(6), row.maxMeanStepMs.toFixed(6),
    (1000 / row.medianMeanStepMs).toFixed(3), row.averageNeighbors.toFixed(3), row.averageCandidates.toFixed(1),
  ].join(',')),
].join('\n');
writeFileSync(`${projectRoot}benchmark/latest-results.csv`, `${csv}\n`);

console.log('\nMedian of per-run means:');
console.table(summaries.map((row) => ({
  fish: row.count,
  search: row.mode,
  'mean ms': row.medianMeanStepMs.toFixed(3),
  'p95 ms': row.medianP95StepMs.toFixed(3),
  'sim fps': (1000 / row.medianMeanStepMs).toFixed(1),
})));
for (const count of options.counts) {
  const brute = summaries.find((row) => row.count === count && row.mode === 'brute-force')!;
  const grid = summaries.find((row) => row.count === count && row.mode === 'grid')!;
  console.log(`${count} fish measured speedup: ${(brute.medianMeanStepMs / grid.medianMeanStepMs).toFixed(2)}×`);
}
console.log('\nWrote benchmark/latest-results.csv and benchmark/latest-results.json');
