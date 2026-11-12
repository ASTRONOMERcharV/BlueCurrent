import { describe, expect, it } from 'vitest';
import { FlockData } from '../src/simulation/FlockData';
import { ObstacleSystem } from '../src/simulation/ObstacleSystem';
import { ReefObstacleMetrics } from '../src/simulation/ReefObstacleMetrics';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';

function makeFlock(count: number): FlockData {
  const flock = new FlockData(count);
  flock.count = count;
  flock.aliveCount = count;
  flock.alive.fill(1, 0, count);
  return flock;
}

describe('ReefObstacleMetrics', () => {
  it('accumulates per-reef force, penetration, deep duration and false avoidance', () => {
    const metrics = new ReefObstacleMetrics();
    metrics.enabled = true;
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    const flock = makeFlock(0);
    const clownfish = makeFlock(0);

    metrics.beginStep(1 / 60, 0);
    metrics.recordForce(0, 4);
    metrics.recordForce(0, 8);
    metrics.recordForce(1, 2);
    metrics.recordPenetration(0, -0.4);
    metrics.recordPenetration(0, -0.1);
    metrics.recordFalseAvoidance(1);
    metrics.endStep(flock, clownfish, obstacles, config, createDefaultConfig());

    const snapshot = metrics.snapshot(obstacles, config);
    expect(snapshot.reefs[0].forceSampleCount).toBe(2);
    expect(snapshot.reefs[0].averageObstacleForce).toBeCloseTo(6);
    expect(snapshot.reefs[0].proxyPenetrationCount).toBe(2);
    expect(snapshot.reefs[0].deepPenetrationDuration).toBeCloseTo(1 / 60);
    expect(snapshot.reefs[1].falseAvoidanceCount).toBe(1);
    expect(snapshot.reefs[1].averageObstacleForce).toBeCloseTo(2);
    expect(snapshot.totals.averageObstacleForce).toBeCloseTo((4 + 8 + 2) / 3);
    expect(snapshot.totals.p95ObstacleForce).toBeGreaterThan(2);
  });

  it('counts passage crossings through the B–C gate', () => {
    const metrics = new ReefObstacleMetrics();
    metrics.enabled = true;
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    const flock = makeFlock(1);
    const clownfish = makeFlock(0);
    // Midpoint of B(-7,3.4,-3) and C(5,3.5,4); cross along the B→C axis.
    const axisX = 12 / Math.hypot(12, 7);
    const axisZ = 7 / Math.hypot(12, 7);
    flock.previousPositions.set([-1 - axisX, 4, 0.5 - axisZ]);
    flock.positions.set([-1 + axisX, 4, 0.5 + axisZ]);
    flock.velocities.set([axisX * 4, 0, axisZ * 4]);

    metrics.beginStep(1 / 60, 0);
    metrics.endStep(flock, clownfish, obstacles, config, createDefaultConfig());
    const snapshot = metrics.snapshot(obstacles, config);
    const gate = snapshot.passages.find((entry) => entry.id === 'b-c');
    expect(gate?.count).toBe(1);
    expect(snapshot.passages.find((entry) => entry.id === 'hero-d')?.count).toBe(0);
  });

  it('reports a stuck fish only after two seconds inside the margin band', () => {
    const metrics = new ReefObstacleMetrics();
    metrics.enabled = true;
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    const flock = makeFlock(1);
    const clownfish = makeFlock(0);
    // 0.5 m outside the B sphere surface, inside the 1.25 m margin, not moving.
    flock.positions.set([-7 + 3.4 + 0.5, 3.4, -3]);
    flock.previousPositions.set(flock.positions);
    flock.velocities.fill(0);

    let time = 0;
    for (let step = 0; step < 60; step += 1) {
      metrics.beginStep(1 / 60, time);
      metrics.endStep(flock, clownfish, obstacles, config, createDefaultConfig());
      time += 1 / 60;
    }
    expect(metrics.snapshot(obstacles, config).totals.stuckFishCount).toBe(0);

    for (let step = 0; step < 65; step += 1) {
      metrics.beginStep(1 / 60, time);
      metrics.endStep(flock, clownfish, obstacles, config, createDefaultConfig());
      time += 1 / 60;
    }
    const snapshot = metrics.snapshot(obstacles, config);
    expect(snapshot.totals.stuckFishCount).toBe(1);
    expect(snapshot.reefs[0].stuckFishCount).toBe(1);
  });

  it('stays disabled by default and reports no samples', () => {
    const metrics = new ReefObstacleMetrics();
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    const flock = makeFlock(2);
    metrics.beginStep(1 / 60, 0);
    metrics.recordForce(0, 4);
    metrics.recordPenetration(0, -1);
    metrics.endStep(flock, makeFlock(0), obstacles, config, createDefaultConfig());
    const snapshot = metrics.snapshot(obstacles, config);
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.totals.forceSampleCount).toBe(0);
    expect(snapshot.totals.proxyPenetrationCount).toBe(0);
  });
});
