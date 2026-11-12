export interface StepResult {
  steps: number;
  droppedSteps: number;
  alpha: number;
}

/** Fixed simulation timestep with interpolation and spiral-of-death protection. */
export class FixedStepScheduler {
  private accumulator = 0;
  private readonly result: StepResult = { steps: 0, droppedSteps: 0, alpha: 0 };

  constructor(private readonly fixedDelta: number, private readonly maxSubSteps: number) {}

  advance(frameDelta: number, step: (delta: number) => void): Readonly<StepResult> {
    this.accumulator += Math.min(Math.max(frameDelta, 0), 0.15);
    let steps = 0;
    while (this.accumulator >= this.fixedDelta && steps < this.maxSubSteps) {
      step(this.fixedDelta);
      this.accumulator -= this.fixedDelta;
      steps += 1;
    }

    let droppedSteps = 0;
    if (this.accumulator >= this.fixedDelta) {
      droppedSteps = Math.floor(this.accumulator / this.fixedDelta);
      this.accumulator -= droppedSteps * this.fixedDelta;
    }
    this.result.steps = steps;
    this.result.droppedSteps = droppedSteps;
    this.result.alpha = this.accumulator / this.fixedDelta;
    return this.result;
  }

  reset(): void {
    this.accumulator = 0;
    this.result.steps = 0;
    this.result.droppedSteps = 0;
    this.result.alpha = 0;
  }
}
