import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import { createRandom, floorHeightAt } from './rockPlacement';

/**
 * Deterministic temperate kelp-forest composition.
 *
 * Kelp is grouped into left/right groves instead of being sprinkled uniformly
 * over the seabed. The central swimming corridor is kept free of midwater
 * crowns, while foreground, midground and background bands create depth.
 */

export const KELP_NAMES = ['kelp_a', 'kelp_b'] as const;
export type KelpName = (typeof KELP_NAMES)[number];
export type KelpBand = 'foreground' | 'midground' | 'background';
export type KelpSide = 'left' | 'right';

/** GLB crown radii before instance scaling. */
export const KELP_CANOPY_RADIUS: Record<KelpName, number> = {
  kelp_a: 1.29315,
  kelp_b: 0.96785,
};

export const CENTRAL_CORRIDOR_HALF_WIDTH = 7;

export interface KelpPlacement {
  readonly name: KelpName;
  readonly band: KelpBand;
  readonly side: KelpSide;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Degrees; a random yaw rotates the rest-pose lean direction. */
  readonly yaw: number;
  readonly tiltX: number;
  readonly tiltZ: number;
  readonly scale: number;
  /** Radians, in [0, 2pi]. */
  readonly phase: number;
  /** Multiplier around 1.0. */
  readonly frequency: number;
  /** Multiplier around 1.0. */
  readonly amplitude: number;
  /** Palette index, resolved to a colour by the renderer. */
  readonly tint: number;
}

interface Grove {
  readonly band: KelpBand;
  readonly side: KelpSide;
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly clusters: number;
  readonly clusterRadius: number;
  readonly count: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
  readonly kelpAShare: number;
}

const GROVES: readonly Grove[] = [
  {
    band: 'foreground', side: 'left', xMin: -20.0, xMax: -11.8, zMin: 16.0, zMax: 24.5,
    clusters: 4, clusterRadius: 2.1, count: 13, scaleMin: 1.2, scaleMax: 2.1, kelpAShare: 0.68,
  },
  {
    band: 'midground', side: 'left', xMin: -20.5, xMax: -11.8, zMin: -1, zMax: 15,
    clusters: 5, clusterRadius: 2.15, count: 24, scaleMin: 0.95, scaleMax: 1.75, kelpAShare: 0.58,
  },
  {
    band: 'background', side: 'left', xMin: -20, xMax: -12.2, zMin: -25, zMax: -10,
    clusters: 3, clusterRadius: 2.3, count: 9, scaleMin: 0.82, scaleMax: 1.35, kelpAShare: 0.5,
  },
  {
    band: 'foreground', side: 'right', xMin: 12.4, xMax: 19, zMin: 16.5, zMax: 24,
    clusters: 4, clusterRadius: 2.05, count: 13, scaleMin: 1.15, scaleMax: 2.05, kelpAShare: 0.62,
  },
  {
    band: 'midground', side: 'right', xMin: 12.2, xMax: 19, zMin: -1, zMax: 13,
    clusters: 5, clusterRadius: 2.1, count: 23, scaleMin: 0.9, scaleMax: 1.7, kelpAShare: 0.55,
  },
  {
    band: 'background', side: 'right', xMin: 12.2, xMax: 20, zMin: -24, zMax: -9,
    clusters: 3, clusterRadius: 2.2, count: 9, scaleMin: 0.8, scaleMax: 1.3, kelpAShare: 0.45,
  },
] as const;

interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

function tooClose(x: number, z: number, footprints: readonly Footprint[], spacing: number): boolean {
  for (const footprint of footprints) {
    if (Math.hypot(x - footprint.x, z - footprint.z) < footprint.radius + spacing) return true;
  }
  return false;
}

function crownReachesCorridor(x: number, name: KelpName, scale: number): boolean {
  // Include the authored sway envelope so a calm plant cannot visually intrude
  // on the open corridor even when its holdfast is outside it.
  const swayEnvelope = 0.38 * 1.18 * scale;
  const edge = Math.abs(x) - KELP_CANOPY_RADIUS[name] * scale - swayEnvelope;
  return edge < CENTRAL_CORRIDOR_HALF_WIDTH;
}

/**
 * @param obstacles simulation obstacles; holdfasts stay outside their visual cores.
 * @param seed layout seed; changing it reshuffles only the decoration.
 */
export function generateKelpLayout(
  obstacles: readonly ObstacleDefinition[],
  seed = 0x6b656c70,
): KelpPlacement[] {
  const random = createRandom(seed);
  const placements: KelpPlacement[] = [];
  const plantFootprints: Footprint[] = [];
  const reefFootprints: Footprint[] = obstacles.map((obstacle) => ({
    x: obstacle.center[0],
    z: obstacle.center[2],
    radius: Math.max(obstacle.radius * 1.15, obstacle.radius + 0.35),
  }));

  for (const grove of GROVES) {
    const centers: { x: number; z: number }[] = [];
    for (let index = 0; index < grove.clusters; index += 1) {
      let center = {
        x: grove.xMin + random() * (grove.xMax - grove.xMin),
        z: grove.zMin + random() * (grove.zMax - grove.zMin),
      };
      // Large reef colliders can swallow a whole cluster; keep the cluster
      // centres in the open part of the grove so the authored count is met.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const candidate = {
          x: grove.xMin + random() * (grove.xMax - grove.xMin),
          z: grove.zMin + random() * (grove.zMax - grove.zMin),
        };
        if (!tooClose(candidate.x, candidate.z, reefFootprints, 0.4)) {
          center = candidate;
          break;
        }
      }
      centers.push(center);
    }

    let placed = 0;
    // Smaller colony scales change the rejection sequence; keep enough attempts
    // to reach the authored 91-plant composition instead of silently thinning it.
    for (let attempt = 0; attempt < grove.count * 1200 && placed < grove.count; attempt += 1) {
      const cluster = centers[attempt % centers.length];
      const angle = random() * Math.PI * 2;
      const radial = Math.sqrt(random()) * grove.clusterRadius;
      const x = cluster.x + Math.cos(angle) * radial;
      const z = cluster.z + Math.sin(angle) * radial;
      if (x < grove.xMin || x > grove.xMax || z < grove.zMin || z > grove.zMax) continue;
      if (tooClose(x, z, reefFootprints, 0)) continue;

      const name: KelpName = random() < grove.kelpAShare ? 'kelp_a' : 'kelp_b';
      const scale = grove.scaleMin + random() * (grove.scaleMax - grove.scaleMin);
      if (crownReachesCorridor(x, name, scale)) continue;
      const baseRadius = 0.48 * scale;
      if (tooClose(x, z, plantFootprints, 0.55)) continue;

      placements.push({
        name,
        band: grove.band,
        side: grove.side,
        x,
        y: floorHeightAt(x, z) - 0.05,
        z,
        yaw: random() * Math.PI * 2,
        tiltX: (random() - 0.5) * 0.08,
        tiltZ: (random() - 0.5) * 0.08,
        scale,
        phase: random() * Math.PI * 2,
        frequency: 0.82 + random() * 0.36,
        amplitude: 0.82 + random() * 0.36,
        tint: Math.floor(random() * 3),
      });
      plantFootprints.push({ x, z, radius: baseRadius });
      placed += 1;
    }
  }

  return placements;
}
