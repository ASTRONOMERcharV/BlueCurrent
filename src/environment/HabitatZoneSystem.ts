import { DEFAULT_CONFIG } from '../simulation/SimulationConfig';
import type { FloorHeightFunction } from './OceanCurrentField';
import { floorHeightAt } from '../rendering/rockPlacement';

export type HabitatZone = 'benthic' | 'lower-midwater' | 'upper-midwater' | 'surface-canopy';
export type HabitatKelpName = 'kelp_a' | 'kelp_b';

export interface HabitatBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface KelpPlacementLike {
  readonly name: HabitatKelpName;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
}

export interface KelpAnchor {
  readonly name: HabitatKelpName;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Actual scaled crown height in metres. */
  readonly height: number;
  /** Actual scaled horizontal crown radius in metres. */
  readonly canopyRadius: number;
}

export interface ReefAnchor {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface KelpGeometryProfile {
  readonly height: number;
  readonly canopyRadius: number;
}

/** Dimensions are derived from the delivered GLB bounds, not holdfast spacing. */
export const KELP_GEOMETRY_PROFILES: Record<HabitatKelpName, KelpGeometryProfile> = {
  kelp_a: { height: 3.55, canopyRadius: 1.29315 },
  kelp_b: { height: 2.8, canopyRadius: 0.96785 },
};

export interface HabitatZoneWeights {
  benthic: number;
  lowerMidwater: number;
  upperMidwater: number;
  surfaceCanopy: number;
}

export interface HabitatSample {
  zone: HabitatZone;
  readonly weights: HabitatZoneWeights;
  floorY: number;
  heightAboveFloor: number;
  depth: number;
  lightIntensity: number;
  kelpDensity: number;
  reefProximity: number;
  canopyTopY: number;
  inBounds: boolean;
}

export interface HabitatZoneOptions {
  readonly kelp?: readonly KelpAnchor[];
  readonly reefs?: readonly ReefAnchor[];
  readonly bounds?: HabitatBounds;
  readonly floorAt?: FloorHeightFunction;
  /** Height above the local seabed, in metres. */
  readonly benthicTop?: number;
  readonly lowerMidwaterTop?: number;
  readonly upperMidwaterTop?: number;
  /** Soft transition width around each water-layer boundary, in metres. */
  readonly layerTransition?: number;
  /** Horizontal kelp influence extends to 1.25 crown radii by default. */
  readonly kelpEdgeScale?: number;
  readonly reefInfluenceMargin?: number;
  /** Relative surface light, in [0, 1]. */
  readonly surfaceLightIntensity?: number;
  /** Single-channel ecological light attenuation in 1/m. */
  readonly lightAttenuation?: number;
}

export function createHabitatSample(): HabitatSample {
  return {
    zone: 'benthic',
    weights: { benthic: 1, lowerMidwater: 0, upperMidwater: 0, surfaceCanopy: 0 },
    floorY: 0,
    heightAboveFloor: 0,
    depth: 0,
    lightIntensity: 0,
    kelpDensity: 0,
    reefProximity: 0,
    canopyTopY: 0,
    inBounds: false,
  };
}

export function kelpAnchorsFromLayout(placements: readonly KelpPlacementLike[]): KelpAnchor[] {
  return placements.map((placement, index) => {
    if (!Number.isFinite(placement.scale) || placement.scale < 0) {
      throw new RangeError(`placements[${index}].scale must be finite and non-negative`);
    }
    const profile = KELP_GEOMETRY_PROFILES[placement.name];
    return {
      name: placement.name,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      height: profile.height * placement.scale,
      canopyRadius: profile.canopyRadius * placement.scale,
    };
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function dominantZone(weights: HabitatZoneWeights): HabitatZone {
  let zone: HabitatZone = 'benthic';
  let maximum = weights.benthic;
  if (weights.lowerMidwater > maximum) {
    zone = 'lower-midwater';
    maximum = weights.lowerMidwater;
  }
  if (weights.upperMidwater > maximum) {
    zone = 'upper-midwater';
    maximum = weights.upperMidwater;
  }
  if (weights.surfaceCanopy > maximum) zone = 'surface-canopy';
  return zone;
}

/** Continuous ecological habitat queries over the existing Three.js world coordinates. */
export class HabitatZoneSystem {
  readonly kelp: readonly KelpAnchor[];
  readonly reefs: readonly ReefAnchor[];
  readonly bounds: HabitatBounds;

  private readonly floorAt: FloorHeightFunction;
  private readonly benthicTop: number;
  private readonly lowerMidwaterTop: number;
  private readonly upperMidwaterTop: number;
  private readonly layerTransition: number;
  private readonly kelpEdgeScale: number;
  private readonly reefInfluenceMargin: number;
  private readonly surfaceLightIntensity: number;
  private readonly lightAttenuation: number;

  constructor(options: HabitatZoneOptions = {}) {
    const bounds = options.bounds ?? DEFAULT_CONFIG.bounds;
    for (let component = 0; component < 3; component += 1) {
      assertFinite(bounds.min[component], `bounds.min[${component}]`);
      assertFinite(bounds.max[component], `bounds.max[${component}]`);
      if (bounds.max[component] <= bounds.min[component]) {
        throw new RangeError(`bounds.max[${component}] must exceed bounds.min[${component}]`);
      }
    }
    this.bounds = { min: [...bounds.min], max: [...bounds.max] };

    this.kelp = (options.kelp ?? []).map((anchor, index) => {
      assertFinite(anchor.x, `kelp[${index}].x`);
      assertFinite(anchor.y, `kelp[${index}].y`);
      assertFinite(anchor.z, `kelp[${index}].z`);
      assertNonNegative(anchor.height, `kelp[${index}].height`);
      assertNonNegative(anchor.canopyRadius, `kelp[${index}].canopyRadius`);
      return { ...anchor };
    });
    this.reefs = (options.reefs ?? []).map((reef, index) => {
      for (let component = 0; component < 3; component += 1) {
        assertFinite(reef.center[component], `reefs[${index}].center[${component}]`);
      }
      assertNonNegative(reef.radius, `reefs[${index}].radius`);
      return { center: [...reef.center], radius: reef.radius };
    });

    this.floorAt = options.floorAt ?? floorHeightAt;
    this.benthicTop = options.benthicTop ?? 2.5;
    this.lowerMidwaterTop = options.lowerMidwaterTop ?? 9;
    this.upperMidwaterTop = options.upperMidwaterTop ?? 15;
    assertPositive(this.benthicTop, 'benthicTop');
    assertFinite(this.lowerMidwaterTop, 'lowerMidwaterTop');
    assertFinite(this.upperMidwaterTop, 'upperMidwaterTop');
    if (this.lowerMidwaterTop <= this.benthicTop) {
      throw new RangeError('lowerMidwaterTop must exceed benthicTop');
    }
    if (this.upperMidwaterTop <= this.lowerMidwaterTop) {
      throw new RangeError('upperMidwaterTop must exceed lowerMidwaterTop');
    }

    this.layerTransition = options.layerTransition ?? 1;
    this.kelpEdgeScale = options.kelpEdgeScale ?? 1.25;
    this.reefInfluenceMargin = options.reefInfluenceMargin ?? 2;
    this.surfaceLightIntensity = options.surfaceLightIntensity ?? 1;
    this.lightAttenuation = options.lightAttenuation ?? 0.055;
    assertPositive(this.layerTransition, 'layerTransition');
    assertPositive(this.kelpEdgeScale, 'kelpEdgeScale');
    if (this.kelpEdgeScale <= 0.75) throw new RangeError('kelpEdgeScale must exceed 0.75');
    assertPositive(this.reefInfluenceMargin, 'reefInfluenceMargin');
    assertFinite(this.surfaceLightIntensity, 'surfaceLightIntensity');
    if (this.surfaceLightIntensity < 0 || this.surfaceLightIntensity > 1) {
      throw new RangeError('surfaceLightIntensity must be in [0, 1]');
    }
    assertNonNegative(this.lightAttenuation, 'lightAttenuation');
  }

  /** Populate and return the supplied reusable sample; no vector/object is allocated here. */
  sample(x: number, y: number, z: number, out: HabitatSample): HabitatSample {
    assertFinite(x, 'x');
    assertFinite(y, 'y');
    assertFinite(z, 'z');
    const floorY = this.floorAt(x, z);
    if (!Number.isFinite(floorY)) throw new RangeError('floorAt must return a finite height');
    const height = y - floorY;
    const halfTransition = this.layerTransition * 0.5;
    const s0 = smoothstep(
      this.benthicTop - halfTransition,
      this.benthicTop + halfTransition,
      height,
    );
    const s1 = smoothstep(
      this.lowerMidwaterTop - halfTransition,
      this.lowerMidwaterTop + halfTransition,
      height,
    );
    const s2 = smoothstep(
      this.upperMidwaterTop - halfTransition,
      this.upperMidwaterTop + halfTransition,
      height,
    );

    // Ordered smoothstep transitions are telescoping: weights remain normalized
    // and non-negative even when custom transition intervals overlap.
    out.weights.benthic = 1 - s0;
    out.weights.lowerMidwater = s0 - s1;
    out.weights.upperMidwater = s1 - s2;
    out.weights.surfaceCanopy = s2;
    out.zone = dominantZone(out.weights);
    out.floorY = floorY;
    out.heightAboveFloor = height;
    out.depth = this.bounds.max[1] - y;
    out.lightIntensity = this.surfaceLightIntensity * Math.exp(
      -this.lightAttenuation * Math.max(0, out.depth),
    );

    let kelpDensity = 0;
    let canopyTopY = floorY;
    for (const anchor of this.kelp) {
      if (anchor.height <= 0 || anchor.canopyRadius <= 0) continue;
      const distance = Math.hypot(x - anchor.x, z - anchor.z);
      const horizontal = 1 - smoothstep(
        anchor.canopyRadius * 0.75,
        anchor.canopyRadius * this.kelpEdgeScale,
        distance,
      );
      if (horizontal <= 0) continue;

      const top = anchor.y + anchor.height;
      canopyTopY = Math.max(canopyTopY, top);
      const verticalFade = Math.min(0.6, anchor.height * 0.25);
      const lower = smoothstep(anchor.y, anchor.y + verticalFade, y);
      const upper = 1 - smoothstep(top - verticalFade, top, y);
      kelpDensity = Math.max(kelpDensity, horizontal * lower * upper);
    }
    out.kelpDensity = kelpDensity;
    out.canopyTopY = canopyTopY;

    let reefProximity = 0;
    for (const reef of this.reefs) {
      if (reef.radius <= 0) continue;
      const distance = Math.hypot(
        x - reef.center[0],
        y - reef.center[1],
        z - reef.center[2],
      );
      const proximity = 1 - smoothstep(
        reef.radius,
        reef.radius + this.reefInfluenceMargin,
        distance,
      );
      reefProximity = Math.max(reefProximity, proximity);
    }
    out.reefProximity = reefProximity;
    out.inBounds = x >= this.bounds.min[0] && x <= this.bounds.max[0]
      && y >= this.bounds.min[1] && y <= this.bounds.max[1]
      && z >= this.bounds.min[2] && z <= this.bounds.max[2];
    return out;
  }

  canopyTopAt(x: number, z: number): number {
    assertFinite(x, 'x');
    assertFinite(z, 'z');
    let top = this.floorAt(x, z);
    if (!Number.isFinite(top)) throw new RangeError('floorAt must return a finite height');
    for (const anchor of this.kelp) {
      if (anchor.height <= 0 || anchor.canopyRadius <= 0) continue;
      if (Math.hypot(x - anchor.x, z - anchor.z) < anchor.canopyRadius * this.kelpEdgeScale) {
        top = Math.max(top, anchor.y + anchor.height);
      }
    }
    return top;
  }
}
