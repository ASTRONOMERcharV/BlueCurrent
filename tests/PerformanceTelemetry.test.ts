import { describe, expect, it } from 'vitest';
import { PhaseEmaRecorder } from '../src/simulation/PerformanceTelemetry';
import { applyScenario } from '../src/simulation/Scenarios';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

function recorder(): PhaseEmaRecorder {
  return new PhaseEmaRecorder({ exclusivePhases: ['boids', 'metrics'], alpha: 0.5 });
}

describe('PhaseEmaRecorder', () => {
  it('is a no-op until enabled', () => {
    const timings = recorder();
    timings.beginStep(0);
    timings.recordPhase('boids', 10);
    timings.endStep(20, 20);
    const snapshot = timings.snapshot();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.sampleSteps).toBe(0);
    expect(snapshot.totalMs).toBe(0);
    expect(snapshot.phases.boids).toBe(0);
  });

  it('seeds on the first step and records exclusive and sub phases', () => {
    const timings = recorder();
    timings.setEnabled(true);
    timings.beginStep(100);
    timings.recordPhase('boids', 120);
    timings.beginPhase(125);
    timings.recordPhase('metrics', 130);
    timings.addPhaseMs('obstacleQuery', 7);
    timings.endStep(40);

    const first = timings.snapshot();
    expect(first.sampleSteps).toBe(1);
    expect(first.totalMs).toBeCloseTo(40, 10);
    expect(first.phases.boids).toBeCloseTo(20, 10);
    expect(first.phases.metrics).toBeCloseTo(5, 10);
    expect(first.phases.obstacleQuery).toBeCloseTo(7, 10);
    expect(first.otherMs).toBeCloseTo(15, 10);
  });

  it('smooths subsequent steps and clears pending sub phases', () => {
    const timings = recorder();
    timings.setEnabled(true);
    timings.beginStep(0);
    timings.recordPhase('boids', 10);
    timings.endStep(20);
    timings.beginStep(100);
    timings.recordPhase('boids', 130);
    timings.addPhaseMs('obstacleQuery', 4);
    timings.endStep(60);

    const second = timings.snapshot();
    expect(second.totalMs).toBeCloseTo(0.5 * 20 + 0.5 * 60, 10);
    expect(second.phases.boids).toBeCloseTo(0.5 * 10 + 0.5 * 30, 10);
    expect(second.phases.obstacleQuery).toBeCloseTo(2, 10);
    expect(second.otherMs).toBeCloseTo(second.totalMs - second.phases.boids, 10);
  });

  it('resets and re-seeds after reset', () => {
    const timings = recorder();
    timings.setEnabled(true);
    timings.beginStep(0);
    timings.recordPhase('boids', 50);
    timings.endStep(50);
    timings.reset();
    expect(timings.snapshot().sampleSteps).toBe(0);
    timings.beginStep(200);
    timings.recordPhase('boids', 210);
    timings.endStep(20);
    expect(timings.snapshot().totalMs).toBeCloseTo(20, 10);
    expect(timings.snapshot().phases.boids).toBeCloseTo(10, 10);
  });
});

describe('simulation telemetry isolation', () => {
  it('does not change the simulation when telemetry is enabled', () => {
    const plain = new SimulationWorld();
    applyScenario(plain, 'encounter');
    const measured = new SimulationWorld();
    applyScenario(measured, 'encounter');
    measured.setPerformanceTelemetryEnabled(true);
    for (let step = 0; step < 300; step += 1) {
      plain.step();
      measured.step();
    }
    expect(measured.flock.positions).toEqual(plain.flock.positions);
    expect(measured.flock.velocities).toEqual(plain.flock.velocities);
    expect(measured.clownfishFlock.positions).toEqual(plain.clownfishFlock.positions);
    expect(measured.metrics.captures).toBe(plain.metrics.captures);
    expect(measured.getPerformanceSnapshot().sampleSteps).toBe(300);
    expect(measured.getPerformanceSnapshot().totalMs).toBeGreaterThan(0);
    expect(plain.getPerformanceSnapshot().sampleSteps).toBe(0);
  }, 60000);
});
