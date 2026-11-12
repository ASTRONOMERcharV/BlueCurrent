/**
 * Deterministic marine-snow advection.
 *
 * The particles are not an independent decorative animation: every frame their
 * position is advanced by the same `OceanCurrentField` that sways the kelp,
 * plus a small biological settling/rise velocity. Rendering lives in
 * `rendering/MarineSnow.ts`; this module is pure and unit-tested.
 */

export interface MarineSnowBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface MarineSnowOptions {
  readonly count: number;
  readonly bounds: MarineSnowBounds;
  readonly seed: number;
}

export interface CurrentSampler {
  sample(x: number, y: number, z: number, time: number, out: Float32Array): void;
}

export const DEFAULT_MARINE_SNOW_BOUNDS: MarineSnowBounds = {
  min: [-30, 0.8, -30],
  max: [30, 19.6, 30],
};

/** Wrap one coordinate into [min, max). */
export function wrapMarineSnowCoordinate(value: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) throw new RangeError('marine snow bounds must have positive extent');
  return min + ((((value - min) % span) + span) % span);
}

export class MarineSnowSimulation {
  readonly count: number;
  readonly bounds: MarineSnowBounds;
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
  readonly phases: Float32Array;
  /** Vertical biological velocity in m/s (negative settles, positive rises). */
  readonly verticalSpeeds: Float32Array;
  private readonly velocity = new Float32Array(3);

  constructor(options: MarineSnowOptions) {
    if (!Number.isInteger(options.count) || options.count <= 0) {
      throw new RangeError('count must be a positive integer');
    }
    const { min, max } = options.bounds;
    for (let axis = 0; axis < 3; axis += 1) {
      if (!Number.isFinite(min[axis]) || !Number.isFinite(max[axis])) {
        throw new RangeError('marine snow bounds must be finite');
      }
      if (max[axis] <= min[axis]) {
        throw new RangeError('marine snow maximum bound must exceed the minimum');
      }
    }
    this.count = options.count;
    this.bounds = options.bounds;
    this.positions = new Float32Array(options.count * 3);
    this.sizes = new Float32Array(options.count);
    this.phases = new Float32Array(options.count);
    this.verticalSpeeds = new Float32Array(options.count);

    let state = options.seed >>> 0;
    const random = (): number => {
      // Mulberry32: deterministic across platforms and cheap enough for init.
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };

    for (let index = 0; index < options.count; index += 1) {
      const offset = index * 3;
      this.positions[offset] = min[0] + random() * (max[0] - min[0]);
      this.positions[offset + 1] = min[1] + random() * (max[1] - min[1]);
      this.positions[offset + 2] = min[2] + random() * (max[2] - min[2]);
      // Most flakes are small; a few larger pieces give near-field parallax.
      const sizeRoll = random();
      this.sizes[index] = 0.016 + sizeRoll * sizeRoll * 0.075;
      this.phases[index] = random() * Math.PI * 2;
      // 12 % of particles are tiny bubbles that rise instead of settling.
      this.verticalSpeeds[index] = random() < 0.12
        ? 0.012 + random() * 0.02
        : -(0.008 + random() * 0.026);
    }
  }

  /**
   * Advance all particles by the sampled current plus their settling velocity.
   * Positions are wrapped inside the fixed observation volume.
   */
  update(
    field: CurrentSampler,
    time: number,
    delta: number,
    advection = 1.0,
  ): void {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new RangeError('delta must be a non-negative finite number');
    }
    if (delta === 0) return;
    const { positions, verticalSpeeds, bounds } = this;
    const { min, max } = bounds;
    const velocity = this.velocity;
    for (let index = 0; index < this.count; index += 1) {
      const offset = index * 3;
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      field.sample(x, y, z, time, velocity);
      positions[offset] = wrapMarineSnowCoordinate(
        x + velocity[0] * delta * advection,
        min[0],
        max[0],
      );
      positions[offset + 1] = wrapMarineSnowCoordinate(
        y + (velocity[1] * advection + verticalSpeeds[index]) * delta,
        min[1],
        max[1],
      );
      positions[offset + 2] = wrapMarineSnowCoordinate(
        z + velocity[2] * delta * advection,
        min[2],
        max[2],
      );
    }
  }
}
