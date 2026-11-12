export type Vec3Tuple = [number, number, number];
export type NeighborSearchMode = 'grid' | 'brute-force';
/** Physical collider shape used by the fish/predator avoidance step. */
export type ObstacleShapeMode = 'sphere' | 'reefProxy';

export interface SimulationConfig {
  readonly bounds: { min: Vec3Tuple; max: Vec3Tuple };
  seed: number;
  initialFishCount: number;
  maxFishCount: number;
  fixedDelta: number;
  maxSubSteps: number;

  separationRadius: number;
  alignmentRadius: number;
  cohesionRadius: number;
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  /** Desired local neighbor count inside alignmentRadius before cohesion fades. */
  cohesionDensityTarget: number;
  /** Lower bound preserves a weak grouping tendency in crowded water. */
  cohesionDensityMinScale: number;
  fieldOfViewDegrees: number;
  minSpeed: number;
  maxSpeed: number;
  maxAcceleration: number;
  /** rad/s; limits abrupt slow-speed reversals without changing fast cruising turns. */
  maxTurnRate: number;

  evasionWeight: number;
  evasionRadius: number;
  /** Seconds of predicted predator approach added to the threat range. */
  evasionPredictionTime: number;
  /** Fraction of the escape force turned sideways for per-fish variation. */
  evasionLateralWeight: number;
  /** Fear inherited from alarmed neighbors each step, in [0, 1). */
  fearPropagation: number;
  /** Fraction of direct fear remaining when kelp fully blocks the sight line. */
  kelpFearMultiplier: number;
  /** Fractional maximum-speed loss at full kelp cover. */
  kelpCoverSpeedPenalty: number;
  /** Fractional acceleration loss at full kelp cover. */
  kelpCoverAccelerationPenalty: number;
  /** Weight of the fear-gated force that steers fish toward nearby kelp. */
  kelpShelterWeight: number;
  /** Direct fear needed before a fish will actively seek shelter. */
  kelpShelterFearThreshold: number;
  /** Metres in which a threatened fish can sense a kelp refuge. */
  kelpShelterRadius: number;
  /** Cover in [0, 1] counted as sheltered and used by several refuge rules. */
  kelpCoverThreshold: number;
  /** Inside this range the predator can still target prey through kelp. */
  kelpOcclusionMinDistance: number;
  predatorEnabled: boolean;
  predatorAggression: number;
  predatorDetectRadius: number;
  predatorLoseRadius: number;
  predatorAttackRadius: number;
  predatorCaptureRadius: number;
  predatorCruiseSpeed: number;
  predatorPursuitSpeed: number;
  predatorMaxAcceleration: number;

  obstaclesEnabled: boolean;
  /**
   * `sphere` keeps the original five-sphere collider. `reefProxy` swaps in the
   * compound SDF built from the loaded reef GLBs; margin is applied once outside
   * the SDF. The experiment default stays `sphere` so existing checksums and
   * every scenario keep their baseline behaviour until the mode is chosen
   * explicitly (?obstacleShape=reefProxy, Laboratory control, or API).
   */
  obstacleShapeMode: ObstacleShapeMode;
  obstacleWeight: number;
  obstacleMargin: number;
  obstacleLookAhead: number;
  boundaryWeight: number;
  boundaryMargin: number;
  /** Tangential share that turns the school along a boundary instead of stacking it there. */
  boundaryTangentialWeight: number;

  connectionRadius: number;

  /** Optional soft habitat anchor used by the reef-dwelling second school. */
  homeCenter?: Vec3Tuple;
  /** Metres; beyond this radius the home force starts to pull the school back. */
  homeRadius?: number;
  /** 0 disables the habitat force; 1 is a full-strength max-acceleration pull. */
  homeWeight?: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  bounds: { min: [-20, 1, -20], max: [20, 20, 20] },
  seed: 0x4bc1a2d3,
  initialFishCount: 500,
  maxFishCount: 2000,
  fixedDelta: 1 / 60,
  maxSubSteps: 8,

  separationRadius: 1.4,
  alignmentRadius: 4,
  cohesionRadius: 5,
  separationWeight: 2.4,
  alignmentWeight: 0.9,
  cohesionWeight: 0.32,
  cohesionDensityTarget: 24,
  cohesionDensityMinScale: 0.15,
  fieldOfViewDegrees: 360,
  minSpeed: 2,
  maxSpeed: 6,
  maxAcceleration: 14,
  maxTurnRate: 2,

  evasionWeight: 2.1,
  evasionRadius: 8,
  evasionPredictionTime: 0.3,
  evasionLateralWeight: 0.4,
  fearPropagation: 0.8,
  kelpFearMultiplier: 0.3,
  kelpCoverSpeedPenalty: 0.18,
  kelpCoverAccelerationPenalty: 0.12,
  kelpShelterWeight: 1.1,
  kelpShelterFearThreshold: 0.35,
  kelpShelterRadius: 10,
  kelpCoverThreshold: 0.4,
  kelpOcclusionMinDistance: 3,
  predatorEnabled: true,
  predatorAggression: 0.8,
  predatorDetectRadius: 13,
  predatorLoseRadius: 20,
  predatorAttackRadius: 1.65,
  predatorCaptureRadius: 0.95,
  predatorCruiseSpeed: 3.2,
  predatorPursuitSpeed: 7.4,
  predatorMaxAcceleration: 9,

  obstaclesEnabled: true,
  obstacleShapeMode: 'sphere',
  obstacleWeight: 2,
  obstacleMargin: 1.25,
  obstacleLookAhead: 0.55,
  boundaryWeight: 2.4,
  boundaryMargin: 5,
  boundaryTangentialWeight: 1,

  connectionRadius: 3.2,
};

export function createDefaultConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    bounds: {
      min: [...DEFAULT_CONFIG.bounds.min],
      max: [...DEFAULT_CONFIG.bounds.max],
    },
  };
}

/** Reef-dwelling clownfish school: smaller radii, slower cruise, soft home anchor. */
export const CLOWNFISH_SPAWN = {
  center: [0.0, 8.0, -4.5] as Vec3Tuple,
  radiusScale: 0.42,
};

export const DEFAULT_CLOWNFISH_COUNT = 100;
export const MAX_CLOWNFISH_COUNT = 400;

export function createClownfishConfig(): SimulationConfig {
  return {
    ...createDefaultConfig(),
    separationRadius: 0.55,
    alignmentRadius: 1.6,
    cohesionRadius: 2.2,
    separationWeight: 2.2,
    alignmentWeight: 1.0,
    cohesionWeight: 0.45,
    cohesionDensityTarget: 18,
    cohesionDensityMinScale: 0.18,
    minSpeed: 0.8,
    maxSpeed: 2.6,
    maxAcceleration: 8,
    maxTurnRate: 3.2,
    evasionWeight: 2.0,
    evasionRadius: 6,
    evasionPredictionTime: 0.25,
    evasionLateralWeight: 0.55,
    fearPropagation: 0.7,
    obstacleWeight: 2.2,
    obstacleMargin: 0.55,
    obstacleLookAhead: 0.45,
    boundaryWeight: 2.6,
    boundaryMargin: 1.2,
    boundaryTangentialWeight: 1.0,
    connectionRadius: 1.8,
    homeCenter: [...CLOWNFISH_SPAWN.center] as Vec3Tuple,
    homeRadius: 4.2,
    homeWeight: 0.55,
  };
}

export function maximumNeighborRadius(config: SimulationConfig): number {
  return Math.max(config.separationRadius, config.alignmentRadius, config.cohesionRadius);
}
