import { floorHeightAt } from '../rendering/rockPlacement';
import { SeededRandom } from '../simulation/math';

/**
 * Phase E4 near-bed sediment field.
 *
 * A deterministic, presentation-only particle pool. It reads live fish
 * positions/velocities and the shared ocean current; it never writes simulation
 * state. Particles are ejected by fish passing close to the seabed at speed,
 * then drift and fade as suspended sediment. The pool is fixed and allocation
 * free after construction.
 */

export interface SedimentFlockView {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly alive: Uint8Array;
  readonly count: number;
}

export type CurrentSampler = (
  x: number,
  y: number,
  z: number,
  time: number,
  out: Float32Array,
) => void;

export interface SedimentOptions {
  capacity?: number;
  seed?: number;
  /**
   * Height above the seabed within which fish downwash can resuspend sediment.
   * The scene keeps fish at y >= 1 m while the bed sits near y = -0.25 m, so a
   * literal contact threshold is unreachable; intensity falls with height.
   */
  influenceHeight?: number;
  /** Minimum fish speed that can raise sediment. */
  minSpeed?: number;
  /** Maximum bursts and particles per 1/30 s sample. */
  maxBursts?: number;
  particlesPerBurst?: number;
}

const SAMPLE_INTERVAL = 1 / 30;
const CURRENT_COUPLING = 0.6;
const DRAG_PER_SECOND = 0.85;

export class SedimentField {
  readonly capacity: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly ages: Float32Array;
  readonly lifetimes: Float32Array;
  readonly sizes: Float32Array;
  readonly alpha: Float32Array;
  readonly alive: Uint8Array;
  activeCount = 0;

  private readonly random: SeededRandom;
  private readonly seed: number;
  private readonly influenceHeight: number;
  private readonly minSpeed: number;
  private readonly maxBursts: number;
  private readonly particlesPerBurst: number;
  private cursor = 0;
  private accumulator = 0;
  private lastTime = 0;
  private readonly currentScratch = new Float32Array(3);

  constructor(options: SedimentOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 320));
    this.influenceHeight = Math.max(0.5, options.influenceHeight ?? 8);
    this.minSpeed = Math.max(0, options.minSpeed ?? 1.2);
    this.maxBursts = Math.max(0, Math.floor(options.maxBursts ?? 1));
    this.particlesPerBurst = Math.max(1, Math.floor(options.particlesPerBurst ?? 4));
    this.random = new SeededRandom(options.seed ?? 0x5ed1e17);
    this.seed = options.seed ?? 0x5ed1e17;
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.ages = new Float32Array(this.capacity);
    this.lifetimes = new Float32Array(this.capacity);
    this.sizes = new Float32Array(this.capacity);
    this.alpha = new Float32Array(this.capacity);
    this.alive = new Uint8Array(this.capacity);
  }

  reset(): void {
    this.positions.fill(0);
    this.velocities.fill(0);
    this.ages.fill(0);
    this.lifetimes.fill(0);
    this.sizes.fill(0);
    this.alpha.fill(0);
    this.alive.fill(0);
    this.activeCount = 0;
    this.cursor = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.random.reset(this.seed);
  }

  update(delta: number, time: number, flock: SedimentFlockView, current?: CurrentSampler): void {
    const step = Math.max(0, Math.min(0.1, delta));
    if (time + 1e-9 < this.lastTime) this.reset();
    this.lastTime = time;
    if (step === 0) return;

    this.integrate(step, time, current);
    this.accumulator += step;
    let samples = 0;
    while (this.accumulator >= SAMPLE_INTERVAL && samples < 8) {
      this.accumulator -= SAMPLE_INTERVAL;
      samples += 1;
      this.emitFromFlock(flock, time, current);
    }
    let active = 0;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.alive[index] !== 0) active += 1;
    }
    this.activeCount = active;
  }

  private integrate(delta: number, time: number, current?: CurrentSampler): void {
    const drag = Math.max(0, 1 - DRAG_PER_SECOND * delta);
    const positions = this.positions;
    const velocities = this.velocities;
    let active = 0;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.alive[index] === 0) continue;
      const age = this.ages[index] + delta;
      const life = this.lifetimes[index];
      if (age >= life) {
        this.alive[index] = 0;
        this.alpha[index] = 0;
        continue;
      }
      this.ages[index] = age;
      const offset = index * 3;
      let vx = velocities[offset];
      let vy = velocities[offset + 1];
      let vz = velocities[offset + 2];
      if (current) {
        current(positions[offset], positions[offset + 1], positions[offset + 2], time, this.currentScratch);
        vx = vx * drag + this.currentScratch[0] * CURRENT_COUPLING * delta;
        vy = vy * drag + this.currentScratch[1] * CURRENT_COUPLING * delta;
        vz = vz * drag + this.currentScratch[2] * CURRENT_COUPLING * delta;
      } else {
        vx *= drag;
        vy *= drag;
        vz *= drag;
      }
      velocities[offset] = vx;
      velocities[offset + 1] = vy;
      velocities[offset + 2] = vz;
      positions[offset] += vx * delta;
      positions[offset + 1] += vy * delta;
      positions[offset + 2] += vz * delta;
      const floor = floorHeightAt(positions[offset], positions[offset + 2]) + 0.02;
      if (positions[offset + 1] < floor) {
        positions[offset + 1] = floor;
        velocities[offset + 1] = Math.max(0, velocities[offset + 1]);
      }
      const lifeLeft = 1 - age / life;
      const fadeIn = Math.min(1, age / 0.18);
      this.alpha[index] = Math.max(0, lifeLeft) * fadeIn;
      active += 1;
    }
    this.activeCount = active;
  }

  private emitFromFlock(flock: SedimentFlockView, time: number, current?: CurrentSampler): void {
    if (this.maxBursts <= 0 || flock.count <= 0) return;
    const { positions, velocities, alive, count } = flock;
    let bursts = 0;
    for (let index = 0; index < count && bursts < this.maxBursts; index += 1) {
      if (alive[index] === 0) continue;
      const offset = index * 3;
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      const ground = floorHeightAt(x, z);
      const clearance = y - ground;
      if (clearance < 0 || clearance > this.influenceHeight) continue;
      const vx = velocities[offset];
      const vy = velocities[offset + 1];
      const vz = velocities[offset + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed < this.minSpeed || vy > 0.5) continue;
      const proximity = 1 - clearance / this.influenceHeight;
      const probability = Math.min(
        0.35,
        0.005 + proximity * proximity * 0.09 * Math.min(1.5, speed / 5),
      );
      if (this.random.next() > probability) continue;
      this.burst(x, ground, z, vx, vz, time, current);
      bursts += 1;
    }
  }

  private burst(
    x: number,
    ground: number,
    z: number,
    fishVelocityX: number,
    fishVelocityZ: number,
    time: number,
    current?: CurrentSampler,
  ): void {
    for (let particle = 0; particle < this.particlesPerBurst; particle += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const offset = index * 3;
      this.positions[offset] = x + (this.random.next() - 0.5) * 0.35;
      this.positions[offset + 1] = ground + 0.05 + this.random.next() * 0.12;
      this.positions[offset + 2] = z + (this.random.next() - 0.5) * 0.35;
      let vx = fishVelocityX * 0.08 + (this.random.next() - 0.5) * 0.3;
      const vy = 0.06 + this.random.next() * 0.10;
      let vz = fishVelocityZ * 0.08 + (this.random.next() - 0.5) * 0.3;
      if (current) {
        current(this.positions[offset], this.positions[offset + 1], this.positions[offset + 2], time, this.currentScratch);
        vx += this.currentScratch[0] * CURRENT_COUPLING * 0.35;
        vz += this.currentScratch[2] * CURRENT_COUPLING * 0.35;
      }
      this.velocities[offset] = vx;
      this.velocities[offset + 1] = vy;
      this.velocities[offset + 2] = vz;
      this.ages[index] = 0;
      this.lifetimes[index] = 1.2 + this.random.next() * 1.2;
      this.sizes[index] = 0.09 + this.random.next() * 0.08;
      this.alpha[index] = 0;
      this.alive[index] = 1;
    }
  }
}
