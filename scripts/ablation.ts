import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { DEFAULT_CONFIG } from '../src/simulation/SimulationConfig';

interface RuleConfiguration {
  id: string;
  label: string;
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
}

interface MetricSample {
  step: number;
  radiusOfGyration: number;
  polarization: number;
  averageNeighbors: number;
  schoolCount: number;
  largestSchool: number;
  largestFraction: number;
  meanSpeed: number;
}

interface RunSummary {
  radiusOfGyration: number;
  polarization: number;
  averageNeighbors: number;
  schoolCount: number;
  maxSchoolCount: number;
  largestFraction: number;
  meanLargestSchool: number;
  meanSpeed: number;
}

interface RunResult {
  seed: number;
  configuration: RuleConfiguration;
  samples: MetricSample[];
  summary: RunSummary;
}

const configurations: RuleConfiguration[] = [
  { id: 'separation-only', label: 'Separation only', separationWeight: 2.4, alignmentWeight: 0, cohesionWeight: 0 },
  { id: 'separation-alignment', label: 'Separation + alignment', separationWeight: 2.4, alignmentWeight: 0.9, cohesionWeight: 0 },
  { id: 'full-boids', label: 'All three rules', separationWeight: 2.4, alignmentWeight: 0.9, cohesionWeight: 0.32 },
];

const args = process.argv.slice(2);
const seedArgument = args.find((argument) => argument.startsWith('--seeds='));
const seeds = seedArgument
  ? seedArgument.slice('--seeds='.length).split(',').map(Number)
  : [DEFAULT_CONFIG.seed, DEFAULT_CONFIG.seed + 1, DEFAULT_CONFIG.seed + 2];
const warmupSteps = 300;
const measurementSteps = 600;
const sampleInterval = 30;

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function measureSpeed(world: SimulationWorld): number {
  const { velocities, alive, count } = world.flock;
  let total = 0;
  let live = 0;
  for (let i = 0; i < count; i += 1) {
    if (alive[i] === 0) continue;
    const offset = i * 3;
    total += Math.hypot(velocities[offset], velocities[offset + 1], velocities[offset + 2]);
    live += 1;
  }
  return live > 0 ? total / live : 0;
}

function run(configuration: RuleConfiguration, seed: number): RunResult {
  const world = new SimulationWorld();
  world.config.predatorEnabled = false;
  world.config.seed = seed;
  world.config.separationWeight = configuration.separationWeight;
  world.config.alignmentWeight = configuration.alignmentWeight;
  world.config.cohesionWeight = configuration.cohesionWeight;
  world.setFishCount(500);

  const samples: MetricSample[] = [];
  const totalSteps = warmupSteps + measurementSteps;
  for (let step = 1; step <= totalSteps; step += 1) {
    world.step();
    if (step > warmupSteps && step % sampleInterval === 0) {
      samples.push({
        step,
        radiusOfGyration: world.metrics.radiusOfGyration,
        polarization: world.metrics.polarization,
        averageNeighbors: world.metrics.averageNeighbors,
        schoolCount: world.metrics.schoolCount,
        largestSchool: world.metrics.largestSchool,
        largestFraction: world.metrics.fishCount > 0 ? world.metrics.largestSchool / world.metrics.fishCount : 0,
        meanSpeed: measureSpeed(world),
      });
    }
  }

  const summary = {
    radiusOfGyration: average(samples.map((sample) => sample.radiusOfGyration)),
    polarization: average(samples.map((sample) => sample.polarization)),
    averageNeighbors: average(samples.map((sample) => sample.averageNeighbors)),
    schoolCount: average(samples.map((sample) => sample.schoolCount)),
    maxSchoolCount: Math.max(...samples.map((sample) => sample.schoolCount)),
    largestFraction: average(samples.map((sample) => sample.largestFraction)),
    meanLargestSchool: average(samples.map((sample) => sample.largestSchool)),
    meanSpeed: average(samples.map((sample) => sample.meanSpeed)),
  };
  return { seed, configuration, samples, summary };
}

const runs: RunResult[] = [];
for (const seed of seeds) {
  for (const configuration of configurations) {
    const result = run(configuration, seed);
    runs.push(result);
    console.log(
      `${configuration.label.padEnd(24)} seed ${seed} | Rg ${result.summary.radiusOfGyration.toFixed(2)} | ` +
      `polarization ${result.summary.polarization.toFixed(3)} | neighbors ${result.summary.averageNeighbors.toFixed(1)} | ` +
      `schools ${result.summary.schoolCount.toFixed(2)}`,
    );
  }
}

const aggregated = configurations.map((configuration) => {
  const matching = runs.filter((runResult) => runResult.configuration.id === configuration.id);
  return {
    configuration,
    seeds: seeds.length,
    meanRadiusOfGyration: average(matching.map((runResult) => runResult.summary.radiusOfGyration)),
    meanPolarization: average(matching.map((runResult) => runResult.summary.polarization)),
    meanAverageNeighbors: average(matching.map((runResult) => runResult.summary.averageNeighbors)),
    meanSchoolCount: average(matching.map((runResult) => runResult.summary.schoolCount)),
    meanMaxSchoolCount: average(matching.map((runResult) => runResult.summary.maxSchoolCount)),
    meanLargestFraction: average(matching.map((runResult) => runResult.summary.largestFraction)),
    meanSpeed: average(matching.map((runResult) => runResult.summary.meanSpeed)),
  };
});

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = `${projectRoot}benchmarks/`;
mkdirSync(outputDirectory, { recursive: true });
const environment = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  release: release(),
  cpu: cpus()[0]?.model ?? 'Unknown',
  logicalCores: cpus().length,
};
const methodology = {
  fishCount: 500,
  warmupSteps,
  measurementSteps,
  sampleInterval,
  seeds,
  searchMode: 'grid',
  predatorEnabled: false,
  fixedDeltaSeconds: DEFAULT_CONFIG.fixedDelta,
  simulationSecondsMeasured: measurementSteps * DEFAULT_CONFIG.fixedDelta,
  connectionRadius: DEFAULT_CONFIG.connectionRadius,
  notes: [
    'All configurations use the same seed, radii, speeds, environment and integration settings.',
    'Only the three behavior weights differ; no data are theoretical or inferred.',
    'Metrics are sampled every 30 fixed steps during the final 600 steps.',
  ],
};
writeFileSync(`${outputDirectory}ablation-results.json`, JSON.stringify({ environment, methodology, aggregated, runs }, null, 2));

const csvRows = [
  'configuration,seed,step,radius_of_gyration,polarization,average_neighbors,school_count,largest_school,largest_fraction,mean_speed',
];
const summaryRows = [
  'configuration,seeds,mean_radius_of_gyration,mean_polarization,mean_average_neighbors,mean_school_count,mean_max_school_count,mean_largest_fraction,mean_speed',
];
for (const runResult of runs) {
  for (const sample of runResult.samples) {
    csvRows.push([
      runResult.configuration.id, runResult.seed, sample.step,
      sample.radiusOfGyration.toFixed(6), sample.polarization.toFixed(6), sample.averageNeighbors.toFixed(3),
      sample.schoolCount, sample.largestSchool, sample.largestFraction.toFixed(6), sample.meanSpeed.toFixed(6),
    ].join(','));
  }
}
for (const row of aggregated) {
  summaryRows.push([
    row.configuration.id, row.seeds,
    row.meanRadiusOfGyration.toFixed(6), row.meanPolarization.toFixed(6), row.meanAverageNeighbors.toFixed(3),
    row.meanSchoolCount.toFixed(3), row.meanMaxSchoolCount.toFixed(3), row.meanLargestFraction.toFixed(6),
    row.meanSpeed.toFixed(6),
  ].join(','));
}
writeFileSync(`${outputDirectory}ablation-results.csv`, `${csvRows.join('\n')}\n`);
writeFileSync(`${outputDirectory}ablation-summary.csv`, `${summaryRows.join('\n')}\n`);

console.log('\nAggregated across seeds:');
console.table(aggregated.map((row) => ({
  configuration: row.configuration.id,
  seeds: row.seeds,
  'Rg (u)': row.meanRadiusOfGyration.toFixed(2),
  polarization: row.meanPolarization.toFixed(3),
  neighbors: row.meanAverageNeighbors.toFixed(1),
  schools: row.meanSchoolCount.toFixed(2),
  'largest fraction': row.meanLargestFraction.toFixed(3),
  'speed (u/s)': row.meanSpeed.toFixed(2),
})));
console.log('\nWrote benchmarks/ablation-results.json, ablation-results.csv and ablation-summary.csv');
