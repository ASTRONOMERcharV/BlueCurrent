import { InstancedBufferAttribute, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyCurrentSway,
  localSwayDirection,
  updateCurrentSway,
  type CurrentSwayLayer,
} from '../src/rendering/currentSway';
import type { OceanCurrentField } from '../src/environment/OceanCurrentField';

function fakeField(velocity: readonly [number, number, number]): OceanCurrentField {
  return {
    sample: (
      _x: number,
      _y: number,
      _z: number,
      _time: number,
      out: Float32Array,
    ) => {
      out[0] = velocity[0];
      out[1] = velocity[1];
      out[2] = velocity[2];
    },
  } as unknown as OceanCurrentField;
}

describe('shared current sway', () => {
  it('rotates the world flow into instance-local XZ with the same helper as kelp', () => {
    const out = new Float32Array(2);
    localSwayDirection(0, 3, 0, out);
    expect(Array.from(out)).toEqual([0, 1]);
    localSwayDirection(2, 0, Math.PI / 2, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });

  it('uploads packed direction and speed for every plant', () => {
    const layer: CurrentSwayLayer = {
      entries: [
        { x: 1, z: 2, yaw: 0 },
        { x: 3, z: 4, yaw: Math.PI / 2 },
      ],
      sampleY: new Float32Array([0.4, 0.6]),
      sway: new InstancedBufferAttribute(new Float32Array(6), 3),
    };
    updateCurrentSway(layer, fakeField([3, 0, 0]), 12.5);

    expect(layer.sway.getX(0)).toBeCloseTo(1, 6);
    expect(layer.sway.getY(0)).toBeCloseTo(0, 6);
    expect(layer.sway.getZ(0)).toBeCloseTo(3, 6);
    expect(layer.sway.getX(1)).toBeCloseTo(0, 6);
    expect(layer.sway.getY(1)).toBeCloseTo(1, 6);
    expect(layer.sway.getZ(1)).toBeCloseTo(3, 6);
    expect(layer.sway.version).toBeGreaterThan(0);
  });

  it('injects one shared chunk with speed gains and a pinned root', () => {
    const material = new MeshStandardMaterial();
    const time = { value: 0 };
    applyCurrentSway(material, {
      amplitude: 0.15,
      frequency: 1.05,
      phaseGradient: 1.7,
      swayExponent: 1.1,
      secondaryWeight: 0.35,
      speedAmplitude: 0.55,
      speedFrequency: 0.25,
      referenceSpeed: 0.35,
    }, time);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ['#include <common>', '#include <begin_vertex>'].join('\n'),
      fragmentShader: '',
    };
    material.onBeforeCompile(shader as never, undefined as never);

    expect(shader.uniforms.uSwayTime).toBe(time);
    expect(shader.uniforms.uSwaySpeedAmplitude.value).toBe(0.55);
    expect(shader.uniforms.uSwayReferenceSpeed.value).toBe(0.35);
    expect(shader.vertexShader).toContain('pow(clamp(aSwayWeight');
    expect(shader.vertexShader).toContain('instanceSway.z');
    expect(shader.vertexShader).toContain('swayAmpGain');
    expect(shader.vertexShader).toContain('swayFreqGain');
    expect(material.customProgramCacheKey()).toContain('current-sway:');
  });
});
