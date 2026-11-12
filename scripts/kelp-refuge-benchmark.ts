import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

/**
 * CPU-only A/B benchmark for the kelp refuge field.
 *
 * Both sides use the same fixed seed and start from the same warm-up state.
 * Kelp is enabled only for the measured interval, so the comparison includes
 * both the query cost and any school-shape change caused by cover drag.
 * This is not a GPU/FPS measurement.
 */

interface Row {
  fishCount: number;
  refuge: 'off' | 'on';
  repeat: number;
  meanCpuMs: number;
  meanStepMs: number;
  medianStepMs: number;
  p95StepMs: number;
  averageNeighbors: number;
  averageSheltered: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function measure(fishCount: number, refuge: boolean, repeat: number): Row {
  const world = new SimulationWorld();
  world.detailedMetricsEnabled = false;
  world.config.predatorEnabled = false;
  world.kelpRefuge.enabled = false;
  world.setFishCount(fishCount);
  for (let step = 0; step < 30; step += 1) world.step();

  world.kelpRefuge.enabled = refuge;
  const durations = new Float64Array(120);
  let sheltered = 0;
  const cpuBefore = process.cpuUsage();
  for (let step = 0; step < durations.length; step += 1) {
    const started = performance.now();
    world.step();
    durations[step] = performance.now() - started;
    sheltered += world.metrics.shelteredCount;
  }
  const cpu = process.cpuUsage(cpuBefore);
  const sorted = Array.from(durations).sort((a, b) => a - b);
  return {
    fishCount,
    refuge: refuge ? 'on' : 'off',
    repeat,
    // CPU time excludes time the process spent descheduled by other host load.
    meanCpuMs: ((cpu.user + cpu.system) / 1000) / durations.length,
    meanStepMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    medianStepMs: percentile(sorted, 0.5),
    p95StepMs: percentile(sorted, 0.95),
    averageNeighbors: world.metrics.averageNeighbors,
    averageSheltered: sheltered / durations.length,
  };
}

/** Isolate raw query cost from any emergent school-shape change. */
function queryMicrobenchmark(): {
  coverQueriesPerSecond: number;
  segmentQueriesPerSecond: number;
  coverQueriesPerCpuSecond: number;
  segmentQueriesPerCpuSecond: number;
} {
  const world = new SimulationWorld();
  world.setFishCount(2000);
  const field = world.kelpRefuge;
  const count = world.flock.count;
  const points = new Float32Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    points[index * 6] = world.flock.positions[offset];
    points[index * 6 + 1] = world.flock.positions[offset + 1];
    points[index * 6 + 2] = world.flock.positions[offset + 2];
    points[index * 6 + 3] = world.predator.position[0];
    points[index * 6 + 4] = world.predator.position[1];
    points[index * 6 + 5] = world.predator.position[2];
  }

  let coverTotal = 0;
  const coverCpuStart = process.cpuUsage();
  const coverStart = performance.now();
  for (let repeat = 0; repeat < 60; repeat += 1) {
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      coverTotal += field.coverAt(points[offset], points[offset + 1], points[offset + 2]);
    }
  }
  const coverCpu = process.cpuUsage(coverCpuStart);
  const coverMs = performance.now() - coverStart;

  let blocked = 0;
  const segmentCpuStart = process.cpuUsage();
  const segmentStart = performance.now();
  for (let repeat = 0; repeat < 60; repeat += 1) {
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      if (field.blocksSegment(
        points[offset + 3], points[offset + 4], points[offset + 5],
        points[offset], points[offset + 1], points[offset + 2],
      )) blocked += 1;
    }
  }
  const segmentCpu = process.cpuUsage(segmentCpuStart);
  const segmentMs = performance.now() - segmentStart;

  // Keep the accumulators observable so the benchmark cannot be optimized away.
  if (coverTotal === Number.NEGATIVE_INFINITY || blocked === -1) throw new Error('unreachable');
  return {
    coverQueriesPerSecond: (count * 60) / (coverMs / 1000),
    segmentQueriesPerSecond: (count * 60) / (segmentMs / 1000),
    coverQueriesPerCpuSecond: (count * 60) / ((coverCpu.user + coverCpu.system) / 1e6),
    segmentQueriesPerCpuSecond: (count * 60) / ((segmentCpu.user + segmentCpu.system) / 1e6),
  };
}

const rows: Row[] = [];
for (const fishCount of [500, 1000, 2000]) {
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    const order = repeat % 2 === 0 ? [true, false] : [false, true];
    for (const refuge of order) {
      const row = measure(fishCount, refuge, repeat);
      rows.push(row);
      console.log(
        `${fishCount} #${repeat} refuge=${row.refuge}: ` +
        `CPU ${row.meanCpuMs.toFixed(3)} ms, wall ${row.meanStepMs.toFixed(3)} ms, ` +
        `p95 ${row.p95StepMs.toFixed(3)} ms, ` +
        `neighbors ${row.averageNeighbors.toFixed(2)}, sheltered ${row.averageSheltered.toFixed(1)}`,
      );
    }
  }
}

const summaries = [500, 1000, 2000].map((fishCount) => {
  const runs = rows.filter((row) => row.fishCount === fishCount);
  const values = (refuge: 'off' | 'on', key: 'meanCpuMs' | 'p95StepMs'): number[] => (
    runs.filter((row) => row.refuge === refuge).map((row) => row[key]).sort((a, b) => a - b)
  );
  const median = (refuge: 'off' | 'on', key: 'meanCpuMs' | 'p95StepMs'): number => (
    percentile(values(refuge, key), 0.5)
  );
  const minimum = (refuge: 'off' | 'on'): number => Math.min(...values(refuge, 'meanCpuMs'));
  const off = median('off', 'meanCpuMs');
  const on = median('on', 'meanCpuMs');
  // Pair each repeat's off/on runs; the median ratio cancels the host's
  // frequency/load drift much better than comparing cross-run medians.
  const pairedRatios: number[] = [];
  for (let repeat = 1; repeat <= 3; repeat += 1) {
    const offRun = runs.find((row) => row.repeat === repeat && row.refuge === 'off');
    const onRun = runs.find((row) => row.repeat === repeat && row.refuge === 'on');
    if (offRun && onRun) pairedRatios.push(onRun.meanCpuMs / offRun.meanCpuMs);
  }
  const pairedMedian = percentile([...pairedRatios].sort((a, b) => a - b), 0.5);
  return {
    fishCount,
    medianCpuMsOff: off,
    medianCpuMsOn: on,
    deltaPercent: ((on / off) - 1) * 100,
    minimumCpuMsOff: minimum('off'),
    minimumCpuMsOn: minimum('on'),
    minimumDeltaPercent: ((minimum('on') / minimum('off')) - 1) * 100,
    pairedMedianRatio: pairedMedian,
    pairedMedianDeltaPercent: (pairedMedian - 1) * 100,
    pairedRatios,
    medianP95StepMsOff: median('off', 'p95StepMs'),
    medianP95StepMsOn: median('on', 'p95StepMs'),
  };
});

const queries = queryMicrobenchmark();
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const output = resolve(
  outputArgument?.slice('--output='.length)
  ?? 'test-artifacts/kelp-refuge/kelp-refuge-benchmark.json',
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  scenario: 'Default centered school, predator disabled, obstacle avoidance active',
  warmup: '30 fixed steps with refuge disabled on both sides',
  measuredStepsPerRun: 120,
  repeats: 3,
  rendering: 'none',
  primaryMetric: 'process.cpuUsage(user+system) per fixed step',
  note: 'Sandbox CPU fixed-step measurements only. CPU time excludes host descheduling but is not FPS, GPU time or a hardware guarantee.',
  rows,
  summaries,
  queries,
}, null, 2)}\n`);
console.log(JSON.stringify({ summaries, queries, output }, null, 2));
