import type { SimulationConfig } from './SimulationConfig';
import { SeededRandom } from './math';

export interface FlockSpawnVolume {
  readonly center: readonly [number, number, number];
  /** Multiplier on the default population-scaled ellipsoid radii. */
  readonly radiusScale?: number;
}

/** Structure-of-arrays storage with double-buffered integration state. */
export class FlockData {
  readonly capacity: number;
  count = 0;
  aliveCount = 0;

  positions: Float32Array;
  velocities: Float32Array;
  nextPositions: Float32Array;
  nextVelocities: Float32Array;
  readonly previousPositions: Float32Array;

  banks: Float32Array;
  nextBanks: Float32Array;
  readonly previousBanks: Float32Array;

  readonly alive: Uint8Array;
  fear: Float32Array;
  nextFear: Float32Array;
  readonly phases: Float32Array;
  readonly variants: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.nextPositions = new Float32Array(capacity * 3);
    this.nextVelocities = new Float32Array(capacity * 3);
    this.previousPositions = new Float32Array(capacity * 3);
    this.banks = new Float32Array(capacity);
    this.nextBanks = new Float32Array(capacity);
    this.previousBanks = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.fear = new Float32Array(capacity);
    this.nextFear = new Float32Array(capacity);
    this.phases = new Float32Array(capacity);
    this.variants = new Float32Array(capacity);
  }

  initialize(
    count: number,
    config: SimulationConfig,
    random: SeededRandom,
    spawn?: FlockSpawnVolume,
  ): void {
    this.count = Math.max(0, Math.min(this.capacity, Math.floor(count)));
    this.aliveCount = this.count;
    this.alive.fill(0);
    this.alive.fill(1, 0, this.count);
    this.fear.fill(0);
    this.nextFear.fill(0);
    this.banks.fill(0);
    this.nextBanks.fill(0);

    const centerX = spawn?.center[0] ?? -2;
    const centerY = spawn?.center[1] ?? 10;
    const centerZ = spawn?.center[2] ?? 0;
    const radiusScale = Math.max(0.05, spawn?.radiusScale ?? 1);
    const densityScale = Math.max(0.65, Math.min(1.6, Math.cbrt(Math.max(1, this.count) / 500)));
    const horizontalPadding = config.boundaryMargin + 0.5;
    const radiusX = Math.min(
      12 * densityScale * radiusScale,
      Math.max(0, centerX - config.bounds.min[0] - horizontalPadding),
      Math.max(0, config.bounds.max[0] - horizontalPadding - centerX),
    );
    const radiusY = Math.min(
      4.4 * densityScale * radiusScale,
      Math.max(0, centerY - config.bounds.min[1] - horizontalPadding),
      Math.max(0, config.bounds.max[1] - horizontalPadding - centerY),
    );
    const radiusZ = Math.min(
      8 * densityScale * radiusScale,
      Math.max(0, centerZ - config.bounds.min[2] - horizontalPadding),
      Math.max(0, config.bounds.max[2] - horizontalPadding - centerZ),
    );
    const minimumSpacing = Math.max(0.35, Math.min(0.9, config.separationRadius * 0.6));
    const minimumSpacingSquared = minimumSpacing * minimumSpacing;

    for (let i = 0; i < this.count; i += 1) {
      const offset = i * 3;
      let bestX = centerX;
      let bestY = centerY;
      let bestZ = centerZ;
      let bestClearance = -1;

      // Uniform-volume ellipsoid sampling with best-candidate Poisson rejection.
      // The school is elongated along its mean heading instead of starting as
      // an overlapping vertical cylinder. Sampling remains seeded and bounded.
      for (let attempt = 0; attempt < 48; attempt += 1) {
        const angle = random.range(0, Math.PI * 2);
        const vertical = random.range(-1, 1);
        const ring = Math.sqrt(Math.max(0, 1 - vertical * vertical));
        const radius = Math.cbrt(random.next());
        const x = centerX + Math.cos(angle) * ring * radius * radiusX;
        const y = centerY + vertical * radius * radiusY;
        const z = centerZ + Math.sin(angle) * ring * radius * radiusZ;
        let clearance = Number.POSITIVE_INFINITY;
        for (let other = 0; other < i; other += 1) {
          const otherOffset = other * 3;
          const dx = x - this.positions[otherOffset];
          const dy = y - this.positions[otherOffset + 1];
          const dz = z - this.positions[otherOffset + 2];
          clearance = Math.min(clearance, dx * dx + dy * dy + dz * dz);
          if (clearance < minimumSpacingSquared) break;
        }
        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestX = x;
          bestY = y;
          bestZ = z;
        }
        if (clearance >= minimumSpacingSquared) break;
      }
      this.positions[offset] = bestX;
      this.positions[offset + 1] = bestY;
      this.positions[offset + 2] = bestZ;

      const speed = random.range(config.minSpeed, config.maxSpeed * 0.72);
      const heading = random.range(-0.85, 0.85);
      const verticalHeading = random.range(-0.12, 0.12);
      const horizontalSpeed = Math.cos(verticalHeading) * speed;
      this.velocities[offset] = Math.cos(heading) * horizontalSpeed;
      this.velocities[offset + 1] = Math.sin(verticalHeading) * speed;
      this.velocities[offset + 2] = Math.sin(heading) * horizontalSpeed;

      this.phases[i] = random.range(0, Math.PI * 2);
      this.variants[i] = random.next();
    }

    this.nextPositions.set(this.positions);
    this.nextVelocities.set(this.velocities);
    this.previousPositions.set(this.positions);
    this.previousBanks.set(this.banks);
  }

  beginStep(): void {
    this.previousPositions.set(this.positions);
    this.previousBanks.set(this.banks);
  }

  swap(): void {
    [this.positions, this.nextPositions] = [this.nextPositions, this.positions];
    [this.velocities, this.nextVelocities] = [this.nextVelocities, this.velocities];
    [this.banks, this.nextBanks] = [this.nextBanks, this.banks];
    [this.fear, this.nextFear] = [this.nextFear, this.fear];
  }

  remove(index: number): boolean {
    if (index < 0 || index >= this.count || this.alive[index] === 0) return false;
    this.alive[index] = 0;
    this.aliveCount -= 1;
    return true;
  }
}
