import { describe, expect, it } from 'vitest';
import { ObstacleSystem } from '../src/simulation/ObstacleSystem';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';
import {
  buildReefCollisionProxy,
  ReefProxySet,
} from '../src/simulation/ReefCollisionProxy';
import type { ReefProxySpec } from '../src/simulation/reefCollisionProxySpecs';

const TEST_PROXY_SPEC: ReefProxySpec = {
  id: 'c',
  label: 'Test slab',
  anchorIndex: 0,
  shapes: [
    { kind: 'roundedBox', center: [0, 0.5, 0], half: [0.5, 0.25, 0.5], rounding: 0.1 },
  ],
};

function testProxySet(): ReefProxySet {
  const proxy = buildReefCollisionProxy(
    {
      id: 'c',
      anchorIndex: 0,
      position: [0, 0, 0],
      yaw: 0,
      tiltX: 0,
      tiltZ: 0,
      scale: [1, 1, 1],
      localSize: [4, 2, 4],
    },
    TEST_PROXY_SPEC,
  );
  return new ReefProxySet([proxy]);
}

describe('ObstacleSystem', () => {
  it('predicts a collision before the fish reaches the sphere', () => {
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    const obstacle = obstacles.definitions[0];
    const output = new Float32Array(3);
    const x = obstacle.center[0] + obstacle.radius + 2;
    obstacles.computeAvoidance(x, obstacle.center[1], obstacle.center[2], -5, 0, 0, config, output);
    expect(Math.hypot(...output)).toBeGreaterThan(0);
    expect(output[0]).toBeGreaterThan(0);
  });

  it('does not generate obstacle forces while disabled', () => {
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    config.obstaclesEnabled = false;
    const output = new Float32Array([1, 1, 1]);
    obstacles.computeAvoidance(-7, 2.1, -2, -5, 0, 0, config, output);
    expect(Array.from(output)).toEqual([0, 0, 0]);
  });

  it('projects a penetrating fish to the safety surface and removes inward speed', () => {
    const obstacles = new ObstacleSystem();
    const config = createDefaultConfig();
    const obstacle = obstacles.definitions[0];
    const positions = new Float32Array([obstacle.center[0] + obstacle.radius - 0.2, obstacle.center[1], obstacle.center[2]]);
    const velocities = new Float32Array([-3, 0, 0]);
    obstacles.constrain(positions, velocities, 0, config, 0.28);
    expect(positions[0] - obstacle.center[0]).toBeCloseTo(obstacle.radius + 0.28);
    expect(velocities[0]).toBeCloseTo(0);
  });

  it('uses the SDF proxy only in reefProxy mode', () => {
    const obstacles = new ObstacleSystem();
    obstacles.setProxySet(testProxySet());
    const config = createDefaultConfig();
    config.obstacleShapeMode = 'reefProxy';
    const output = new Float32Array(3);

    // Above the slab: far outside the proxy, but still inside the old y-sphere
    // if this test proxy were treated as a sphere. No avoidance force.
    obstacles.computeAvoidance(0, 4, 0, 1, 0, 0, config, output);
    expect(Array.from(output)).toEqual([0, 0, 0]);

    // Close to the +X face, inside the margin: force points outward.
    obstacles.computeAvoidance(1.8, 1, 0, 1, 0, 0, config, output);
    expect(output[0]).toBeGreaterThan(0);
    expect(Math.hypot(...output)).toBeGreaterThan(0);

    // Just outside the margin: no force.
    obstacles.computeAvoidance(2.6, 1, 0, 1, 0, 0, config, output);
    expect(Array.from(output)).toEqual([0, 0, 0]);
  });

  it('keeps the sphere path when the mode is sphere even if proxies are installed', () => {
    const obstacles = new ObstacleSystem();
    obstacles.setProxySet(testProxySet());
    const config = createDefaultConfig();
    config.obstacleShapeMode = 'sphere';
    const output = new Float32Array(3);
    // The first real reef sphere is at (-7,3.4,-3), r=3.4.
    obstacles.computeAvoidance(-7, 7, -3, 0, 1, 0, config, output);
    expect(Math.hypot(...output)).toBeGreaterThan(0);
  });

  it('projects a fish out of an SDF proxy to padding clearance', () => {
    const obstacles = new ObstacleSystem();
    const set = testProxySet();
    obstacles.setProxySet(set);
    const config = createDefaultConfig();
    config.obstacleShapeMode = 'reefProxy';
    const positions = new Float32Array([1.0, 1, 0]);
    const velocities = new Float32Array([-2, 0, 0]);
    obstacles.constrain(positions, velocities, 0, config, 0.28);
    expect(set.get(0).distance(positions[0], positions[1], positions[2])).toBeCloseTo(0.28, 5);
    expect(velocities[0]).toBeCloseTo(0);
  });

  it('uses the SDF for line-of-sight in proxy mode', () => {
    const obstacles = new ObstacleSystem();
    obstacles.setProxySet(testProxySet());
    const config = createDefaultConfig();
    config.obstacleShapeMode = 'reefProxy';
    expect(obstacles.blocksSegment(-2, 1, 0, 2, 1, 0, config)).toBe(true);
    expect(obstacles.blocksSegment(-2, 3, 0, 2, 3, 0, config)).toBe(false);
    // Without the config the original sphere test is preserved.
    expect(obstacles.blocksSegment(-2, 1, 0, 2, 1, 0)).toBe(false);
  });
});
