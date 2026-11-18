/**
 * Read-only predation event tracker (Phase E3).
 *
 * It consumes real `SimulationWorld` observations and derives a small event
 * stream for the Observation UI and debug capture scripts. It never writes
 * simulation state, never forces a target or capture, and never infers a
 * capture from fish counts — only from `captureSerial` increments.
 */

export type PredationEventKind =
  | 'state-change'
  | 'target-acquired'
  | 'target-switch'
  | 'target-lost'
  | 'attack-missed'
  | 'capture'
  | 'group-compression'
  | 'group-release'
  | 'recovery'
  | 'reset';

export type PredatorStateName = 'patrol' | 'pursuit' | 'attack' | 'search';

export interface PredationObservation {
  readonly simulationTime: number;
  readonly totalSteps: number;
  readonly predatorState: PredatorStateName;
  readonly targetIndex: number;
  readonly captures: number;
  readonly captureSerial: number;
  readonly aliveCount: number;
  readonly schoolCount: number;
  readonly radiusOfGyration: number;
  readonly threatenedCount: number;
}

export interface PredationEvent {
  readonly sequence: number;
  readonly kind: PredationEventKind;
  readonly simulationTime: number;
  readonly state: PredatorStateName;
  readonly targetIndex: number;
  readonly message: string;
  readonly values?: Readonly<Record<string, number>>;
}

const EVENT_CAP = 24;
const GROUP_COOLDOWN = 1.5;
const THREAT_HYSTERESIS = 2;

export class PredationEventTracker {
  private last: PredationObservation | null = null;
  private events: PredationEvent[] = [];
  private sequence = 0;
  private groupBaselineSchoolCount = 0;
  private groupBaselineRg = 0;
  private lastGroupTime = Number.NEGATIVE_INFINITY;
  private threatHigh = false;
  private threatHighSince = 0;
  private wasThreatening = false;

  /** New events since the previous call; newest last. */
  observe(observation: PredationObservation): PredationEvent[] {
    if (!this.last) {
      this.last = observation;
      this.groupBaselineSchoolCount = observation.schoolCount;
      this.groupBaselineRg = observation.radiusOfGyration;
      this.lastGroupTime = observation.simulationTime;
      this.wasThreatening = observation.predatorState === 'pursuit'
        || observation.predatorState === 'attack';
      const threshold = Math.max(3, observation.aliveCount * 0.02);
      this.threatHigh = observation.threatenedCount > threshold;
      this.threatHighSince = observation.simulationTime;
      return [];
    }
    if (
      observation.simulationTime < this.last.simulationTime
      || observation.totalSteps < this.last.totalSteps
    ) {
      const resetEvent = this.push('reset', observation, 'timeline reset', undefined);
      this.last = observation;
      this.groupBaselineSchoolCount = observation.schoolCount;
      this.groupBaselineRg = observation.radiusOfGyration;
      this.lastGroupTime = observation.simulationTime;
      this.threatHigh = false;
      this.wasThreatening = false;
      return [resetEvent];
    }

    const previous = this.last;
    const emitted: PredationEvent[] = [];
    const serialDelta = observation.captureSerial - previous.captureSerial;

    if (serialDelta > 0) {
      for (let index = 0; index < serialDelta; index += 1) {
        const target = previous.targetIndex >= 0 ? previous.targetIndex : observation.targetIndex;
        emitted.push(this.push(
          'capture',
          observation,
          target >= 0 ? `capture #${previous.captures + index + 1} · target #${target}` : `capture #${previous.captures + index + 1}`,
          { captures: previous.captures + index + 1 },
        ));
      }
    }

    if (observation.predatorState !== previous.predatorState) {
      emitted.push(this.push(
        'state-change',
        observation,
        `${previous.predatorState} → ${observation.predatorState}`,
      ));
      if (
        observation.predatorState === 'pursuit'
        && (previous.predatorState === 'patrol' || previous.predatorState === 'search')
        && observation.targetIndex >= 0
      ) {
        this.wasThreatening = true;
        emitted.push(this.push(
          'target-acquired',
          observation,
          `target #${observation.targetIndex} acquired`,
        ));
      }
      if (
        observation.predatorState === 'attack'
        || observation.predatorState === 'pursuit'
      ) {
        this.wasThreatening = true;
      }
      if (observation.predatorState === 'search' && previous.predatorState === 'pursuit') {
        if (serialDelta === 0) {
          emitted.push(this.push('target-lost', observation, 'target lost · search sweep'));
        }
      }
      if (observation.predatorState === 'search' && previous.predatorState === 'attack') {
        if (serialDelta === 0) {
          emitted.push(this.push('attack-missed', observation, 'attack missed · recovery scan'));
        }
      }
      if (observation.predatorState === 'patrol' && previous.predatorState === 'search' && this.wasThreatening) {
        this.wasThreatening = false;
        emitted.push(this.push('recovery', observation, 'recovery · patrol resumed'));
      }
    }

    if (
      observation.predatorState === 'pursuit'
      && previous.predatorState === 'pursuit'
      && observation.targetIndex !== previous.targetIndex
      && observation.targetIndex >= 0
    ) {
      emitted.push(this.push(
        'target-switch',
        observation,
        `target switched to #${observation.targetIndex}`,
      ));
    }

    const threatThreshold = Math.max(3, observation.aliveCount * 0.02);
    if (observation.threatenedCount > threatThreshold && !this.threatHigh) {
      this.threatHigh = true;
      this.threatHighSince = observation.simulationTime;
    } else if (
      this.threatHigh
      && observation.threatenedCount <= threatThreshold
      && observation.simulationTime - this.threatHighSince >= THREAT_HYSTERESIS
    ) {
      this.threatHigh = false;
      const alreadyRecovered = emitted.some((event) => event.kind === 'recovery');
      if (!alreadyRecovered
        && observation.predatorState !== 'pursuit'
        && observation.predatorState !== 'attack') {
        emitted.push(this.push(
          'recovery',
          observation,
          'escape response fading',
          { threatened: observation.threatenedCount },
        ));
      }
    }

    if (observation.simulationTime - this.lastGroupTime >= GROUP_COOLDOWN) {
      const schoolDelta = observation.schoolCount - this.groupBaselineSchoolCount;
      const rgDelta = observation.radiusOfGyration - this.groupBaselineRg;
      const rgThreshold = Math.max(0.15, this.groupBaselineRg * 0.1);
      if (schoolDelta >= 1 || rgDelta <= -rgThreshold) {
        this.lastGroupTime = observation.simulationTime;
        this.groupBaselineSchoolCount = observation.schoolCount;
        this.groupBaselineRg = observation.radiusOfGyration;
        emitted.push(this.push(
          'group-compression',
          observation,
          schoolDelta >= 1 ? `school split into ${observation.schoolCount}` : 'group compressing',
          { schools: observation.schoolCount, radius: observation.radiusOfGyration },
        ));
      } else if (schoolDelta <= -1 || rgDelta >= rgThreshold) {
        this.lastGroupTime = observation.simulationTime;
        this.groupBaselineSchoolCount = observation.schoolCount;
        this.groupBaselineRg = observation.radiusOfGyration;
        emitted.push(this.push(
          'group-release',
          observation,
          schoolDelta <= -1 ? `schools merged to ${observation.schoolCount}` : 'group dispersing',
          { schools: observation.schoolCount, radius: observation.radiusOfGyration },
        ));
      }
    }

    this.last = observation;
    return emitted;
  }

  get latest(): PredationEvent | null {
    return this.events.length > 0 ? this.events[this.events.length - 1] : null;
  }

  get all(): readonly PredationEvent[] {
    return this.events;
  }

  reset(): void {
    this.last = null;
    this.events = [];
    this.groupBaselineSchoolCount = 0;
    this.groupBaselineRg = 0;
    this.lastGroupTime = Number.NEGATIVE_INFINITY;
    this.threatHigh = false;
    this.threatHighSince = 0;
    this.wasThreatening = false;
  }

  private push(
    kind: PredationEventKind,
    observation: PredationObservation,
    message: string,
    values: Readonly<Record<string, number>> | undefined = undefined,
  ): PredationEvent {
    this.sequence += 1;
    const event: PredationEvent = {
      sequence: this.sequence,
      kind,
      simulationTime: observation.simulationTime,
      state: observation.predatorState,
      targetIndex: observation.targetIndex,
      message,
      values,
    };
    this.events.push(event);
    if (this.events.length > EVENT_CAP) this.events.shift();
    return event;
  }
}
