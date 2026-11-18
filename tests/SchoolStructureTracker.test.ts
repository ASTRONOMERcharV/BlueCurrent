import { describe, expect, it } from 'vitest';
import { SchoolStructureTracker } from '../src/ui/SchoolStructureTracker';
import type { SchoolStructureSnapshot } from '../src/simulation/SimulationWorld';

function makeSnapshot(
  version: number,
  simulationTime: number,
  groups: number[][],
  overrides: Partial<SchoolStructureSnapshot> = {},
): SchoolStructureSnapshot {
  const fishCount = Math.max(...groups.map((group) => Math.max(...group) + 1), 1);
  const roots = new Int32Array(fishCount).fill(-1);
  const sizes = new Int32Array(fishCount);
  const schoolSizes: number[] = [];
  for (const group of groups) {
    const root = group[0];
    sizes[root] = group.length;
    for (const index of group) roots[index] = root;
    if (group.length >= 5) schoolSizes.push(group.length);
  }
  schoolSizes.sort((first, second) => first - second);
  return {
    version,
    simulationTime,
    fishCount,
    aliveCount: fishCount,
    roots,
    sizes,
    schools: schoolSizes.length,
    medianSchoolSize: schoolSizes.length > 0
      ? schoolSizes[Math.floor((schoolSizes.length - 1) / 2)]
      : 0,
    largestSchool: schoolSizes.length > 0 ? schoolSizes[schoolSizes.length - 1] : 0,
    largestPolarization: 0,
    startleCount: 0,
    startleCentroid: null,
    startleRadius: 0,
    edgePressureCount: 0,
    ...overrides,
  };
}

const range = (start: number, end: number): number[] => {
  const values: number[] = [];
  for (let index = start; index <= end; index += 1) values.push(index);
  return values;
};

describe('SchoolStructureTracker', () => {
  it('reports a split and a merge only when the real components change', () => {
    const tracker = new SchoolStructureTracker();
    const first = makeSnapshot(1, 1, [range(0, 9), range(10, 19)]);
    expect(tracker.observe(first).events).toHaveLength(0);

    const split = makeSnapshot(2, 1.5, [range(0, 4), range(5, 9), range(10, 19)]);
    const splitState = tracker.observe(split);
    expect(splitState.events.at(-1)?.kind).toBe('split');
    expect(splitState.events.at(-1)?.message).toContain('split 10');

    const merge = makeSnapshot(3, 3.2, [range(0, 9), range(10, 19)]);
    const mergeState = tracker.observe(merge);
    expect(mergeState.events.at(-1)?.kind).toBe('merge');
  });

  it('suppresses repeated split events inside the cooldown window', () => {
    const tracker = new SchoolStructureTracker();
    tracker.observe(makeSnapshot(1, 1, [range(0, 29)]));
    tracker.observe(makeSnapshot(2, 1.5, [range(0, 14), range(15, 29)]));
    const suppressed = tracker.observe(
      makeSnapshot(3, 1.8, [range(0, 9), range(10, 14), range(15, 29)]),
    );
    expect(suppressed.events.filter((event) => event.kind === 'split')).toHaveLength(1);
  });

  it('reports emerging and dissolving subgroups and bins their sizes', () => {
    const tracker = new SchoolStructureTracker();
    const empty = makeSnapshot(1, 1, []);
    tracker.observe(empty);
    const emerged = tracker.observe(makeSnapshot(2, 1.6, [range(0, 9), range(10, 29)]));
    expect(emerged.events.map((event) => event.kind)).toContain('subgroup-emerged');
    expect(emerged.histogram[1]).toBe(1);
    expect(emerged.histogram[2]).toBe(1);
    const dissolved = tracker.observe(makeSnapshot(3, 3.2, []));
    expect(dissolved.events.map((event) => event.kind)).toContain('subgroup-dissolved');
  });

  it('emits one reset when simulation time rewinds and keeps the event cap', () => {
    const tracker = new SchoolStructureTracker();
    tracker.observe(makeSnapshot(1, 10, [range(0, 9)]));
    const reset = tracker.observe(makeSnapshot(2, 0, [range(0, 9)]));
    expect(reset.events.at(-1)?.kind).toBe('reset');
    for (let index = 0; index < 40; index += 1) {
      const groups = index % 2 === 0
        ? [range(0, 4), range(5, 9)]
        : [range(0, 9)];
      tracker.observe(makeSnapshot(3 + index, index * 2 + 2.1, groups));
    }
    expect(tracker.latest.events.length).toBeLessThanOrEqual(24);
    expect(tracker.latest.events.length).toBeGreaterThan(0);
  });

  it('skips duplicate snapshot versions', () => {
    const tracker = new SchoolStructureTracker();
    const snapshot = makeSnapshot(5, 1, [range(0, 9)]);
    tracker.observe(snapshot);
    const state = tracker.observe(snapshot);
    expect(state.events).toHaveLength(0);
  });
});
