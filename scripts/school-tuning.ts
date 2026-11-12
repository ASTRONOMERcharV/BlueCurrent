import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyScenario } from '../src/simulation/Scenarios';
import { SimulationWorld } from '../src/simulation/SimulationWorld';
import type { SimulationConfig } from '../src/simulation/SimulationConfig';

interface Variant {
  readonly name: string;
  readonly config: Partial<SimulationConfig>;
}

interface Row {
  step: number;
  radiusOfGyration: number;
  polarization: number;
  averageNeighbors: number;
  averageSeparationNeighbors: number;
  averageAlignmentNeighbors: number;
  averageCohesionScale: number;
  schoolCount: number;
  axes: [number, number, number];
}

const variants: readonly Variant[] = [
  { name: 'tangent-0', config: { cohesionRadius: 5, cohesionDensityTarget: 24, maxTurnRate: 2, boundaryTangentialWeight: 0 } },
  { name: 'tangent-0.3', config: { cohesionRadius: 5, cohesionDensityTarget: 24, maxTurnRate: 2, boundaryTangentialWeight: 0.3 } },
  { name: 'tangent-0.6', config: { cohesionRadius: 5, cohesionDensityTarget: 24, maxTurnRate: 2, boundaryTangentialWeight: 0.6 } },
  { name: 'tangent-1.0', config: { cohesionRadius: 5, cohesionDensityTarget: 24, maxTurnRate: 2, boundaryTangentialWeight: 1 } },
  { name: 'tangent-1.5', config: { cohesionRadius: 5, cohesionDensityTarget: 24, maxTurnRate: 2, boundaryTangentialWeight: 1.5 } },
];

function measure(world: SimulationWorld): Row {
  const { positions, alive, count, aliveCount } = world.flock;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i += 1) {
    if (alive[i] === 0) continue;
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= aliveCount;
  cy /= aliveCount;
  cz /= aliveCount;
  let xx = 0;
  let yy = 0;
  let zz = 0;
  for (let i = 0; i < count; i += 1) {
    if (alive[i] === 0) continue;
    const offset = i * 3;
    xx += (positions[offset] - cx) ** 2;
    yy += (positions[offset + 1] - cy) ** 2;
    zz += (positions[offset + 2] - cz) ** 2;
  }
  return {
    step: world.metrics.totalSteps,
    radiusOfGyration: world.metrics.radiusOfGyration,
    polarization: world.metrics.polarization,
    averageNeighbors: world.metrics.averageNeighbors,
    averageSeparationNeighbors: world.boids.averageSeparationNeighbors,
    averageAlignmentNeighbors: world.boids.averageAlignmentNeighbors,
    averageCohesionScale: world.boids.averageCohesionScale,
    schoolCount: world.metrics.schoolCount,
    axes: [Math.sqrt(xx / aliveCount), Math.sqrt(yy / aliveCount), Math.sqrt(zz / aliveCount)],
  };
}

const results: Record<string, Row[]> = {};
for (const variant of variants) {
  const world = new SimulationWorld();
  applyScenario(world, 'obstacles', variant.config);
  const rows = [measure(world)];
  for (const steps of [240, 240, 240]) {
    for (let step = 0; step < steps; step += 1) world.step();
    rows.push(measure(world));
  }
  results[variant.name] = rows;
  console.log(variant.name, rows.map((row) => (
    `t${row.step}:Rg${row.radiusOfGyration.toFixed(1)}/N${row.averageNeighbors.toFixed(0)}/axis${row.axes.map((v) => v.toFixed(1)).join(':')}`
  )).join(' '));
}

const output = resolve('test-artifacts/visual-quality-v1/cohesion-sweep.json');
mkdirSync(resolve('test-artifacts/visual-quality-v1'), { recursive: true });
writeFileSync(output, `${JSON.stringify({ note: 'Obstacle Navigation, fixed seed, 500 fish, CPU only.', variants, results }, null, 2)}\n`);
console.log(`Wrote ${output}`);
