/**
 * Gated phase-timing recorder for Phase F performance diagnostics.
 *
 * Disabled by default: when disabled, begin/record/end are no-ops and the
 * simulation/render paths keep their pre-Phase-F timing behavior. Timings are
 * CPU wall-clock (performance.now) and never imply GPU time.
 */

export interface PhaseEmaOptions {
  /** Phases that partition the full step; used to derive `otherMs`. */
  readonly exclusivePhases: readonly string[];
  /** EMA smoothing factor; first sample seeds the value. */
  readonly alpha?: number;
}

export interface PhaseEmaSnapshot {
  readonly enabled: boolean;
  readonly sampleSteps: number;
  readonly totalMs: number;
  readonly phases: Record<string, number>;
  readonly otherMs: number;
}

export class PhaseEmaRecorder {
  enabled = false;

  private readonly exclusivePhases: ReadonlySet<string>;
  private readonly alpha: number;
  private sampleSteps = 0;
  private totalMs = 0;
  private stepStart = 0;
  private cursor = 0;
  private seeded = false;
  private readonly phases = new Map<string, number>();
  private readonly pending = new Map<string, number>();

  constructor(options: PhaseEmaOptions) {
    this.exclusivePhases = new Set(options.exclusivePhases);
    this.alpha = Math.min(1, Math.max(0, options.alpha ?? 0.08));
    for (const phase of options.exclusivePhases) {
      this.phases.set(phase, 0);
      this.pending.set(phase, 0);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reset();
  }

  reset(): void {
    this.sampleSteps = 0;
    this.totalMs = 0;
    this.stepStart = 0;
    this.cursor = 0;
    this.seeded = false;
    for (const phase of this.phases.keys()) this.phases.set(phase, 0);
    for (const phase of this.pending.keys()) this.pending.set(phase, 0);
  }

  beginStep(now = performance.now()): void {
    if (!this.enabled) return;
    this.stepStart = now;
    this.cursor = now;
  }

  /** Start a separately bounded phase (e.g. the every-30-step metrics pass). */
  beginPhase(now = performance.now()): void {
    if (!this.enabled) return;
    this.cursor = now;
  }

  /** Close the phase opened at the last boundary and attribute its elapsed time. */
  recordPhase(phase: string, now = performance.now()): void {
    if (!this.enabled) return;
    const elapsed = Math.max(0, now - this.cursor);
    this.cursor = now;
    this.addPhaseMs(phase, elapsed);
  }

  /** Add a pre-measured sub-phase duration, e.g. summed obstacle queries. */
  addPhaseMs(phase: string, milliseconds: number): void {
    if (!this.enabled || !Number.isFinite(milliseconds)) return;
    const value = Math.max(0, milliseconds);
    this.pending.set(phase, (this.pending.get(phase) ?? 0) + value);
  }

  /**
   * Finish the step. Pass the already-measured total when one exists so the
   * recorder never adds a redundant timer for the whole step.
   */
  endStep(totalMilliseconds?: number, now = performance.now()): void {
    if (!this.enabled) return;
    const total = Math.max(0, totalMilliseconds ?? now - this.stepStart);
    const weight = this.seeded ? this.alpha : 1;
    this.totalMs = this.totalMs * (1 - weight) + total * weight;
    for (const [phase, value] of this.pending) {
      const previous = this.phases.get(phase) ?? 0;
      this.phases.set(phase, previous * (1 - weight) + value * weight);
      this.pending.set(phase, 0);
    }
    this.sampleSteps += 1;
    this.seeded = true;
  }

  snapshot(): PhaseEmaSnapshot {
    const phases: Record<string, number> = {};
    let exclusiveTotal = 0;
    for (const [phase, value] of this.phases) {
      phases[phase] = value;
      if (this.exclusivePhases.has(phase)) exclusiveTotal += value;
    }
    return {
      enabled: this.enabled,
      sampleSteps: this.sampleSteps,
      totalMs: this.totalMs,
      phases,
      otherMs: Math.max(0, this.totalMs - exclusiveTotal),
    };
  }
}
