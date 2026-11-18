import { describe, expect, it } from 'vitest';
import {
  evaluatePhaseFGate,
  type GateSample,
} from '../scripts/phase-f-gate-rule';

const BASE: GateSample = {
  row: 'standard-control',
  repeat: 1,
  mode: 'off',
  width: 1280,
  height: 720,
  telemetry: false,
  frameCount: 160,
  durationMs: 12000,
  p50Ms: 12,
  p95Ms: 18,
  droppedSteps: 0,
  simulationMs: 6.9,
  renderer: {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  browserErrors: [],
  visibility: {
    before: { visibility: 'visible', focused: true },
    after: { visibility: 'visible', focused: true },
  },
  viewport: {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
  },
  canvas: {
    width: 1280,
    height: 720,
    clientWidth: 1280,
    clientHeight: 720,
    devicePixelRatio: 1,
    effectivePixelRatio: 1,
  },
  panelClosed: false,
  refresh: { estimateMs: 16.67, estimateHz: 60, method: 'blank-page-rAF-median-60' },
  totalSteps: 3600,
  stepsPerFrameMean: 1,
};

function control(overrides: Partial<GateSample> = {}): GateSample {
  return { ...BASE, ...overrides };
}

function verdict(overrides: Partial<GateSample> = {}): GateSample {
  return control({
    row: 'standard-spot',
    width: 1440,
    height: 900,
    p50Ms: 20,
    p95Ms: 25,
    viewport: { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1 },
    canvas: {
      width: 1440,
      height: 900,
      clientWidth: 1440,
      clientHeight: 900,
      devicePixelRatio: 1,
      effectivePixelRatio: 1,
    },
    ...overrides,
  });
}

function controls(p50 = [12, 12.2, 12.1]): GateSample[] {
  return p50.map((value, index) => control({ repeat: index + 1, p50Ms: value }));
}

describe('evaluatePhaseFGate', () => {
  it('passes the gate when all controls and 1440 samples meet D028', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, p50Ms: 12.5, p95Ms: 19 })),
      attempt: 1,
    });
    expect(result.verdict).toBe('PASS_1440');
    expect(result.nextSpend).toBe('cpu-prune-eligible');
    expect(result.rerunRecommended).toBe(false);
    expect(result.checks.every((check) => check.pass)).toBe(true);
  });

  it('classifies a one-tier median as ONE_TIER', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 18 }),
        verdict({ repeat: 2, p50Ms: 20 }),
        verdict({ repeat: 3, p50Ms: 21 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('ONE_TIER');
    expect(result.nextSpend).toBe('render-gpu-investigation');
    expect(result.verdictDetail.medianP50Ms).toBe(20);
  });

  it('keeps the one-tier boundary at exactly 22.8 ms', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 20, p95Ms: 33 }),
        verdict({ repeat: 2, p50Ms: 22.8, p95Ms: 33 }),
        verdict({ repeat: 3, p50Ms: 23.5, p95Ms: 33 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('ONE_TIER');
    expect(result.verdictDetail.medianP50Ms).toBe(22.8);
  });

  it('classifies a median above 22.8 ms as TWO_TIER', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 23 }),
        verdict({ repeat: 2, p50Ms: 24 }),
        verdict({ repeat: 3, p50Ms: 25 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('TWO_TIER');
    expect(result.nextSpend).toBe('render-gpu-investigation');
  });

  it('classifies P95 above 33 ms in two of three samples as TWO_TIER', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 12, p95Ms: 34 }),
        verdict({ repeat: 2, p50Ms: 12, p95Ms: 35 }),
        verdict({ repeat: 3, p50Ms: 12, p95Ms: 20 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('TWO_TIER');
    expect(result.checks.find((check) => check.id === 'V3-spread')?.pass).toBe(true);
  });

  it('treats an undefined mixed case as ONE_TIER instead of leaving it unclassified', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 15 }),
        verdict({ repeat: 2, p50Ms: 16 }),
        verdict({ repeat: 3, p50Ms: 17 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('ONE_TIER');
    expect(result.verdictDetail.medianP50Ms).toBe(16);
  });

  it('treats more than one dropped step as TWO_TIER when D1 and D2 fail', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 18, droppedSteps: 2 }),
        verdict({ repeat: 2, p50Ms: 19 }),
        verdict({ repeat: 3, p50Ms: 20 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('TWO_TIER');
  });

  it('accepts the exact D028 boundary values', () => {
    const result = evaluatePhaseFGate({
      controls: controls([16.7, 16.7, 16.7]).map((sample) => ({
        ...sample,
        p95Ms: 33,
      })),
      verdicts: [1, 2, 3].map((repeat) => verdict({
        repeat,
        p50Ms: 16.7,
        p95Ms: 33,
        droppedSteps: 0,
      })),
      attempt: 1,
    });
    expect(result.verdict).toBe('PASS_1440');
  });

  it('invalidates a control that misses D028 and recommends one rerun', () => {
    const result = evaluatePhaseFGate({
      controls: controls([12, 12, 17]),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, p50Ms: 12 })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.nextSpend).toBe('stop');
    expect(result.rerunRecommended).toBe(true);
    expect(result.checks.find((check) => check.id === 'V1-d028')?.pass).toBe(false);
  });

  it('becomes INCONCLUSIVE when the second attempt also fails', () => {
    const result = evaluatePhaseFGate({
      controls: controls([12, 12, 17]),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, p50Ms: 12 })),
      attempt: 2,
    });
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.nextSpend).toBe('stop');
    expect(result.rerunRecommended).toBe(false);
  });

  it('invalidates a control P50 spread above 1.25', () => {
    const result = evaluatePhaseFGate({
      controls: controls([10, 13, 10]),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, p50Ms: 20 })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V1-spread')?.pass).toBe(false);
  });

  it('invalidates a verdict P50 spread above 1.25', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [
        verdict({ repeat: 1, p50Ms: 15 }),
        verdict({ repeat: 2, p50Ms: 19 }),
        verdict({ repeat: 3, p50Ms: 20 }),
      ],
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V3-spread')?.pass).toBe(false);
  });

  it('invalidates a software renderer', () => {
    const result = evaluatePhaseFGate({
      controls: controls().map((sample) => ({
        ...sample,
        renderer: { vendor: 'Google Inc.', renderer: 'SwiftShader Device (Subzero)' },
      })),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V2-renderer')?.pass).toBe(false);
  });

  it('invalidates an unfocused or hidden page', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({
        repeat,
        visibility: {
          before: { visibility: 'visible', focused: true },
          after: { visibility: 'visible', focused: false },
        },
      })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V2-visibility')?.pass).toBe(false);
  });

  it('invalidates browser errors and short verdict samples', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({
        repeat,
        frameCount: 119,
        durationMs: 9999,
        browserErrors: ['pageerror: boom'],
      })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V3-samples')?.pass).toBe(false);
    expect(result.checks.find((check) => check.id === 'V2-errors')?.pass).toBe(false);
  });

  it('invalidates a simulation EMA ratio above 1.05', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, simulationMs: 7.3 })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    const ratio = result.checks.find((check) => check.id === 'V3-sim-ratio');
    expect(ratio?.pass).toBe(false);
    expect(ratio?.detail).toContain('1.058');
  });

  it('invalidates canvas size or effective DPR drift', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({
        repeat,
        canvas: {
          width: 1440,
          height: 900,
          clientWidth: 720,
          clientHeight: 450,
          devicePixelRatio: 2,
          effectivePixelRatio: 2,
        },
      })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V2-canvas')?.pass).toBe(false);
  });

  it('invalidates a viewport that did not apply the requested page size', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({
        repeat,
        viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
      })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V2-viewport')?.pass).toBe(false);
  });

  it('invalidates a 1440 page viewport that does not grow the canvas area', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({
        repeat,
        canvas: {
          width: 1280,
          height: 720,
          clientWidth: 1280,
          clientHeight: 720,
          devicePixelRatio: 1,
          effectivePixelRatio: 1,
        },
      })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V3-canvas-growth')?.pass).toBe(false);
  });

  it('invalidates an inconsistent console state', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, panelClosed: repeat !== 2 })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V2-panel-consistent')?.pass).toBe(false);
  });

  it('invalidates a sample whose simulation did not advance', () => {
    const result = evaluatePhaseFGate({
      controls: controls(),
      verdicts: [1, 2, 3].map((repeat) => verdict({ repeat, stepsPerFrameMean: 0 })),
      attempt: 1,
    });
    expect(result.verdict).toBe('INVALID');
    expect(result.checks.find((check) => check.id === 'V2-run')?.pass).toBe(false);
  });
});
