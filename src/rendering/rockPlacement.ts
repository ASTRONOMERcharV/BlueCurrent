import type { ObstacleDefinition } from '../simulation/ObstacleSystem';

/**
 * Deterministic rock / debris / dune scatter for the Blue Current reef floor.
 *
 * The layout is pure data: the renderer maps each placement onto an InstancedMesh
 * per asset type. Positions use the same floor height function as Environment's
 * procedurally displaced plane, and every random value comes from a seeded PRNG
 * so the scene looks identical across reloads.
 */

export const FLOOR_BASE_Y = -0.25;

export function floorHeightAt(x: number, z: number): number {
  return FLOOR_BASE_Y
    + Math.sin(x * 0.42) * Math.cos(z * 0.35) * 0.17
    + Math.sin(x * 0.13 + 1.1) * Math.cos(z * 0.18 - 0.6) * 0.23
    + Math.sin((x + z) * 0.085 + 0.4) * 0.16;
}

export type RockKind = 'large' | 'medium' | 'debris' | 'dune';

export const ROCK_NAMES = [
  'reef_large_a',
  'reef_large_b',
  'reef_large_c',
  'reef_medium_a',
  'reef_medium_b',
  'reef_medium_c',
  'reef_medium_d',
  'reef_debris_a',
  'reef_debris_b',
  'reef_debris_c',
  'reef_debris_d',
  'seabed_dune_a',
  'seabed_dune_b',
] as const;

export type RockName = (typeof ROCK_NAMES)[number];

export interface RockDimensions {
  /** Blender/glTF height with the base on y = 0. */
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly kind: RockKind;
  /** Longest horizontal footprint radius, used for overlap tests. */
  readonly footprint: number;
}

export const ROCK_DIMENSIONS: Record<RockName, RockDimensions> = {
  reef_large_a: { height: 1.0405, width: 1.5178, depth: 1.2701, kind: 'large', footprint: 0.76 },
  reef_large_b: { height: 1.2786, width: 1.1281, depth: 0.9844, kind: 'large', footprint: 0.56 },
  reef_large_c: { height: 0.7115, width: 1.7911, depth: 1.2196, kind: 'large', footprint: 0.90 },
  reef_medium_a: { height: 0.6201, width: 0.7369, depth: 0.7933, kind: 'medium', footprint: 0.40 },
  reef_medium_b: { height: 0.38, width: 1.3422, depth: 1.0194, kind: 'medium', footprint: 0.67 },
  reef_medium_c: { height: 0.6531, width: 1.8556, depth: 1.3501, kind: 'medium', footprint: 0.93 },
  reef_medium_d: { height: 1.0771, width: 0.8381, depth: 0.8018, kind: 'medium', footprint: 0.42 },
  reef_debris_a: { height: 0.341, width: 0.425, depth: 0.3697, kind: 'debris', footprint: 0.21 },
  reef_debris_b: { height: 0.1993, width: 0.4979, depth: 0.3706, kind: 'debris', footprint: 0.25 },
  reef_debris_c: { height: 0.1398, width: 0.5277, depth: 0.3533, kind: 'debris', footprint: 0.26 },
  reef_debris_d: { height: 0.2598, width: 0.3409, depth: 0.2882, kind: 'debris', footprint: 0.17 },
  seabed_dune_a: { height: 0.5645, width: 7.0005, depth: 2.8233, kind: 'dune', footprint: 3.50 },
  seabed_dune_b: { height: 0.4888, width: 6.2001, depth: 5.2003, kind: 'dune', footprint: 3.10 },
};

export const LARGE_ASSET_ORDER: readonly RockName[] = [
  'reef_large_a',
  'reef_large_b',
  'reef_large_c',
];

export const MEDIUM_ASSET_ORDER: readonly RockName[] = [
  'reef_medium_a',
  'reef_medium_b',
  'reef_medium_c',
  'reef_medium_d',
];

export const DEBRIS_ASSET_ORDER: readonly RockName[] = [
  'reef_debris_a',
  'reef_debris_b',
  'reef_debris_c',
  'reef_debris_d',
];

export const DUNE_ASSET_ORDER: readonly RockName[] = ['seabed_dune_a', 'seabed_dune_b'];

export interface RockPlacement {
  readonly name: RockName;
  readonly kind: RockKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Degrees; full yaw variation hides the shared atlas orientation. */
  readonly yaw: number;
  readonly tiltX: number;
  readonly tiltZ: number;
  readonly scale: number;
  /** Palette index, resolved to a colour by the renderer. */
  readonly tint: number;
  /** For the five large anchors: the simulation obstacle they replace. */
  readonly anchorIndex?: number;
}

export interface RockLayout {
  readonly large: readonly RockPlacement[];
  readonly medium: readonly RockPlacement[];
  readonly debris: readonly RockPlacement[];
  readonly dunes: readonly RockPlacement[];
}

/** Small deterministic PRNG (mulberry32). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const SCATTER_RADIUS = 25;
const DUNE_RADIUS = 27;
const OPEN_CORRIDOR_HALF_WIDTH = 7;
const FOREGROUND_Z = 16;

function inCentralSwimCorridor(x: number, z: number): boolean {
  return Math.abs(x) < OPEN_CORRIDOR_HALF_WIDTH && z < FOREGROUND_Z;
}

interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

function insideFootprints(x: number, z: number, footprints: readonly Footprint[], padding = 0): boolean {
  for (const footprint of footprints) {
    const dx = x - footprint.x;
    const dz = z - footprint.z;
    if (Math.hypot(dx, dz) < footprint.radius + padding) return true;
  }
  return false;
}

/**
 * Build the full deterministic layout.
 *
 * @param obstacles simulation obstacles; the five large reef rocks are anchored
 *   to them so the visual and collision volumes stay aligned.
 * @param seed layout seed; changing it reshuffles only the decoration.
 */
export function generateRockLayout(
  obstacles: readonly ObstacleDefinition[],
  seed = 0x9e3779b9,
): RockLayout {
  const random = createRandom(seed);

  const large: RockPlacement[] = obstacles.map((obstacle, index) => {
    const name = LARGE_ASSET_ORDER[index % LARGE_ASSET_ORDER.length];
    const dimensions = ROCK_DIMENSIONS[name];
    const [x, , z] = obstacle.center;
    const scale = obstacle.radius * 1.4;
    return {
      name,
      kind: 'large',
      x,
      y: floorHeightAt(x, z) - dimensions.height * scale * 0.08,
      z,
      yaw: random() * 360,
      tiltX: (random() - 0.5) * 4,
      tiltZ: (random() - 0.5) * 4,
      scale,
      tint: index % 3,
      anchorIndex: index,
    };
  });

  const obstaclesWithRadius = obstacles.map((obstacle) => ({
    x: obstacle.center[0],
    z: obstacle.center[2],
    radius: obstacle.radius,
  }));

  // Dunes first: medium rocks and debris must not pierce the sand banks.
  const dunes: RockPlacement[] = [];
  const duneAssignments: RockName[] = [
    'seabed_dune_a',
    'seabed_dune_b',
    'seabed_dune_a',
    'seabed_dune_b',
    'seabed_dune_a',
  ];
  const duneFootprints: Footprint[] = [];
  for (const name of duneAssignments) {
    const dimensions = ROCK_DIMENSIONS[name];
    let placed = false;
    for (let attempt = 0; attempt < 60 && !placed; attempt += 1) {
      const x = (random() * 2 - 1) * DUNE_RADIUS;
      const z = (random() * 2 - 1) * DUNE_RADIUS;
      const scale = 0.8 + random() * 0.45;
      if (insideFootprints(x, z, obstaclesWithRadius, 4.5)) continue;
      if (insideFootprints(x, z, duneFootprints, 2.2)) continue;
      dunes.push({
        name,
        kind: 'dune',
        x,
        y: floorHeightAt(x, z) - dimensions.height * scale * 0.30,
        z,
        yaw: random() * 360,
        tiltX: (random() - 0.5) * 2,
        tiltZ: (random() - 0.5) * 2,
        scale,
        tint: random() < 0.5 ? 0 : 1,
      });
      duneFootprints.push({ x, z, radius: dimensions.footprint * scale });
      placed = true;
    }
  }

  const medium: RockPlacement[] = [];
  const mediumFootprints: Footprint[] = [];
  for (let index = 0; index < 16; index += 1) {
    const name = MEDIUM_ASSET_ORDER[Math.floor(random() * MEDIUM_ASSET_ORDER.length)];
    const dimensions = ROCK_DIMENSIONS[name];
    let placed = false;
    for (let attempt = 0; attempt < 80 && !placed; attempt += 1) {
      const x = (random() * 2 - 1) * SCATTER_RADIUS;
      const z = (random() * 2 - 1) * SCATTER_RADIUS;
      const scale = 0.85 + random() * 0.65;
      if (inCentralSwimCorridor(x, z)) continue;
      if (insideFootprints(x, z, obstaclesWithRadius, 1.4)) continue;
      if (insideFootprints(x, z, duneFootprints, 1.0)) continue;
      if (insideFootprints(x, z, mediumFootprints, 1.8)) continue;
      medium.push({
        name,
        kind: 'medium',
        x,
        y: floorHeightAt(x, z) - dimensions.height * scale * 0.18,
        z,
        yaw: random() * 360,
        tiltX: (random() - 0.5) * 8,
        tiltZ: (random() - 0.5) * 8,
        scale,
        tint: Math.floor(random() * 3),
      });
      mediumFootprints.push({ x, z, radius: dimensions.footprint * scale });
      placed = true;
    }
  }

  const debris: RockPlacement[] = [];
  const debrisFootprints: Footprint[] = [];

  // A ring of debris around every reef reads as eroded rock at the base.
  obstacles.forEach((obstacle, obstacleIndex) => {
    for (let index = 0; index < 3; index += 1) {
      const name = DEBRIS_ASSET_ORDER[(obstacleIndex + index) % DEBRIS_ASSET_ORDER.length];
      const dimensions = ROCK_DIMENSIONS[name];
      const angle = random() * Math.PI * 2;
      const radius = obstacle.radius * (1.05 + random() * 0.45);
      const x = obstacle.center[0] + Math.cos(angle) * radius;
      const z = obstacle.center[2] + Math.sin(angle) * radius;
      const scale = 0.85 + random() * 0.8;
      debris.push({
        name,
        kind: 'debris',
        x,
        y: floorHeightAt(x, z) - dimensions.height * scale * 0.22,
        z,
        yaw: random() * 360,
        tiltX: (random() - 0.5) * 16,
        tiltZ: (random() - 0.5) * 16,
        scale,
        tint: Math.floor(random() * 3),
      });
      debrisFootprints.push({ x, z, radius: dimensions.footprint * scale });
    }
  });

  for (let index = 0; index < 18; index += 1) {
    const name = DEBRIS_ASSET_ORDER[Math.floor(random() * DEBRIS_ASSET_ORDER.length)];
    const dimensions = ROCK_DIMENSIONS[name];
    let placed = false;
    for (let attempt = 0; attempt < 60 && !placed; attempt += 1) {
      const x = (random() * 2 - 1) * SCATTER_RADIUS;
      const z = (random() * 2 - 1) * SCATTER_RADIUS;
      const scale = 0.7 + random() * 1.0;
      if (inCentralSwimCorridor(x, z)) continue;
      if (insideFootprints(x, z, obstaclesWithRadius, 0.35)) continue;
      if (insideFootprints(x, z, duneFootprints, 0.35)) continue;
      if (insideFootprints(x, z, debrisFootprints, 0.45)) continue;
      debris.push({
        name,
        kind: 'debris',
        x,
        y: floorHeightAt(x, z) - dimensions.height * scale * 0.24,
        z,
        yaw: random() * 360,
        tiltX: (random() - 0.5) * 20,
        tiltZ: (random() - 0.5) * 20,
        scale,
        tint: Math.floor(random() * 3),
      });
      debrisFootprints.push({ x, z, radius: dimensions.footprint * scale });
      placed = true;
    }
  }

  // The pale foreground dune in the observation-side sand patch should act as
  // a scale cue, not compete with the hero reef. Scale only after the seeded
  // rejection pass so every other placement and random draw stays identical.
  const composedDunes = dunes.map((placement) => {
    const observationForeground = placement.z > 15 && placement.x > -12 && placement.x < 2;
    return observationForeground
      ? { ...placement, scale: placement.scale * 0.68 }
      : placement;
  });

  return { large, medium, debris, dunes: composedDunes };
}

export function allPlacements(layout: RockLayout): RockPlacement[] {
  return [...layout.large, ...layout.medium, ...layout.debris, ...layout.dunes];
}
