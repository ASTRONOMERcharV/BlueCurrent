import type { SimulationConfig } from './SimulationConfig';
import { clamp } from './math';

export function addBoundaryForce(
  x: number,
  y: number,
  z: number,
  config: SimulationConfig,
  output: Float32Array,
  fearLevel = 0,
): void {
  output[0] = 0;
  output[1] = 0;
  output[2] = 0;
  let lowerX = 0;
  let lowerZ = 0;
  let upperX = 0;
  let upperZ = 0;
  const boundaryAcceleration = config.maxAcceleration * config.boundaryWeight;
  const boundaryMargin = config.boundaryMargin;
  const boundsMin = config.bounds.min;
  const boundsMax = config.bounds.max;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = boundsMin[axis];
    const maximum = boundsMax[axis];
    const value = axis === 0 ? x : axis === 1 ? y : z;
    const margin = Math.min(boundaryMargin, (maximum - minimum) * 0.45);
    const lowerWeight = clamp((margin - (value - minimum)) / margin, 0, 1);
    const upperWeight = clamp((margin - (maximum - value)) / margin, 0, 1);
    if (axis === 0) {
      lowerX = lowerWeight;
      upperX = upperWeight;
    } else if (axis === 2) {
      lowerZ = lowerWeight;
      upperZ = upperWeight;
    }
    output[axis] = boundaryAcceleration
      * (lowerWeight * lowerWeight - upperWeight * upperWeight);
  }

  // A frightened fish slides along the edge instead of stacking into it. The
  // inward/outward component stays untouched; only the tangential share grows.
  const edgeBoost = config.schoolDynamicsEnabled
    ? 1 + Math.max(0, config.edgeEscapeBoost) * clamp(fearLevel, 0, 1)
    : 1;
  const tangent = boundaryAcceleration
    * Math.max(0, config.boundaryTangentialWeight) * edgeBoost;
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
  const boundsMin = config.bounds.min;
  const boundsMax = config.bounds.max;
  for (let axis = 0; axis < 3; axis += 1) {
    const component = offset + axis;
    const minimum = boundsMin[axis] + padding;
    const maximum = boundsMax[axis] - padding;
    if (positions[component] < minimum) {
      positions[component] = minimum;
      if (velocities[component] < 0) velocities[component] *= -0.35;
    } else if (positions[component] > maximum) {
      positions[component] = maximum;
      if (velocities[component] > 0) velocities[component] *= -0.35;
    }
  }
}
