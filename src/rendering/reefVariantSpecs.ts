import type { EpibiontPlanOptions } from './reefEpibiontPlacement';

/**
 * The approved hero sample plus four derived variants.
 *
 * Each entry replaces only the visual mesh anchored to one simulation
 * obstacle; the sphere itself is never changed. The target dimensions are the
 * authored near-LOD sizes used by the asset pipeline and by the variant tests.
 * `?reef=sample` loads the hero only; `?reef=set` loads all five.
 *
 * Composition pass: one tall hero, two medium secondary reefs and two low,
 * laterally extended reefs. The original collision layout already contains
 * usable channels, so opening the view is a visual-scale/rotation change only.
 */

export type ReefVariantId = 'hero' | 'b' | 'c' | 'd' | 'e';

export interface ReefVariantSpec {
  readonly id: ReefVariantId;
  readonly label: string;
  readonly anchorIndex: number;
  readonly obstacleRadius: number;
  /** GLB and texture filename prefix. */
  readonly assetPrefix: string;
  readonly yawDegrees: number;
  /** Small authored leans; the hero remains upright as the stable anchor. */
  readonly tiltXDegrees: number;
  readonly tiltZDegrees: number;
  readonly embedDepth: number;
  readonly lodDistances: readonly [number, number];
  readonly epibiontSeed: number;
  readonly epibiontOptions: EpibiontPlanOptions;
  /** Reef-local decoration size multiplier; 1 keeps the authored scale. */
  readonly decorationScale?: number;
  readonly apronSeed: number;
  readonly targetHeight: number;
  readonly targetWidth: number;
  readonly targetDepth: number;
}

export const HERO_REEF_SPEC: ReefVariantSpec = {
  id: 'hero',
  label: 'Hero sample',
  anchorIndex: 2,
  obstacleRadius: 3.6,
  assetPrefix: 'reef_hero_b1',
  yawDegrees: -16,
  tiltXDegrees: 0,
  tiltZDegrees: 0,
  embedDepth: 0.07,
  lodDistances: [18, 38],
  epibiontSeed: 0xe9b10c1d,
  epibiontOptions: {},
  apronSeed: 0x5eed7a11,
  targetHeight: 9.4,
  targetWidth: 7.0,
  targetDepth: 6.3,
};

export const REEF_VARIANT_SPECS: readonly ReefVariantSpec[] = [
  HERO_REEF_SPEC,
  {
    id: 'b',
    label: 'Spire',
    anchorIndex: 0,
    obstacleRadius: 3.4,
    assetPrefix: 'reef_variant_b',
    yawDegrees: -30,
    tiltXDegrees: 1.5,
    tiltZDegrees: -4,
    embedDepth: 0.18,
    lodDistances: [18, 38],
    epibiontSeed: 0x8b21c4d1,
    epibiontOptions: {
      clusterCount: 6,
      minClusterSpacing: 0.82,
      perClusterMin: 5,
      perClusterMax: 7,
      clusterRadius: 0.5,
      minColonySpacing: 0.13,
      encrustingCount: 18,
      sideCount: 12,
    },
    apronSeed: 0x5eedb001,
    targetHeight: 6.3,
    targetWidth: 6.2,
    targetDepth: 5.5,
  },
  {
    id: 'c',
    label: 'Platform',
    anchorIndex: 1,
    obstacleRadius: 3.5,
    assetPrefix: 'reef_variant_c',
    yawDegrees: 16,
    tiltXDegrees: -2,
    tiltZDegrees: 3,
    embedDepth: 0.18,
    lodDistances: [15, 32],
    epibiontSeed: 0x51c0ffee,
    epibiontOptions: {
      clusterCount: 7,
      minClusterSpacing: 0.72,
      perClusterMin: 5,
      perClusterMax: 7,
      clusterRadius: 0.54,
      minColonySpacing: 0.14,
      encrustingCount: 22,
      sideCount: 10,
    },
    apronSeed: 0x5eedc002,
    targetHeight: 4.3,
    targetWidth: 7.0,
    targetDepth: 5.8,
  },
  {
    id: 'd',
    label: 'Twin',
    anchorIndex: 3,
    obstacleRadius: 3.2,
    assetPrefix: 'reef_twin_d_b1',
    yawDegrees: 76,
    tiltXDegrees: 1,
    tiltZDegrees: 4,
    embedDepth: 0.2,
    lodDistances: [14, 30],
    epibiontSeed: 0x7ea5d00d,
    epibiontOptions: {
      clusterCount: 5,
      minClusterSpacing: 0.48,
      perClusterMin: 5,
      perClusterMax: 7,
      clusterRadius: 0.4,
      minColonySpacing: 0.12,
      encrustingCount: 14,
      sideCount: 8,
      decorationScale: 0.85,
    },
    apronSeed: 0x5eedd003,
    targetHeight: 6.7,
    targetWidth: 6.1,
    targetDepth: 5.2,
  },
  {
    id: 'e',
    label: 'Terraces',
    anchorIndex: 4,
    obstacleRadius: 3.4,
    assetPrefix: 'reef_variant_e',
    yawDegrees: -38,
    tiltXDegrees: -1.5,
    tiltZDegrees: -3.5,
    embedDepth: 0.18,
    lodDistances: [15, 32],
    epibiontSeed: 0x73e44a55,
    epibiontOptions: {
      clusterCount: 6,
      minClusterSpacing: 0.62,
      perClusterMin: 5,
      perClusterMax: 7,
      clusterRadius: 0.46,
      minColonySpacing: 0.13,
      encrustingCount: 18,
      sideCount: 10,
    },
    apronSeed: 0x5eede004,
    targetHeight: 4.9,
    targetWidth: 6.8,
    targetDepth: 6.0,
  },
];

export const REEF_VARIANT_ORDER: readonly ReefVariantId[] = ['hero', 'b', 'c', 'd', 'e'];
