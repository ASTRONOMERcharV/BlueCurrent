import { MeshStandardMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { applyCaustics } from '../src/rendering/Caustics';
import { causticOptionsFor, Environment } from '../src/rendering/Environment';
import { UNDERWATER_LIGHTING_CONFIG } from '../src/rendering/lighting/UnderwaterLightingConfig';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

function compileCausticShader(material: MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: [
      '#include <common>',
      '#include <begin_vertex>',
      '#include <defaultnormal_vertex>',
    ].join('\n'),
    fragmentShader: '#include <common>\n#include <opaque_fragment>\n',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('Phase 3 caustics configuration', () => {
  it('keeps every caustic tunable in one config block', () => {
    const water = UNDERWATER_LIGHTING_CONFIG.water;
    const caustics = water.caustics;
    expect(caustics.strength).toBe(water.causticsStrength);
    expect(caustics.strength).toBeGreaterThan(0);
    expect(caustics.strength).toBeLessThanOrEqual(1);
    expect(caustics.color).toHaveLength(3);
    expect(caustics.pattern.baseFrequency).toBeGreaterThan(0);
    expect(caustics.pattern.ridgePower).toBeGreaterThanOrEqual(2);
    expect(caustics.pattern.fineMix).toBeGreaterThanOrEqual(0);
    expect(caustics.pattern.fineMix).toBeLessThanOrEqual(1);
    expect(caustics.macro.base).toBeGreaterThan(0);
    expect(caustics.macro.base + caustics.macro.amplitude).toBeLessThanOrEqual(1);
    expect(caustics.distanceFade.start).toBeGreaterThan(0);
    expect(caustics.distanceFade.end).toBeGreaterThan(caustics.distanceFade.start);
    expect(caustics.distanceFade.minimum).toBeGreaterThanOrEqual(0);
    expect(caustics.distanceFade.minimum).toBeLessThan(1);
    const surfaces = Object.entries(caustics.surfaces);
    expect(surfaces.length).toBeGreaterThanOrEqual(5);
    for (const [, preset] of surfaces) {
      expect(preset.intensity).toBeGreaterThan(0);
      expect(preset.scale).toBeGreaterThan(0);
    }
    // The seabed remains the strongest receiver; corals/far rocks stay weaker.
    expect(caustics.surfaces.floor.intensity).toBeGreaterThan(caustics.surfaces.coral.intensity);
    expect(caustics.surfaces.distant.intensity).toBeLessThan(caustics.surfaces.rock.intensity);
  });

  it('maps a surface preset onto shader options without magic numbers', () => {
    const caustics = UNDERWATER_LIGHTING_CONFIG.water.caustics;
    const floor = causticOptionsFor('floor');
    expect(floor.intensity).toBe(caustics.surfaces.floor.intensity);
    expect(floor.scale).toBe(caustics.surfaces.floor.scale);
    expect(floor.color).toEqual(caustics.color);
    expect(floor.baseFrequency).toBe(caustics.pattern.baseFrequency);
    expect(floor.ridgePower).toBe(caustics.pattern.ridgePower);
    expect(floor.fineMix).toBe(caustics.pattern.fineMix);
    expect(floor.facingMinimum).toBe(caustics.facing.minimum);
    expect(floor.macro).toBe(caustics.macro);
    expect(floor.distanceFade).toBe(caustics.distanceFade);
    expect(causticOptionsFor('dune').scale).toBe(caustics.surfaces.dune.scale);
    expect(causticOptionsFor('distant').intensity).toBe(caustics.surfaces.distant.intensity);
  });

  it('injects configurable pattern, envelope and distance fade into the material', () => {
    const material = new MeshStandardMaterial();
    const time = { value: 0 };
    const strength = { value: 0.5 };
    applyCaustics(material, { time, strength }, causticOptionsFor('floor'));
    const shader = compileCausticShader(material);

    const uniforms = shader.uniforms;
    expect(uniforms.uCausticTime).toBe(time);
    expect(uniforms.uCausticStrength).toBe(strength);
    const caustics = UNDERWATER_LIGHTING_CONFIG.water.caustics;
    expect(uniforms.uCausticIntensity.value).toBe(caustics.surfaces.floor.intensity);
    expect(uniforms.uCausticScale.value).toBe(caustics.surfaces.floor.scale);
    expect(uniforms.uCausticBaseFrequency.value).toBe(caustics.pattern.baseFrequency);
    expect(uniforms.uCausticRidgePower.value).toBe(caustics.pattern.ridgePower);
    expect(uniforms.uCausticFineMix.value).toBe(caustics.pattern.fineMix);
    expect(uniforms.uCausticDistanceStart.value).toBe(caustics.distanceFade.start);
    expect(uniforms.uCausticDistanceEnd.value).toBe(caustics.distanceFade.end);
    expect(uniforms.uCausticDistanceMin.value).toBe(caustics.distanceFade.minimum);
    expect(shader.fragmentShader).toContain('vCausticWorld - cameraPosition');
    expect(shader.fragmentShader).toContain('causticDistanceFade');
    expect(shader.fragmentShader).toContain('uCausticMacroFrequencyX');
    expect(shader.vertexShader).toContain('instanceMatrix * causticWorld');
    expect(material.customProgramCacheKey()).toContain('caustics:');
  });

  it('still throws when an injection point is missing', () => {
    const material = new MeshStandardMaterial();
    applyCaustics(material, { time: { value: 0 }, strength: { value: 0.5 } });
    expect(() => material.onBeforeCompile({
      uniforms: {},
      vertexShader: 'void main() {}',
      fragmentShader: 'void main() {}',
    } as never, undefined as never)).toThrow(/Caustic shader injection point not found/);
  });
});

describe('Phase 3 caustics gate', () => {
  it('zeroes the effective strength in base lighting and restores it in full', () => {
    const world = new SimulationWorld();
    const full = new Environment(new Scene(), world.obstacles, world.config, 'full');
    const base = new Environment(new Scene(), world.obstacles, world.config, 'base');
    expect(full.causticStrengthValue)
      .toBe(UNDERWATER_LIGHTING_CONFIG.water.caustics.strength);
    expect(base.causticStrengthValue).toBe(0);

    full.setWaterDebugLayer('caustics', false);
    expect(full.causticStrengthValue).toBe(0);
    full.setWaterDebugLayer('caustics', true);
    expect(full.causticStrengthValue)
      .toBe(UNDERWATER_LIGHTING_CONFIG.water.caustics.strength);

    full.setWaterEffects(false);
    expect(full.causticStrengthValue).toBe(0);
    full.setWaterEffects(true);
    full.setLightingMode('base');
    expect(full.causticStrengthValue).toBe(0);
    full.setLightingMode('full');
    expect(full.causticStrengthValue)
      .toBe(UNDERWATER_LIGHTING_CONFIG.water.caustics.strength);
  });
});
