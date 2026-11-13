import { describe, expect, it } from 'vitest';
import { FlockData } from '../src/simulation/FlockData';
import { SeededRandom } from '../src/simulation/math';
import { ObstacleSystem } from '../src/simulation/ObstacleSystem';
import { PredatorSystem, type PredatorState } from '../src/simulation/PredatorSystem';
import { createDefaultConfig } from '../src/simulation/SimulationConfig';

const SEARCH_HORIZONTAL_FLOOR = 0.8;

/** Re-read the state so TypeScript does not narrow it across update() calls. */
function stateOf(predator: PredatorSystem): PredatorState {
  return predator.state;
}

function makePredator(): PredatorSystem {
  const predator = new PredatorSystem(createDefaultConfig(), new ObstacleSystem());
  predator.reset(new SeededRandom(0x9e71c0de));
  return predator;
}

function makeFlock(x: number, y: number, z: number): FlockData {
  const flock = new FlockData(4);
  flock.count = 1;
  flock.aliveCount = 1;
  flock.alive[0] = 1;
  flock.positions.set([x, y, z]);
  return flock;
}

function makeFlockWithPositions(positions: Array<[number, number, number]>): FlockData {
  const flock = new FlockData(4);
  flock.count = positions.length;
  flock.aliveCount = positions.length;
  positions.forEach((position, index) => {
    flock.alive[index] = 1;
    flock.positions.set(position, index * 3);
  });
  return flock;
}

describe('predator search after a capture', () => {
  it('continues forward instead of steering back at its own position', () => {
    const predator = makePredator();
    predator.position.set([0, 10, 0]);
    predator.velocity.set([3, 0, 0]);
    predator.state = 'attack';
    predator.targetIndex = 0;
    const flock = makeFlock(0, 10, 0);

    predator.update(1 / 60, flock);
    expect(predator.captures).toBe(1);
    expect(predator.state).toBe('search');

    const startX = predator.position[0];
    let maxX = startX;
    let searchFrames = 0;
    for (let i = 0; i < 150; i += 1) {
      const wasSearching = stateOf(predator) === 'search';
      predator.update(1 / 60, flock);
      if (wasSearching && stateOf(predator) === 'search') {
        searchFrames += 1;
        const horizontalSpeed = Math.hypot(predator.velocity[0], predator.velocity[2]);
        expect(horizontalSpeed).toBeGreaterThanOrEqual(SEARCH_HORIZONTAL_FLOOR - 1e-4);
      }
      maxX = Math.max(maxX, predator.position[0]);
    }

    expect(searchFrames).toBeGreaterThan(0);
    // The old behaviour braked and circled the capture point; now the shark
    // carries its momentum through the search.
    expect(maxX).toBeGreaterThan(startX + 3);
    expect(predator.state).not.toBe('search');
  });

  it('keeps a horizontal component when the capture velocity is almost vertical', () => {
    const predator = makePredator();
    predator.position.set([0, 10, 0]);
    predator.velocity.set([0.02, 3, 0.01]);
    predator.state = 'attack';
    predator.targetIndex = 0;
    const flock = makeFlock(0, 10, 0);

    predator.update(1 / 60, flock);
    expect(predator.state).toBe('search');

    let searchFrames = 0;
    for (let i = 0; i < 60; i += 1) {
      const wasSearching = stateOf(predator) === 'search';
      predator.update(1 / 60, flock);
      if (wasSearching && stateOf(predator) === 'search') {
        searchFrames += 1;
        // The floor is reached through the acceleration budget, so allow a
        // short ramp instead of demanding it on the first search frame.
        if (searchFrames >= 8) {
          const horizontalSpeed = Math.hypot(predator.velocity[0], predator.velocity[2]);
          expect(horizontalSpeed).toBeGreaterThanOrEqual(SEARCH_HORIZONTAL_FLOOR - 1e-3);
          // Steering and the floor share the same fallback heading, so the
          // horizontal motion stays in that quadrant instead of reversing.
          expect(predator.velocity[0]).toBeLessThan(-0.2);
        }
      }
    }
    expect(searchFrames).toBeGreaterThan(10);
  });

  it('sheds excess attack speed at the acceleration budget instead of snapping', () => {
    const config = createDefaultConfig();
    const predator = new PredatorSystem(config, new ObstacleSystem());
    predator.reset(new SeededRandom(0x9e71c0de));
    predator.position.set([0, 10, 0]);
    predator.velocity.set([8, 0, 0]);
    predator.state = 'attack';
    predator.targetIndex = 0;
    const flock = makeFlock(0, 10, 0);

    predator.update(1 / 60, flock);
    expect(predator.captures).toBe(1);
    expect(predator.state).toBe('search');
    const speedAfterCapture = Math.hypot(...predator.velocity);
    expect(speedAfterCapture).toBeGreaterThan(7.5);

    // The old code scaled the whole velocity to the search cap in one frame.
    predator.update(1 / 60, flock);
    const nextSpeed = Math.hypot(...predator.velocity);
    expect(nextSpeed).toBeGreaterThan(7.3);

    let previousSpeed = nextSpeed;
    let maxStepDrop = speedAfterCapture - nextSpeed;
    for (let i = 0; i < 120; i += 1) {
      predator.update(1 / 60, flock);
      const speed = Math.hypot(...predator.velocity);
      maxStepDrop = Math.max(maxStepDrop, previousSpeed - speed);
      previousSpeed = speed;
    }
    // Steering and the cap each spend at most maxAcceleration * dt per step.
    const budget = 2 * config.predatorMaxAcceleration * (1 / 60) + 1e-3;
    expect(maxStepDrop).toBeLessThanOrEqual(budget);
    expect(previousSpeed).toBeLessThan(4);
  });
});

describe('predator target switching', () => {
  it('switches directly to a clearly closer live target without passing through null', () => {
    const predator = makePredator();
    predator.position.set([0, 10, 0]);
    predator.velocity.set([0, 0, 3]);
    predator.state = 'pursuit';
    predator.targetIndex = 0;
    const flock = makeFlockWithPositions([[0, 10, 12], [0, 10, 8]]);
    const seen: number[] = [];

    for (let index = 0; index < 120; index += 1) {
      predator.update(1 / 60, flock);
      seen.push(predator.targetIndex);
      if (predator.targetIndex === 1) break;
    }

    expect(seen).toContain(0);
    expect(seen).toContain(1);
    expect(seen).not.toContain(-1);
    expect(predator.state).toBe('pursuit');
    expect(predator.captures).toBe(0);
  });

  it('keeps the current target when the candidate is only marginally closer', () => {
    const predator = makePredator();
    predator.position.set([0, 10, 0]);
    predator.velocity.set([0, 0, 3]);
    predator.state = 'pursuit';
    predator.targetIndex = 0;
    const flock = makeFlockWithPositions([[0, 10, 12], [0, 10, 11.8]]);

    for (let index = 0; index < 60; index += 1) {
      predator.update(1 / 60, flock);
    }

    expect(predator.targetIndex).toBe(0);
    expect(predator.state).toBe('pursuit');
  });
});
