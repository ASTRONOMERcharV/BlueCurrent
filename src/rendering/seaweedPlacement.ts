import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import { createRandom, floorHeightAt } from './rockPlacement';

/**
 * Deterministic layout for the detail seaweed clump.
 *
 * This is a hero/decor tier, not mass vegetation: six instances at most, three
 * on the camera-facing side of reef cores and three in open sand. The source
 * clump is 1.2 m tall, so instances scale to roughly 2.1-2.5 m world height.
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
}

const NEAR_REEF = 3;
const OPEN_SAND = 3;
const SCATTER_RADIUS = 15;
const CAMERA_HINT = { x: 28, z: 31 };

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

export function generateSeaweedLayout(
  obstacles: readonly ObstacleDefinition[],
  seed = 0x5ea5eed,
): SeaweedPlacement[] {
  const random = createRandom(seed);
  const placements: SeaweedPlacement[] = [];
  const reefFootprints: Footprint[] = obstacles.map((obstacle) => ({
    x: obstacle.center[0],
    z: obstacle.center[2],
    radius: obstacle.radius,
  }));
  const plantFootprints: Footprint[] = [];

  const push = (x: number, z: number, scaleMin: number, scaleMax: number): void => {
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
    });
    plantFootprints.push({ x, z, radius: 0.55 * scale });
  };

  // Three reef-side clumps on the camera-facing side of the first three cores.
  obstacles.slice(0, NEAR_REEF).forEach((obstacle) => {
    const cameraAngle = Math.atan2(
      CAMERA_HINT.z - obstacle.center[2],
      CAMERA_HINT.x - obstacle.center[0],
    );
    const angle = cameraAngle + (random() - 0.5) * 0.9;
    const radius = obstacle.radius * (1.35 + random() * 0.35);
    const x = obstacle.center[0] + Math.cos(angle) * radius;
    const z = obstacle.center[2] + Math.sin(angle) * radius;
    if (tooClose(x, z, plantFootprints, 1.2)) return;
    push(x, z, 1.75, 2.05);
  });

  // Open-sand accents, rejecting reef cores and already placed clumps.
  let placed = 0;
  for (let attempt = 0; attempt < OPEN_SAND * 80 && placed < OPEN_SAND; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 6 + random() * (SCATTER_RADIUS - 6);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (tooClose(x, z, reefFootprints, 1.5)) continue;
    if (tooClose(x, z, plantFootprints, 1.2)) continue;
    push(x, z, 1.7, 2.0);
    placed += 1;
  }

  return placements;
}
