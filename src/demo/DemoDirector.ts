import type { CameraMode } from '../rendering/CameraController';
import type { NeighborSearchMode } from '../simulation/SimulationConfig';
import type { ScenarioId } from '../simulation/Scenarios';
import type { ViewMode } from '../ui/ControlPanel';

export const DEMO_DURATION_SECONDS = 90;

export type DemoPresentation = 'cinematic' | 'technical';
export type DemoShotId =
  | 'opening'
  | 'schooling'
  | 'predation'
  | 'recovery'
  | 'navigation'
  | 'technical-grid'
  | 'technical-brute-force'
  | 'technical-grid-return'
  | 'finale';

export interface DemoShot {
  readonly id: DemoShotId;
  readonly start: number;
  readonly end: number;
  readonly title: string;
  /** A scenario is supplied only when the shot intentionally initializes a new run. */
  readonly scenario?: ScenarioId;
  readonly camera: CameraMode;
  readonly presentation: DemoPresentation;
  readonly viewMode: ViewMode;
  readonly searchMode: NeighborSearchMode;
  readonly gridVisible: boolean;
}

/**
 * A deterministic presentation timeline. It never writes fish, predator or
 * target state; scenario changes use the same seeded reset path as the UI.
 */
export const DEMO_SHOTS: readonly DemoShot[] = [
  {
    id: 'opening',
    start: 0,
    end: 8,
    title: 'Enter the water column',
    scenario: 'calm',
    camera: 'overview',
    presentation: 'cinematic',
    viewMode: 'observation',
    searchMode: 'grid',
    gridVisible: false,
  },
  {
    id: 'schooling',
    start: 8,
    end: 23,
    title: 'Schooling behavior',
    camera: 'school',
    presentation: 'cinematic',
    viewMode: 'observation',
    searchMode: 'grid',
    gridVisible: false,
  },
  {
    id: 'predation',
    start: 23,
    end: 39,
    title: 'Predator encounter',
    scenario: 'encounter',
    camera: 'predator',
    presentation: 'cinematic',
    viewMode: 'observation',
    searchMode: 'grid',
    gridVisible: false,
  },
  {
    id: 'recovery',
    start: 39,
    end: 44,
    title: 'School recovery',
    camera: 'school',
    presentation: 'cinematic',
    viewMode: 'observation',
    searchMode: 'grid',
    gridVisible: false,
  },
  {
    id: 'navigation',
    start: 44,
    end: 53,
    title: 'Reef navigation',
    scenario: 'obstacles',
    camera: 'overview',
    presentation: 'cinematic',
    viewMode: 'observation',
    searchMode: 'grid',
    gridVisible: false,
  },
  {
    id: 'technical-grid',
    start: 53,
    end: 62,
    title: 'Uniform-grid neighbor search',
    scenario: 'calm',
    camera: 'school',
    presentation: 'technical',
    viewMode: 'laboratory',
    searchMode: 'grid',
    gridVisible: true,
  },
  {
    id: 'technical-brute-force',
    start: 62,
    end: 67,
    title: 'Brute-force comparison',
    camera: 'overview',
    presentation: 'technical',
    viewMode: 'laboratory',
    searchMode: 'brute-force',
    gridVisible: false,
  },
  {
    id: 'technical-grid-return',
    start: 67,
    end: 70,
    title: 'Return to the live grid',
    camera: 'school',
    presentation: 'technical',
    viewMode: 'laboratory',
    searchMode: 'grid',
    gridVisible: true,
  },
  {
    id: 'finale',
    start: 70,
    end: DEMO_DURATION_SECONDS,
    title: 'One live ecosystem',
    camera: 'overview',
    presentation: 'cinematic',
    viewMode: 'observation',
    searchMode: 'grid',
    gridVisible: false,
  },
] as const;

export interface DemoDirectorActions {
  setScenario(id: ScenarioId): void;
  setCameraMode(mode: CameraMode): void;
  setViewMode(mode: ViewMode): void;
  setSearchMode(mode: NeighborSearchMode): void;
  setGridVisible(visible: boolean): void;
  setCollisionDebugLayers(enabled: boolean): void;
  setPresentation(mode: DemoPresentation | null): void;
  setPaused(paused: boolean): void;
  setTimeScale(scale: number): void;
}

export interface DemoState {
  readonly active: boolean;
  readonly complete: boolean;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly shot: DemoShot;
  readonly shotIndex: number;
}

export function demoShotAt(seconds: number): { shot: DemoShot; index: number } {
  const time = Number.isFinite(seconds)
    ? Math.min(DEMO_DURATION_SECONDS, Math.max(0, seconds))
    : 0;
  const index = DEMO_SHOTS.findIndex((shot) => time >= shot.start && time < shot.end);
  if (index >= 0) return { shot: DEMO_SHOTS[index], index };
  return { shot: DEMO_SHOTS[DEMO_SHOTS.length - 1], index: DEMO_SHOTS.length - 1 };
}

/**
 * Presentation-only director for repeatable recording. Camera and solution
 * mode changes are explicit; no biological trajectory is scripted here.
 */
export class DemoDirector {
  private active = false;
  private complete = false;
  private elapsed = 0;
  private shotIndex = -1;

  constructor(private readonly actions: DemoDirectorActions) {}

  start(): DemoState {
    this.active = true;
    this.complete = false;
    this.elapsed = 0;
    this.shotIndex = -1;
    this.actions.setTimeScale(1);
    this.actions.setPaused(false);
    this.applyShot(0);
    return this.getState();
  }

  restart(): DemoState {
    return this.start();
  }

  stop(restorePresentation = true): DemoState {
    const state = this.getState();
    this.active = false;
    this.complete = false;
    if (restorePresentation) {
      this.actions.setPresentation(null);
      this.actions.setViewMode('observation');
    }
    return { ...state, active: false };
  }

  seek(seconds: number): DemoState {
    this.elapsed = Number.isFinite(seconds)
      ? Math.min(DEMO_DURATION_SECONDS, Math.max(0, seconds))
      : 0;
    this.complete = this.elapsed >= DEMO_DURATION_SECONDS;
    const { index } = demoShotAt(this.elapsed);
    if (index !== this.shotIndex) this.applyShot(index);
    return this.getState();
  }

  update(deltaSeconds: number): DemoState {
    if (!this.active || this.complete) return this.getState();
    const delta = Number.isFinite(deltaSeconds)
      ? Math.min(0.25, Math.max(0, deltaSeconds))
      : 0;
    this.elapsed = Math.min(DEMO_DURATION_SECONDS, this.elapsed + delta);

    if (this.elapsed >= DEMO_DURATION_SECONDS) {
      this.complete = true;
      this.active = false;
      this.actions.setPaused(true);
      return this.getState();
    }

    const { index } = demoShotAt(this.elapsed);
    if (index !== this.shotIndex) this.applyShot(index);
    return this.getState();
  }

  getState(): DemoState {
    const { shot, index } = demoShotAt(this.elapsed);
    return {
      active: this.active,
      complete: this.complete,
      elapsedSeconds: this.elapsed,
      durationSeconds: DEMO_DURATION_SECONDS,
      shot,
      shotIndex: index,
    };
  }

  private applyShot(index: number): void {
    const shot = DEMO_SHOTS[index];
    if (!shot) return;
    this.shotIndex = index;
    if (shot.scenario) this.actions.setScenario(shot.scenario);
    this.actions.setPresentation(shot.presentation);
    this.actions.setViewMode(shot.viewMode);
    this.actions.setCameraMode(shot.camera);
    this.actions.setSearchMode(shot.searchMode);
    this.actions.setGridVisible(shot.gridVisible);
    // The demo uses the occupied grid and a single-fish behavior sample. A
    // forest of collision-proxy wireframes obscures the actual school.
    this.actions.setCollisionDebugLayers(false);
  }
}
