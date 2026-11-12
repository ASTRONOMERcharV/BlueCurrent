import type { SimulationWorld } from '../simulation/SimulationWorld';
import { PerformanceGraph } from './PerformanceGraph';

export interface FrameReadings {
  readonly fps: number;
  readonly renderMs: number;
  readonly p95FrameMs: number;
  readonly droppedSteps: number;
  readonly drawCalls: number;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing measurement element #${id}.`);
  return element;
}

function measured(value: number, unit = '', decimals = 2): string {
  return Number.isFinite(value) && value >= 0 ? `${value.toFixed(decimals)}${unit}` : 'N/A';
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
}

export class StatisticsPanel {
  private readonly graph: PerformanceGraph;
  private lastCaptureSerial = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.graph = new PerformanceGraph(byId('performance-graph') as HTMLCanvasElement);
  }

  resetCaptureNotifications(world: SimulationWorld): void {
    this.lastCaptureSerial = world.predator.captureSerial;
    byId('capture-toast').classList.remove('visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  update(world: SimulationWorld, readings: FrameReadings): void {
    const { metrics, predator, config } = world;
    const { fps, renderMs, p95FrameMs } = readings;
    const predatorState = config.predatorEnabled
      ? predator.state[0].toUpperCase() + predator.state.slice(1)
      : 'Standby';
    const fearTotal = world.flock.fear.reduce((sum, value, index) => (
      index < world.flock.count && world.flock.alive[index] === 1 ? sum + value : sum
    ), 0);
    const escapeIntensity = world.flock.aliveCount > 0 ? fearTotal / world.flock.aliveCount : 0;

    byId('metric-fish').textContent = (metrics.fishCount + metrics.clownfishCount).toLocaleString();
    byId('metric-ecology-fish').textContent = metrics.fishCount.toLocaleString();
    byId('metric-clownfish').textContent = metrics.clownfishCount.toLocaleString();
    byId('metric-ecology-initial').textContent = `of ${config.initialFishCount.toLocaleString()} initial`;
    byId('metric-performance-fps').textContent = fps > 0 ? fps.toFixed(0) : 'N/A';
    byId('metric-footer-fps').textContent = fps > 0 ? fps.toFixed(0) : 'N/A';
    byId('metric-step').textContent = measured(metrics.averageStepMs, ' ms');
    byId('metric-footer-step').textContent = measured(metrics.averageStepMs);
    byId('metric-time').textContent = formatDuration(metrics.simulationTime);
    byId('metric-predator').textContent = predatorState;
    byId('metric-ecology-predator').textContent = predatorState;
    byId('predator-watch-state').textContent = config.predatorEnabled ? predatorState : 'Inactive';
    byId('predator-watch').classList.toggle('standby', !config.predatorEnabled);
    byId('metric-render').textContent = measured(renderMs, ' ms');
    byId('metric-p95').textContent = measured(p95FrameMs, ' ms');
    byId('metric-footer-p95').textContent = measured(p95FrameMs);
    byId('metric-neighbors').textContent = metrics.averageNeighbors.toFixed(1);
    byId('metric-neighbors-inline').textContent = metrics.averageNeighbors.toFixed(1);
    byId('metric-schools').textContent = String(metrics.schoolCount);
    byId('metric-schools-inline').textContent = String(metrics.schoolCount);
    byId('metric-threatened').textContent = metrics.threatenedCount.toLocaleString();
    byId('metric-sheltered').textContent = metrics.shelteredCount.toLocaleString();
    byId('metric-escape-intensity').textContent = `${(escapeIntensity * 100).toFixed(1)}%`;
    byId('metric-dispersion').textContent = `${metrics.radiusOfGyration.toFixed(2)} m`;
    byId('metric-polarization').textContent = `${(metrics.polarization * 100).toFixed(0)}%`;
    byId('metric-captures').textContent = String(metrics.captures);
    byId('metric-steps').textContent = metrics.totalSteps.toLocaleString();
    byId('metric-dropped').textContent = readings.droppedSteps.toLocaleString();
    byId('metric-candidates').textContent = world.boids.candidatesExamined.toLocaleString();
    byId('metric-draw-calls').textContent = readings.drawCalls.toLocaleString();
    byId('metric-cells').textContent = world.boids.searchMode === 'grid'
      ? world.boids.grid.occupiedCellCount.toLocaleString()
      : 'N/A';
    this.graph.push(fps);
    this.updateCaption(world);

    if (predator.captureSerial > this.lastCaptureSerial) {
      this.lastCaptureSerial = predator.captureSerial;
      this.showCaptureToast(metrics.fishCount);
    } else if (predator.captureSerial < this.lastCaptureSerial) {
      this.lastCaptureSerial = predator.captureSerial;
      byId('capture-toast').classList.remove('visible');
    }
  }

  private updateCaption(world: SimulationWorld): void {
    const title = byId('scene-caption-title');
    const copy = byId('scene-caption-copy');
    if (!world.config.predatorEnabled) {
      title.textContent = world.config.obstaclesEnabled ? 'Undisturbed schooling' : 'Open-water schooling';
      copy.textContent = 'Local neighbor rules coordinate the school without a central path.';
    } else if (world.predator.state === 'attack') {
      title.textContent = 'Predator strike';
      copy.textContent = 'A close-range attack can remove the selected prey from the school.';
    } else if (world.metrics.threatenedCount > Math.max(3, world.metrics.fishCount * 0.02)) {
      title.textContent = 'Escape wave';
      copy.textContent = `${world.metrics.threatenedCount} fish are inside the predator's evasion radius.`;
    } else if (world.predator.state === 'search' && world.metrics.captures > 0) {
      title.textContent = 'School recovery';
      copy.textContent = 'Cohesion and alignment rebuild coordination as the immediate threat fades.';
    } else if (world.predator.state === 'pursuit') {
      title.textContent = 'Target tracking active';
      copy.textContent = 'The predator is pursuing one fish while nearby neighbors initiate escape.';
    } else {
      title.textContent = 'Coordinated movement';
      copy.textContent = 'Separation, alignment and cohesion shape the school.';
    }
  }

  private showCaptureToast(remaining: number): void {
    const toast = byId('capture-toast');
    toast.textContent = `1 prey captured · ${remaining.toLocaleString()} fish remain`;
    toast.classList.add('visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
  }
}
