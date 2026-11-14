import { describe, expect, it } from 'vitest';
import {
  PredationEventTracker,
  type PredationObservation,
} from '../src/ui/PredationEventTracker';

function observation(partial: Partial<PredationObservation> = {}): PredationObservation {
  return {
    simulationTime: 0,
    totalSteps: 0,
    predatorState: 'patrol',
    targetIndex: -1,
    captures: 0,
    captureSerial: 0,
    aliveCount: 500,
    schoolCount: 1,
    radiusOfGyration: 10,
    threatenedCount: 0,
    ...partial,
  };
}

describe('predation event tracker', () => {
  it('derives state changes and target acquisition from real snapshots', () => {
    const tracker = new PredationEventTracker();
    expect(tracker.observe(observation())).toEqual([]);
    const events = tracker.observe(observation({
      simulationTime: 0.5,
      totalSteps: 30,
      predatorState: 'pursuit',
      targetIndex: 7,
    }));
    expect(events.map((event) => event.kind)).toEqual(['state-change', 'target-acquired']);
    expect(events[1].message).toContain('#7');
  });

  it('reports a target switch during pursuit', () => {
    const tracker = new PredationEventTracker();
    tracker.observe(observation({ predatorState: 'pursuit', targetIndex: 7, totalSteps: 1 }));
    const events = tracker.observe(observation({
      predatorState: 'pursuit',
      targetIndex: 9,
      simulationTime: 1,
      totalSteps: 60,
    }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('target-switch');
    expect(events[0].message).toContain('#9');
  });

  it('emits exactly one capture per serial increment and uses the previous target', () => {
    const tracker = new PredationEventTracker();
    tracker.observe(observation({ predatorState: 'pursuit', targetIndex: 7, totalSteps: 1 }));
    tracker.observe(observation({
      predatorState: 'attack',
      targetIndex: 7,
      simulationTime: 1,
      totalSteps: 60,
    }));
    const events = tracker.observe(observation({
      predatorState: 'attack',
      targetIndex: 7,
      simulationTime: 1.2,
      totalSteps: 72,
      captures: 1,
      captureSerial: 1,
    }));
    const captures = events.filter((event) => event.kind === 'capture');
    expect(captures).toHaveLength(1);
    expect(captures[0].message).toContain('#7');
    expect(captures[0].values?.captures).toBe(1);
  });

  it('distinguishes a lost target from a missed attack', () => {
    const pursuit = new PredationEventTracker();
    pursuit.observe(observation({ predatorState: 'pursuit', targetIndex: 3, totalSteps: 1 }));
    const lost = pursuit.observe(observation({
      predatorState: 'search',
      targetIndex: -1,
      simulationTime: 2,
      totalSteps: 120,
    }));
    expect(lost.map((event) => event.kind)).toContain('target-lost');

    const attack = new PredationEventTracker();
    attack.observe(observation({ predatorState: 'attack', targetIndex: 3, totalSteps: 1 }));
    const missed = attack.observe(observation({
      predatorState: 'search',
      targetIndex: -1,
      simulationTime: 2,
      totalSteps: 120,
    }));
    expect(missed.map((event) => event.kind)).toContain('attack-missed');
  });

  it('reports recovery when search returns to patrol after a threat', () => {
    const tracker = new PredationEventTracker();
    tracker.observe(observation({ predatorState: 'pursuit', targetIndex: 4, totalSteps: 1 }));
    tracker.observe(observation({
      predatorState: 'search',
      targetIndex: -1,
      simulationTime: 2,
      totalSteps: 120,
    }));
    const events = tracker.observe(observation({
      predatorState: 'patrol',
      targetIndex: -1,
      simulationTime: 4,
      totalSteps: 240,
    }));
    expect(events.map((event) => event.kind)).toContain('recovery');
  });

  it('resets instead of inventing captures when the timeline moves backwards', () => {
    const tracker = new PredationEventTracker();
    tracker.observe(observation({
      predatorState: 'attack',
      targetIndex: 2,
      simulationTime: 10,
      totalSteps: 600,
      captures: 2,
      captureSerial: 2,
    }));
    const events = tracker.observe(observation({
      simulationTime: 0,
      totalSteps: 0,
      predatorState: 'patrol',
      targetIndex: -1,
      captures: 0,
      captureSerial: 0,
    }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('reset');
  });

  it('reports group compression and release with a cooldown', () => {
    const tracker = new PredationEventTracker();
    tracker.observe(observation({ simulationTime: 0, totalSteps: 0 }));
    const compressed = tracker.observe(observation({
      simulationTime: 1.6,
      totalSteps: 96,
      schoolCount: 2,
    }));
    expect(compressed.map((event) => event.kind)).toContain('group-compression');

    const tooSoon = tracker.observe(observation({
      simulationTime: 2.2,
      totalSteps: 132,
      schoolCount: 4,
    }));
    expect(tooSoon).toHaveLength(0);

    const released = tracker.observe(observation({
      simulationTime: 3.2,
      totalSteps: 192,
      schoolCount: 1,
    }));
    expect(released.map((event) => event.kind)).toContain('group-release');
  });

  it('applies the threat recovery hysteresis', () => {
    const tracker = new PredationEventTracker();
    tracker.observe(observation({ simulationTime: 0, totalSteps: 0, threatenedCount: 50 }));
    const early = tracker.observe(observation({
      simulationTime: 1,
      totalSteps: 60,
      threatenedCount: 0,
    }));
    expect(early.some((event) => event.kind === 'recovery')).toBe(false);
    const late = tracker.observe(observation({
      simulationTime: 2.2,
      totalSteps: 132,
      threatenedCount: 0,
    }));
    expect(late.some((event) => event.kind === 'recovery')).toBe(true);
  });

  it('caps stored events and does not mutate frozen input', () => {
    const tracker = new PredationEventTracker();
    const base = Object.freeze(observation({ totalSteps: 0 }));
    tracker.observe(base);
    for (let index = 0; index < 40; index += 1) {
      tracker.observe(Object.freeze(observation({
        simulationTime: index * 0.5 + 0.5,
        totalSteps: (index + 1) * 30,
        predatorState: index % 2 === 0 ? 'pursuit' : 'patrol',
        targetIndex: index % 2 === 0 ? index : -1,
      })));
    }
    expect(tracker.all.length).toBeLessThanOrEqual(24);
    expect(tracker.latest).not.toBeNull();
  });
});
