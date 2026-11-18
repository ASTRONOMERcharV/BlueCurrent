import { floorHeightAt } from '../rendering/rockPlacement';
import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import type { Vec3Tuple } from '../simulation/SimulationConfig';

/**
 * Phase E4 anemone habitat anchors.
 *
 * The full coral tier places one anemone at each reef base in CoralScatter with
 * the formula below. This module is the single owner of that formula so the
 * simulation's habitat anchor and the rendered instance cannot drift apart.
 * The anchors are read-only data; nothing here writes simulation state.
 */

export const ANEMONE_SPECIES_INDEX = 5;
/** Metres above the anemone base where the clownfish school hovers. */
export const ANEMONE_HOVER_HEIGHT = 5.5;

const REEF_ID_BY_INDEX = ['b', 'c', 'hero', 'd', 'e'] as const;

export interface AnemoneAnchor {
  readonly id: string;
  readonly reefIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Soft habitat center: above the tentacles, not on the seabed. */
  readonly hover: Vec3Tuple;
}

export function anemoneAnchorForReef(
  obstacle: Pick<ObstacleDefinition, 'center' | 'radius'>,
  reefIndex: number,
): AnemoneAnchor {
  const angle = reefIndex * 1.71 + ANEMONE_SPECIES_INDEX * 2.39996;
  const radial = obstacle.radius * (1.02 + (ANEMONE_SPECIES_INDEX % 2) * 0.15);
  const x = obstacle.center[0] + Math.cos(angle) * radial;
  const z = obstacle.center[2] + Math.sin(angle) * radial;
  const y = floorHeightAt(x, z) - 0.025;
  return {
    id: `anemone-${REEF_ID_BY_INDEX[reefIndex] ?? reefIndex}`,
    reefIndex,
    x,
    y,
    z,
    hover: [x, y + ANEMONE_HOVER_HEIGHT, z],
  };
}

export function anemoneAnchors(
  obstacles: readonly Pick<ObstacleDefinition, 'center' | 'radius'>[],
): AnemoneAnchor[] {
  return obstacles.map((obstacle, index) => anemoneAnchorForReef(obstacle, index));
}

export function nearestAnemoneAnchor(
  anchors: readonly AnemoneAnchor[],
  point: readonly [number, number, number],
): AnemoneAnchor | null {
  let nearest: AnemoneAnchor | null = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const dx = anchor.hover[0] - point[0];
    const dy = anchor.hover[1] - point[1];
    const dz = anchor.hover[2] - point[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = anchor;
    }
  }
  return nearest;
}
