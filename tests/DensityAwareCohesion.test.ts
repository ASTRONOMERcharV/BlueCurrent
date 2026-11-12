import { describe, expect, it } from 'vitest';
import { densityAwareCohesionScale } from '../src/simulation/BoidSystem';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';

describe('density-aware cohesion', () => {
  it('keeps full cohesion below target density and fades it above target', () => {
    const config = createDefaultConfig();
    expect(densityAwareCohesionScale(0, config)).toBe(1);
    expect(densityAwareCohesionScale(config.cohesionDensityTarget / 2, config)).toBe(1);
    expect(densityAwareCohesionScale(config.cohesionDensityTarget * 2, config)).toBeCloseTo(0.5, 8);
    expect(densityAwareCohesionScale(100_000, config)).toBeCloseTo(config.cohesionDensityMinScale, 8);
  });

  it('keeps the tested separation/alignment/cohesion radius ordering', () => {
    const config = createDefaultConfig();
    expect(config.cohesionRadius).toBe(5);
    expect(config.cohesionDensityTarget).toBe(24);
    expect(config.separationRadius).toBeLessThan(config.alignmentRadius);
    expect(config.alignmentRadius).toBeLessThan(config.cohesionRadius);
  });
});
