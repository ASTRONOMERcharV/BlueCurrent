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
  ) {
    this.grid = new UniformGrid3D(config, flock.capacity);
    this.bruteForce = new BruteForceSearch();
    this.search = this.grid;
    this.neighbors = new Int32Array(flock.capacity);
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
    let totalNeighbors = 0;
    let totalSeparationNeighbors = 0;
    let totalAlignmentNeighbors = 0;
    let totalCohesionScale = 0;
    let threatened = 0;
    let sheltered = 0;
    let shelterSeeking = 0;
    const kelp = this.kelpRefuge;
    const kelpActive = kelp !== undefined && kelp.enabled;
    const measureObstacleQueries = this.metrics?.enabled === true;
    const neighbors = this.neighbors;
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
      if (cover >= config.kelpCoverThreshold) sheltered += 1;
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

      for (let n = 0; n < neighborCount; n += 1) {
        const other = neighbors[n];
        const otherOffset = other * 3;
        const dx = positions[otherOffset] - px;
        const dy = positions[otherOffset + 1] - py;
        const dz = positions[otherOffset + 2] - pz;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        neighborFear = Math.max(neighborFear, fear[other]);

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
          alignmentX += velocities[otherOffset];
          alignmentY += velocities[otherOffset + 1];
          alignmentZ += velocities[otherOffset + 2];
          alignmentCount += 1;
          totalAlignmentNeighbors += 1;
        }
        if (distanceSquared <= cohesionRadiusSquared) {
          cohesionX += positions[otherOffset];
          cohesionY += positions[otherOffset + 1];
          cohesionZ += positions[otherOffset + 2];
          cohesionCount += 1;
        }
      }

      if (alignmentCount > 0) {
        alignmentX = alignmentX / alignmentCount - vx;
        alignmentY = alignmentY / alignmentCount - vy;
        alignmentZ = alignmentZ / alignmentCount - vz;
      }
      if (cohesionCount > 0) {
        cohesionX = cohesionX / cohesionCount - px;
        cohesionY = cohesionY / cohesionCount - py;
        cohesionZ = cohesionZ / cohesionCount - pz;
      }

      const separationForceX = config.separationWeight * separationX;
      const separationForceY = config.separationWeight * separationY;
      const separationForceZ = config.separationWeight * separationZ;
      const alignmentForceX = config.alignmentWeight * alignmentX;
      const alignmentForceY = config.alignmentWeight * alignmentY;
      const alignmentForceZ = config.alignmentWeight * alignmentZ;
      const cohesionScale = densityAwareCohesionScale(alignmentCount, config);
      totalCohesionScale += cohesionScale;
      const cohesionForceX = config.cohesionWeight * cohesionScale * cohesionX;
      const cohesionForceY = config.cohesionWeight * cohesionScale * cohesionY;
      const cohesionForceZ = config.cohesionWeight * cohesionScale * cohesionZ;
      let ax = separationForceX + alignmentForceX + cohesionForceX;
      let ay = separationForceY + alignmentForceY + cohesionForceY;
      let az = separationForceZ + alignmentForceZ + cohesionForceZ;

      let fearLevel = 0;
      let directFear = 0;
      let escapeX = 0;
      let escapeY = 0;
      let escapeZ = 0;
      if (config.predatorEnabled) {
        const dx = px - predator.position[0];
        const dy = py - predator.position[1];
        const dz = pz - predator.position[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const inverseDistance = 1 / Math.max(distance, 1e-4);
        const radialX = dx * inverseDistance;
        const radialY = dy * inverseDistance;
        const radialZ = dz * inverseDistance;

        // Closing speed extends the perceived threat range: fish react earlier
        // to an approaching predator than to a receding one.
        const closingSpeed = -(
          predator.velocity[0] * radialX
          + predator.velocity[1] * radialY
          + predator.velocity[2] * radialZ
        );
        const threatRadius = config.evasionRadius
          + Math.max(0, closingSpeed) * config.evasionPredictionTime;
        const propagated = neighborFear * config.fearPropagation;
        if (distance < threatRadius) {
          directFear = Math.max(0, Math.min(1, 1 - distance / threatRadius));
          const reefBlocked = this.obstacles.blocksSegment(
            predator.position[0], predator.position[1], predator.position[2],
            px, py, pz,
            config,
          );
          const kelpBlocked = kelpActive && kelp !== undefined && kelp.blocksSegment(
            predator.position[0], predator.position[1], predator.position[2],
            px, py, pz,
          );
          directFear *= kelpBlocked
            ? config.kelpFearMultiplier
            : reefBlocked ? 0.25 : 1;
          if (directFear > 0.15 && !reefBlocked && !kelpBlocked) threatened += 1;
        }
        fearLevel = Math.max(directFear, propagated);

        if (fearLevel > 0.001) {
          const escapeForce = config.maxAcceleration * config.evasionWeight * fearLevel * fearLevel;
          // A lateral component turns the uniform radial panic into a
          // per-fish escape direction; its sign is deterministic per fish.
          const phaseWave = Math.sin(this.flock.phases[i] * 3.7);
          const sideSign = phaseWave >= 0 ? 1 : -1;
          const lateral = config.evasionLateralWeight
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
          && directFear > config.kelpShelterFearThreshold
          && cover < config.kelpCoverThreshold
        ) {
          const proximity = kelp.nearestRefuge(
            px, py, pz, config.kelpShelterRadius, this.shelterDirection,
          );
          if (proximity > 0) {
            const shelterForce = config.maxAcceleration
              * config.kelpShelterWeight
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
      this.obstacles.computeAvoidance(px, py, pz, vx, vy, vz, config, this.obstacleForce);
      ax += this.obstacleForce[0];
      ay += this.obstacleForce[1];
      az += this.obstacleForce[2];
      if (measureObstacleQueries) {
        this.metrics!.addQueryTime(performance.now() - avoidanceQueryStart);
      }
      addBoundaryForce(px, py, pz, config, this.boundaryForce);
      ax += this.boundaryForce[0];
      ay += this.boundaryForce[1];
      az += this.boundaryForce[2];

      // The reef-dwelling second school keeps a soft habitat anchor. It is a
      // real steering force with a smooth ramp, never a hard teleport.
      const homeCenter = config.homeCenter;
      const homeWeight = config.homeWeight ?? 0;
      if (homeCenter && homeWeight > 0) {
        const homeX = homeCenter[0] - px;
        const homeY = homeCenter[1] - py;
        const homeZ = homeCenter[2] - pz;
        const homeDistance = Math.sqrt(
          homeX * homeX + homeY * homeY + homeZ * homeZ,
        );
        const homeRadius = Math.max(0.1, config.homeRadius ?? 3);
        if (homeDistance > homeRadius) {
          const t = Math.min(1, (homeDistance - homeRadius) / homeRadius);
          const smooth = t * t * (3 - 2 * t);
          const force = config.maxAcceleration * homeWeight * smooth;
          const inverse = 1 / homeDistance;
          ax += homeX * inverse * force;
          ay += homeY * inverse * force;
          az += homeZ * inverse * force;
        }
      }

      const acceleration = Math.sqrt(ax * ax + ay * ay + az * az);
      const coverAccelerationScale = Math.max(
        0.05,
        1 - config.kelpCoverAccelerationPenalty * cover,
      );
      const maximumAcceleration = config.maxAcceleration
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
      const coverSpeedScale = Math.max(0.05, 1 - config.kelpCoverSpeedPenalty * cover);
      const maximumSpeed = config.maxSpeed * (1 + fearLevel * 0.25) * coverSpeedScale;
      if (nextSpeed > maximumSpeed) {
        const scale = maximumSpeed / nextSpeed;
        nextVx *= scale;
        nextVy *= scale;
        nextVz *= scale;
        nextSpeed = maximumSpeed;
      } else if (nextSpeed < config.minSpeed) {
        if (nextSpeed > 1e-5) {
          const scale = config.minSpeed / nextSpeed;
          nextVx *= scale;
          nextVy *= scale;
          nextVz *= scale;
        } else {
          nextVx = config.minSpeed;
          nextVy = 0;
          nextVz = 0;
        }
        nextSpeed = config.minSpeed;
      }

      clampVelocityTurn(
        vx, vy, vz,
        nextVx, nextVy, nextVz,
        config.maxTurnRate, delta, this.velocityTurn,
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
        this.metrics!.addQueryTime(performance.now() - constrainQueryStart);
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
  }
}
