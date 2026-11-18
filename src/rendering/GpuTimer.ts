import type { WebGLRenderer } from 'three';

/**
 * Gated GPU timer-query recorder (WebGL2 EXT_disjoint_timer_query_webgl2).
 *
 * A query is started only when telemetry is enabled, and at most two queries
 * are in flight. The extension's disjoint flag is checked before accepting a
 * result; a disjoint sample is discarded rather than reported. `frameMs`
 * stays null until at least one valid result has been read.
 */

export interface GpuTimerSnapshot {
  readonly available: boolean;
  readonly extension: string | null;
  readonly measured: boolean;
  readonly frameMs: number | null;
  readonly sampleCount: number;
  readonly emaMs: number | null;
  readonly disjointSamples: number;
}

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  enabled = false;

  private readonly gl: WebGL2RenderingContext;
  private readonly extension: string | null;
  private readonly timer: TimerExtension | null;
  private query: WebGLQuery | null = null;
  private readonly pending: WebGLQuery[] = [];
  private readonly maxPending = 2;
  private lastMs: number | null = null;
  private emaMs = 0;
  private sampleCount = 0;
  private disjointSamples = 0;

  constructor(renderer: WebGLRenderer) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.gl = gl;
    const webgl2 = typeof gl.createQuery === 'function'
      ? gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
      : null;
    const webgl1 = webgl2
      ? null
      : gl.getExtension('EXT_disjoint_timer_query') as TimerExtension | null;
    this.timer = webgl2;
    this.extension = webgl2
      ? 'EXT_disjoint_timer_query_webgl2'
      : webgl1
        ? 'EXT_disjoint_timer_query'
        : null;
  }

  get available(): boolean {
    return this.extension !== null;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  reset(): void {
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
    if (this.query) {
      this.gl.deleteQuery(this.query);
      this.query = null;
    }
    this.lastMs = null;
    this.emaMs = 0;
    this.sampleCount = 0;
    this.disjointSamples = 0;
  }

  begin(): void {
    if (!this.enabled || !this.timer || this.query || this.pending.length >= this.maxPending) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
    this.query = query;
  }

  end(): void {
    if (this.query && this.timer) {
      this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.pending.push(this.query);
      this.query = null;
    }
    this.poll();
  }

  private poll(): void {
    if (!this.timer) return;
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const query = this.pending[index];
      const available = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE);
      if (!available) continue;
      const disjoint = this.gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      if (!disjoint) {
        const nanoseconds = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
        const milliseconds = nanoseconds / 1e6;
        if (Number.isFinite(milliseconds) && milliseconds >= 0) {
          this.lastMs = milliseconds;
          this.emaMs = this.sampleCount === 0
            ? milliseconds
            : this.emaMs * 0.92 + milliseconds * 0.08;
          this.sampleCount += 1;
        }
      } else {
        this.disjointSamples += 1;
      }
      this.gl.deleteQuery(query);
      this.pending.splice(index, 1);
    }
  }

  snapshot(): GpuTimerSnapshot {
    return {
      available: this.available,
      extension: this.extension,
      measured: this.sampleCount > 0,
      frameMs: this.lastMs,
      sampleCount: this.sampleCount,
      emaMs: this.sampleCount > 0 ? this.emaMs : null,
      disjointSamples: this.disjointSamples,
    };
  }
}
