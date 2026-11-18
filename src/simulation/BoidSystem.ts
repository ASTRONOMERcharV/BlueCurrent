import { BruteForceSearch } from '../spatial/BruteForceSearch';
import type { NeighborSearch } from '../spatial/NeighborSearch';
import { UniformGrid3D } from '../spatial/UniformGrid3D';
import type { KelpRefugeField } from '../environment/KelpRefugeField';
import type { FlockData } from './FlockData';
import { maximumNeighborRadius } from './SimulationConfig';
import type { NeighborSearchMode, SimulationConfig } from './SimulationConfig';
import { clamp, clampVelocityTurn } from './math';
import type { ObstacleSystem } from './ObstacleSystem';
import { addBoundaryForce, constrainToBounds } from './EnvironmentForces';
import type { PredatorSystem } from './PredatorSystem';
import type { ReefObstacleMetrics } from './ReefObstacleMetrics';
import type { PhaseEmaRecorder } from './PerformanceTelemetry';

/** Read-only diagnostics for one fish; these values never feed back into steering. */
export interface BoidDebugSample {
  index: number;
  neighborCount: number;
  neighbors: Int32Array;
  readonly separation: Float32Array;
  readonly alignment: Float32Array;
  readonly cohesion: Float32Array;
  readonly escape: Float32Array;
}

/** Fade aggregation only when the local alignment neighborhood is crowded. */
export function densityAwareCohesionScale(
  alignmentNeighbors: number,
  config: Pick<SimulationConfig, 'cohesionDensityTarget' | 'cohesionDensityMinScale'>,
): number {
  if (config.cohesionDensityTarget <= 0) return 1;
  const densityScale = config.cohesionDensityTarget
    / Math.max(config.cohesionDensityTarget, alignmentNeighbors);
  return clamp(densityScale, config.cohesionDensityMinScale, 1);
}

/**
 * Alignment weight by heading agreement: same direction keeps full weight,
 * perpendicular halves it, opposite reaches zero. Never alters the plain
 * alignment target when the E2 blend is zero.
 */
export function alignmentAgreementWeight(dot: number): number {
  return 0.5 + 0.5 * clamp(dot, -1, 1);
}

/** Extra separation in crowded pockets; 1 below the density target. */
export function densityAwareSeparationScale(
  alignmentNeighbors: number,
  config: Pick<
    SimulationConfig,
    'schoolDynamicsEnabled' | 'separationDensityBoost' | 'cohesionDensityTarget'
  >,
): number {
  if (
    !config.schoolDynamicsEnabled
    || config.separationDensityBoost <= 0
    || config.cohesionDensityTarget <= 0
  ) {
    return 1;
  }
  const crowding = alignmentNeighbors / config.cohesionDensityTarget - 1;
  return Math.min(1.75, 1 + config.separationDensityBoost * clamp(crowding, 0, 1.5));
}

/** One-hop alarm propagation with a noise floor; legacy keeps the plain hop. */
export function propagatedFear(
  neighborFear: number,
  config: Pick<
    SimulationConfig,
    'schoolDynamicsEnabled' | 'startlePropagationThreshold' | 'fearPropagation'
  >,
): number {
  if (
    config.schoolDynamicsEnabled
    && config.startlePropagationThreshold > 0
    && neighborFear < config.startlePropagationThreshold
  ) {
    return 0;
  }
  return neighborFear * config.fearPropagation;
}

/** All neighbor rules are shared by both search implementations. */
export class BoidSystem {
  readonly grid: UniformGrid3D;
  readonly bruteForce: BruteForceSearch;
  averageNeighbors = 0;
  averageSeparationNeighbors = 0;
  averageAlignmentNeighbors = 0;
  averageCohesionScale = 1;
  threatenedCount = 0;
  /** Fish whose real kelp cover is at or above the configured threshold. */
  shelteredCount = 0;
  /** Fish that received a fear-gated steering force toward kelp this step. */
  shelterSeekingCount = 0;
  debugFishIndex = 0;
  readonly debugSample: BoidDebugSample = {
    index: -1,
    neighborCount: 0,
    neighbors: new Int32Array(0),
    separation: new Float32Array(3),
    alignment: new Float32Array(3),
    cohesion: new Float32Array(3),
    escape: new Float32Array(3),
  };

  private search: NeighborSearch;
  private readonly neighbors: Int32Array;
  private readonly speeds: Float64Array;
  private readonly obstacleForce = new Float32Array(3);
  private readonly boundaryForce = new Float32Array(3);
  private readonly velocityTurn = new Float32Array(3);
  private readonly shelterDirection = new Float32Array(3);

  constructor(
    private readonly flock: FlockData,
    private readonly config: SimulationConfig,
    private readonly obstacles: ObstacleSystem,
    private readonly kelpRefuge?: KelpRefugeField,
    private readonly metrics?: ReefObstacleMetrics,
    private readonly performanceTelemetry?: PhaseEmaRecorder,
  ) {
    this.grid = new UniformGrid3D(config, flock.capacity);
    this.bruteForce = new BruteForceSearch();
    this.search = this.grid;
    this.neighbors = new Int32Array(flock.capacity);
    this.speeds = new Float64Array(flock.capacity);
    this.debugSample.neighbors = new Int32Array(flock.capacity);
  }

  get searchMode(): NeighborSearchMode {
    return this.search.mode;
  }

  get candidatesExamined(): number {
    return this.search.candidatesExamined;
  }

  setSearchMode(mode: NeighborSearchMode): void {
    this.search = mode === 'grid' ? this.grid : this.bruteForce;
    // Keep paused debug views and occupied-cell telemetry on the current state.
    if (mode === 'grid') this.grid.rebuild(this.flock, maximumNeighborRadius(this.config));
  }

  update(delta: number, predator: PredatorSystem): void {
    const { positions, velocities, nextPositions, nextVelocities, alive, count, fear, nextFear } = this.flock;
    const config = this.config;
    const radius = maximumNeighborRadius(config);
    this.search.rebuild(this.flock, radius);

    const separationRadiusSquared = config.separationRadius ** 2;
    const alignmentRadiusSquared = config.alignmentRadius ** 2;
    const cohesionRadiusSquared = config.cohesionRadius ** 2;
    const cosHalfFov = Math.cos((config.fieldOfViewDegrees * Math.PI) / 360);
    const restrictFov = config.fieldOfViewDegrees < 359.999;
    // Every value below is fixed for the whole step; hoisting keeps the
    // per-fish loop free of repeated property loads without changing math.
    const separationWeight = config.separationWeight;
    const alignmentWeight = config.alignmentWeight;
    const cohesionWeight = config.cohesionWeight;
    const maxAcceleration = config.maxAcceleration;
    const maxSpeed = config.maxSpeed;
    const minSpeed = config.minSpeed;
    const maxTurnRate = config.maxTurnRate;
    const predatorEnabled = config.predatorEnabled;
    const schoolDynamicsEnabled = config.schoolDynamicsEnabled;
    const weightedAlignment = schoolDynamicsEnabled && config.alignmentAgreementBlend > 0;
    const alignmentBlend = clamp(config.alignmentAgreementBlend, 0, 1);
    const obstacleAnticipationBlend = config.obstacleAnticipationBlend;
    const anticipateObstacles = schoolDynamicsEnabled && obstacleAnticipationBlend > 0;
    const kelpCoverThreshold = config.kelpCoverThreshold;
    const kelpCoverAccelerationPenalty = config.kelpCoverAccelerationPenalty;
    const kelpCoverSpeedPenalty = config.kelpCoverSpeedPenalty;
    const evasionRadius = config.evasionRadius;
    const evasionPredictionTime = config.evasionPredictionTime;
    const evasionWeight = config.evasionWeight;
    const evasionLateralWeight = config.evasionLateralWeight;
    const kelpFearMultiplier = config.kelpFearMultiplier;
    const kelpShelterFearThreshold = config.kelpShelterFearThreshold;
    const kelpShelterRadius = config.kelpShelterRadius;
    const kelpShelterWeight = config.kelpShelterWeight;
    const habitatCenter = config.habitatCenter;
    const habitatAttractWeight = config.habitatAttractWeight ?? 0;
    const habitatAttractRadius = Math.max(0.2, config.habitatAttractRadius ?? 3.4);
    const habitatCoreRadius = clamp(config.habitatCoreRadius ?? 1.1, 0.05, habitatAttractRadius * 0.9);
    const habitatRepelWeight = config.habitatRepelWeight ?? 0.7;
    const homeCenter = config.homeCenter;
    const homeWeight = config.homeWeight ?? 0;
    const homeRadius = Math.max(0.1, config.homeRadius ?? 3);
    const predatorX = predator.position[0];
    const predatorY = predator.position[1];
    const predatorZ = predator.position[2];
    const predatorVx = predator.velocity[0];
    const predatorVy = predator.velocity[1];
    const predatorVz = predator.velocity[2];
    let totalNeighbors = 0;
    let totalSeparationNeighbors = 0;
    let totalAlignmentNeighbors = 0;
    let totalCohesionScale = 0;
    let threatened = 0;
    let sheltered = 0;
    let shelterSeeking = 0;
    const kelp = this.kelpRefuge;
    const kelpActive = kelp !== undefined && kelp.enabled;
    const measureObstacleQueries = this.metrics?.enabled === true
      || this.performanceTelemetry?.enabled === true;
    let obstacleQueryMs = 0;
    const neighbors = this.neighbors;
    const speeds = this.speeds;
    for (let i = 0; i < count; i += 1) {
      const offset = i * 3;
      const vx = velocities[offset];
      const vy = velocities[offset + 1];
      const vz = velocities[offset + 2];
      speeds[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    this.debugSample.index = -1;
    this.debugSample.neighborCount = 0;

    for (let i = 0; i < count; i += 1) {
      if (alive[i] === 0) continue;
      const offset = i * 3;
      const px = positions[offset];
      const py = positions[offset + 1];
      const pz = positions[offset + 2];
      const vx = velocities[offset];
      const vy = velocities[offset + 1];
      const vz = velocities[offset + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const cover = kelpActive && kelp ? kelp.coverAt(px, py, pz) : 0;
      if (cover >= kelpCoverThreshold) sheltered += 1;
      const neighborCount = this.search.collect(i, radius, neighbors);
      totalNeighbors += neighborCount;

      let separationX = 0;
      let separationY = 0;
      let separationZ = 0;
      let alignmentX = 0;
      let alignmentY = 0;
      let alignmentZ = 0;
      let cohesionX = 0;
      let cohesionY = 0;
      let cohesionZ = 0;
      let alignmentCount = 0;
      let cohesionCount = 0;
      let neighborFear = 0;
      let agreementWeight = 0;
      let agreementX = 0;
      let agreementY = 0;
      let agreementZ = 0;

      for (let n = 0; n < neighborCount; n += 1) {
        const other = neighbors[n];
        const otherOffset = other * 3;
        const dx = positions[otherOffset] - px;
        const dy = positions[otherOffset + 1] - py;
        const dz = positions[otherOffset + 2] - pz;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (predatorEnabled) neighborFear = Math.max(neighborFear, fear[other]);

        if (distanceSquared <= separationRadiusSquared) {
          const inverse = 1 / (distanceSquared + 1e-4);
          separationX -= dx * inverse;
          separationY -= dy * inverse;
          separationZ -= dz * inverse;
          totalSeparationNeighbors += 1;
        }

        let visible = true;
        if (restrictFov && speed > 1e-5 && distanceSquared > 1e-8) {
          const dot = (vx * dx + vy * dy + vz * dz) / (speed * Math.sqrt(distanceSquared));
          visible = dot >= cosHalfFov;
        }
        if (!visible) continue;

        if (distanceSquared <= alignmentRadiusSquared) {
          const otherVx = velocities[otherOffset];
          const otherVy = velocities[otherOffset + 1];
          const otherVz = velocities[otherOffset + 2];
          alignmentX += otherVx;
          alignmentY += otherVy;
          alignmentZ += otherVz;
          alignmentCount += 1;
          totalAlignmentNeighbors += 1;
          if (weightedAlignment) {
            const otherSpeed = speeds[other];
            const denominator = speed * otherSpeed;
            const dot = denominator > 1e-9
              ? (vx * otherVx + vy * otherVy + vz * otherVz) / denominator
              : 1;
            const weight = 0.5 + 0.5 * clamp(dot, -1, 1);
            agreementWeight += weight;
            agreementX += otherVx * weight;
            agreementY += otherVy * weight;
            agreementZ += otherVz * weight;
          }
        }
        if (distanceSquared <= cohesionRadiusSquared) {
          cohesionX += positions[otherOffset];
          cohesionY += positions[otherOffset + 1];
          cohesionZ += positions[otherOffset + 2];
          cohesionCount += 1;
        }
      }

      if (alignmentCount > 0) {
        const plainX = alignmentX / alignmentCount - vx;
        const plainY = alignmentY / alignmentCount - vy;
        const plainZ = alignmentZ / alignmentCount - vz;
        if (weightedAlignment && agreementWeight > 0) {
          const blend = alignmentBlend;
          const weightedX = agreementX / agreementWeight - vx;
          const weightedY = agreementY / agreementWeight - vy;
          const weightedZ = agreementZ / agreementWeight - vz;
          alignmentX = plainX * (1 - blend) + weightedX * blend;
          alignmentY = plainY * (1 - blend) + weightedY * blend;
          alignmentZ = plainZ * (1 - blend) + weightedZ * blend;
        } else {
          alignmentX = plainX;
          alignmentY = plainY;
          alignmentZ = plainZ;
        }
      }
      if (cohesionCount > 0) {
        cohesionX = cohesionX / cohesionCount - px;
        cohesionY = cohesionY / cohesionCount - py;
        cohesionZ = cohesionZ / cohesionCount - pz;
      }

      const separationScale = densityAwareSeparationScale(alignmentCount, config);
      const separationForceX = separationWeight * separationScale * separationX;
      const separationForceY = separationWeight * separationScale * separationY;
      const separationForceZ = separationWeight * separationScale * separationZ;
      const alignmentForceX = alignmentWeight * alignmentX;
      const alignmentForceY = alignmentWeight * alignmentY;
      const alignmentForceZ = alignmentWeight * alignmentZ;
      const cohesionScale = densityAwareCohesionScale(alignmentCount, config);
      totalCohesionScale += cohesionScale;
      const cohesionForceX = cohesionWeight * cohesionScale * cohesionX;
      const cohesionForceY = cohesionWeight * cohesionScale * cohesionY;
      const cohesionForceZ = cohesionWeight * cohesionScale * cohesionZ;
      let ax = separationForceX + alignmentForceX + cohesionForceX;
      let ay = separationForceY + alignmentForceY + cohesionForceY;
      let az = separationForceZ + alignmentForceZ + cohesionForceZ;

      let fearLevel = 0;
      let directFear = 0;
      let escapeX = 0;
      let escapeY = 0;
      let escapeZ = 0;
      if (predatorEnabled) {
        const dx = px - predatorX;
        const dy = py - predatorY;
        const dz = pz - predatorZ;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const inverseDistance = 1 / Math.max(distance, 1e-4);
        const radialX = dx * inverseDistance;
        const radialY = dy * inverseDistance;
        const radialZ = dz * inverseDistance;

        // Closing speed extends the perceived threat range: fish react earlier
        // to an approaching predator than to a receding one.
        const closingSpeed = -(
          predatorVx * radialX
          + predatorVy * radialY
          + predatorVz * radialZ
        );
        const threatRadius = evasionRadius
          + Math.max(0, closingSpeed) * evasionPredictionTime;
        const propagated = propagatedFear(neighborFear, config);
        if (distance < threatRadius) {
          directFear = Math.max(0, Math.min(1, 1 - distance / threatRadius));
          const reefBlocked = this.obstacles.blocksSegment(
            predatorX, predatorY, predatorZ,
            px, py, pz,
            config,
          );
          const kelpBlocked = kelpActive && kelp !== undefined && kelp.blocksSegment(
            predatorX, predatorY, predatorZ,
            px, py, pz,
          );
          directFear *= kelpBlocked
            ? kelpFearMultiplier
            : reefBlocked ? 0.25 : 1;
          if (directFear > 0.15 && !reefBlocked && !kelpBlocked) threatened += 1;
        }
        fearLevel = Math.max(directFear, propagated);

        if (fearLevel > 0.001) {
          const escapeForce = maxAcceleration * evasionWeight * fearLevel * fearLevel;
          // A lateral component turns the uniform radial panic into a
          // per-fish escape direction; its sign is deterministic per fish.
          const phaseWave = Math.sin(this.flock.phases[i] * 3.7);
          const sideSign = phaseWave >= 0 ? 1 : -1;
          const lateral = evasionLateralWeight
            * (0.5 + 0.5 * Math.abs(phaseWave));
          const lateralX = radialY * sideSign;
          const lateralY = -radialX * sideSign;
          const lateralZ = 0;
          const lateralLength = Math.sqrt(
            lateralX * lateralX + lateralY * lateralY + lateralZ * lateralZ,
          ) || 1;
          escapeX = escapeForce * (
            radialX * (1 - lateral)
            + (lateralX / lateralLength) * lateral
          );
          escapeY = escapeForce * (
            radialY * (1 - lateral)
            + (lateralY / lateralLength) * lateral
          );
          escapeZ = escapeForce * radialZ * (1 - lateral);
          ax += escapeX;
          ay += escapeY;
          az += escapeZ;
        }

        // Only a real direct threat opens the refuge response. Normal schooling
        // must never bend toward kelp, and a fish already inside dense cover
        // should not be pulled toward the nearest stalk.
        if (
          kelpActive && kelp !== undefined
          && directFear > kelpShelterFearThreshold
          && cover < kelpCoverThreshold
        ) {
          const proximity = kelp.nearestRefuge(
            px, py, pz, kelpShelterRadius, this.shelterDirection,
          );
          if (proximity > 0) {
            const shelterForce = maxAcceleration
              * kelpShelterWeight
              * fearLevel * fearLevel
              * proximity;
            ax += this.shelterDirection[0] * shelterForce;
            ay += this.shelterDirection[1] * shelterForce;
            az += this.shelterDirection[2] * shelterForce;
            shelterSeeking += 1;
          }
        }
      }
      nextFear[i] = fearLevel;

      const avoidanceQueryStart = measureObstacleQueries ? performance.now() : 0;
      let obstacleVelocityX = vx;
      let obstacleVelocityY = vy;
      let obstacleVelocityZ = vz;
      if (anticipateObstacles) {
        obstacleVelocityX = vx + alignmentX * obstacleAnticipationBlend;
        obstacleVelocityY = vy + alignmentY * obstacleAnticipationBlend;
        obstacleVelocityZ = vz + alignmentZ * obstacleAnticipationBlend;
      }
      this.obstacles.computeAvoidance(
        px, py, pz,
        obstacleVelocityX, obstacleVelocityY, obstacleVelocityZ,
        config, this.obstacleForce,
      );
      ax += this.obstacleForce[0];
      ay += this.obstacleForce[1];
      az += this.obstacleForce[2];
      if (measureObstacleQueries) {
        const queryMs = performance.now() - avoidanceQueryStart;
        if (this.metrics?.enabled) this.metrics.addQueryTime(queryMs);
        obstacleQueryMs += queryMs;
      }
      addBoundaryForce(
        px, py, pz, config, this.boundaryForce,
        schoolDynamicsEnabled ? fearLevel : 0,
      );
      ax += this.boundaryForce[0];
      ay += this.boundaryForce[1];
      az += this.boundaryForce[2];

      // The reef-dwelling second school keeps a soft habitat anchor. It is a
      // real steering force with a smooth ramp, never a hard teleport. Phase E4
      // replaces the point home with an annular anemone habitat when present.
      if (habitatCenter && habitatAttractWeight > 0) {
        const habitatX = habitatCenter[0] - px;
        const habitatY = habitatCenter[1] - py;
        const habitatZ = habitatCenter[2] - pz;
        const habitatDistance = Math.sqrt(
          habitatX * habitatX + habitatY * habitatY + habitatZ * habitatZ,
        );
        const attractRadius = habitatAttractRadius;
        const coreRadius = habitatCoreRadius;
        const fearScale = 1 - 0.5 * clamp(fearLevel, 0, 1);
        if (habitatDistance > attractRadius && habitatDistance > 1e-6) {
          const t = Math.min(1, (habitatDistance - attractRadius) / Math.max(1, attractRadius));
          const smooth = t * t * (3 - 2 * t);
          const force = maxAcceleration * habitatAttractWeight * smooth * fearScale;
          const inverse = 1 / habitatDistance;
          ax += habitatX * inverse * force;
          ay += habitatY * inverse * force;
          az += habitatZ * inverse * force;
        } else if (habitatDistance < coreRadius && habitatDistance > 1e-6) {
          const t = 1 - habitatDistance / coreRadius;
          const smooth = t * t * (3 - 2 * t);
          const force = maxAcceleration
            * habitatRepelWeight * smooth * fearScale;
          const inverse = -1 / habitatDistance;
          ax += habitatX * inverse * force;
          ay += habitatY * inverse * force;
          az += habitatZ * inverse * force;
        }
      } else if (homeCenter && homeWeight > 0) {
        const homeX = homeCenter[0] - px;
        const homeY = homeCenter[1] - py;
        const homeZ = homeCenter[2] - pz;
        const homeDistance = Math.sqrt(
          homeX * homeX + homeY * homeY + homeZ * homeZ,
        );
        if (homeDistance > homeRadius) {
          const t = Math.min(1, (homeDistance - homeRadius) / homeRadius);
          const smooth = t * t * (3 - 2 * t);
          const force = maxAcceleration * homeWeight * smooth;
          const inverse = 1 / homeDistance;
          ax += homeX * inverse * force;
          ay += homeY * inverse * force;
          az += homeZ * inverse * force;
        }
      }

      const acceleration = Math.sqrt(ax * ax + ay * ay + az * az);
      const coverAccelerationScale = Math.max(
        0.05,
        1 - kelpCoverAccelerationPenalty * cover,
      );
      const maximumAcceleration = maxAcceleration
        * (1 + fearLevel * 0.25)
        * coverAccelerationScale;
      if (acceleration > maximumAcceleration) {
        const scale = maximumAcceleration / acceleration;
        ax *= scale;
        ay *= scale;
        az *= scale;
      }

      let nextVx = vx + ax * delta;
      let nextVy = vy + ay * delta;
      let nextVz = vz + az * delta;
      let nextSpeed = Math.sqrt(nextVx * nextVx + nextVy * nextVy + nextVz * nextVz);
      const coverSpeedScale = Math.max(0.05, 1 - kelpCoverSpeedPenalty * cover);
      const maximumSpeed = maxSpeed * (1 + fearLevel * 0.25) * coverSpeedScale;
      if (nextSpeed > maximumSpeed) {
        const scale = maximumSpeed / nextSpeed;
        nextVx *= scale;
        nextVy *= scale;
        nextVz *= scale;
        nextSpeed = maximumSpeed;
      } else if (nextSpeed < minSpeed) {
        if (nextSpeed > 1e-5) {
          const scale = minSpeed / nextSpeed;
          nextVx *= scale;
          nextVy *= scale;
          nextVz *= scale;
        } else {
          nextVx = minSpeed;
          nextVy = 0;
          nextVz = 0;
        }
        nextSpeed = minSpeed;
      }

      clampVelocityTurn(
        vx, vy, vz,
        nextVx, nextVy, nextVz,
        maxTurnRate, delta, this.velocityTurn,
      );
      nextVx = this.velocityTurn[0];
      nextVy = this.velocityTurn[1];
      nextVz = this.velocityTurn[2];
      nextSpeed = Math.sqrt(nextVx * nextVx + nextVy * nextVy + nextVz * nextVz);
      nextVelocities[offset] = nextVx;
      nextVelocities[offset + 1] = nextVy;
      nextVelocities[offset + 2] = nextVz;
      nextPositions[offset] = px + nextVx * delta;
      nextPositions[offset + 1] = py + nextVy * delta;
      nextPositions[offset + 2] = pz + nextVz * delta;

      // Signed yaw rate drives a smoothed bank angle for rendering.
      if (speed > 1e-4 && nextSpeed > 1e-4) {
        const crossY = vz * nextVx - vx * nextVz;
        const turnRate = crossY / (speed * nextSpeed * delta);
        const targetBank = clamp(turnRate * 0.09, -0.65, 0.65);
        this.flock.nextBanks[i] = this.flock.banks[i] + (targetBank - this.flock.banks[i]) * Math.min(1, delta * 5);
      } else {
        this.flock.nextBanks[i] = this.flock.banks[i];
      }

      const constrainQueryStart = measureObstacleQueries ? performance.now() : 0;
      this.obstacles.constrain(nextPositions, nextVelocities, offset, config, 0.28);
      if (measureObstacleQueries) {
        const queryMs = performance.now() - constrainQueryStart;
        if (this.metrics?.enabled) this.metrics.addQueryTime(queryMs);
        obstacleQueryMs += queryMs;
      }
      constrainToBounds(nextPositions, nextVelocities, offset, config, 0.08);

      if (i === this.debugFishIndex) {
        const sample = this.debugSample;
        sample.index = i;
        sample.neighborCount = neighborCount;
        sample.neighbors.set(neighbors.subarray(0, neighborCount));
        sample.separation.set([separationForceX, separationForceY, separationForceZ]);
        sample.alignment.set([alignmentForceX, alignmentForceY, alignmentForceZ]);
        sample.cohesion.set([cohesionForceX, cohesionForceY, cohesionForceZ]);
        sample.escape.set([escapeX, escapeY, escapeZ]);
      }
    }

    this.averageNeighbors = this.flock.aliveCount > 0 ? totalNeighbors / this.flock.aliveCount : 0;
    this.averageSeparationNeighbors = this.flock.aliveCount > 0
      ? totalSeparationNeighbors / this.flock.aliveCount
      : 0;
    this.averageAlignmentNeighbors = this.flock.aliveCount > 0
      ? totalAlignmentNeighbors / this.flock.aliveCount
      : 0;
    this.averageCohesionScale = this.flock.aliveCount > 0 ? totalCohesionScale / this.flock.aliveCount : 1;
    this.threatenedCount = threatened;
    this.shelteredCount = sheltered;
    this.shelterSeekingCount = shelterSeeking;
    if (this.performanceTelemetry?.enabled) {
      this.performanceTelemetry.addPhaseMs('obstacleQuery', obstacleQueryMs);
    }
  }
}
