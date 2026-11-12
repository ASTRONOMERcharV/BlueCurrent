import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyScenario } from '../src/simulation/Scenarios';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

interface Row {
  fishCount: number;
  repeat: number;
  meanStepMs: number;
  medianStepMs: number;
  p95StepMs: number;
  averageCandidates: number;
  radiusOfGyration: number;
  averageNeighbors: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function measure(fishCount: number, repeat: number): Row {
  const world = new SimulationWorld();
  world.detailedMetricsEnabled = false;
  applyScenario(world, 'obstacles');
  // setFishCount is available in both the pre-change and current code; using it
  // after applyScenario keeps this benchmark an honest A/B comparison.
  world.setFishCount(fishCount);
  for (let step = 0; step < 30; step += 1) world.step();
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
    fishCount,
    repeat,
    meanStepMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    medianStepMs: percentile(sorted, 0.5),
    p95StepMs: percentile(sorted, 0.95),
    averageCandidates: candidates / durations.length,
    radiusOfGyration: world.metrics.radiusOfGyration,
    averageNeighbors: world.metrics.averageNeighbors,
  };
}

const rows: Row[] = [];
for (const fishCount of [500, 1000, 2000]) {
  for (let repeat = 1; repeat <= 2; repeat += 1) {
    const row = measure(fishCount, repeat);
    rows.push(row);
    console.log(
      `${fishCount} #${repeat}: mean ${row.meanStepMs.toFixed(3)} ms, ` +
      `p95 ${row.p95StepMs.toFixed(3)} ms, ${row.averageCandidates.toFixed(0)} candidates/step`,
    );
  }
}
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const output = resolve(outputArgument?.slice('--output='.length)
  ?? 'test-artifacts/visual-quality-v1/simulation-scaling.json');
const summaries = [500, 1000, 2000].map((fishCount) => {
  const runs = rows.filter((row) => row.fishCount === fishCount);
  return {
    fishCount,
    medianMeanStepMs: percentile(runs.map((row) => row.meanStepMs).sort((a, b) => a - b), 0.5),
    maximumP95StepMs: Math.max(...runs.map((row) => row.p95StepMs)),
    medianCandidates: percentile(runs.map((row) => row.averageCandidates).sort((a, b) => a - b), 0.5),
    medianAverageNeighbors: percentile(runs.map((row) => row.averageNeighbors).sort((a, b) => a - b), 0.5),
  };
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  scenario: 'Obstacle Navigation',
  seed: '0x0b57ac1e',
  warmup: 'scenario warm-up + 30 fixed steps',
  measuredStepsPerRun: 120,
  repeats: 2,
  rendering: 'none',
  note: 'Sandbox CPU fixed-step measurements only. Not FPS, GPU time or a hardware guarantee.',
  rows,
  summaries,
}, null, 2)}\n`);
console.log(`Wrote ${output}`);
