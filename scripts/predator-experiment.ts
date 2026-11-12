import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { UniformGrid3D } from '../src/spatial/UniformGrid3D';
import type { FlockData } from '../src/simulation/FlockData';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { DEFAULT_CONFIG } from '../src/simulation/SimulationConfig';

interface Condition {
  id: string;
  label: string;
  predatorActive: boolean;
  detectsPrey: boolean;
  preyEvasion: boolean;
}

interface Sample {
  seed: number;
  condition: string;
  phase: 'settle' | 'threat' | 'recovery';
  step: number;
  phaseStep: number;
  radiusOfGyration: number;
  polarization: number;
  averageNeighbors: number;
  schoolCount3p2: number;
  largestFraction3p2: number;
  schoolCount2p0: number;
  largestFraction2p0: number;
  threatenedCount: number;
  captures: number;
  meanSpeed: number;
}

interface RunSummary {
  preRadius: number;
  prePolarization: number;
  preSchoolCount3p2: number;
  preSchoolCount2p0: number;
  threatRadius: number;
  threatPolarization: number;
  threatSchoolCount3p2: number;
  meanThreatLargestFraction3p2: number;
  maxThreatSchoolCount2p0: number;
  minThreatLargestFraction2p0: number;
  meanThreatenedCount: number;
  recoveryRadius: number;
  recoveryPolarization: number;
  recoverySchoolCount3p2: number;
  recoverySchoolCount2p0: number;
  recoveryLargestFraction2p0: number;
  captures: number;
  recoveryRadiusRatio: number;
}

interface ConditionRun {
  seed: number;
  condition: Condition;
  samples: Sample[];
  summary: RunSummary;
}

interface ClusterStats {
  count: number;
  largest: number;
}

const conditions: Condition[] = [
  { id: 'no-predator', label: 'No predator', predatorActive: false, detectsPrey: false, preyEvasion: false },
  { id: 'patrol-only', label: 'Patrol only', predatorActive: true, detectsPrey: false, preyEvasion: false },
  { id: 'pursuit-no-evasion', label: 'Pursuit, no evasion', predatorActive: true, detectsPrey: true, preyEvasion: false },
  { id: 'pursuit-with-evasion', label: 'Pursuit + evasion', predatorActive: true, detectsPrey: true, preyEvasion: true },
];

const settleSteps = 600;
const threatSteps = 600;
const recoverySteps = 1200;
const sampleInterval = 15;
const clusterRadiusWide = 3.2;
const clusterRadiusStrict = 2;
const args = process.argv.slice(2);
const mergeMode = args.includes('--merge');
const seedArgument = args.find((argument) => argument.startsWith('--seeds='));
const seeds = seedArgument
  ? seedArgument.slice('--seeds='.length).split(',').map(Number)
  : [DEFAULT_CONFIG.seed, DEFAULT_CONFIG.seed + 1, DEFAULT_CONFIG.seed + 2];

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function measureMeanSpeed(world: SimulationWorld): number {
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

function measureGeometry(world: SimulationWorld): { radiusOfGyration: number; polarization: number } {
  const { positions, velocities, alive, count, aliveCount } = world.flock;
  if (aliveCount === 0) return { radiusOfGyration: 0, polarization: 0 };
  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;
  let directionX = 0;
  let directionY = 0;
  let directionZ = 0;
  for (let i = 0; i < count; i += 1) {
    if (alive[i] === 0) continue;
    const offset = i * 3;
    centerX += positions[offset];
    centerY += positions[offset + 1];
    centerZ += positions[offset + 2];
    const speed = Math.hypot(velocities[offset], velocities[offset + 1], velocities[offset + 2]);
    if (speed > 1e-5) {
      directionX += velocities[offset] / speed;
      directionY += velocities[offset + 1] / speed;
      directionZ += velocities[offset + 2] / speed;
    }
  }
  centerX /= aliveCount;
  centerY /= aliveCount;
  centerZ /= aliveCount;
  let radiusSquaredSum = 0;
  for (let i = 0; i < count; i += 1) {
    if (alive[i] === 0) continue;
    const offset = i * 3;
    radiusSquaredSum +=
      (positions[offset] - centerX) ** 2 +
      (positions[offset + 1] - centerY) ** 2 +
      (positions[offset + 2] - centerZ) ** 2;
  }
  return {
    radiusOfGyration: Math.sqrt(radiusSquaredSum / aliveCount),
    polarization: Math.hypot(directionX, directionY, directionZ) / aliveCount,
  };
}

function measureClusters(
  flock: FlockData,
  grid: UniformGrid3D,
  neighbors: Int32Array,
  parents: Int32Array,
  componentSizes: Int32Array,
  radius: number,
): ClusterStats {
  const findRoot = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  grid.rebuild(flock, radius);
  for (let i = 0; i < flock.count; i += 1) {
    if (flock.alive[i] !== 0) parents[i] = i;
  }
  for (let i = 0; i < flock.count; i += 1) {
    if (flock.alive[i] === 0) continue;
    const found = grid.collect(i, radius, neighbors);
    for (let n = 0; n < found; n += 1) {
      if (neighbors[n] > i) union(i, neighbors[n]);
    }
  }
  componentSizes.fill(0);
  for (let i = 0; i < flock.count; i += 1) {
    if (flock.alive[i] !== 0) componentSizes[findRoot(i)] += 1;
  }
  let count = 0;
  let largest = 0;
  for (let i = 0; i < flock.count; i += 1) {
    if (flock.alive[i] === 0 || findRoot(i) !== i) continue;
    largest = Math.max(largest, componentSizes[i]);
    if (componentSizes[i] >= 5) count += 1;
  }
  return { count, largest };
}

function createWorld(condition: Condition, seed: number): SimulationWorld {
  const world = new SimulationWorld();
  world.config.seed = seed;
  world.config.predatorEnabled = false;
  world.config.predatorDetectRadius = condition.detectsPrey ? DEFAULT_CONFIG.predatorDetectRadius : 0.01;
  world.config.evasionRadius = condition.preyEvasion ? DEFAULT_CONFIG.evasionRadius : 0.01;
  world.config.evasionWeight = condition.preyEvasion ? DEFAULT_CONFIG.evasionWeight : 0;
  world.setFishCount(500);
  return world;
}

function runCondition(condition: Condition, seed: number): ConditionRun {
  const world = createWorld(condition, seed);
  const wideGrid = new UniformGrid3D(world.config, world.flock.capacity);
  const strictGrid = new UniformGrid3D(world.config, world.flock.capacity);
  const neighbors = new Int32Array(world.flock.capacity);
  const parents = new Int32Array(world.flock.capacity);
  const componentSizes = new Int32Array(world.flock.capacity);
  const samples: Sample[] = [];
  let absoluteStep = 0;

  const collect = (phase: Sample['phase'], phaseStep: number): Sample => {
    const geometry = measureGeometry(world);
    const wide = measureClusters(world.flock, wideGrid, neighbors, parents, componentSizes, clusterRadiusWide);
    const strict = measureClusters(world.flock, strictGrid, neighbors, parents, componentSizes, clusterRadiusStrict);
    const live = Math.max(1, world.metrics.fishCount);
    return {
      seed,
      condition: condition.id,
      phase,
      step: absoluteStep,
      phaseStep,
      radiusOfGyration: geometry.radiusOfGyration,
      polarization: geometry.polarization,
      averageNeighbors: world.metrics.averageNeighbors,
      schoolCount3p2: wide.count,
      largestFraction3p2: wide.largest / live,
      schoolCount2p0: strict.count,
      largestFraction2p0: strict.largest / live,
      threatenedCount: world.metrics.threatenedCount,
      captures: world.metrics.captures,
      meanSpeed: measureMeanSpeed(world),
    };
  };

  const advance = (phase: Sample['phase'], steps: number): void => {
    for (let phaseStep = 1; phaseStep <= steps; phaseStep += 1) {
      world.step();
      absoluteStep += 1;
      if (phaseStep % sampleInterval === 0) samples.push(collect(phase, phaseStep));
    }
  };

  advance('settle', settleSteps);
  const preSamples = samples.filter((sample) => sample.phase === 'settle').slice(-10);

  if (condition.predatorActive) {
    world.config.predatorEnabled = true;
    world.releasePredator();
  }
  advance('threat', threatSteps);
  const threatSamples = samples.filter((sample) => sample.phase === 'threat');

  if (condition.predatorActive) {
    world.regroupSchool();
    world.config.predatorEnabled = false;
  }
  advance('recovery', recoverySteps);
  const recoverySamples = samples.filter(
    (sample) => sample.phase === 'recovery' && sample.phaseStep > recoverySteps * 0.5,
  );

  const preRadius = average(preSamples.map((sample) => sample.radiusOfGyration));
  const recoveryRadius = average(recoverySamples.map((sample) => sample.radiusOfGyration));
  return {
    seed,
    condition,
    samples,
    summary: {
      preRadius,
      prePolarization: average(preSamples.map((sample) => sample.polarization)),
      preSchoolCount3p2: average(preSamples.map((sample) => sample.schoolCount3p2)),
      preSchoolCount2p0: average(preSamples.map((sample) => sample.schoolCount2p0)),
      threatRadius: average(threatSamples.map((sample) => sample.radiusOfGyration)),
      threatPolarization: average(threatSamples.map((sample) => sample.polarization)),
      threatSchoolCount3p2: average(threatSamples.map((sample) => sample.schoolCount3p2)),
      meanThreatLargestFraction3p2: average(threatSamples.map((sample) => sample.largestFraction3p2)),
      maxThreatSchoolCount2p0: Math.max(...threatSamples.map((sample) => sample.schoolCount2p0)),
      minThreatLargestFraction2p0: Math.min(...threatSamples.map((sample) => sample.largestFraction2p0)),
      meanThreatenedCount: average(threatSamples.map((sample) => sample.threatenedCount)),
      recoveryRadius,
      recoveryPolarization: average(recoverySamples.map((sample) => sample.polarization)),
      recoverySchoolCount3p2: average(recoverySamples.map((sample) => sample.schoolCount3p2)),
      recoverySchoolCount2p0: average(recoverySamples.map((sample) => sample.schoolCount2p0)),
      recoveryLargestFraction2p0: average(recoverySamples.map((sample) => sample.largestFraction2p0)),
      captures: world.metrics.captures,
      recoveryRadiusRatio: preRadius > 0 ? recoveryRadius / preRadius : 0,
    },
  };
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = `${projectRoot}benchmarks/`;
mkdirSync(outputDirectory, { recursive: true });

const methodology = {
  fishCount: 500,
  settleSteps,
  threatSteps,
  recoverySteps,
  sampleInterval,
  fixedDeltaSeconds: DEFAULT_CONFIG.fixedDelta,
  settleSeconds: settleSteps * DEFAULT_CONFIG.fixedDelta,
  threatSeconds: threatSteps * DEFAULT_CONFIG.fixedDelta,
  recoverySeconds: recoverySteps * DEFAULT_CONFIG.fixedDelta,
  searchMode: 'grid',
  predatorCount: 1,
  clusterThresholds: {
    wide: clusterRadiusWide,
    strict: clusterRadiusStrict,
    minimumComponentSize: 5,
  },
  sharedParameters: {
    separationWeight: DEFAULT_CONFIG.separationWeight,
    alignmentWeight: DEFAULT_CONFIG.alignmentWeight,
    cohesionWeight: DEFAULT_CONFIG.cohesionWeight,
    separationRadius: DEFAULT_CONFIG.separationRadius,
    alignmentRadius: DEFAULT_CONFIG.alignmentRadius,
    cohesionRadius: DEFAULT_CONFIG.cohesionRadius,
    maxSpeed: DEFAULT_CONFIG.maxSpeed,
  },
  conditionRules: conditions,
  notes: [
    'Each condition starts from the same seed and a 600-step predator-free settling phase.',
    'Patrol-only suppresses detection rather than scripting a movement path; the predator still runs its patrol state machine.',
    'Pursuit-no-evasion disables only the prey evasion radius and weight, leaving pursuit behavior unchanged.',
    'After the threat phase the predator is retreated and disabled to represent departure; recovery is measured in the final 600 steps.',
    'Samples are taken every 15 fixed steps (0.25 s) to reduce missed transient splits.',
    'Two connectivity thresholds are reported: 3.2 units (wide) and 2.0 units (strict). Components below five fish are ignored.',
    'Values are measured from running simulations; no value is inferred from another condition.',
  ],
};

function writeCsv(path: string, runs: ConditionRun[]): void {
  const rows = [
    'seed,condition,phase,step,phase_step,radius_of_gyration,polarization,average_neighbors,school_count_3p2,largest_fraction_3p2,school_count_2p0,largest_fraction_2p0,threatened_count,captures,mean_speed',
  ];
  for (const run of runs) {
    for (const sample of run.samples) {
      rows.push([
        sample.seed, sample.condition, sample.phase, sample.step, sample.phaseStep,
        sample.radiusOfGyration.toFixed(6), sample.polarization.toFixed(6), sample.averageNeighbors.toFixed(3),
        sample.schoolCount3p2, sample.largestFraction3p2.toFixed(6),
        sample.schoolCount2p0, sample.largestFraction2p0.toFixed(6),
        sample.threatenedCount, sample.captures, sample.meanSpeed.toFixed(6),
      ].join(','));
    }
  }
  writeFileSync(path, `${rows.join('\n')}\n`);
}

function summarize(runs: ConditionRun[]): object[] {
  return conditions.map((condition) => {
    const matching = runs.filter((run) => run.condition.id === condition.id);
    const mean = (selector: (run: ConditionRun) => number): number => average(matching.map(selector));
    return {
      condition,
      seeds: matching.length,
      preRadius: mean((run) => run.summary.preRadius),
      prePolarization: mean((run) => run.summary.prePolarization),
      preSchoolCount3p2: mean((run) => run.summary.preSchoolCount3p2),
      preSchoolCount2p0: mean((run) => run.summary.preSchoolCount2p0),
      threatRadius: mean((run) => run.summary.threatRadius),
      threatPolarization: mean((run) => run.summary.threatPolarization),
      threatSchoolCount3p2: mean((run) => run.summary.threatSchoolCount3p2),
      meanThreatLargestFraction3p2: mean((run) => run.summary.meanThreatLargestFraction3p2),
      maxThreatSchoolCount2p0: mean((run) => run.summary.maxThreatSchoolCount2p0),
      minThreatLargestFraction2p0: mean((run) => run.summary.minThreatLargestFraction2p0),
      meanThreatenedCount: mean((run) => run.summary.meanThreatenedCount),
      recoveryRadius: mean((run) => run.summary.recoveryRadius),
      recoveryPolarization: mean((run) => run.summary.recoveryPolarization),
      recoverySchoolCount3p2: mean((run) => run.summary.recoverySchoolCount3p2),
      recoverySchoolCount2p0: mean((run) => run.summary.recoverySchoolCount2p0),
      recoveryLargestFraction2p0: mean((run) => run.summary.recoveryLargestFraction2p0),
      captures: mean((run) => run.summary.captures),
      recoveryRadiusRatio: mean((run) => run.summary.recoveryRadiusRatio),
    };
  });
}

if (mergeMode) {
  const files = readdirSync(outputDirectory)
    .filter((name) => /^predator-results-seed-.+\.json$/.test(name))
    .sort();
  if (files.length === 0) throw new Error('No predator-results-seed-*.json files to merge.');
  const runs = files.flatMap((file) => {
    const payload = JSON.parse(readFileSync(`${outputDirectory}${file}`, 'utf8')) as { runs: ConditionRun[] };
    return payload.runs;
  });
  const aggregated = summarize(runs);
  const firstPayload = JSON.parse(readFileSync(`${outputDirectory}${files[0]}`, 'utf8')) as { environment: object };
  writeFileSync(`${outputDirectory}predator-results.json`, JSON.stringify({
    environment: firstPayload.environment,
    aggregatedAt: new Date().toISOString(),
    sourceFiles: files,
    methodology,
    aggregated,
    runs,
  }, null, 2));
  writeCsv(`${outputDirectory}predator-results.csv`, runs);
  console.log(`Merged ${files.length} seed files into benchmarks/predator-results.json and predator-results.csv`);
  console.table(aggregated);
} else {
  const runs: ConditionRun[] = [];
  const environment = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'Unknown',
    logicalCores: cpus().length,
  };
  for (const seed of seeds) {
    for (const condition of conditions) {
      const result = runCondition(condition, seed);
      runs.push(result);
      console.log(
        `${condition.label.padEnd(22)} seed ${seed} | pre Rg ${result.summary.preRadius.toFixed(2)} | ` +
        `threat max schools@2.0 ${result.summary.maxThreatSchoolCount2p0} | captures ${result.summary.captures} | ` +
        `recovery Rg ${result.summary.recoveryRadius.toFixed(2)}`,
      );
    }
  }
  writeFileSync(`${outputDirectory}predator-results-seed-${seeds.join('-')}.json`, JSON.stringify({ environment, methodology, runs }, null, 2));
  writeCsv(`${outputDirectory}predator-results-seed-${seeds.join('-')}.csv`, runs);
  console.log(`\nWrote per-seed results for ${seeds.length} seed(s). Run with --merge after all desired seeds.`);
}
