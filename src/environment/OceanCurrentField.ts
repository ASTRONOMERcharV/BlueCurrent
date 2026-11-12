import { floorHeightAt } from '../rendering/rockPlacement';

export type CurrentVector = readonly [number, number, number];
export type FloorHeightFunction = (x: number, z: number) => number;

export interface CurrentVortex {
  /** World-space centre in metres. */
  readonly center: CurrentVector;
  /** Right-hand-rule axis. Defaults to +Y. */
  readonly axis?: CurrentVector;
  /** Radial scale in metres; the speed coefficient is defined at this radius. */
  readonly radius: number;
  /** Signed tangential speed at radius R and axial distance zero, in m/s. */
  readonly strength: number;
}

export interface OceanCurrentConfig {
  readonly baseDirection: CurrentVector;
  readonly baseSpeed: number;
  readonly turbulenceAmplitude: number;
  readonly turbulenceLength: number;
  readonly turbulencePeriod: number;
  readonly boundaryLayerHeight: number;
  readonly maxSpeed: number;
  readonly vortices: readonly CurrentVortex[];
}

export interface ReefCurrentGeometry {
  readonly center: CurrentVector;
  readonly radius: number;
}

interface NormalizedVortex {
  readonly center: CurrentVector;
  readonly axis: CurrentVector;
  readonly radius: number;
  readonly strength: number;
}

const DEFAULT_DIRECTION_LENGTH = Math.hypot(0.82, 0.57);
const FLOAT32_MAX = 3.4028234663852886e38;

/** Matches the kelp asset's rest-pose lean after Blender-to-glTF conversion. */
export const DEFAULT_CURRENT_DIRECTION: CurrentVector = [
  0.82 / DEFAULT_DIRECTION_LENGTH,
  0,
  -0.57 / DEFAULT_DIRECTION_LENGTH,
];

/**
 * A deterministic animation field, not a computational fluid dynamics solver.
 * Reef vortices are injected explicitly so reef constants have one owner.
 */
export const DEFAULT_OCEAN_CURRENT_CONFIG: OceanCurrentConfig = {
  baseDirection: DEFAULT_CURRENT_DIRECTION,
  baseSpeed: 0.35,
  turbulenceAmplitude: 0.08,
  turbulenceLength: 6,
  turbulencePeriod: 24,
  boundaryLayerHeight: 1.2,
  maxSpeed: 1.25,
  vortices: [],
};

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

function normalizeVector(vector: CurrentVector, name: string): CurrentVector {
  for (let index = 0; index < 3; index += 1) {
    assertFinite(vector[index], `${name}[${index}]`);
  }
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1e-12) throw new RangeError(`${name} must not be a zero vector`);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** Build idealized, same-handed local circulations around existing reef geometry. */
export function createReefVortices(
  reefs: readonly ReefCurrentGeometry[],
  strength = 0.16,
  radiusScale = 1.8,
): CurrentVortex[] {
  assertFinite(strength, 'strength');
  assertPositive(radiusScale, 'radiusScale');
  return reefs.map((reef, index) => {
    assertPositive(reef.radius, `reefs[${index}].radius`);
    return {
      center: [...reef.center],
      axis: [0, 1, 0],
      radius: reef.radius * radiusScale,
      strength,
    };
  });
}

/**
 * Shared three-dimensional water velocity in m/s.
 *
 * The field is deterministic and has no internal clock. Callers supply simulation
 * time and a reusable output array, so sampling does not allocate vector objects.
 */
export class OceanCurrentField {
  readonly config: OceanCurrentConfig;

  private readonly floorAt: FloorHeightFunction;
  private readonly vortices: readonly NormalizedVortex[];
  private readonly waveNumber: number;
  private readonly angularFrequency: number;
  private readonly speedScratch = new Float32Array(3);

  constructor(
    config: Partial<OceanCurrentConfig> = {},
    floorAt: FloorHeightFunction = floorHeightAt,
  ) {
    const merged: OceanCurrentConfig = {
      ...DEFAULT_OCEAN_CURRENT_CONFIG,
      ...config,
      baseDirection: config.baseDirection ?? DEFAULT_OCEAN_CURRENT_CONFIG.baseDirection,
      vortices: config.vortices ?? DEFAULT_OCEAN_CURRENT_CONFIG.vortices,
    };

    assertNonNegative(merged.baseSpeed, 'baseSpeed');
    assertNonNegative(merged.turbulenceAmplitude, 'turbulenceAmplitude');
    assertPositive(merged.turbulenceLength, 'turbulenceLength');
    assertPositive(merged.turbulencePeriod, 'turbulencePeriod');
    assertNonNegative(merged.boundaryLayerHeight, 'boundaryLayerHeight');
    assertNonNegative(merged.maxSpeed, 'maxSpeed');
    if (merged.maxSpeed > FLOAT32_MAX) {
      throw new RangeError('maxSpeed must fit in a Float32 output component');
    }
    this.waveNumber = Math.PI * 2 / merged.turbulenceLength;
    this.angularFrequency = Math.PI * 2 / merged.turbulencePeriod;
    assertFinite(this.waveNumber, 'derived turbulence waveNumber');
    assertFinite(this.angularFrequency, 'derived turbulence angularFrequency');

    const baseDirection = merged.baseSpeed === 0
      && Math.hypot(...merged.baseDirection) <= 1e-12
      ? ([0, 0, 0] as CurrentVector)
      : normalizeVector(merged.baseDirection, 'baseDirection');

    const vortices: NormalizedVortex[] = merged.vortices.map((vortex, index) => {
      for (let component = 0; component < 3; component += 1) {
        assertFinite(vortex.center[component], `vortices[${index}].center[${component}]`);
      }
      assertPositive(vortex.radius, `vortices[${index}].radius`);
      assertFinite(vortex.strength, `vortices[${index}].strength`);
      return {
        center: [...vortex.center],
        axis: normalizeVector(vortex.axis ?? [0, 1, 0], `vortices[${index}].axis`),
        radius: vortex.radius,
        strength: vortex.strength,
      };
    });

    this.config = { ...merged, baseDirection, vortices };
    this.vortices = vortices;
    this.floorAt = floorAt;
  }

  /** Write the velocity in m/s into out[0..2]. Other output elements are untouched. */
  sample(x: number, y: number, z: number, time: number, out: Float32Array): void {
    if (out.length < 3) throw new RangeError('out must contain at least three elements');
    assertFinite(x, 'x');
    assertFinite(y, 'y');
    assertFinite(z, 'z');
    assertFinite(time, 'time');

    const direction = this.config.baseDirection;
    let velocityX = direction[0] * this.config.baseSpeed;
    let velocityY = direction[1] * this.config.baseSpeed;
    let velocityZ = direction[2] * this.config.baseSpeed;

    for (const vortex of this.vortices) {
      const rx = x - vortex.center[0];
      const ry = y - vortex.center[1];
      const rz = z - vortex.center[2];
      const axis = vortex.axis;
      const axial = rx * axis[0] + ry * axis[1] + rz * axis[2];
      const perpendicularX = rx - axis[0] * axial;
      const perpendicularY = ry - axis[1] * axial;
      const perpendicularZ = rz - axis[2] * axial;
      const radiusSquared = vortex.radius * vortex.radius;
      const radialSquared = (
        perpendicularX * perpendicularX
        + perpendicularY * perpendicularY
        + perpendicularZ * perpendicularZ
      );
      if (radialSquared <= 1e-20) continue;

      const exponent = 1 - radialSquared / radiusSquared
        - 0.5 * axial * axial / radiusSquared;
      // Avoid 0 * Infinity for extremely distant, but finite, query positions.
      if (exponent < -745 || Number.isNaN(exponent)) continue;

      // S * q * exp(...) * normalize(axis × radial) simplifies to this form.
      const scale = vortex.strength * Math.exp(exponent) / vortex.radius;
      velocityX += scale * (axis[1] * perpendicularZ - axis[2] * perpendicularY);
      velocityY += scale * (axis[2] * perpendicularX - axis[0] * perpendicularZ);
      velocityZ += scale * (axis[0] * perpendicularY - axis[1] * perpendicularX);
    }

    const amplitude = this.config.turbulenceAmplitude;
    if (amplitude > 0) {
      // Reduce each periodic argument before multiplication to avoid overflow and
      // improve phase precision during long runs or with very large timestamps.
      const wavelength = this.config.turbulenceLength;
      const waveX = (x % wavelength) * this.waveNumber;
      const waveY = (y % wavelength) * this.waveNumber;
      const waveZ = (z % wavelength) * this.waveNumber;
      const phase = (time % this.config.turbulencePeriod) * this.angularFrequency;
      const halfAmplitude = amplitude * 0.5;
      velocityX += halfAmplitude * (
        Math.sin(waveZ + phase) + Math.cos(waveY - phase)
      );
      velocityY += halfAmplitude * (
        Math.sin(waveX + phase * 2) + Math.cos(waveZ - phase)
      );
      velocityZ += halfAmplitude * (
        Math.sin(waveY + phase * 3) + Math.cos(waveX - phase * 2)
      );
    }

    if (this.config.boundaryLayerHeight > 0) {
      const floorY = this.floorAt(x, z);
      if (!Number.isFinite(floorY)) throw new RangeError('floorAt must return a finite height');
      const attenuation = smoothstep01(
        (y - floorY) / this.config.boundaryLayerHeight,
      );
      velocityX *= attenuation;
      velocityY *= attenuation;
      velocityZ *= attenuation;
    }

    if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY) || !Number.isFinite(velocityZ)) {
      throw new RangeError('current velocity overflow; reduce the configured speeds');
    }
    const componentMaximum = Math.max(
      Math.abs(velocityX),
      Math.abs(velocityY),
      Math.abs(velocityZ),
    );
    const maximum = this.config.maxSpeed;
    if (componentMaximum > 0) {
      // Scale first so squaring a large, but finite, velocity cannot overflow.
      const scaledX = velocityX / componentMaximum;
      const scaledY = velocityY / componentMaximum;
      const scaledZ = velocityZ / componentMaximum;
      const scaledLength = Math.hypot(scaledX, scaledY, scaledZ);
      if (componentMaximum > maximum / scaledLength) {
        const targetComponent = maximum / scaledLength;
        velocityX = scaledX * targetComponent;
        velocityY = scaledY * targetComponent;
        velocityZ = scaledZ * targetComponent;
      }
    }

    out[0] = velocityX;
    out[1] = velocityY;
    out[2] = velocityZ;
  }

  speedAt(x: number, y: number, z: number, time: number): number {
    this.sample(x, y, z, time, this.speedScratch);
    return Math.hypot(this.speedScratch[0], this.speedScratch[1], this.speedScratch[2]);
  }
}
