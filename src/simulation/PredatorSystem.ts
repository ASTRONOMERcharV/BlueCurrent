export type PredatorState = 'patrol' | 'pursuit' | 'attack' | 'search';

import type { FlockData } from './FlockData';
import type { SimulationConfig } from './SimulationConfig';
import { clamp, SeededRandom } from './math';
import type { ObstacleSystem } from './ObstacleSystem';
import type { KelpRefugeField } from '../environment/KelpRefugeField';
import { addBoundaryForce, constrainToBounds } from './EnvironmentForces';

/** Seconds of cruise travel used to place the search target ahead of the shark. */
const SEARCH_LEAD_SECONDS = 1.5;
/** Within this distance the search target counts as reached (metres). */
const SEARCH_ARRIVAL_RADIUS = 2;
/** Minimum horizontal search speed, keeps the shark out of a vertical wobble. */
const MIN_SEARCH_HORIZONTAL_SPEED = 0.8;
/** Horizontal speed at which the stored search heading is trusted (m/s). */
const SEARCH_HEADING_MIN_SPEED = 0.3;

/** A sticky-target FSM: patrol -> pursuit -> attack -> search/patrol. */
export class PredatorSystem {
  readonly position = new Float32Array(3);
  readonly previousPosition = new Float32Array(3);
  readonly velocity = new Float32Array(3);
  state: PredatorState = 'patrol';
  targetIndex = -1;
  captures = 0;
  captureSerial = 0;

  private readonly lastSeen = new Float32Array(3);
  private readonly patrolTarget = new Float32Array(3);
  private readonly obstacleForce = new Float32Array(3);
  private readonly boundaryForce = new Float32Array(3);
  /** Stable horizontal heading used while search has no meaningful velocity heading. */
  private readonly searchHeading = new Float32Array(2);
  private stateTime = 0;
  private retargetTimer = 0;
  private detectCooldown = 0;

  constructor(
    private readonly config: SimulationConfig,
    private readonly obstacles: ObstacleSystem,
    private readonly kelpRefuge?: KelpRefugeField,
  ) {}

  reset(random: SeededRandom): void {
    this.position.set([15, 12, -14]);
    this.previousPosition.set(this.position);
    this.velocity.set([-2.6, -0.2, 2]);
    const initialHorizontalSpeed = Math.hypot(this.velocity[0], this.velocity[2]);
    this.searchHeading[0] = this.velocity[0] / initialHorizontalSpeed;
    this.searchHeading[1] = this.velocity[2] / initialHorizontalSpeed;
    this.lastSeen.set(this.position);
    this.patrolTarget.set([-2, 10, 0]);
    this.state = 'patrol';
    this.targetIndex = -1;
    this.captures = 0;
    this.captureSerial = 0;
    this.stateTime = 0;
    this.retargetTimer = random.range(0.1, 0.35);
    this.detectCooldown = 0.8;
  }

  releaseNearSchool(center: Float32Array): void {
    this.position.set([center[0] + 7, center[1] + 1.5, center[2] - 6]);
    constrainToBounds(this.position, this.velocity, 0, this.config, 1);
    this.previousPosition.set(this.position);
    const dx = center[0] - this.position[0];
    const dy = center[1] - this.position[1];
    const dz = center[2] - this.position[2];
    const length = Math.max(0.001, Math.hypot(dx, dy, dz));
    this.velocity.set([(dx / length) * 4, (dy / length) * 4, (dz / length) * 4]);
    this.patrolTarget.set(center);
    this.transition('patrol');
    this.targetIndex = -1;
    this.detectCooldown = 0;
    this.retargetTimer = 0;
  }

  retreat(): void {
    this.position.set([this.config.bounds.max[0] - 2, this.config.bounds.max[1] - 2, this.config.bounds.max[2] - 2]);
    this.previousPosition.set(this.position);
    this.velocity.set([0, 0, 0]);
    this.patrolTarget.set(this.position);
    this.targetIndex = -1;
    this.detectCooldown = 5;
    this.retargetTimer = 0.5;
    this.transition('patrol');
  }

  update(delta: number, flock: FlockData): void {
    this.previousPosition.set(this.position);
    if (!this.config.predatorEnabled) return;

    // Keep the last trustworthy horizontal heading current every step; search
    // falls back to it when vx/vz collapse during a near-vertical segment.
    this.updateSearchHeading();
    this.stateTime += delta;
    this.retargetTimer -= delta;
    this.detectCooldown -= delta;
    const aggression = this.config.predatorAggression;
    const detectionRadius = this.config.predatorDetectRadius * (0.8 + aggression * 0.25);

    if (this.retargetTimer <= 0) {
      this.retargetTimer = 0.35;
      if (this.detectCooldown <= 0) {
        const target = this.findNearest(flock, detectionRadius);
        if (target >= 0) {
          if (this.state === 'patrol' || this.state === 'search') {
            this.targetIndex = target;
            this.transition('pursuit');
          } else if (
            this.state === 'pursuit'
            && target !== this.targetIndex
            && this.targetIndex >= 0
            && this.targetIndex < flock.count
            && flock.alive[this.targetIndex] === 1
          ) {
            const currentOffset = this.targetIndex * 3;
            const currentDistance = Math.hypot(
              flock.positions[currentOffset] - this.position[0],
              flock.positions[currentOffset + 1] - this.position[1],
              flock.positions[currentOffset + 2] - this.position[2],
            );
            const candidateOffset = target * 3;
            const candidateDistance = Math.hypot(
              flock.positions[candidateOffset] - this.position[0],
              flock.positions[candidateOffset + 1] - this.position[1],
              flock.positions[candidateOffset + 2] - this.position[2],
            );
            // Keep the sticky target unless another live fish is clearly closer;
            // this allows direct index-to-index switches without thrashing.
            if (
              currentDistance > this.config.predatorAttackRadius
              && candidateDistance < currentDistance * this.config.predatorRetargetAdvantage
            ) {
              this.targetIndex = target;
              this.stateTime = 0;
            }
          }
        }
      }
    }

    let targetX = this.patrolTarget[0];
    let targetY = this.patrolTarget[1];
    let targetZ = this.patrolTarget[2];
    let desiredSpeed = this.config.predatorCruiseSpeed;

    if (this.state === 'pursuit' || this.state === 'attack') {
      const target = this.targetIndex;
      if (target < 0 || target >= flock.count || flock.alive[target] === 0) {
        this.setSearchTargetAhead();
        this.targetIndex = -1;
        this.transition('search');
      } else {
        const offset = target * 3;
        const dx = flock.positions[offset] - this.position[0];
        const dy = flock.positions[offset + 1] - this.position[1];
        const dz = flock.positions[offset + 2] - this.position[2];
        const distance = Math.hypot(dx, dy, dz);
        this.lastSeen.set(flock.positions.subarray(offset, offset + 3));

        if (this.state === 'pursuit' && distance > this.config.predatorLoseRadius && this.stateTime > 1) {
          this.targetIndex = -1;
          this.transition('search');
        } else {
          const leadTime = clamp(distance / Math.max(1, Math.hypot(...this.velocity)), 0, 1.1);
          targetX = flock.positions[offset] + flock.velocities[offset] * leadTime * 0.8;
          targetY = flock.positions[offset + 1] + flock.velocities[offset + 1] * leadTime * 0.8;
          targetZ = flock.positions[offset + 2] + flock.velocities[offset + 2] * leadTime * 0.8;
          desiredSpeed = this.config.predatorPursuitSpeed * (0.8 + aggression * 0.25);
          if (this.state === 'attack') desiredSpeed *= 1.08;

          if (this.state === 'pursuit' && distance < this.config.predatorAttackRadius) {
            this.transition('attack');
          } else if (this.state === 'attack' && this.stateTime > 0.55) {
            this.targetIndex = -1;
            this.detectCooldown = 1.2;
            this.transition('search');
          }
        }
      }
    }

    if (this.state === 'search') {
      targetX = this.lastSeen[0];
      targetY = this.lastSeen[1];
      targetZ = this.lastSeen[2];
      desiredSpeed = this.config.predatorCruiseSpeed * 1.15;
      const distanceToLastSeen = Math.hypot(
        this.lastSeen[0] - this.position[0],
        this.lastSeen[1] - this.position[1],
        this.lastSeen[2] - this.position[2],
      );
      // Arriving must end the search: steering at a point already reached is
      // what used to turn the predator around on its own tail.
      if (distanceToLastSeen < SEARCH_ARRIVAL_RADIUS || this.stateTime > 2.4) {
        this.targetIndex = -1;
        this.transition('patrol');
      }
    }

    if (this.state === 'patrol') {
      const targetDistance = Math.hypot(
        this.patrolTarget[0] - this.position[0],
        this.patrolTarget[1] - this.position[1],
        this.patrolTarget[2] - this.position[2],
      );
      if (targetDistance < 2) this.choosePatrolTarget(flock);
      targetX = this.patrolTarget[0];
      targetY = this.patrolTarget[1];
      targetZ = this.patrolTarget[2];
    }

    const searchFloor = this.state === 'search' ? MIN_SEARCH_HORIZONTAL_SPEED : 0;
    this.steer(targetX, targetY, targetZ, desiredSpeed, delta, searchFloor);

    if (this.state === 'attack' && this.targetIndex >= 0) {
      const offset = this.targetIndex * 3;
      const distance = Math.hypot(
        flock.positions[offset] - this.position[0],
        flock.positions[offset + 1] - this.position[1],
        flock.positions[offset + 2] - this.position[2],
      );
      if (distance < this.config.predatorCaptureRadius && flock.remove(this.targetIndex)) {
        this.captures += 1;
        this.captureSerial += 1;
        this.targetIndex = -1;
        this.detectCooldown = 1.6;
        this.setSearchTargetAhead();
        this.transition('search');
      }
    }
  }

  private steer(
    targetX: number,
    targetY: number,
    targetZ: number,
    speed: number,
    delta: number,
    minHorizontalSpeed = 0,
  ): void {
    let dx = targetX - this.position[0];
    let dy = targetY - this.position[1];
    let dz = targetZ - this.position[2];
    const distance = Math.max(0.0001, Math.hypot(dx, dy, dz));
    dx /= distance;
    dy /= distance;
    dz /= distance;

    let ax = (dx * speed - this.velocity[0]) * 2.2;
    let ay = (dy * speed - this.velocity[1]) * 2.2;
    let az = (dz * speed - this.velocity[2]) * 2.2;
    this.obstacles.computeAvoidance(
      this.position[0], this.position[1], this.position[2],
      this.velocity[0], this.velocity[1], this.velocity[2],
      this.config, this.obstacleForce, false,
    );
    ax += this.obstacleForce[0];
    ay += this.obstacleForce[1];
    az += this.obstacleForce[2];
    addBoundaryForce(this.position[0], this.position[1], this.position[2], this.config, this.boundaryForce);
    ax += this.boundaryForce[0];
    ay += this.boundaryForce[1];
    az += this.boundaryForce[2];

    const acceleration = Math.hypot(ax, ay, az);
    if (acceleration > this.config.predatorMaxAcceleration) {
      const scale = this.config.predatorMaxAcceleration / acceleration;
      ax *= scale;
      ay *= scale;
      az *= scale;
    }
    this.velocity[0] += ax * delta;
    this.velocity[1] += ay * delta;
    this.velocity[2] += az * delta;
    const currentSpeed = Math.hypot(...this.velocity);
    const maximumSpeed = Math.max(speed, this.config.predatorCruiseSpeed);
    if (currentSpeed > maximumSpeed) {
      // Shed excess speed within the acceleration budget instead of scaling
      // the whole velocity in one step. The instant rescale produced 4+ m/s
      // dVel spikes whenever attack (fast) flipped to search (slow), which the
      // animation layer read as a lurch.
      const deceleration = this.config.predatorMaxAcceleration * delta;
      const limitedSpeed = Math.max(maximumSpeed, currentSpeed - deceleration);
      const scale = limitedSpeed / currentSpeed;
      this.velocity[0] *= scale;
      this.velocity[1] *= scale;
      this.velocity[2] *= scale;
    }
    if (minHorizontalSpeed > 0) {
      const horizontalSpeed = Math.hypot(this.velocity[0], this.velocity[2]);
      if (horizontalSpeed < minHorizontalSpeed) {
        // Search must keep a horizontal component; otherwise a near-vertical
        // target collapses vx/vz and the animation heading becomes noise.
        // Boost along the current horizontal direction when it exists so the
        // floor never reverses the shark; fall back to the stored heading only
        // when the horizontal vector is pure noise. Approach at the shared
        // acceleration budget, not as a snap.
        const headingX = horizontalSpeed > 0.1
          ? this.velocity[0] / horizontalSpeed
          : this.searchHeading[0];
        const headingZ = horizontalSpeed > 0.1
          ? this.velocity[2] / horizontalSpeed
          : this.searchHeading[1];
        const deltaX = headingX * minHorizontalSpeed - this.velocity[0];
        const deltaZ = headingZ * minHorizontalSpeed - this.velocity[2];
        const correction = Math.hypot(deltaX, deltaZ);
        const maxCorrection = this.config.predatorMaxAcceleration * delta;
        const scale = correction > maxCorrection ? maxCorrection / correction : 1;
        this.velocity[0] += deltaX * scale;
        this.velocity[2] += deltaZ * scale;
      }
    }
    this.position[0] += this.velocity[0] * delta;
    this.position[1] += this.velocity[1] * delta;
    this.position[2] += this.velocity[2] * delta;
    this.obstacles.constrain(this.position, this.velocity, 0, this.config, 0.7, false);
    constrainToBounds(this.position, this.velocity, 0, this.config, 0.65);
  }

  /**
   * Seed the search target ahead of the shark instead of at its own position.
   * A zero-length steer target makes the predator brake and circle the capture
   * point, degenerating into near-vertical motion and ±π heading flips.
   */
  private setSearchTargetAhead(): void {
    const speed = Math.hypot(...this.velocity);
    const lead = Math.max(3, this.config.predatorCruiseSpeed * 1.15 * SEARCH_LEAD_SECONDS);
    if (speed > 0.2) {
      const scale = lead / speed;
      this.lastSeen[0] = this.position[0] + this.velocity[0] * scale;
      this.lastSeen[1] = this.position[1] + this.velocity[1] * scale;
      this.lastSeen[2] = this.position[2] + this.velocity[2] * scale;
    } else {
      this.lastSeen.set(this.patrolTarget);
    }
    const { min, max } = this.config.bounds;
    this.lastSeen[0] = clamp(this.lastSeen[0], min[0] + 2, max[0] - 2);
    this.lastSeen[1] = clamp(this.lastSeen[1], min[1] + 2, max[1] - 2);
    this.lastSeen[2] = clamp(this.lastSeen[2], min[2] + 2, max[2] - 2);
    // If bounds clamping collapsed the lead point onto the shark, fall back to
    // the patrol point so search never steers at a zero-length target again.
    if (
      Math.hypot(
        this.lastSeen[0] - this.position[0],
        this.lastSeen[1] - this.position[1],
        this.lastSeen[2] - this.position[2],
      ) < 0.5
    ) {
      this.lastSeen.set(this.patrolTarget);
    }

    this.updateSearchHeading();
  }

  /** Track the horizontal heading while it is strong enough to trust. */
  private updateSearchHeading(): void {
    const horizontalSpeed = Math.hypot(this.velocity[0], this.velocity[2]);
    if (horizontalSpeed < SEARCH_HEADING_MIN_SPEED) return;
    this.searchHeading[0] = this.velocity[0] / horizontalSpeed;
    this.searchHeading[1] = this.velocity[2] / horizontalSpeed;
  }

  private findNearest(flock: FlockData, radius: number): number {
    let nearest = -1;
    let nearestDistanceSquared = radius * radius;
    const kelp = this.kelpRefuge;
    const kelpActive = kelp !== undefined && kelp.enabled;
    const closeRangeSquared = this.config.kelpOcclusionMinDistance ** 2;
    for (let i = 0; i < flock.count; i += 1) {
      if (flock.alive[i] === 0) continue;
      const offset = i * 3;
      const dx = flock.positions[offset] - this.position[0];
      const dy = flock.positions[offset + 1] - this.position[1];
      const dz = flock.positions[offset + 2] - this.position[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared >= nearestDistanceSquared) continue;
      if (this.obstacles.blocksSegment(
        this.position[0], this.position[1], this.position[2],
        flock.positions[offset], flock.positions[offset + 1], flock.positions[offset + 2],
        this.config,
      )) continue;
      // Kelp hides distant prey, but the shark can still strike within close
      // range; the refuge is not an absolute safe zone.
      if (
        kelpActive && kelp !== undefined
        && distanceSquared > closeRangeSquared
        && kelp.blocksSegment(
          this.position[0], this.position[1], this.position[2],
          flock.positions[offset], flock.positions[offset + 1], flock.positions[offset + 2],
        )
      ) continue;
      nearest = i;
      nearestDistanceSquared = distanceSquared;
    }
    return nearest;
  }

  private choosePatrolTarget(flock: FlockData): void {
    if (flock.aliveCount === 0) return;
    // Move through the school's current region without steering at its centroid forever.
    let sample = 0;
    for (let i = 0; i < flock.count; i += 1) {
      if (flock.alive[i] !== 0 && (sample++ === 0 || i % 37 === 0)) {
        const offset = i * 3;
        this.patrolTarget[0] = clamp(flock.positions[offset] + 5, this.config.bounds.min[0] + 2, this.config.bounds.max[0] - 2);
        this.patrolTarget[1] = clamp(flock.positions[offset + 1], this.config.bounds.min[1] + 2, this.config.bounds.max[1] - 2);
        this.patrolTarget[2] = clamp(flock.positions[offset + 2] - 5, this.config.bounds.min[2] + 2, this.config.bounds.max[2] - 2);
        return;
      }
    }
  }

  private transition(next: PredatorState): void {
    if (this.state !== next) {
      this.state = next;
      this.stateTime = 0;
    }
  }
}
