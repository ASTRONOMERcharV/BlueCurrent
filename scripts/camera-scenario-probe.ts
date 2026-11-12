import { SimulationWorld } from '../src/simulation/SimulationWorld';
import { applyScenario } from '../src/simulation/Scenarios';

const world = new SimulationWorld();
applyScenario(world, 'encounter');
const dt = 1 / 60;
const steps = 70 * 60;
let previousTarget = -1;
let previousState = world.predator.state;
const targetChanges: string[] = [];
const stateChanges: string[] = [];
let bestVerticalRatio = 0;
let bestVerticalTime = 0;
let minTargetDistance = Infinity;
let minTargetTime = 0;
let zeroSpeedPatrolTime = -1;
let minCoherence = Infinity;
let minCoherenceTime = 0;
let maxCoherenceTime = 0;
let maxCoherence = -Infinity;

for (let step = 0; step < steps; step += 1) {
  const time = step * dt;
  const predator = world.predator;
  const targetIndex = predator.targetIndex;
  if (targetIndex !== previousTarget) {
    targetChanges.push(`${time.toFixed(2)}s idx ${previousTarget}->${targetIndex} state ${predator.state}`);
    previousTarget = targetIndex;
  }
  if (predator.state !== previousState) {
    stateChanges.push(`${time.toFixed(2)}s ${previousState}->${predator.state} idx ${targetIndex}`);
    previousState = predator.state;
  }
  if (targetIndex >= 0 && targetIndex < world.flock.count && world.flock.alive[targetIndex] === 1) {
    const offset = targetIndex * 3;
    const dx = world.flock.positions[offset] - predator.position[0];
    const dy = world.flock.positions[offset + 1] - predator.position[1];
    const dz = world.flock.positions[offset + 2] - predator.position[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance > 1e-6) {
      const ratio = Math.abs(dy) / distance;
      if (ratio > bestVerticalRatio) {
        bestVerticalRatio = ratio;
        bestVerticalTime = time;
      }
      if (distance < minTargetDistance) {
        minTargetDistance = distance;
        minTargetTime = time;
      }
    }
  }
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let total = 0;
  for (let index = 0; index < world.flock.count; index += 1) {
    if (world.flock.alive[index] === 0) continue;
    const offset = index * 3;
    sumX += world.flock.velocities[offset];
    sumY += world.flock.velocities[offset + 1];
    sumZ += world.flock.velocities[offset + 2];
    total += Math.hypot(
      world.flock.velocities[offset],
      world.flock.velocities[offset + 1],
      world.flock.velocities[offset + 2],
    );
  }
  if (total > 1e-9) {
    const coherence = Math.hypot(sumX, sumY, sumZ) / total;
    if (coherence < minCoherence) {
      minCoherence = coherence;
      minCoherenceTime = time;
    }
    if (coherence > maxCoherence) {
      maxCoherence = coherence;
      maxCoherenceTime = time;
    }
  }
  if (predator.state === 'patrol') {
    const speed = Math.hypot(predator.velocity[0], predator.velocity[1], predator.velocity[2]);
    if (speed < 0.02 && zeroSpeedPatrolTime < 0) zeroSpeedPatrolTime = time;
  }
  world.step();
}

console.log('target changes', targetChanges.length);
console.log(targetChanges.slice(0, 30).join('\n'));
console.log('state changes', stateChanges.length);
console.log(stateChanges.slice(0, 30).join('\n'));
console.log('max vertical ratio', bestVerticalRatio.toFixed(4), '@', bestVerticalTime.toFixed(2));
console.log('min target distance', minTargetDistance.toFixed(4), '@', minTargetTime.toFixed(2));
console.log('coherence min', minCoherence.toFixed(4), '@', minCoherenceTime.toFixed(2),
  'max', maxCoherence.toFixed(4), '@', maxCoherenceTime.toFixed(2));
console.log('zero-speed patrol first', zeroSpeedPatrolTime);
