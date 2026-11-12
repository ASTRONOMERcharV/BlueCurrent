import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyScenario } from '../src/simulation/Scenarios';
import type { NeighborSearchMode } from '../src/simulation/SimulationConfig';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

interface Measurement {
  repeat: number;
  mode: NeighborSearchMode;
  meanStepMs: number;
  medianStepMs: number;
  p95StepMs: number;
  averageCandidates: number;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function measure(mode: NeighborSearchMode, repeat: number): Measurement {
  const world = new SimulationWorld();
  world.detailedMetricsEnabled = false;
  applyScenario(world, 'obstacles');
  world.setSearchMode(mode);
  for (let step = 0; step < 40; step += 1) world.step();
  const durations = new Float64Array(120);
  let candidates = 0;
  for (let step = 0; step < durations.length; step += 1) {
    const started = performance.now();
    world.step();
    durations[step] = performance.now() - started;
    candidates += world.boids.candidatesExamined;
  }
  const sorted = Array.from(durations).sort((a, b) => a - b);
  return {
    repeat,
    mode,
    meanStepMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    medianStepMs: percentile(sorted, 0.5),
    p95StepMs: percentile(sorted, 0.95),
    averageCandidates: candidates / durations.length,
  };
}

const measurements: Measurement[] = [];
for (let repeat = 1; repeat <= 4; repeat += 1) {
  const modes: NeighborSearchMode[] = repeat % 2 === 0 ? ['grid', 'brute-force'] : ['brute-force', 'grid'];
  for (const mode of modes) {
    const result = measure(mode, repeat);
    measurements.push(result);
    console.log(`${mode} ${repeat}/4 | mean ${result.meanStepMs.toFixed(3)} ms | p95 ${result.p95StepMs.toFixed(3)} ms`);
  }
}

const summaries = (['grid', 'brute-force'] as const).map((mode) => {
  const runs = measurements.filter((measurement) => measurement.mode === mode);
  const means = runs.map((run) => run.meanStepMs).sort((a, b) => a - b);
  return {
    mode,
    repeats: runs.length,
    medianMeanStepMs: percentile(means, 0.5),
    minimumMeanStepMs: means[0],
    maximumMeanStepMs: means[means.length - 1],
    averageCandidates: runs.reduce((sum, run) => sum + run.averageCandidates, 0) / runs.length,
  };
});
const grid = summaries.find((summary) => summary.mode === 'grid')!;
const brute = summaries.find((summary) => summary.mode === 'brute-force')!;
const report = {
  scenario: 'Obstacle Navigation',
  seed: '0x0b57ac1e',
  fishCount: 500,
  warmupSteps: '180 scenario steps + 40 search-specific steps',
  measuredStepsPerRun: 120,
  repeatsPerMode: 4,
  rendering: 'none',
  measurements,
  summaries,
  bruteForceMedianMeanDividedByGrid: brute.medianMeanStepMs / grid.medianMeanStepMs,
  note: 'CPU fixed-step measurements in this sandbox. Not FPS, not GPU time, and not a guarantee for other densities or machines.',
};
const output = fileURLToPath(new URL('../test-artifacts/observatory/', import.meta.url));
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/cpu-benchmark.json`, JSON.stringify(report, null, 2));
const rows = summaries.map((summary) => `| ${summary.mode} | ${summary.repeats} | ${summary.medianMeanStepMs.toFixed(3)} | ${summary.minimumMeanStepMs.toFixed(3)}–${summary.maximumMeanStepMs.toFixed(3)} | ${summary.averageCandidates.toFixed(0)} |`).join('\n');
writeFileSync(`${output}/cpu-benchmark.md`, `# Observatory CPU benchmark\n\n500 fish, Obstacle Navigation seed 0x0b57ac1e, no rendering. Four repeats per search mode, 120 measured steps per run after warm-up.\n\n| Search | Repeats | Median of mean step (ms) | Range of mean step (ms) | Candidate checks / step |\n| --- | ---: | ---: | ---: | ---: |\n${rows}\n\nBrute-force median mean / grid median mean: **${report.bruteForceMedianMeanDividedByGrid.toFixed(3)}×**. Values above 1 favor grid; values below 1 favor brute force. These are sandbox CPU measurements, not display FPS or GPU timings.\n`);
console.log(JSON.stringify({ summaries, ratio: report.bruteForceMedianMeanDividedByGrid, output }, null, 2));
