import type { BufferGeometry } from 'three';
import { createRandom } from './rockPlacement';

/**
 * Deterministic epibiont (reef-life) placement on the hero reef surface.
 *
 * Rules mirrored from the design brief:
 * - colonies prefer up-facing, moderately exposed surface;
 * - deep cavities and the sand contact band are left bare;
 * - colonies arrive in clusters of 3-6 with bare rock between clusters;
 * - only a minority of clusters use tall branching/fan colonies;
 * - most of the visible bedrock stays uncovered.
 *
 * The module is pure math so vitest can verify the contract without WebGL or
 * loading GLBs.
 */

export interface ReefTriangle {
  readonly ax: number; readonly ay: number; readonly az: number;
  readonly bx: number; readonly by: number; readonly bz: number;
  readonly cx: number; readonly cy: number; readonly cz: number;
  /** Face normal, normalised. */
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly area: number;
  readonly gx: number; readonly gy: number; readonly gz: number;
}

export interface EpibiontSpecies {
  readonly name: string;
  /** Authored height in metres; used only by callers for validation. */
  readonly height: number;
  /** 0 = flat crust, 1 = upright colony. */
  readonly upright: number;
  readonly minScale: number;
  readonly maxScale: number;
}

/** Five Blender coral species reused at epibiont scale. */
export const EPIBIONT_SPECIES: readonly EpibiontSpecies[] = [
  { name: 'coral_brain', height: 0.65, upright: 0.25, minScale: 0.28, maxScale: 0.50 },
  { name: 'coral_table', height: 0.55, upright: 0.35, minScale: 0.28, maxScale: 0.48 },
  { name: 'coral_branching', height: 1.30, upright: 0.90, minScale: 0.24, maxScale: 0.50 },
  { name: 'coral_fan', height: 1.15, upright: 0.75, minScale: 0.26, maxScale: 0.52 },
  { name: 'sponge_tube', height: 1.05, upright: 0.85, minScale: 0.22, maxScale: 0.38 },
];

export interface EpibiontPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Surface normal the colony grows from. */
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly scale: number;
  readonly yaw: number;
  readonly species: number;
  readonly cluster: number;
}

export interface EpibiontCluster {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly species: number;
  readonly count: number;
}

export interface EpibiontPlan {
  readonly placements: readonly EpibiontPlacement[];
  readonly clusters: readonly EpibiontCluster[];
  /** Rough fraction of the eligible up-facing area under colony footprints. */
  readonly coverage: number;
  readonly eligibleArea: number;
}

export interface EpibiontPlanOptions {
  readonly clusterCount?: number;
  readonly minClusterSpacing?: number;
  readonly perClusterMin?: number;
  readonly perClusterMax?: number;
  readonly minUpness?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly clusterRadius?: number;
  readonly minColonySpacing?: number;
  /** Extra small encrusting colonies spread outside the main clusters. */
  readonly encrustingCount?: number;
  /** Small sponges/crusts on steeper side faces, lower than the top clusters. */
  readonly sideCount?: number;
  /**
   * Reef-local colony size multiplier. Scales every placement without changing
   * counts, species, or the seeded random sequence; coverage follows area.
   */
  readonly decorationScale?: number;
}

const DEFAULTS: Required<EpibiontPlanOptions> = {
  clusterCount: 7,
  minClusterSpacing: 1.05,
  perClusterMin: 6,
  perClusterMax: 8,
  minUpness: 0.22,
  minHeight: 0.70,
  maxHeight: Number.POSITIVE_INFINITY,
  clusterRadius: 0.58,
  minColonySpacing: 0.14,
  encrustingCount: 24,
  sideCount: 10,
  decorationScale: 1,
};

/** Extract face centroids, normals and areas from the near-LOD geometry. */
export function extractReefTriangles(geometry: BufferGeometry): ReefTriangle[] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triangles: ReefTriangle[] = [];
  const count = index ? index.count : position.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    const ax = position.getX(ia); const ay = position.getY(ia); const az = position.getZ(ia);
    const bx = position.getX(ib); const by = position.getY(ib); const bz = position.getZ(ib);
    const cx = position.getX(ic); const cy = position.getY(ic); const cz = position.getZ(ic);
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-8) continue;
    triangles.push({
      ax, ay, az, bx, by, bz, cx, cy, cz,
      nx: nx / length, ny: ny / length, nz: nz / length,
      area: length * 0.5,
      gx: (ax + bx + cx) / 3,
      gy: (ay + by + cy) / 3,
      gz: (az + bz + cz) / 3,
    });
  }
  return triangles;
}

function triangleWeight(triangle: ReefTriangle, minUpness: number): number {
  if (triangle.ny < minUpness) return 0;
  const upness = triangle.ny;
  return triangle.area * (0.35 + 0.65 * upness * upness);
}

function pickWeighted(
  candidates: readonly { triangle: ReefTriangle; weight: number }[],
  random: () => number,
): ReefTriangle | null {
  let total = 0;
  for (const candidate of candidates) total += candidate.weight;
  if (total <= 0) return null;
  let threshold = random() * total;
  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold <= 0) return candidate.triangle;
  }
  return candidates[candidates.length - 1]?.triangle ?? null;
}

export function planEpibionts(
  triangles: readonly ReefTriangle[],
  seed = 0xe9b10c1d,
  options: EpibiontPlanOptions = {},
): EpibiontPlan {
  const config = { ...DEFAULTS, ...options };
  const random = createRandom(seed);
  const weighted = triangles
    .filter((triangle) => triangle.gy >= config.minHeight && triangle.gy <= config.maxHeight)
    .map((triangle) => ({ triangle, weight: triangleWeight(triangle, config.minUpness) }))
    .filter((candidate) => candidate.weight > 0);

  const eligibleArea = weighted.reduce((total, candidate) => total + candidate.triangle.area, 0);
  if (weighted.length === 0) {
    return { placements: [], clusters: [], coverage: 0, eligibleArea: 0 };
  }

  const clusterCenters: ReefTriangle[] = [];
  const maxClusterAttempts = config.clusterCount * 60;
  for (let attempt = 0; attempt < maxClusterAttempts && clusterCenters.length < config.clusterCount; attempt += 1) {
    const triangle = pickWeighted(weighted, random);
    if (!triangle) break;
    const tooClose = clusterCenters.some((center) => {
      const dx = center.gx - triangle.gx;
      const dz = center.gz - triangle.gz;
      const dy = center.gy - triangle.gy;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < config.minClusterSpacing;
    });
    if (tooClose) continue;
    clusterCenters.push(triangle);
  }

  // Species mix: two tall clusters (branching/fan), the rest encrusting.
  // Every cluster is one species, which reads as a real patch instead of a
  // resampled miniature of the show reef.
  const clusterSpecies: number[] = clusterCenters.map((_, index) => {
    if (index < 2) return index === 0 ? 2 : 3;
    const encrusting = [0, 1, 0, 1, 4];
    return encrusting[(index - 2) % encrusting.length];
  });

  const placements: EpibiontPlacement[] = [];
  const clusters: EpibiontCluster[] = [];

  for (let clusterIndex = 0; clusterIndex < clusterCenters.length; clusterIndex += 1) {
    const center = clusterCenters[clusterIndex];
    const speciesIndex = clusterSpecies[clusterIndex];
    const species = EPIBIONT_SPECIES[speciesIndex];
    const around = weighted.filter((candidate) => {
      const triangle = candidate.triangle;
      const dx = triangle.gx - center.gx;
      const dy = triangle.gy - center.gy;
      const dz = triangle.gz - center.gz;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > config.clusterRadius) return false;
      if (triangle.ny < config.minUpness * 0.55) return false;
      return true;
    });
    if (around.length === 0) continue;
    const targetCount = config.perClusterMin
      + Math.floor(random() * (config.perClusterMax - config.perClusterMin + 1));
    let placed = 0;
    for (let attempt = 0; attempt < targetCount * 8 && placed < targetCount; attempt += 1) {
      const triangle = pickWeighted(around, random);
      if (!triangle) break;
      const spacing = config.minColonySpacing * (0.7 + random() * 0.6);
      const tooClose = placements.some((placement) => {
        const dx = placement.x - (triangle.gx + triangle.nx * -0.02);
        const dy = placement.y - (triangle.gy + triangle.ny * -0.02);
        const dz = placement.z - (triangle.gz + triangle.nz * -0.02);
        return Math.sqrt(dx * dx + dy * dy + dz * dz) < spacing;
      });
      if (tooClose) continue;
      const scale = (species.minScale + random() * (species.maxScale - species.minScale))
        * config.decorationScale;
      placements.push({
        x: triangle.gx + triangle.nx * -0.02,
        y: triangle.gy + triangle.ny * -0.02,
        z: triangle.gz + triangle.nz * -0.02,
        nx: triangle.nx,
        ny: triangle.ny,
        nz: triangle.nz,
        scale,
        yaw: random() * Math.PI * 2,
        species: speciesIndex,
        cluster: clusterIndex,
      });
      placed += 1;
    }
    clusters.push({
      x: center.gx,
      y: center.gy,
      z: center.gz,
      species: speciesIndex,
      count: placed,
    });
  }

  // Low third layer: small encrusting brain/table colonies spread over the
  // upper surface outside the main clusters. These give mid-distance detail
  // without turning every patch into a tall colony.
  const encrustingSpecies = [0, 1];
  for (let index = 0; index < config.encrustingCount; index += 1) {
    const triangle = pickWeighted(weighted, random);
    if (!triangle) continue;
    const speciesIndex = encrustingSpecies[index % encrustingSpecies.length];
    const tooClose = placements.some((placement) => {
      const dx = placement.x - triangle.gx;
      const dy = placement.y - triangle.gy;
      const dz = placement.z - triangle.gz;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < config.minColonySpacing * 1.4;
    });
    if (tooClose) continue;
    placements.push({
      x: triangle.gx + triangle.nx * -0.015,
      y: triangle.gy + triangle.ny * -0.015,
      z: triangle.gz + triangle.nz * -0.015,
      nx: triangle.nx,
      ny: triangle.ny,
      nz: triangle.nz,
      scale: (0.20 + random() * 0.16) * config.decorationScale,
      yaw: random() * Math.PI * 2,
      species: speciesIndex,
      cluster: -1,
    });
  }

  // Low side layer: small flattened colonies on steep faces. They read as
  // encrusting sponges/algae at eye level instead of leaving the walls bare.
  const sideCandidates = triangles
    .filter((triangle) => triangle.gy >= config.minHeight)
    .map((triangle) => {
      if (triangle.ny < -0.05 || triangle.ny > 0.45) {
        return { triangle, weight: 0 };
      }
      const steepness = Math.min(1, Math.abs(triangle.ny) / 0.45);
      return { triangle, weight: triangle.area * (0.35 + 0.65 * (1 - steepness)) };
    })
    .filter((candidate) => candidate.weight > 0);
  const sideSpecies = [0, 1];
  for (let index = 0; index < config.sideCount; index += 1) {
    const triangle = pickWeighted(sideCandidates, random);
    if (!triangle) continue;
    const speciesIndex = sideSpecies[index % sideSpecies.length];
    const tooClose = placements.some((placement) => {
      const dx = placement.x - triangle.gx;
      const dy = placement.y - triangle.gy;
      const dz = placement.z - triangle.gz;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < config.minColonySpacing * 1.1;
    });
    if (tooClose) continue;
    placements.push({
      x: triangle.gx + triangle.nx * -0.012,
      y: triangle.gy + triangle.ny * -0.012,
      z: triangle.gz + triangle.nz * -0.012,
      nx: triangle.nx,
      ny: triangle.ny,
      nz: triangle.nz,
      scale: (0.18 + random() * 0.14) * config.decorationScale,
      yaw: random() * Math.PI * 2,
      species: speciesIndex,
      cluster: -2,
    });
  }

  // Footprint estimate: each colony is approximated by an ellipse with radius
  // 0.42 * scale across and 0.42 * scale * (0.6 + upright) along the surface.
  let footprint = 0;
  for (const placement of placements) {
    const species = EPIBIONT_SPECIES[placement.species];
    const radius = 0.42 * placement.scale;
    footprint += Math.PI * radius * radius * (0.55 + 0.65 * species.upright);
  }
  const coverage = eligibleArea > 0 ? Math.min(1, footprint / eligibleArea) : 0;

  return { placements, clusters, coverage, eligibleArea };
}

/** Convenience used by tests and the preview: total placement count per species. */
export function countBySpecies(plan: EpibiontPlan): number[] {
  const counts = EPIBIONT_SPECIES.map(() => 0);
  for (const placement of plan.placements) counts[placement.species] += 1;
  return counts;
}
