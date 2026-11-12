import { createDefaultConfig } from './SimulationConfig';
import type { SimulationConfig } from './SimulationConfig';
import type { SimulationWorld } from './SimulationWorld';

export type ScenarioId = 'calm' | 'encounter' | 'obstacles';

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly seed: number;
  readonly warmupSteps: number;
  readonly releasePredator: boolean;
  readonly config: Partial<SimulationConfig>;
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'calm',
    name: 'Calm Ecosystem',
    shortName: 'Calm',
    description: 'Undisturbed schooling driven only by local neighbor rules and reef avoidance.',
    seed: 0x0ca17a11,
    warmupSteps: 120,
    releasePredator: false,
    config: {
      initialFishCount: 500,
      predatorEnabled: false,
      obstaclesEnabled: true,
      separationWeight: 2.4,
      alignmentWeight: 0.9,
      cohesionWeight: 0.32,
      maxSpeed: 6,
    },
  },
  {
    id: 'encounter',
    name: 'Predator Encounter',
    shortName: 'Encounter',
    description: 'A nearby predator triggers pursuit, escape, school splitting and recovery.',
    seed: 0x9e71c0de,
    warmupSteps: 150,
    releasePredator: true,
    config: {
      initialFishCount: 500,
      predatorEnabled: false,
      predatorAggression: 1,
      evasionWeight: 2.4,
      obstaclesEnabled: true,
    },
  },
  {
    id: 'obstacles',
    name: 'Obstacle Navigation',
    shortName: 'Navigation',
    description: 'The coordinated school crosses the reef field without predator pressure.',
    seed: 0x0b57ac1e,
    warmupSteps: 180,
    releasePredator: false,
    config: {
      initialFishCount: 500,
      predatorEnabled: false,
      obstaclesEnabled: true,
      obstacleWeight: 2.4,
      obstacleLookAhead: 0.65,
      cohesionWeight: 0.42,
      maxSpeed: 5.2,
    },
  },
] as const;

export function getScenario(id: ScenarioId): ScenarioDefinition {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown ecosystem scenario: ${id}`);
  return scenario;
}

/**
 * Restore a known behavioral baseline, reset once from the scenario seed, then
 * optionally release the predator. Structural construction-time settings and
 * the bounds arrays retain their original identity for the spatial grids.
 */
export function applyScenario(
  world: SimulationWorld,
  id: ScenarioId,
  overrides: Partial<SimulationConfig> = {},
): ScenarioDefinition {
  const scenario = getScenario(id);
  const defaults = createDefaultConfig();
  const { bounds, maxFishCount, fixedDelta, maxSubSteps, obstacleShapeMode } = world.config;
  Object.assign(world.config, defaults, scenario.config, overrides, {
    bounds,
    maxFishCount,
    fixedDelta,
    maxSubSteps,
    // The collider mode is an explicit experiment setting; a scenario reset
    // must not silently fall back to spheres or vice versa.
    obstacleShapeMode,
    seed: scenario.seed,
  });
  world.setSearchMode('grid');
  world.reset();
  for (let step = 0; step < scenario.warmupSteps; step += 1) world.step();
  if (scenario.releasePredator) world.releasePredator();
  return scenario;
}
