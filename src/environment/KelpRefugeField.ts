import { KELP_GEOMETRY_PROFILES } from './HabitatZoneSystem';

/**
 * Physical refuge volume for the temperate kelp forest.
 *
 * Kelp is not a rigid collider. Each plant is approximated as a vertical
 * cylinder anchored at its holdfast, with the radius taken from the authored
 * canopy and the height running from the seabed to the actual canopy top.
 * Queries use a horizontal spatial hash so a fish never scans all 91 plants.
 */

export type KelpRefugeName = 'kelp_a' | 'kelp_b';

export interface KelpRefugePlacement {
  readonly name: KelpRefugeName;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
}

export interface KelpRefugeCylinder {
  readonly name: KelpRefugeName;
  readonly x: number;
  readonly z: number;
  readonly baseY: number;
  readonly topY: number;
  readonly radius: number;
}

export interface KelpRefugeOptions {
  /** Fraction of the authored canopy radius treated as solid refuge volume. */
  readonly radiusScale?: number;
  /** Horizontal spatial-hash cell size in metres. */
  readonly cellSize?: number;
}

export const DEFAULT_KELP_REFUGE_RADIUS_SCALE = 0.8;
export const DEFAULT_KELP_REFUGE_CELL_SIZE = 2.5;

const COVER_FULL_RADIUS = 0.7;
const BOTTOM_FADE_MAX = 0.25;
const TOP_FADE_MAX = 0.45;
const CELL_KEY_OFFSET = 65536;
const CELL_KEY_STRIDE = 131072;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

/** Smooth normalized cover for one vertical kelp cylinder. */
export function kelpCoverAt(
  cylinder: KelpRefugeCylinder,
  x: number,
  y: number,
  z: number,
): number {
  if (y < cylinder.baseY || y > cylinder.topY) return 0;
  const offsetX = x - cylinder.x;
  const offsetZ = z - cylinder.z;
  const horizontalDistance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
  if (horizontalDistance >= cylinder.radius) return 0;
  const horizontal = horizontalDistance <= cylinder.radius * COVER_FULL_RADIUS
    ? 1
    : 1 - smoothstep(cylinder.radius * COVER_FULL_RADIUS, cylinder.radius, horizontalDistance);
  const height = cylinder.topY - cylinder.baseY;
  const bottomFade = Math.min(BOTTOM_FADE_MAX, height * 0.2);
  const topFade = Math.min(TOP_FADE_MAX, height * 0.3);
  const lower = smoothstep(cylinder.baseY, cylinder.baseY + bottomFade, y);
  const upper = 1 - smoothstep(cylinder.topY - topFade, cylinder.topY, y);
  return horizontal * lower * upper;
}

/** Exact segment/vertical-cylinder intersection test. */
export function segmentIntersectsKelpCylinder(
  cylinder: KelpRefugeCylinder,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const horizontalLengthSquared = dx * dx + dz * dz;
  const offsetX = x0 - cylinder.x;
  const offsetZ = z0 - cylinder.z;
  let t0 = 0;
  let t1 = 1;

  if (horizontalLengthSquared <= 1e-12) {
    if (offsetX * offsetX + offsetZ * offsetZ > cylinder.radius * cylinder.radius) return false;
  } else {
    const b = 2 * (offsetX * dx + offsetZ * dz);
    const c = offsetX * offsetX + offsetZ * offsetZ - cylinder.radius * cylinder.radius;
    const discriminant = b * b - 4 * horizontalLengthSquared * c;
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    const inverse = 1 / (2 * horizontalLengthSquared);
    t0 = (-b - root) * inverse;
    t1 = (-b + root) * inverse;
    if (t1 < 0 || t0 > 1) return false;
    t0 = Math.max(0, t0);
    t1 = Math.min(1, t1);
    if (t0 > t1) return false;
  }

  const segmentY0 = y0 + dy * t0;
  const segmentY1 = y0 + dy * t1;
  if (Math.max(segmentY0, segmentY1) < cylinder.baseY) return false;
  if (Math.min(segmentY0, segmentY1) > cylinder.topY) return false;
  return true;
}

/** Closest point on the closed cylinder volume; returns the distance. */
export function closestPointOnKelpCylinder(
  cylinder: KelpRefugeCylinder,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
): number {
  const offsetX = x - cylinder.x;
  const offsetZ = z - cylinder.z;
  const horizontalDistance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
  if (horizontalDistance > cylinder.radius) {
    const scale = cylinder.radius / horizontalDistance;
    out[0] = cylinder.x + offsetX * scale;
    out[2] = cylinder.z + offsetZ * scale;
  } else {
    out[0] = x;
    out[2] = z;
  }
  out[1] = clamp(y, cylinder.baseY, cylinder.topY);
  return Math.hypot(out[0] - x, out[1] - y, out[2] - z);
}

export class KelpRefugeField {
  readonly cylinders: readonly KelpRefugeCylinder[];
  readonly cellSize: number;
  readonly cellCount: number;
  readonly maxRadius: number;
  /** Lets the host disable the field when no kelp is rendered or loaded. */
  enabled = true;

  private readonly cells = new Map<number, number[]>();
  private readonly stamps: Uint32Array;
  private readonly closestPoint = new Float32Array(3);
  private readonly inverseCellSize: number;
  private stamp = 0;

  constructor(placements: readonly KelpRefugePlacement[], options: KelpRefugeOptions = {}) {
    const radiusScale = options.radiusScale ?? DEFAULT_KELP_REFUGE_RADIUS_SCALE;
    const cellSize = options.cellSize ?? DEFAULT_KELP_REFUGE_CELL_SIZE;
    assertFinite(radiusScale, 'radiusScale');
    if (radiusScale <= 0) throw new RangeError('radiusScale must be greater than zero');
    assertFinite(cellSize, 'cellSize');
    if (cellSize <= 0) throw new RangeError('cellSize must be greater than zero');
    this.cellSize = cellSize;
    this.inverseCellSize = 1 / cellSize;

    this.cylinders = placements.map((placement, index) => {
      assertFinite(placement.x, `placements[${index}].x`);
      assertFinite(placement.y, `placements[${index}].y`);
      assertFinite(placement.z, `placements[${index}].z`);
      assertFinite(placement.scale, `placements[${index}].scale`);
      if (placement.scale <= 0) {
        throw new RangeError(`placements[${index}].scale must be greater than zero`);
      }
      const profile = KELP_GEOMETRY_PROFILES[placement.name];
      if (!profile) throw new RangeError(`placements[${index}].name is not a known kelp asset`);
      return {
        name: placement.name,
        x: placement.x,
        z: placement.z,
        baseY: placement.y,
        topY: placement.y + profile.height * placement.scale,
        radius: profile.canopyRadius * placement.scale * radiusScale,
      };
    });
    this.stamps = new Uint32Array(this.cylinders.length);

    let maximumRadius = 0;
    this.cylinders.forEach((cylinder, index) => {
      maximumRadius = Math.max(maximumRadius, cylinder.radius);
      const minimumX = Math.floor((cylinder.x - cylinder.radius) * this.inverseCellSize);
      const maximumX = Math.floor((cylinder.x + cylinder.radius) * this.inverseCellSize);
      const minimumZ = Math.floor((cylinder.z - cylinder.radius) * this.inverseCellSize);
      const maximumZ = Math.floor((cylinder.z + cylinder.radius) * this.inverseCellSize);
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        for (let cellZ = minimumZ; cellZ <= maximumZ; cellZ += 1) {
          const key = this.cellKey(cellX, cellZ);
          const entries = this.cells.get(key);
          if (entries) entries.push(index);
          else this.cells.set(key, [index]);
        }
      }
    });
    this.maxRadius = maximumRadius;
    this.cellCount = this.cells.size;
  }

  /** Normalized coverage in [0, 1] at a world-space point. */
  coverAt(x: number, y: number, z: number): number {
    if (!this.enabled || this.cylinders.length === 0) return 0;
    assertFinite(x, 'x');
    assertFinite(y, 'y');
    assertFinite(z, 'z');
    const entries = this.cells.get(this.cellKey(
      Math.floor(x * this.inverseCellSize),
      Math.floor(z * this.inverseCellSize),
    ));
    if (!entries) return 0;

    let best = 0;
    for (const index of entries) {
      const cover = kelpCoverAt(this.cylinders[index], x, y, z);
      if (cover > best) best = cover;
    }
    return best;
  }

  /** True when the segment passes through any kelp cylinder. */
  blocksSegment(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): boolean {
    if (!this.enabled || this.cylinders.length === 0) return false;
    assertFinite(x0, 'x0');
    assertFinite(y0, 'y0');
    assertFinite(z0, 'z0');
    assertFinite(x1, 'x1');
    assertFinite(y1, 'y1');
    assertFinite(z1, 'z1');

    const stamp = this.nextStamp();
    const minimumX = Math.floor(Math.min(x0, x1) * this.inverseCellSize);
    const maximumX = Math.floor(Math.max(x0, x1) * this.inverseCellSize);
    const minimumZ = Math.floor(Math.min(z0, z1) * this.inverseCellSize);
    const maximumZ = Math.floor(Math.max(z0, z1) * this.inverseCellSize);

    for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
      for (let cellZ = minimumZ; cellZ <= maximumZ; cellZ += 1) {
        const entries = this.cells.get(this.cellKey(cellX, cellZ));
        if (!entries) continue;
        for (const index of entries) {
          if (!this.mark(index, stamp)) continue;
          if (segmentIntersectsKelpCylinder(this.cylinders[index], x0, y0, z0, x1, y1, z1)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Write a unit direction toward the closest point on the nearest kelp volume
   * and return normalized proximity in [0, 1]. Zero means no refuge is within
   * `maxDistance`.
   */
  nearestRefuge(
    x: number, y: number, z: number,
    maxDistance: number,
    out: Float32Array,
  ): number {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    if (!this.enabled || this.cylinders.length === 0 || maxDistance <= 0) return 0;
    assertFinite(x, 'x');
    assertFinite(y, 'y');
    assertFinite(z, 'z');
    assertFinite(maxDistance, 'maxDistance');

    // A cylinder whose axis lies outside the search radius can still reach into
    // it by its own radius, so widen the cell scan and filter by true distance.
    const searchDistance = maxDistance + this.maxRadius;
    const minimumX = Math.floor((x - searchDistance) * this.inverseCellSize);
    const maximumX = Math.floor((x + searchDistance) * this.inverseCellSize);
    const minimumZ = Math.floor((z - searchDistance) * this.inverseCellSize);
    const maximumZ = Math.floor((z + searchDistance) * this.inverseCellSize);
    const stamp = this.nextStamp();
    let bestDistanceSquared = maxDistance * maxDistance;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let found = false;

    for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
      for (let cellZ = minimumZ; cellZ <= maximumZ; cellZ += 1) {
        const entries = this.cells.get(this.cellKey(cellX, cellZ));
        if (!entries) continue;
        for (const index of entries) {
          if (!this.mark(index, stamp)) continue;
          const distance = closestPointOnKelpCylinder(
            this.cylinders[index], x, y, z, this.closestPoint,
          );
          const distanceSquared = distance * distance;
          if (distanceSquared >= bestDistanceSquared) continue;
          bestDistanceSquared = distanceSquared;
          bestX = this.closestPoint[0];
          bestY = this.closestPoint[1];
          bestZ = this.closestPoint[2];
          found = true;
        }
      }
    }

    if (!found) return 0;
    const distance = Math.sqrt(bestDistanceSquared);
    if (distance > 1e-6) {
      const inverse = 1 / distance;
      out[0] = (bestX - x) * inverse;
      out[1] = (bestY - y) * inverse;
      out[2] = (bestZ - z) * inverse;
    }
    return 1 - smoothstep(0, maxDistance, distance);
  }

  private cellKey(cellX: number, cellZ: number): number {
    return (cellX + CELL_KEY_OFFSET) * CELL_KEY_STRIDE + (cellZ + CELL_KEY_OFFSET);
  }

  private nextStamp(): number {
    this.stamp += 1;
    if (this.stamp >= 0xffffffff) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  private mark(index: number, stamp: number): boolean {
    if (this.stamps[index] === stamp) return false;
    this.stamps[index] = stamp;
    return true;
  }
}
