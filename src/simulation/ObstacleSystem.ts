import type { ObstacleShapeMode, SimulationConfig } from './SimulationConfig';
import {
  type ReefProxyQueryResult,
  type ReefProxySet,
} from './ReefCollisionProxy';
import type { ReefObstacleMetrics } from './ReefObstacleMetrics';

export interface ObstacleDefinition {
  readonly center: readonly [number, number, number];
  readonly radius: number;
  readonly variant: number;
}

export const REEF_OBSTACLES: readonly ObstacleDefinition[] = [
  { center: [-7, 3.4, -3], radius: 3.4, variant: 0 },
  { center: [5, 3.5, 4], radius: 3.5, variant: 1 },
  { center: [0, 3.6, -9], radius: 3.6, variant: 2 },
  { center: [11, 3.2, -7], radius: 3.2, variant: 0 },
  { center: [-12, 3.4, 9], radius: 3.4, variant: 1 },
];

/**
 * Predictive obstacle avoidance. Sphere mode is the original collider and is
 * kept bit-for-bit; reefProxy mode replaces each sphere with a compound SDF
 * built from the loaded reef geometry.
 */
export class ObstacleSystem {
  readonly definitions = REEF_OBSTACLES;
  private proxySet?: ReefProxySet;
  private shapeMode: ObstacleShapeMode = 'sphere';
  private metrics?: ReefObstacleMetrics;
  private readonly proxyNormal = new Float32Array(3);
  private readonly proxyPredictedNormal = new Float32Array(3);

  /** True once the renderer has installed the five reef proxies. */
  get proxyActive(): boolean {
    return this.proxySet !== undefined;
  }

  getProxySet(): ReefProxySet | undefined {
    return this.proxySet;
  }

  setProxySet(set: ReefProxySet | undefined): void {
    this.proxySet = set;
  }

  setShapeMode(mode: ObstacleShapeMode): void {
    this.shapeMode = mode;
  }

  setMetrics(metrics: ReefObstacleMetrics | undefined): void {
    this.metrics = metrics;
  }

  private usesProxy(config?: SimulationConfig): boolean {
    if (!this.proxySet) return false;
    const mode = config?.obstacleShapeMode ?? this.shapeMode;
    return mode === 'reefProxy';
  }

  /**
   * True when the line between two points crosses any obstacle collider.
   * Used for line-of-sight checks only; it does not change avoidance forces.
   */
  blocksSegment(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    config?: SimulationConfig,
  ): boolean {
    if (this.usesProxy(config)) return this.blocksSegmentProxy(x0, y0, z0, x1, y1, z1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    if (lengthSquared <= 1e-12) return false;
    for (const obstacle of this.definitions) {
      const [cx, cy, cz] = obstacle.center;
      const ox = x0 - cx;
      const oy = y0 - cy;
      const oz = z0 - cz;
      const projection = -(ox * dx + oy * dy + oz * dz) / lengthSquared;
      if (projection <= 0 || projection >= 1) continue;
      const closestX = ox + projection * dx;
      const closestY = oy + projection * dy;
      const closestZ = oz + projection * dz;
      const clearance = Math.sqrt(closestX * closestX + closestY * closestY + closestZ * closestZ);
      if (clearance < obstacle.radius) return true;
    }
    return false;
  }

  computeAvoidance(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    config: SimulationConfig,
    output: Float32Array,
    recordMetrics = true,
  ): void {
    output[0] = 0;
    output[1] = 0;
    output[2] = 0;
    if (!config.obstaclesEnabled) return;
    if (this.usesProxy(config)) {
      this.computeProxyAvoidance(x, y, z, vx, vy, vz, config, output, recordMetrics);
      return;
    }

    const lookAhead = config.obstacleLookAhead;
    const futureX = x + vx * lookAhead;
    const futureY = y + vy * lookAhead;
    const futureZ = z + vz * lookAhead;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const maximumTravel = speed * lookAhead;
    const margin = config.obstacleMargin;
    const definitions = this.definitions;
    const forceScale = config.maxAcceleration * config.obstacleWeight;
    const metrics = recordMetrics ? this.metrics : undefined;
    const proxySet = this.proxySet;

    for (let obstacleIndex = 0; obstacleIndex < definitions.length; obstacleIndex += 1) {
      const obstacle = definitions[obstacleIndex];
      const cx = obstacle.center[0];
      const cy = obstacle.center[1];
      const cz = obstacle.center[2];
      const currentX = x - cx;
      const currentY = y - cy;
      const currentZ = z - cz;
      const clearance = obstacle.radius + margin;
      const currentDistanceSquared = currentX * currentX + currentY * currentY + currentZ * currentZ;
      const broadReach = clearance + maximumTravel;
      if (currentDistanceSquared >= broadReach * broadReach) continue;

      const predictedX = futureX - cx;
      const predictedY = futureY - cy;
      const predictedZ = futureZ - cz;
      const predictedDistanceSquared = predictedX * predictedX
        + predictedY * predictedY
        + predictedZ * predictedZ;
      const clearanceSquared = clearance * clearance;
      if (currentDistanceSquared >= clearanceSquared && predictedDistanceSquared >= clearanceSquared) continue;

      const currentDistance = Math.sqrt(currentDistanceSquared);
      const predictedDistance = Math.sqrt(predictedDistanceSquared);
      const strength = Math.min(
        1,
        Math.max(
          (clearance - currentDistance) / margin,
          (clearance - predictedDistance) / margin,
          0,
        ),
      );
      const useCurrent = currentDistance < clearance;
      let nx = useCurrent ? currentX : predictedX;
      let ny = useCurrent ? currentY : predictedY;
      let nz = useCurrent ? currentZ : predictedZ;
      let distance = useCurrent ? currentDistance : predictedDistance;
      if (distance < 1e-5) {
        nx = 1;
        ny = 0;
        nz = 0;
        distance = 1;
      }
      nx /= distance;
      ny /= distance;
      nz /= distance;

      const force = forceScale * strength * strength;
      output[0] += nx * force;
      output[1] += ny * force;
      output[2] += nz * force;

      if (force > 0 && metrics !== undefined) {
        metrics.recordForce(obstacleIndex, force);
        // Sphere contact is based on the centre distance; compare it with the
        // true proxy surface only for the experiment telemetry.
        if (metrics.enabled && proxySet) {
          const proxy = proxySet.proxies[obstacleIndex];
          if (proxy && proxy.query(x, y, z, this.proxyNormal) > margin) {
            metrics.recordFalseAvoidance(obstacleIndex);
          }
        }
      }

      // A tangent term promotes flowing around the reef instead of bouncing backward.
      let tx = -nz;
      let tz = nx;
      const tangentLength = Math.sqrt(tx * tx + tz * tz);
      if (tangentLength > 1e-5) {
        tx /= tangentLength;
        tz /= tangentLength;
        if (tx * vx + tz * vz < 0) {
          tx = -tx;
          tz = -tz;
        }
        output[0] += tx * force * 0.38;
        output[2] += tz * force * 0.38;
      }
    }
  }

  constrain(
    positions: Float32Array,
    velocities: Float32Array,
    offset: number,
    config: SimulationConfig,
    padding: number,
    recordMetrics = true,
  ): void {
    if (!config.obstaclesEnabled) return;
    if (this.usesProxy(config)) {
      this.constrainProxy(positions, velocities, offset, padding, recordMetrics);
      return;
    }
    const metrics = recordMetrics ? this.metrics : undefined;
    for (let obstacleIndex = 0; obstacleIndex < this.definitions.length; obstacleIndex += 1) {
      const obstacle = this.definitions[obstacleIndex];
      const [cx, cy, cz] = obstacle.center;
      let nx = positions[offset] - cx;
      let ny = positions[offset + 1] - cy;
      let nz = positions[offset + 2] - cz;
      const minimumDistance = obstacle.radius + padding;
      const distanceSquared = nx * nx + ny * ny + nz * nz;
      if (distanceSquared >= minimumDistance * minimumDistance) continue;

      let distance = Math.sqrt(distanceSquared);
      const surfaceDistance = distance - obstacle.radius;
      if (surfaceDistance < 0) metrics?.recordPenetration(obstacleIndex, surfaceDistance);
      if (distance < 1e-6) {
        nx = 1;
        ny = 0;
        nz = 0;
        distance = 1;
      } else {
        nx /= distance;
        ny /= distance;
        nz /= distance;
      }
      positions[offset] = cx + nx * minimumDistance;
      positions[offset + 1] = cy + ny * minimumDistance;
      positions[offset + 2] = cz + nz * minimumDistance;

      const inwardSpeed = velocities[offset] * nx + velocities[offset + 1] * ny + velocities[offset + 2] * nz;
      if (inwardSpeed < 0) {
        velocities[offset] -= inwardSpeed * nx;
        velocities[offset + 1] -= inwardSpeed * ny;
        velocities[offset + 2] -= inwardSpeed * nz;
      }
    }
  }

  /**
   * SDF variant of `computeAvoidance`. The same predictive formula and tangent
   * term are used; only the distance/normal source changes. `obstacleMargin` is
   * applied once outside the signed distance (the SDF itself is the rock).
   */
  private computeProxyAvoidance(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    config: SimulationConfig,
    output: Float32Array,
    recordMetrics: boolean,
  ): void {
    const set = this.proxySet!;
    const lookAhead = config.obstacleLookAhead;
    const futureX = x + vx * lookAhead;
    const futureY = y + vy * lookAhead;
    const futureZ = z + vz * lookAhead;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const maximumTravel = speed * lookAhead;
    const margin = config.obstacleMargin;
    const inverseMargin = margin > 1e-6 ? 1 / margin : 0;
    const currentNormal = this.proxyNormal;
    const predictedNormal = this.proxyPredictedNormal;
    const forceScale = config.maxAcceleration * config.obstacleWeight;

    for (let index = 0; index < set.proxies.length; index += 1) {
      const proxy = set.get(index);
      const cx = proxy.boundCenter[0];
      const cy = proxy.boundCenter[1];
      const cz = proxy.boundCenter[2];
      const currentX = x - cx;
      const currentY = y - cy;
      const currentZ = z - cz;
      const broadReach = proxy.boundRadius + margin + maximumTravel;
      if (currentX * currentX + currentY * currentY + currentZ * currentZ >= broadReach * broadReach) {
        continue;
      }

      const currentDistance = proxy.query(x, y, z, currentNormal);
      const predictedDistance = proxy.query(futureX, futureY, futureZ, predictedNormal);
      if (currentDistance >= margin && predictedDistance >= margin) continue;

      const strength = Math.min(
        1,
        Math.max(
          inverseMargin > 0 ? (margin - currentDistance) * inverseMargin : (currentDistance < 0 ? 1 : 0),
          inverseMargin > 0 ? (margin - predictedDistance) * inverseMargin : (predictedDistance < 0 ? 1 : 0),
          0,
        ),
      );
      const useCurrent = currentDistance < margin;
      let nx = useCurrent ? currentNormal[0] : predictedNormal[0];
      let ny = useCurrent ? currentNormal[1] : predictedNormal[1];
      let nz = useCurrent ? currentNormal[2] : predictedNormal[2];
      const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (normalLength < 1e-8) {
        nx = 1;
        ny = 0;
        nz = 0;
      } else {
        nx /= normalLength;
        ny /= normalLength;
        nz /= normalLength;
      }

      const force = forceScale * strength * strength;
      output[0] += nx * force;
      output[1] += ny * force;
      output[2] += nz * force;
      if (recordMetrics) this.metrics?.recordForce(index, force);

      let tx = -nz;
      let tz = nx;
      const tangentLength = Math.sqrt(tx * tx + tz * tz);
      if (tangentLength > 1e-5) {
        tx /= tangentLength;
        tz /= tangentLength;
        if (tx * vx + tz * vz < 0) {
          tx = -tx;
          tz = -tz;
        }
        output[0] += tx * force * 0.38;
        output[2] += tz * force * 0.38;
      }
    }
  }

  /** SDF variant of `constrain`: project to `padding` outside the rock surface. */
  private constrainProxy(
    positions: Float32Array,
    velocities: Float32Array,
    offset: number,
    padding: number,
    recordMetrics: boolean,
  ): void {
    const set = this.proxySet!;
    const normal = this.proxyNormal;
    for (let index = 0; index < set.proxies.length; index += 1) {
      const proxy = set.get(index);
      const [cx, cy, cz] = proxy.boundCenter;
      const dx = positions[offset] - cx;
      const dy = positions[offset + 1] - cy;
      const dz = positions[offset + 2] - cz;
      const broadReach = proxy.boundRadius + padding;
      if (dx * dx + dy * dy + dz * dz >= broadReach * broadReach) continue;
      const distance = proxy.query(positions[offset], positions[offset + 1], positions[offset + 2], normal);
      if (distance < 0 && recordMetrics) this.metrics?.recordPenetration(index, distance);
      if (distance >= padding) continue;
      const push = padding - distance;
      positions[offset] += normal[0] * push;
      positions[offset + 1] += normal[1] * push;
      positions[offset + 2] += normal[2] * push;
      const inwardSpeed = velocities[offset] * normal[0]
        + velocities[offset + 1] * normal[1]
        + velocities[offset + 2] * normal[2];
      if (inwardSpeed < 0) {
        velocities[offset] -= inwardSpeed * normal[0];
        velocities[offset + 1] -= inwardSpeed * normal[1];
        velocities[offset + 2] -= inwardSpeed * normal[2];
      }
    }
  }

  /**
   * Conservative segment test against the SDF: reject against each proxy's
   * bounding sphere, then sample at most 0.6 m apart. Line-of-sight only.
   */
  private blocksSegmentProxy(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): boolean {
    const set = this.proxySet!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    if (lengthSquared <= 1e-12) return false;
    const length = Math.sqrt(lengthSquared);
    const steps = Math.max(2, Math.ceil(length / 0.6));
    for (let index = 0; index < set.proxies.length; index += 1) {
      const proxy = set.get(index);
      const [cx, cy, cz] = proxy.boundCenter;
      const ox = x0 - cx;
      const oy = y0 - cy;
      const oz = z0 - cz;
      const projection = -(ox * dx + oy * dy + oz * dz) / lengthSquared;
      if (projection <= 0 || projection >= 1) continue;
      const closestX = ox + projection * dx;
      const closestY = oy + projection * dy;
      const closestZ = oz + projection * dz;
      const reach = proxy.boundRadius;
      if (closestX * closestX + closestY * closestY + closestZ * closestZ > reach * reach) continue;
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        if (proxy.distance(x0 + dx * t, y0 + dy * t, z0 + dz * t) < 0) return true;
      }
    }
    return false;
  }

  /** Nearest reef proxy surface for diagnostics/debug; no effect on steering. */
  queryNearestProxy(x: number, y: number, z: number, result: ReefProxyQueryResult): boolean {
    if (!this.proxySet) return false;
    return this.proxySet.queryNearest(x, y, z, result);
  }
}
