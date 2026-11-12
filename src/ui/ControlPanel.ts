import type { CameraMode } from '../rendering/CameraController';
import type { DebugLayer } from '../rendering/DebugVisualizer';
import type { CollisionDebugLayer, CollisionDebugVisibility } from '../rendering/CollisionDebugVisualizer';
import type { NeighborSearchMode, ObstacleShapeMode, SimulationConfig } from '../simulation/SimulationConfig';
import type { ScenarioDefinition, ScenarioId } from '../simulation/Scenarios';
import type { WaterDebugLayer, WaterDebugState } from '../rendering/UnderwaterMedium';

export type ViewMode = 'observation' | 'laboratory';
export type ConsoleTab = 'behavior' | 'ecology' | 'environment' | 'performance';

export interface ControlActions {
  setPaused(paused: boolean): void;
  reset(): void;
  setFishCount(count: number): void;
  setClownfishCount(count: number): void;
  setTimeScale(scale: number): void;
  setSearchMode(mode: NeighborSearchMode): void;
  setObstacleShapeMode(mode: ObstacleShapeMode): void;
  updateConfig(patch: Partial<SimulationConfig>): void;
  setCameraMode(mode: CameraMode): void;
  setGridVisible(visible: boolean): void;
  setViewMode(mode: ViewMode): void;
  setScenario(id: ScenarioId): void;
  setWaterEffects(enabled: boolean): void;
  setWaterDebugLayer(layer: WaterDebugLayer, enabled: boolean): void;
  setWaterDebugLayers(enabled: boolean): void;
  setDebugLayer(layer: DebugLayer, visible: boolean): void;
  setCollisionDebugLayer(layer: CollisionDebugLayer, visible: boolean): void;
  toggleFullscreen(): void;
  releasePredator(): void;
  regroupSchool(): void;
}

type NumericConfigKey = {
  [Key in keyof SimulationConfig]-?: SimulationConfig[Key] extends number ? Key : never;
}[keyof SimulationConfig];

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element #${id}.`);
  return element as T;
}

export class ControlPanel {
  private paused = false;
  private readonly ranges = new Map<string, { key: NumericConfigKey; suffix: string; decimals: number }>();
  private gridVisible = false;
  private viewMode: ViewMode = 'observation';
  private activeTab: ConsoleTab = 'behavior';

  constructor(private readonly actions: ControlActions) {
    byId('pause-button').addEventListener('click', () => this.actions.setPaused(!this.paused));
    byId('reset-button').addEventListener('click', () => this.actions.reset());
    byId<HTMLSelectElement>('time-scale').addEventListener('change', (event) => {
      this.actions.setTimeScale(Number((event.target as HTMLSelectElement).value));
    });

    const fishCount = byId<HTMLInputElement>('fish-count');
    fishCount.addEventListener('input', () => {
      byId<HTMLOutputElement>('fish-count-value').value = fishCount.value;
    });
    fishCount.addEventListener('change', () => this.actions.setFishCount(Number(fishCount.value)));

    const clownfishCount = byId<HTMLInputElement>('clownfish-count');
    clownfishCount.addEventListener('input', () => {
      byId<HTMLOutputElement>('clownfish-count-value').value = clownfishCount.value;
    });
    clownfishCount.addEventListener('change', () => this.actions.setClownfishCount(Number(clownfishCount.value)));

    this.bindRange('separation-weight', 'separationWeight');
    this.bindRange('alignment-weight', 'alignmentWeight');
    this.bindRange('cohesion-weight', 'cohesionWeight');
    this.bindRange('max-speed', 'maxSpeed', ' m/s');
    this.bindRange('separation-radius', 'separationRadius', ' m');
    this.bindRange('alignment-radius', 'alignmentRadius', ' m');
    this.bindRange('cohesion-radius', 'cohesionRadius', ' m');
    this.bindRange('field-of-view', 'fieldOfViewDegrees', '°');
    this.bindRange('evasion-weight', 'evasionWeight');
    this.bindRange('predator-aggression', 'predatorAggression');

    byId<HTMLInputElement>('predator-enabled').addEventListener('change', (event) => {
      this.actions.updateConfig({ predatorEnabled: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('obstacles-enabled').addEventListener('change', (event) => {
      this.actions.updateConfig({ obstaclesEnabled: (event.target as HTMLInputElement).checked });
    });
    byId<HTMLInputElement>('water-effects').addEventListener('change', (event) => {
      this.actions.setWaterEffects((event.target as HTMLInputElement).checked);
    });
    document.querySelectorAll<HTMLInputElement>('[data-water-debug]').forEach((input) => {
      input.addEventListener('change', () => {
        this.actions.setWaterDebugLayer(input.dataset.waterDebug as WaterDebugLayer, input.checked);
      });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-water-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        this.actions.setWaterDebugLayers(button.dataset.waterPreset === 'all-on');
      });
    });
    byId<HTMLInputElement>('grid-visible').addEventListener('change', (event) => {
      this.setGridVisible((event.target as HTMLInputElement).checked);
    });
    document.querySelectorAll<HTMLInputElement>('[data-debug]').forEach((input) => {
      input.addEventListener('change', () => {
        this.actions.setDebugLayer(input.dataset.debug as DebugLayer, input.checked);
      });
    });
    byId<HTMLInputElement>('reef-proxy-mode').addEventListener('change', (event) => {
      this.actions.setObstacleShapeMode(
        (event.target as HTMLInputElement).checked ? 'reefProxy' : 'sphere',
      );
    });
    document.querySelectorAll<HTMLInputElement>('[data-collision-debug]').forEach((input) => {
      input.addEventListener('change', () => {
        this.actions.setCollisionDebugLayer(
          input.dataset.collisionDebug as CollisionDebugLayer,
          input.checked,
        );
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-search]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.search as NeighborSearchMode;
        this.actions.setSearchMode(mode);
        this.syncSearchMode(mode);
      });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.addEventListener('click', () => this.actions.setCameraMode(button.dataset.view as CameraMode));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.setViewMode(button.dataset.mode as ViewMode));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
      button.addEventListener('click', () => this.actions.setScenario(button.dataset.scenario as ScenarioId));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => this.selectTab(button.dataset.tab as ConsoleTab));
      button.addEventListener('keydown', (event) => this.handleTabKey(event));
    });

    byId('chase-button').addEventListener('click', () => {
      this.actions.releasePredator();
      byId<HTMLInputElement>('predator-enabled').checked = true;
    });
    byId('regroup-button').addEventListener('click', () => this.actions.regroupSchool());
    byId('panel-toggle').addEventListener('click', () => {
      this.setPanelOpen(byId('control-panel').closest('.observatory')?.classList.contains('panel-closed') ?? false);
    });
    byId('panel-close').addEventListener('click', () => this.setPanelOpen(false));
    byId('panel-scrim').addEventListener('click', () => this.setPanelOpen(false));
    byId('fullscreen-button').addEventListener('click', () => this.actions.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      const active = Boolean(document.fullscreenElement);
      byId('fullscreen-button').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
      byId('fullscreen-button').setAttribute('title', active ? 'Exit fullscreen' : 'Fullscreen');
    });

    this.selectTab(this.activeTab);
    if (window.innerWidth <= 980) this.setPanelOpen(false);
  }

  setRunning(running: boolean): void {
    this.paused = !running;
    byId('pause-label').textContent = running ? 'Pause' : 'Resume';
    byId('pause-icon').textContent = running ? 'Ⅱ' : '▶';
    byId('status-label').textContent = running ? 'Live' : 'Paused';
    byId('run-status').classList.toggle('paused', !running);
  }

  setPanelOpen(open: boolean): void {
    byId('control-panel').closest('.observatory')?.classList.toggle('panel-closed', !open);
    byId('panel-toggle').setAttribute('aria-expanded', String(open));
    if (open) byId('control-panel').removeAttribute('aria-hidden');
    else byId('control-panel').setAttribute('aria-hidden', 'true');
  }

  setViewMode(mode: ViewMode): void {
    this.actions.setViewMode(mode);
    this.syncViewMode(mode);
  }

  syncViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    const root = document.querySelector<HTMLElement>('.observatory')!;
    root.dataset.viewMode = mode;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    byId('console-title').textContent = mode === 'laboratory' ? 'Laboratory console' : 'Observation console';
  }

  syncScenario(scenario: ScenarioDefinition): void {
    byId('header-scenario').textContent = scenario.name;
    byId('scene-name').textContent = scenario.name;
    byId('scenario-seed').textContent = `Seed 0x${scenario.seed.toString(16).padStart(8, '0')}`;
    byId('scenario-seed').setAttribute('title', scenario.description);
    document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario.id));
    });
  }

  syncCameraMode(mode: CameraMode): void {
    const normalized = mode === 'free' ? 'orbit' : mode;
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === normalized));
    });
  }

  syncTimeScale(scale: number): void {
    byId<HTMLSelectElement>('time-scale').value = String(scale);
  }

  selectTab(tab: ConsoleTab): void {
    this.activeTab = tab;
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
  }

  syncSearchMode(mode: NeighborSearchMode): void {
    document.querySelectorAll<HTMLButtonElement>('[data-search]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.search === mode));
    });
    byId('search-badge').textContent = mode === 'grid' ? 'Uniform grid' : 'Brute force';
    const gridInput = byId<HTMLInputElement>('grid-visible');
    gridInput.disabled = mode !== 'grid';
    gridInput.checked = mode === 'grid' && this.gridVisible;
    byId('grid-visible-note').textContent = mode === 'grid'
      ? 'Wireframes show occupied cells only'
      : 'Switch to Uniform grid to inspect';
  }

  setGridVisible(visible: boolean): void {
    if (visible && this.viewMode === 'observation') this.setViewMode('laboratory');
    this.gridVisible = visible;
    byId<HTMLInputElement>('grid-visible').checked = visible;
    this.actions.setGridVisible(visible);
  }

  toggleGrid(): void {
    this.setGridVisible(!this.gridVisible);
  }

  syncWaterDebug(state: WaterDebugState): void {
    let enabledCount = 0;
    document.querySelectorAll<HTMLInputElement>('[data-water-debug]').forEach((input) => {
      const layer = input.dataset.waterDebug as WaterDebugLayer;
      input.checked = state[layer];
      if (state[layer]) enabledCount += 1;
    });
    byId<HTMLOutputElement>('water-debug-count').value = `${enabledCount} / 7`;
  }

  syncCollisionDebug(state: CollisionDebugVisibility): void {
    document.querySelectorAll<HTMLInputElement>('[data-collision-debug]').forEach((input) => {
      input.checked = state[input.dataset.collisionDebug as CollisionDebugLayer];
    });
  }

  syncConfig(config: SimulationConfig, clownfishCount = 0): void {
    for (const [id, binding] of this.ranges) {
      const value = config[binding.key];
      byId<HTMLInputElement>(id).value = String(value);
      byId<HTMLOutputElement>(`${id}-value`).value = `${value.toFixed(binding.decimals)}${binding.suffix}`;
    }
    byId<HTMLInputElement>('fish-count').value = String(config.initialFishCount);
    byId<HTMLOutputElement>('fish-count-value').value = String(config.initialFishCount);
    this.syncClownfishCount(clownfishCount);
    byId<HTMLInputElement>('predator-enabled').checked = config.predatorEnabled;
    byId<HTMLInputElement>('obstacles-enabled').checked = config.obstaclesEnabled;
    byId<HTMLInputElement>('reef-proxy-mode').checked = config.obstacleShapeMode === 'reefProxy';
  }

  syncClownfishCount(count: number): void {
    byId<HTMLInputElement>('clownfish-count').value = String(count);
    byId<HTMLOutputElement>('clownfish-count-value').value = String(count);
  }

  private bindRange(id: string, key: NumericConfigKey, suffix = ''): void {
    const input = byId<HTMLInputElement>(id);
    const step = input.step;
    const decimals = step.includes('.') ? step.split('.')[1].length : 0;
    this.ranges.set(id, { key, suffix, decimals });
    input.addEventListener('input', () => {
      const value = Number(input.value);
      byId<HTMLOutputElement>(`${id}-value`).value = `${value.toFixed(decimals)}${suffix}`;
      this.actions.updateConfig({ [key]: value } as Partial<SimulationConfig>);
    });
  }

  private handleTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabs: ConsoleTab[] = ['behavior', 'ecology', 'environment', 'performance'];
    const current = tabs.indexOf(this.activeTab);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    this.selectTab(next);
    byId<HTMLButtonElement>(`tab-${next}`).focus();
  }
}
