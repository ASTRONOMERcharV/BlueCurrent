import { describe, expect, it } from 'vitest';
import { cameraDamping, predatorFraming } from '../src/rendering/CameraController';

describe('camera damping', () => {
  it('starts at rest and approaches the preset without overshooting', () => {
    expect(cameraDamping(0, 3)).toBe(0);
    expect(cameraDamping(1 / 60, 3)).toBeGreaterThan(0);
    expect(cameraDamping(0.15, 3)).toBeLessThan(1);
    expect(cameraDamping(0.15, 3)).toBeGreaterThan(cameraDamping(1 / 60, 3));
    expect(cameraDamping(-1, 3)).toBe(0);
  });

  it('uses exponential, frame-rate-independent response', () => {
    const oneFrame = cameraDamping(0.1, 4);
    const twoFrames = 1 - (1 - cameraDamping(0.05, 4)) ** 2;
    expect(twoFrames).toBeCloseTo(oneFrame, 12);
  });
});

describe('predator framing', () => {
  it('uses the velocity-follow rig when no live target exists', () => {
    expect(predatorFraming(null)).toEqual({ lead: 1.8, back: 14, side: 4.8, up: 4.4 });
  });

  it('widens with real target separation without uncapping the follow distance', () => {
    const near = predatorFraming(4);
    const far = predatorFraming(16);
    const extreme = predatorFraming(100);
    expect(far.back).toBeGreaterThan(near.back);
    expect(far.lead).toBeGreaterThan(near.lead);
    expect(extreme.back).toBe(19.5);
    expect(extreme.lead).toBe(5);
  });

  it('keeps a minimum forward composition window at contact range', () => {
    expect(predatorFraming(0).lead).toBe(2.2);
    expect(predatorFraming(0).back).toBe(13.5);
  });
});
