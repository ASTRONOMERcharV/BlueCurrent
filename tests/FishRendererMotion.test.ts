import { MeshStandardMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { FishRenderer } from '../src/rendering/FishRenderer';
import { FlockData } from '../src/simulation/FlockData';

function makeFlock(): FlockData {
  const flock = new FlockData(4);
  flock.count = 4;
  flock.aliveCount = 4;
  flock.alive.fill(1);
  for (let index = 0; index < 4; index += 1) {
    const offset = index * 3;
    flock.positions[offset] = index;
    flock.positions[offset + 1] = 0;
    flock.positions[offset + 2] = 0;
    flock.previousPositions[offset] = index;
    flock.previousPositions[offset + 1] = 0;
    flock.previousPositions[offset + 2] = 0;
    flock.velocities[offset] = 0;
    flock.velocities[offset + 1] = 0;
    flock.velocities[offset + 2] = 2;
    flock.banks[index] = 0;
    flock.previousBanks[index] = 0;
  }
  return flock;
}

describe('FishRenderer motion', () => {
  it('clamps steep velocity pitch on the first frame', () => {
    const flock = makeFlock();
    for (let index = 0; index < 4; index += 1) {
      flock.velocities[index * 3 + 1] = 4;
      flock.velocities[index * 3 + 2] = 0.2;
    }
    const renderer = new FishRenderer(new Scene(), flock);
    renderer.update(0.5, 0, 6);
    const diagnostics = renderer.motionDiagnostics();
    expect(diagnostics.maxAbsPitch).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(diagnostics.maxAbsPitch).toBeGreaterThan(0.5);
  });

  it('rate-limits pitch changes between frames', () => {
    const flock = makeFlock();
    const renderer = new FishRenderer(new Scene(), flock);
    renderer.update(0.5, 0, 6);
    const first = renderer.motionDiagnostics().maxAbsPitch;
    expect(first).toBeCloseTo(0, 6);
    for (let index = 0; index < 4; index += 1) {
      flock.velocities[index * 3 + 1] = 4;
      flock.velocities[index * 3 + 2] = 0.2;
    }
    renderer.update(0.5, 1 / 60, 6);
    const second = renderer.motionDiagnostics().maxAbsPitch;
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThanOrEqual(2.4 / 60 + 1e-6);
  });

  it('writes a bounded turn signal from the simulated bank', () => {
    const flock = makeFlock();
    for (let index = 0; index < 4; index += 1) {
      flock.banks[index] = 0.65;
      flock.previousBanks[index] = 0.65;
    }
    const renderer = new FishRenderer(new Scene(), flock);
    renderer.update(0.5, 0, 6);
    const diagnostics = renderer.motionDiagnostics();
    expect(diagnostics.maxAbsTurn).toBeCloseTo(1, 6);
    expect(diagnostics.meanAbsTurn).toBeCloseTo(1, 6);
  });

  it('injects the turn bend into the fish shader', () => {
    const renderer = new FishRenderer(new Scene(), makeFlock());
    const material = renderer.mesh.material as MeshStandardMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: [
        '#include <common>',
        '#include <begin_vertex>',
        '#include <skinning_vertex>',
        '#include <defaultnormal_vertex>',
      ].join('\n'),
      fragmentShader: ['#include <common>', '#include <opaque_fragment>'].join('\n'),
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute float instanceTurn');
    expect(shader.vertexShader).toContain('instanceTurn * 0.200');
    expect(shader.vertexShader).toContain('pow(tailWeight, 1.35)');
    expect(material.customProgramCacheKey()).toContain('blue-current-fish');
  });

  it('reproduces the legacy presentation for same-version comparison captures', () => {
    const flock = makeFlock();
    for (let index = 0; index < 4; index += 1) {
      flock.velocities[index * 3 + 1] = 4;
      flock.velocities[index * 3 + 2] = 0.2;
      flock.banks[index] = 0.65;
      flock.previousBanks[index] = 0.65;
    }
    const renderer = new FishRenderer(new Scene(), flock, undefined, { motionMode: 'legacy' });
    renderer.update(0.5, 0, 6);
    const diagnostics = renderer.motionDiagnostics();
    expect(diagnostics.maxAbsPitch).toBeCloseTo(Math.asin(4 / Math.hypot(4, 0.2)), 5);
    expect(diagnostics.maxAbsPitch).toBeGreaterThan(0.9);
    expect(diagnostics.maxAbsTurn).toBe(0);
    expect(diagnostics.maxTargetPitchIndex).toBe(0);
    expect(diagnostics.maxTargetPitchPosition).toEqual([0, 0, 0]);
  });

  it('keeps matrices finite for still fish', () => {
    const flock = makeFlock();
    flock.velocities.fill(0);
    const renderer = new FishRenderer(new Scene(), flock);
    renderer.update(0.5, 0, 6);
    renderer.update(0.5, 1 / 60, 6);
    const matrix = new Float32Array(16);
    for (let index = 0; index < 4; index += 1) {
      // InstancedMesh exposes matrix elements through the instance matrix.
      const array = renderer.mesh.instanceMatrix.array as Float32Array;
      for (let element = 0; element < 16; element += 1) {
        matrix[element] = array[index * 16 + element];
      }
      for (const value of matrix) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
