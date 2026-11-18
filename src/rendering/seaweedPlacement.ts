import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import { createRandom, floorHeightAt } from './rockPlacement';

/**
 * Deterministic layout for the detail seaweed clump.
 *
 * Hero/decor tier only: six cluster sites (three on the camera-facing side of
 * the first three reef cores, three in open sand) with 2-3 clumps each. The
 * clusters give the foreground readable grouping without turning seaweed into
 * mass vegetation. The source clump is ~1.2 m tall, so instances scale to
 * roughly 2.0-2.5 m world height.
 */

export interface SeaweedPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Degrees. */
  readonly yaw: number;
  readonly tiltX: number;
  readonly tiltZ: number;
  readonly scale: number;
  /** Radians in [0, 2pi]. */
  readonly phase: number;
  /** Multiplier around 1.0. */
  readonly frequency: number;
  /** Multiplier around 1.0. */
  readonly amplitude: number;
  /** Palette index, resolved to a near-white tint by the renderer. */
  readonly tint: number;
  /** Cluster site index in [0, 6). */
  readonly cluster: number;
}

const NEAR_REEF = 3;
const OPEN_SAND = 3;
const CLUSTER_SIZES = [3, 2, 3, 2, 2, 2] as const;
const SCATTER_RADIUS = 15;
const CAMERA_HINT = { x: 28, z: 31 };
const PLANT_SPACING = 0.7;
const CLUSTER_SPACING = 2.5;
const REEF_FOOTPRINT_FACTOR = 1.33;
const CORRIDOR_HALF_WIDTH = 7;
const CORRIDOR_Z_LIMIT = 16;

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

function insideReef(
  x: number,
  z: number,
  obstacles: readonly ObstacleDefinition[],
): boolean {
  for (const obstacle of obstacles) {
    if (Math.hypot(x - obstacle.center[0], z - obstacle.center[2])
      < obstacle.radius * REEF_FOOTPRINT_FACTOR) return true;
  }
  return false;
}

function insideSwimCorridor(x: number, z: number): boolean {
  return Math.abs(x) < CORRIDOR_HALF_WIDTH && z < CORRIDOR_Z_LIMIT;
}

export function generateSeaweedLayout(
  obstacles: readonly ObstacleDefinition[],
  seed = 0x5ea5eed,
): SeaweedPlacement[] {
  const random = createRandom(seed);
  const placements: SeaweedPlacement[] = [];
  const plantFootprints: Footprint[] = [];
  const clusterCenters: Footprint[] = [];

  const push = (
    x: number,
    z: number,
    cluster: number,
    scaleMin: number,
    scaleMax: number,
  ): void => {
    const scale = scaleMin + random() * (scaleMax - scaleMin);
    placements.push({
      x,
      y: floorHeightAt(x, z) - 0.04,
      z,
      yaw: random() * Math.PI * 2,
      tiltX: (random() - 0.5) * 0.05,
      tiltZ: (random() - 0.5) * 0.05,
      scale,
      phase: random() * Math.PI * 2,
      frequency: 0.85 + random() * 0.3,
      amplitude: 0.85 + random() * 0.3,
      tint: Math.floor(random() * 3),
      cluster,
    });
    plantFootprints.push({ x, z, radius: 0 });
  };

  const addClusterPlants = (
    center: { readonly x: number; readonly z: number },
    cluster: number,
    scaleMin: number,
    scaleMax: number,
    respectCorridor: boolean,
  ): void => {
    const size = CLUSTER_SIZES[cluster];
    for (let plant = 0; plant < size; plant += 1) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const angle = random() * Math.PI * 2;
        const distance = plant === 0 ? random() * 0.6 : 0.8 + random() * 1.4;
        const x = center.x + Math.cos(angle) * distance;
        const z = center.z + Math.sin(angle) * distance;
        if (respectCorridor && insideSwimCorridor(x, z)) continue;
        if (insideReef(x, z, obstacles)) continue;
        if (tooClose(x, z, plantFootprints, PLANT_SPACING)) continue;
        push(x, z, cluster, scaleMin, scaleMax);
        break;
      }
    }
  };

  // Three reef-side clusters on the camera-facing side of the first cores.
  obstacles.slice(0, NEAR_REEF).forEach((obstacle, cluster) => {
    const cameraAngle = Math.atan2(
      CAMERA_HINT.z - obstacle.center[2],
      CAMERA_HINT.x - obstacle.center[0],
    );
    const angle = cameraAngle + (random() - 0.5) * 0.9;
    const radius = obstacle.radius * (1.35 + random() * 0.35);
    const center = {
      x: obstacle.center[0] + Math.cos(angle) * radius,
      z: obstacle.center[2] + Math.sin(angle) * radius,
    };
    clusterCenters.push({ ...center, radius: 0 });
    // Reef-anchored clusters intentionally sit on the camera-facing side of
    // their core, matching the accepted D2 framing; only random open-sand
    // scatter must stay out of the central observation lane.
    addClusterPlants(center, cluster, 1.75, 2.05, false);  });

  // Three open-sand clusters, rejecting reef cores, the corridor and each other.
  let placed = 0;
  for (let attempt = 0; attempt < OPEN_SAND * 80 && placed < OPEN_SAND; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 6 + random() * (SCATTER_RADIUS - 6);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (insideSwimCorridor(x, z)) continue;
    if (insideReef(x, z, obstacles)) continue;
    if (tooClose(x, z, clusterCenters, CLUSTER_SPACING)) continue;
    const cluster = NEAR_REEF + placed;
    clusterCenters.push({ x, z, radius: 0 });
    addClusterPlants({ x, z }, cluster, 1.7, 2.0, true);
    placed += 1;
  }

  return placements;
}
