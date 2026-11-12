import { describe, expect, it } from 'vitest';
import { addBoundaryForce } from '../src/simulation/EnvironmentForces';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';

describe('boundary steering', () => {
  it('adds a tangential component at the horizontal edges instead of only pushing inward', () => {
    const config = createDefaultConfig();
    const force = new Float32Array(3);
    addBoundaryForce(19.5, 10, 0, config, force);
    expect(force[0]).toBeLessThan(0);
    expect(force[2]).toBeGreaterThan(0);

    addBoundaryForce(-19.5, 10, 0, config, force);
    expect(force[0]).toBeGreaterThan(0);
    expect(force[2]).toBeLessThan(0);
  });

  it('leaves the central water column free of boundary steering', () => {
    const config = createDefaultConfig();
    const force = new Float32Array(3);
    addBoundaryForce(0, 10, 0, config, force);
    expect(Array.from(force)).toEqual([0, 0, 0]);
  });
});
