import { describe, expect, it } from 'vitest';
import { AdditiveBlending, DoubleSide, Scene, type Mesh } from 'three';
import { Environment } from '../src/rendering/Environment';
import { createLightShaftGroup, createShaftMaterial } from '../src/rendering/lighting/LightShafts';
import { UNDERWATER_LIGHTING_CONFIG } from '../src/rendering/lighting/UnderwaterLightingConfig';
import { UNDERWATER_MEDIUM_CONFIG } from '../src/rendering/UnderwaterMedium';
import { REEF_OBSTACLES } from '../src/simulation/ObstacleSystem';
import { SimulationWorld } from '../src/simulation/SimulationWorld';

const SHAFTS = UNDERWATER_LIGHTING_CONFIG.water.shafts;

describe('Phase 4 light shaft config', () => {
  it('mirrors the legacy water shaft values and keeps every falloff ordered', () => {
    expect(SHAFTS.color).toBe(UNDERWATER_LIGHTING_CONFIG.water.shaftColor);
    expect(SHAFTS.opacity).toBe(UNDERWATER_LIGHTING_CONFIG.water.shaftOpacity);
    // 3 anchors × 2 crossed planes = the six shafts, never more.
    expect(SHAFTS.positions.length).toBe(3);
    expect(SHAFTS.positions.length * 2).toBeLessThanOrEqual(6);
    for (const anchor of SHAFTS.positions) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.z)).toBe(true);
      expect(Number.isFinite(anchor.yaw)).toBe(true);
    }
    expect(SHAFTS.width).toBeGreaterThan(0);
    expect(SHAFTS.height).toBeGreaterThan(0);
    expect(SHAFTS.crossAngle).toBeCloseTo(Math.PI / 2);
    expect(SHAFTS.nearFade.start).toBeLessThan(SHAFTS.nearFade.end);
    expect(SHAFTS.farFade.start).toBeLessThan(SHAFTS.farFade.end);
    expect(SHAFTS.farFade.minimum).toBeGreaterThan(0);
    expect(SHAFTS.farFade.minimum).toBeLessThan(1);
    expect(SHAFTS.vertical.bottomFadeEnd).toBeLessThan(SHAFTS.vertical.topFadeStart);
    expect(SHAFTS.seabedFade.start).toBeLessThan(SHAFTS.seabedFade.end);
    expect(SHAFTS.occlusion.rockMargin).toBeGreaterThan(0);
    expect(SHAFTS.lateral.corePower).toBeGreaterThan(1);
    expect(SHAFTS.lateral.shoulderPower).toBeGreaterThan(1);
    expect(SHAFTS.lateral.shoulderPower).toBeLessThan(SHAFTS.lateral.corePower);
  });

  it('keeps the noise slow and low-frequency so distant beams cannot alias', () => {
    expect(SHAFTS.noise.scale).toBeGreaterThan(0);
    expect(SHAFTS.noise.scale).toBeLessThan(1);
    expect(SHAFTS.noise.octaveScale).toBeGreaterThan(1);
    expect(SHAFTS.noise.octaveScale).toBeLessThan(3);
    expect(SHAFTS.noise.speed).toBeLessThan(0.1);
    expect(SHAFTS.noise.contrast).toBeGreaterThan(0);
    expect(SHAFTS.noise.contrast).toBeLessThan(0.6);
    expect(SHAFTS.noise.widthAmount).toBeGreaterThan(0);
  });

  it('builds one additive, depth-tested, texture-free material from the config', () => {
    const time = { value: 0 };
    const material = createShaftMaterial(REEF_OBSTACLES, time);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.uniforms.uTime).toBe(time);
    expect(material.uniforms.uShaftOpacity.value).toBeCloseTo(
      SHAFTS.opacity * UNDERWATER_MEDIUM_CONFIG.volumetricStrength,
    );
    const spheres = material.uniforms.uRockSpheres.value as unknown[];
    expect(spheres).toHaveLength(REEF_OBSTACLES.length);
    expect(material.fragmentShader).not.toMatch(/sampler2D|texture2D/);
    expect(material.fragmentShader).toContain('shaftValueNoise');
    for (const value of [
      SHAFTS.noise.scale,
      SHAFTS.noise.speed,
      SHAFTS.nearFade.start,
      SHAFTS.farFade.minimum,
      SHAFTS.seabedFade.end,
    ]) {
      expect(material.fragmentShader).toContain(value.toFixed(5));
    }
  });

  it('creates exactly six crossed planes sharing one geometry and one material', () => {
    const group = createLightShaftGroup(REEF_OBSTACLES, { value: 0 });
    expect(group.children).toHaveLength(6);
    const meshes = group.children as Mesh[];
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1);
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(1);
  });
});

describe('Phase 4 light shaft gate', () => {
  it('hides every shaft in base mode and when the debug layer or water effects are off', () => {
    const world = new SimulationWorld();
    const full = new Environment(new Scene(), world.obstacles, world.config, 'full');
    expect(full.waterEffectsVisible).toBe(true);

    full.setWaterDebugLayer('lightShafts', false);
    expect(full.waterEffectsVisible).toBe(false);
    full.setWaterDebugLayer('lightShafts', true);
    expect(full.waterEffectsVisible).toBe(true);

    full.setWaterEffects(false);
    expect(full.waterEffectsVisible).toBe(false);
    full.setWaterEffects(true);
    expect(full.waterEffectsVisible).toBe(true);

    full.setLightingMode('base');
    expect(full.waterEffectsVisible).toBe(false);
    full.setLightingMode('full');
    expect(full.waterEffectsVisible).toBe(true);

    const base = new Environment(new Scene(), world.obstacles, world.config, 'base');
    expect(base.waterEffectsVisible).toBe(false);
  });
});
