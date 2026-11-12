import { describe, expect, it } from 'vitest';
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import {
  UnderwaterLighting,
  applyFresnelRim,
  computeRimLightPose,
} from '../src/rendering/lighting/UnderwaterLighting';
import { UNDERWATER_LIGHTING_CONFIG, UNDERWATER_SUN_DIRECTION } from '../src/rendering/lighting/UnderwaterLightingConfig';
import { auditMaterialColorSpaces } from '../src/rendering/lighting/MaterialColorSpace';

describe('underwater base lighting', () => {
  it('keeps hemisphere fill and shared rim subordinate to the sun', () => {
    const config = UNDERWATER_LIGHTING_CONFIG;
    const fillRatio = config.hemisphere.intensity / config.sun.intensity;
    expect(fillRatio).toBeGreaterThanOrEqual(0.25);
    expect(fillRatio).toBeLessThanOrEqual(0.4);
    expect(config.rim.intensity / config.sun.intensity).toBeLessThanOrEqual(0.25);
    expect(config.schoolRim.strength).toBeLessThan(config.predatorRim.strength);
  });

  it('uses a diagonal sun and static-only shadow settings', () => {
    const scene = new Scene();
    const lighting = new UnderwaterLighting(scene);
    expect(lighting.sun.position.x).toBeLessThan(0);
    expect(lighting.sun.position.y).toBeGreaterThan(0);
    expect(lighting.sun.castShadow).toBe(true);
    expect(lighting.hemisphere.castShadow).toBe(false);
    expect(lighting.rim.castShadow).toBe(false);
    expect(lighting.snapshot().shadowMapSize).toBe(1024);
  });

  it('places the shared rim behind the focus and handles a degenerate camera', () => {
    const camera = new Vector3(12, 9, 14);
    const focus = new Vector3(0, 5, 0);
    const pose = computeRimLightPose(camera, focus);
    const towardCamera = camera.clone().sub(focus);
    expect(pose.position.clone().sub(focus).dot(towardCamera)).toBeLessThan(0);
    expect(pose.target.equals(focus)).toBe(true);

    const degenerate = computeRimLightPose(focus, focus);
    expect(Number.isFinite(degenerate.position.length())).toBe(true);
    expect(degenerate.position.y).toBeGreaterThan(focus.y);
  });

  it('keeps phase 2 lit scattering bounded below the school layer', () => {
    const water = UNDERWATER_LIGHTING_CONFIG.water;
    expect(water.scatterNearColor).not.toBe(water.scatterFarColor);
    expect(water.scatterColorDistance).toBeGreaterThan(0);
    expect(water.surfaceScatterStrength).toBeGreaterThan(0);
    expect(water.surfaceScatterStrength).toBeLessThanOrEqual(0.5);
    expect(water.sunScatterStrength).toBeGreaterThan(0);
    expect(water.sunScatterStrength).toBeLessThanOrEqual(0.5);
    expect(water.scatteringAnisotropy).toBeGreaterThanOrEqual(0);
    expect(water.scatteringAnisotropy).toBeLessThan(0.9);
    expect(water.domeSunStrength).toBeGreaterThan(0);
    expect(water.domeSunStrength).toBeLessThanOrEqual(0.8);
    expect(water.domeSunPower).toBeGreaterThan(1);
    expect(Math.hypot(...UNDERWATER_SUN_DIRECTION)).toBeCloseTo(1, 12);
  });
});

describe('creature rim shader', () => {
  it('captures world position after skinning and keeps attack on the rim', () => {
    const material = new MeshStandardMaterial();
    const alert = { value: 0.75 };
    applyFresnelRim(material, { alert, alertStrength: 0.16 });
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: `
        #include <common>
        void main() {
          #include <defaultnormal_vertex>
          #include <skinning_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        void main() {
          #include <opaque_fragment>
        }
      `,
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader.indexOf('#include <skinning_vertex>'))
      .toBeLessThan(shader.vertexShader.indexOf('vec4 rimWorld'));
    expect(shader.uniforms.uRimAlert).toBe(alert);
    expect(shader.fragmentShader).toContain('uRimAlert * 0.160');
    expect(shader.fragmentShader).not.toContain('totalEmissiveRadiance');
    expect(material.customProgramCacheKey()).toContain('fresnel-rim-v2');
  });
});

describe('PBR texture colour-space audit', () => {
  it('accepts colour/data maps and reports incorrect assignments', () => {
    const root = new Group();
    const valid = new MeshStandardMaterial({ name: 'valid' });
    valid.map = new Texture();
    valid.map.colorSpace = SRGBColorSpace;
    valid.normalMap = new Texture();
    valid.normalMap.colorSpace = NoColorSpace;
    valid.roughnessMap = new Texture();
    valid.roughnessMap.colorSpace = NoColorSpace;
    root.add(new Mesh(undefined, valid));

    const invalid = new MeshStandardMaterial({ name: 'invalid' });
    invalid.map = new Texture();
    invalid.map.colorSpace = NoColorSpace;
    invalid.normalMap = new Texture();
    invalid.normalMap.colorSpace = SRGBColorSpace;
    root.add(new Mesh(undefined, invalid));

    const issues = auditMaterialColorSpaces(root);
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.slot).sort()).toEqual(['map', 'normalMap']);
    expect(issues.every((issue) => issue.material === 'invalid')).toBe(true);
  });
});
