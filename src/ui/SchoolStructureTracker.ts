import type { SchoolStructureSnapshot } from '../simulation/SimulationWorld';

/**
 * Read-only school-structure event stream for the Observation UI and capture
 * scripts. It consumes metrics snapshots, never simulation state, and never
 * steers a fish. Components are matched between snapshots by shared fish
 * indices, so a split/merge is only reported when the real graph changed.
 */

export type SchoolStructureEventKind =
  | 'split'
  | 'merge'
  | 'subgroup-emerged'
  | 'subgroup-dissolved'
  | 'reset';

export interface SchoolStructureEvent {
  sequence: number;
  simulationTime: number;
  kind: SchoolStructureEventKind;
  message: string;
  values?: Record<string, number>;
}

export interface SchoolStructureState {
  events: readonly SchoolStructureEvent[];
  schools: number;
  medianSchoolSize: number;
  largestSchool: number;
  largestPolarization: number;
  startleCount: number;
  startleCentroid: [number, number, number] | null;
  startleRadius: number;
  edgePressureCount: number;
  histogram: readonly number[];
  lastEvent: SchoolStructureEvent | null;
}

const HISTORY_LIMIT = 24;
const EVENT_COOLDOWN = 1.5;
const MIN_SCHOOL = 5;
const HISTOGRAM_LOWER_BOUNDS = [5, 10, 20, 50, 100] as const;

type ComponentMap = Map<number, number[]>;

function componentsOf(snapshot: SchoolStructureSnapshot): ComponentMap {
  const components: ComponentMap = new Map();
  for (let index = 0; index < snapshot.fishCount; index += 1) {
    const root = snapshot.roots[index];
    if (root < 0 || snapshot.sizes[root] < MIN_SCHOOL) continue;
    const component = components.get(root);
    if (component) component.push(index);
    else components.set(root, [index]);
  }
  return components;
}

function histogramOf(components: ComponentMap): number[] {
  const bins = new Array(HISTOGRAM_LOWER_BOUNDS.length).fill(0);
  for (const members of components.values()) {
    let bin = 0;
    for (let index = 0; index < HISTOGRAM_LOWER_BOUNDS.length; index += 1) {
      if (members.length >= HISTOGRAM_LOWER_BOUNDS[index]) bin = index;
    }
    bins[bin] += 1;
  }
  return bins;
}

function overlapCount(previous: readonly number[], current: readonly number[]): number {
  let shared = 0;
  let previousIndex = 0;
  let currentIndex = 0;
  while (previousIndex < previous.length && currentIndex < current.length) {
    const a = previous[previousIndex];
    const b = current[currentIndex];
    if (a === b) {
      shared += 1;
      previousIndex += 1;
      currentIndex += 1;
    } else if (a < b) {
      previousIndex += 1;
    } else {
      currentIndex += 1;
    }
  }
  return shared;
}

export class SchoolStructureTracker {
  private previousVersion = -1;
  private previousTime = 0;
  private previous: ComponentMap = new Map();
  private events: SchoolStructureEvent[] = [];
  private sequence = 0;
  private lastEventTime = new Map<SchoolStructureEventKind, number>();
  private state: SchoolStructureState = {
    events: [],
    schools: 0,
    medianSchoolSize: 0,
    largestSchool: 0,
    largestPolarization: 0,
    startleCount: 0,
    startleCentroid: null,
    startleRadius: 0,
    edgePressureCount: 0,
    histogram: [],
    lastEvent: null,
  };

  get latest(): SchoolStructureState {
    return this.state;
  }

  observe(snapshot: SchoolStructureSnapshot): SchoolStructureState {    if (snapshot.version === this.previousVersion) return this.state;
    if (snapshot.simulationTime + 1e-9 < this.previousTime) {
      this.reset();
      this.push(snapshot.simulationTime, 'reset', 'structure baseline reset', {
        time: snapshot.simulationTime,
      });
      this.previousTime = snapshot.simulationTime;
      this.previousVersion = snapshot.version;
      this.previous = componentsOf(snapshot);
      this.state = this.buildState(snapshot, this.previous);
      return this.state;
    }

    const current = componentsOf(snapshot);
    if (this.previousVersion >= 0) this.diff(snapshot.simulationTime, this.previous, current);
    this.previous = current;
    this.previousVersion = snapshot.version;
    this.previousTime = snapshot.simulationTime;
    this.state = this.buildState(snapshot, current);
    return this.state;
  }

  reset(): void {
    this.previousVersion = -1;
    this.previousTime = 0;
    this.previous = new Map();
    this.events = [];
    this.sequence = 0;
    this.lastEventTime.clear();
  }

  private diff(simulationTime: number, previous: ComponentMap, current: ComponentMap): void {
    const previousRoots = [...previous.keys()];
    const currentRoots = [...current.keys()];
    const previousOverlaps = new Map<number, number[]>();
    const currentOverlaps = new Map<number, number[]>();
    for (const previousRoot of previousRoots) {
      for (const currentRoot of currentRoots) {
        if (overlapCount(previous.get(previousRoot)!, current.get(currentRoot)!) === 0) continue;
        const previousList = previousOverlaps.get(previousRoot);
        if (previousList) previousList.push(currentRoot);
        else previousOverlaps.set(previousRoot, [currentRoot]);
        const currentList = currentOverlaps.get(currentRoot);
        if (currentList) currentList.push(previousRoot);
        else currentOverlaps.set(currentRoot, [previousRoot]);
      }
    }
    for (const previousRoot of previousRoots) {
      const size = previous.get(previousRoot)!.length;
      const overlaps = previousOverlaps.get(previousRoot) ?? [];
      if (overlaps.length === 0) {
        this.emit(simulationTime, 'subgroup-dissolved', `subgroup ${size} dispersed`, { size });
      } else if (overlaps.length >= 2) {
        this.emit(simulationTime, 'split', `split ${size} → ${overlaps.length} groups`, {
          size,
          groups: overlaps.length,
        });
      }
    }
    for (const currentRoot of currentRoots) {
      const size = current.get(currentRoot)!.length;
      const overlaps = currentOverlaps.get(currentRoot) ?? [];
      if (overlaps.length === 0) {
        this.emit(simulationTime, 'subgroup-emerged', `subgroup ${size} formed`, { size });
      } else if (overlaps.length >= 2) {
        this.emit(simulationTime, 'merge', `merge ${overlaps.length} groups → ${size}`, {
          groups: overlaps.length,
          size,
        });
      }
    }
  }

  private emit(
    simulationTime: number,
    kind: SchoolStructureEventKind,
    message: string,
    values: Record<string, number>,
  ): void {
    const last = this.lastEventTime.get(kind);
    if (last !== undefined && simulationTime - last < EVENT_COOLDOWN) return;
    this.lastEventTime.set(kind, simulationTime);
    this.push(simulationTime, kind, message, values);
  }

  private push(
    simulationTime: number,
    kind: SchoolStructureEventKind,
    message: string,
    values: Record<string, number>,
  ): void {
    this.sequence += 1;
    this.events.push({
      sequence: this.sequence,
      simulationTime,
      kind,
      message,
      values,
    });
    if (this.events.length > HISTORY_LIMIT) this.events.shift();
  }

  private buildState(snapshot: SchoolStructureSnapshot, components: ComponentMap): SchoolStructureState {
    return {
      events: this.events,
      schools: snapshot.schools,
      medianSchoolSize: snapshot.medianSchoolSize,
      largestSchool: snapshot.largestSchool,
      largestPolarization: snapshot.largestPolarization,
      startleCount: snapshot.startleCount,
      startleCentroid: snapshot.startleCentroid,
      startleRadius: snapshot.startleRadius,
      edgePressureCount: snapshot.edgePressureCount,
      histogram: histogramOf(components),
      lastEvent: this.events.length > 0 ? this.events[this.events.length - 1] : null,
    };
  }
}
