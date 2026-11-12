import type { SimulationConfig } from './SimulationConfig';
import { clamp } from './math';

export function addBoundaryForce(
  x: number,
  y: number,
  z: number,
  config: SimulationConfig,
  output: Float32Array,
): void {
  output[0] = 0;
  output[1] = 0;
  output[2] = 0;
  let lowerX = 0;
  let lowerZ = 0;
  let upperX = 0;
  let upperZ = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = config.bounds.min[axis];
    const maximum = config.bounds.max[axis];
    const value = axis === 0 ? x : axis === 1 ? y : z;
    const margin = Math.min(config.boundaryMargin, (maximum - minimum) * 0.45);
    const lowerWeight = clamp((margin - (value - minimum)) / margin, 0, 1);
    const upperWeight = clamp((margin - (maximum - value)) / margin, 0, 1);
    if (axis === 0) {
      lowerX = lowerWeight;
      upperX = upperWeight;
    } else if (axis === 2) {
      lowerZ = lowerWeight;
      upperZ = upperWeight;
    }
    output[axis] = config.maxAcceleration * config.boundaryWeight
      * (lowerWeight * lowerWeight - upperWeight * upperWeight);
  }

  const tangent = config.maxAcceleration * config.boundaryWeight
    * Math.max(0, config.boundaryTangentialWeight);
  output[0] += tangent * (lowerZ * lowerZ - upperZ * upperZ);
  output[2] += tangent * (upperX * upperX - lowerX * lowerX);
}

export function constrainToBounds(
  positions: Float32Array,
  velocities: Float32Array,
  offset: number,
  config: SimulationConfig,
  padding: number,
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const component = offset + axis;
    const minimum = config.bounds.min[axis] + padding;
    const maximum = config.bounds.max[axis] - padding;
    if (positions[component] < minimum) {
      positions[component] = minimum;
      if (velocities[component] < 0) velocities[component] *= -0.35;
    } else if (positions[component] > maximum) {
      positions[component] = maximum;
      if (velocities[component] > 0) velocities[component] *= -0.35;
    }
  }
}
