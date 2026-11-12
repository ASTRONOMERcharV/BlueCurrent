/**
 * Data-only description of the five reef collision proxies.
 *
 * Shape parameters are stored as fractions of the authored near-LOD bounds so
 * the proxy follows the real GLB dimensions loaded at runtime. X/Z are divided
 * by the local half width / half depth (the meshes are symmetric about x=0,
 * z=0); Y is divided by the full local height (the mesh base sits on y=0).
 *
 * Local sizes below were measured from the rock-only near LOD meshes with
 * `scripts/measure-reef-collision.ts` (GLB node transforms applied, base y=0).
 * Runtime loading still uses the actual `assets.stats` dimensions and warns if
 * they drift beyond tolerance.
 */

export type ReefProxyId = 'b' | 'c' | 'hero' | 'd' | 'e';

export type Vec3Fraction = readonly [number, number, number];

export interface RoundedBoxShapeSpec {
  readonly kind: 'roundedBox';
  readonly center: Vec3Fraction;
  readonly half: Vec3Fraction;
  /** Fraction of the local height. */
  readonly rounding: number;
}

export interface CapsuleShapeSpec {
  readonly kind: 'capsule';
  readonly a: Vec3Fraction;
  readonly b: Vec3Fraction;
  /** Fraction of the local height. */
  readonly radius: number;
}

export interface EllipsoidShapeSpec {
  readonly kind: 'ellipsoid';
  readonly center: Vec3Fraction;
  readonly radii: Vec3Fraction;
}

export type ReefProxyShapeSpec = RoundedBoxShapeSpec | CapsuleShapeSpec | EllipsoidShapeSpec;

export interface ReefProxySpec {
  readonly id: ReefProxyId;
  readonly label: string;
  readonly anchorIndex: number;
  readonly shapes: readonly ReefProxyShapeSpec[];
}

/** Measured authored dimensions (width, height, depth) of each near LOD. */
export const REEF_NEAR_LOCAL_SIZE: Record<ReefProxyId, Vec3Fraction> = {
  b: [3.857654, 3.997868, 3.394104],
  c: [4.196727, 2.201247, 3.199204],
  hero: [4.7939, 4.6458, 4.4761],
  d: [2.7982, 2.7498, 2.3864],
  e: [3.29045, 2.951503, 2.89844],
};

/**
 * B / Spire: broad base, a rectangular mid shoulder and two capsules that lean
 * out to the authored tip. No single sphere can hold the base and the fin.
 */
const SPIRE_SHAPES: readonly ReefProxyShapeSpec[] = [
  { kind: 'roundedBox', center: [0, 0.1501, 0], half: [0.8295, 0.075, 0.7955], rounding: 0.085 },
  { kind: 'roundedBox', center: [-0.1815, 0.4878, 0], half: [0.4407, 0.1126, 0.3653], rounding: 0.075 },
  { kind: 'capsule', a: [-0.2592, 0.6128, 0.1473], b: [-0.2851, 0.7629, 0.1768], radius: 0.2201 },
  { kind: 'capsule', a: [-0.4148, 0.8254, 0.3241], b: [-0.5444, 0.8805, 0.2946], radius: 0.1301 },
];

/**
 * C / Platform: a wide, low slab plus a small upper terrace. The authored rock
 * is 4.3 m tall at runtime; the old r=3.5 sphere claimed a 7 m vertical range.
 */
const PLATFORM_SHAPES: readonly ReefProxyShapeSpec[] = [
  { kind: 'roundedBox', center: [0, 0.2635, 0], half: [0.834, 0.2499, 0.7814], rounding: 0.1363 },
  { kind: 'roundedBox', center: [0, 0.745, 0], half: [0.3717, 0.2271, 0.3876], rounding: 0.1272 },
];

/**
 * Hero B1: the authored base is wider and deeper than the old hero, the mid
 * body carries a right-hand shoulder ledge, and the single pinnacle leans
 * toward -x. Four stacked boxes plus an ellipsoid follow those layers; the
 * previous five-shape set left the base rim and the upper body outside.
 */
const HERO_SHAPES: readonly ReefProxyShapeSpec[] = [
  { kind: 'roundedBox', center: [0, 0.085, 0], half: [0.99, 0.085, 0.90], rounding: 0.09 },
  { kind: 'roundedBox', center: [-0.02, 0.30, 0], half: [0.87, 0.18, 0.72], rounding: 0.08 },
  { kind: 'roundedBox', center: [-0.03, 0.55, 0.02], half: [0.67, 0.20, 0.55], rounding: 0.08 },
  { kind: 'roundedBox', center: [0.78, 0.42, 0], half: [0.16, 0.055, 0.22], rounding: 0.05 },
  { kind: 'ellipsoid', center: [-0.30, 0.84, 0.02], radii: [0.56, 0.17, 0.50] },
];

/**
 * D / Twin B1: a low connecting base, a shallow saddle, and two asymmetric
 * column capsules. The right column is shorter and sits forward; the rear web
 * is now low, so the old mid-height back box is replaced by a low shelf box.
 */
const TWIN_SHAPES: readonly ReefProxyShapeSpec[] = [
  { kind: 'roundedBox', center: [0, 0.055, 0], half: [0.64, 0.055, 0.74], rounding: 0.12 },
  { kind: 'roundedBox', center: [0.0, 0.17, 0], half: [0.62, 0.11, 0.55], rounding: 0.08 },
  { kind: 'roundedBox', center: [-0.314, 0.50, 0.067], half: [0.40, 0.34, 0.37], rounding: 0.01 },
  { kind: 'roundedBox', center: [-0.33, 0.87, 0.05], half: [0.24, 0.10, 0.26], rounding: 0.01 },
  { kind: 'roundedBox', center: [-0.80, 0.24, 0.02], half: [0.22, 0.12, 0.30], rounding: 0.02 },
  { kind: 'roundedBox', center: [0.86, 0.26, -0.02], half: [0.22, 0.12, 0.30], rounding: 0.02 },
  { kind: 'roundedBox', center: [0.679, 0.49, -0.084], half: [0.24, 0.20, 0.27], rounding: 0.01 },
  { kind: 'roundedBox', center: [0.69, 0.86, -0.04], half: [0.15, 0.09, 0.20], rounding: 0.01 },
  { kind: 'roundedBox', center: [0.05, 0.33, -0.55], half: [0.26, 0.06, 0.16], rounding: 0.04 },
  { kind: 'roundedBox', center: [0.10, 0.16, 0.45], half: [0.26, 0.08, 0.12], rounding: 0.04 },
];

/**
 * E / Terraces: flat base + two stepped upper terraces instead of a full
 * sphere that covered the entire 6.8 m height.
 */
const TERRACES_SHAPES: readonly ReefProxyShapeSpec[] = [
  { kind: 'roundedBox', center: [0, 0.1762, 0], half: [0.8084, 0.1016, 0.7797], rounding: 0.0949 },
  { kind: 'roundedBox', center: [-0.2006, 0.5082, 0.138], half: [0.4376, 0.1186, 0.3105], rounding: 0.0847 },
  { kind: 'roundedBox', center: [-0.0912, 0.7962, 0.1173], half: [0.2188, 0.1186, 0.2346], rounding: 0.0813 },
];

export const REEF_PROXY_SPECS: readonly ReefProxySpec[] = [
  { id: 'b', label: 'Spire', anchorIndex: 0, shapes: SPIRE_SHAPES },
  { id: 'c', label: 'Platform', anchorIndex: 1, shapes: PLATFORM_SHAPES },
  { id: 'hero', label: 'Hero', anchorIndex: 2, shapes: HERO_SHAPES },
  { id: 'd', label: 'Twin', anchorIndex: 3, shapes: TWIN_SHAPES },
  { id: 'e', label: 'Terraces', anchorIndex: 4, shapes: TERRACES_SHAPES },
];

export const REEF_PROXY_ORDER: readonly ReefProxyId[] = ['b', 'c', 'hero', 'd', 'e'];

export function reefProxySpec(id: ReefProxyId): ReefProxySpec {
  const spec = REEF_PROXY_SPECS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Unknown reef proxy id: ${id}`);
  return spec;
}
