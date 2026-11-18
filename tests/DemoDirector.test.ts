import { describe, expect, it } from 'vitest';
import {
  DEMO_DURATION_SECONDS,
  DEMO_SHOTS,
  DemoDirector,
  demoShotAt,
} from '../src/demo/DemoDirector';
import type { DemoDirectorActions } from '../src/demo/DemoDirector';

function recordingActions(): {
  actions: DemoDirectorActions;
  calls: string[];
  state: {
    paused: boolean;
    scale: number;
    presentation: string | null;
    view: string;
    camera: string;
    search: string;
    grid: boolean;
  };
} {
  const calls: string[] = [];
  const state = {
    paused: false,
    scale: 1,
    presentation: null as string | null,
    view: 'observation',
    camera: 'overview',
    search: 'grid',
    grid: false,
  };
  return {
    calls,
    state,
    actions: {
      setScenario: (id) => { state.view = `scenario:${id}`; calls.push(`scenario:${id}`); },
      setCameraMode: (mode) => { state.camera = mode; calls.push(`camera:${mode}`); },
      setViewMode: (mode) => { state.view = mode; calls.push(`view:${mode}`); },
      setSearchMode: (mode) => { state.search = mode; calls.push(`search:${mode}`); },
      setGridVisible: (visible) => { state.grid = visible; calls.push(`grid:${visible}`); },
      setCollisionDebugLayers: (enabled) => { calls.push(`collision:${enabled}`); },
      setPresentation: (mode) => { state.presentation = mode; calls.push(`presentation:${mode}`); },
      setPaused: (paused) => { state.paused = paused; calls.push(`paused:${paused}`); },
      setTimeScale: (scale) => { state.scale = scale; calls.push(`scale:${scale}`); },
    },
  };
}

describe('DemoDirector', () => {
  it('covers the full 90-second timeline without gaps or overlaps', () => {
    expect(DEMO_SHOTS[0].start).toBe(0);
    expect(DEMO_SHOTS[DEMO_SHOTS.length - 1].end).toBe(DEMO_DURATION_SECONDS);
    for (let index = 1; index < DEMO_SHOTS.length; index += 1) {
      expect(DEMO_SHOTS[index].start).toBe(DEMO_SHOTS[index - 1].end);
    }
  });

  it('applies only presentation and explicit scenario initialization at a cut', () => {
    const { actions, calls, state } = recordingActions();
    const director = new DemoDirector(actions);
    director.start();
    expect(calls).toContain('scenario:calm');
    expect(state.paused).toBe(false);
    expect(state.scale).toBe(1);
    expect(state.presentation).toBe('cinematic');
    expect(state.camera).toBe('overview');
    expect(state.grid).toBe(false);
    expect(calls).toContain('collision:false');

    director.seek(23);
    expect(state.view).toBe('observation');
    expect(calls).toContain('scenario:encounter');
    expect(state.camera).toBe('predator');
  });

  it('switches to laboratory observability in the technical segment', () => {
    const { actions, state } = recordingActions();
    const director = new DemoDirector(actions);
    director.start();
    director.seek(53);
    expect(state.presentation).toBe('technical');
    expect(state.view).toBe('laboratory');
    expect(state.search).toBe('grid');
    expect(state.grid).toBe(true);

    director.seek(62);
    expect(state.search).toBe('brute-force');
    expect(state.grid).toBe(false);
  });

  it('completes at 90 seconds and pauses without touching simulation data', () => {
    const { actions, calls } = recordingActions();
    const director = new DemoDirector(actions);
    director.start();
    for (let step = 0; step < 360; step += 1) director.update(0.25);
    expect(director.getState().complete).toBe(true);
    expect(director.getState().active).toBe(false);
    expect(calls).toContain('paused:true');
    expect(demoShotAt(90).shot.id).toBe('finale');
  });
});
