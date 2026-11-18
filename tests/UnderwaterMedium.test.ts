import { Color, Mesh, MeshStandardMaterial, Scene, ShaderChunk, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createWaterDebugState,
  installUnderwaterMedium,
  isUnderwaterMediumInstalled,
  UNDERWATER_MEDIUM_CONFIG,
  UnderwaterMedium,
} from '../src/rendering/UnderwaterMedium';

function compileShader(material: MeshStandardMaterial): {
  uniforms: Record<string, { value: number }>;
  vertexShader: string;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {} as Record<string, { value: number }>,
    vertexShader: '#include <common>\n#include <project_vertex>\n',
    fragmentShader: '#include <common>\n#include <tonemapping_fragment>\n',
  };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

describe('UnderwaterMedium debug mode', () => {
  it('starts with every installed layer enabled and post processing marked N/A', () => {
    const state = createWaterDebugState();
    expect(state).toEqual({
      sceneFog: true,
      waterAttenuation: true,
      volumetricScattering: true,
      marineParticles: true,
      lightShafts: true,
      caustics: true,
      surfaceLight: true,
      sediment: true,
      postProcessing: null,
    });
    expect({ ...state }).not.toBe(state);
  });

  it('keeps the legacy path explicit and the clear path linear-before-tonemapping', () => {
    installUnderwaterMedium();
    expect(isUnderwaterMediumInstalled()).toBe(true);
    expect(ShaderChunk.fog_fragment).toContain('uWaterLegacyMode > 0.5');
    expect(ShaderChunk.fog_fragment).toContain('legacyTransmittance');
    expect(ShaderChunk.fog_fragment).toContain('sRGBTransferOETF');
    expect(ShaderChunk.fog_pars_fragment).toContain('uWaterMediumEnabled');
    expect(ShaderChunk.fog_pars_fragment).toContain('uWaterLegacyMode');
    expect(UNDERWATER_MEDIUM_CONFIG.visibilityDistance).toBeGreaterThan(100);
    expect(UNDERWATER_MEDIUM_CONFIG.visibilityDistance).toBeLessThan(1000);
  });

  it('injects one linear composition, shares live uniforms, and preserves callbacks', () => {
    installUnderwaterMedium();
    const material = new MeshStandardMaterial();
    let previousCalls = 0;
    material.onBeforeCompile = (shader) => {
      previousCalls += 1;
      shader.uniforms.existingCallback = { value: 7 } as never;
    };
    const scene = new Scene();
    const mesh = new Mesh(new SphereGeometry(1, 4, 3), material);
    scene.add(mesh);
    const medium = new UnderwaterMedium();
    medium.attach(scene);
    medium.attach(scene);

    const shader = compileShader(material);
    expect(previousCalls).toBe(1);
    expect(shader.uniforms.existingCallback.value).toBe(7);
    expect(shader.uniforms.uWaterMediumEnabled.value).toBe(1);
    expect(shader.vertexShader).toContain('vWaterViewDepth = - mvPosition.z');
    expect(shader.fragmentShader).toContain(
      'waterTransmittance = exp( - uWaterAbsorption * waterPathLength )',
    );
    expect(shader.fragmentShader.indexOf('waterTransmittance')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <tonemapping_fragment>'),
    );
    expect(shader.fragmentShader).not.toContain('sRGBTransferOETF');

    medium.setLayer('sceneFog', false);
    medium.setLayer('waterAttenuation', false);
    medium.setLayer('volumetricScattering', false);
    expect(shader.uniforms.uWaterMediumEnabled.value).toBe(0);
    expect(shader.uniforms.uWaterAttenuationEnabled.value).toBe(0);
    expect(shader.uniforms.uWaterScatteringEnabled.value).toBe(0);

    medium.setLayer('sceneFog', true);
    expect(shader.uniforms.uWaterMediumEnabled.value).toBe(1);
    medium.setOpticsModel('legacy-display');
    expect(medium.opticsModel).toBe('legacy-display');
    expect(shader.uniforms.uWaterLegacyMode.value).toBe(1);
    mesh.geometry.dispose();
    material.dispose();
  });

  it('does not inject a second composition into custom shader materials', () => {
    installUnderwaterMedium();
    const material = new MeshStandardMaterial();
    const medium = new UnderwaterMedium();
    const scene = new Scene();
    const mesh = new Mesh(new SphereGeometry(1, 4, 3), material);
    scene.add(mesh);
    medium.attach(scene);
    const custom = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    };
    material.onBeforeCompile(custom as never, null as never);
    expect(custom.fragmentShader).not.toContain('waterTransmittance');
    expect(custom.vertexShader).not.toContain('vWaterViewDepth');
    mesh.geometry.dispose();
    material.dispose();
  });

  it('layers near/far colour and the sun lobe into the same linear pass', () => {
    installUnderwaterMedium();
    const material = new MeshStandardMaterial();
    const medium = new UnderwaterMedium();
    const scene = new Scene();
    const mesh = new Mesh(new SphereGeometry(1, 4, 3), material);
    scene.add(mesh);
    medium.attach(scene);
    const shader = compileShader(material);
    const colorUniform = (name: string) => (
      shader.uniforms[name] as unknown as { value: Color }
    ).value;

    expect(colorUniform('uWaterScatterNear').getHexString()).toBe(
      new Color(UNDERWATER_MEDIUM_CONFIG.scatterNearColor).getHexString(),
    );
    expect(colorUniform('uWaterScatterFar').getHexString()).toBe(
      new Color(UNDERWATER_MEDIUM_CONFIG.scatterFarColor).getHexString(),
    );
    expect(colorUniform('uWaterSunScatter').getHexString()).toBe(
      new Color(UNDERWATER_MEDIUM_CONFIG.sunScatterColor).getHexString(),
    );
    expect(UNDERWATER_MEDIUM_CONFIG.scatterColorDistance).toBeGreaterThan(0);
    expect(UNDERWATER_MEDIUM_CONFIG.surfaceHeight)
      .toBeGreaterThan(UNDERWATER_MEDIUM_CONFIG.deepHeight);
    expect(UNDERWATER_MEDIUM_CONFIG.scatteringAnisotropy).toBeGreaterThanOrEqual(0);
    expect(UNDERWATER_MEDIUM_CONFIG.scatteringAnisotropy).toBeLessThan(1);
    const sunLength = Math.hypot(...UNDERWATER_MEDIUM_CONFIG.sunDirection);
    expect(sunLength).toBeCloseTo(1, 12);

    expect(shader.vertexShader).toContain('varying vec3 vWaterWorldPosition');
    expect(shader.vertexShader).toContain('instanceMatrix * waterWorldPosition');
    expect(shader.fragmentShader).toContain('waterScatterMix');
    expect(shader.fragmentShader).toContain('uWaterScatterNear');
    expect(shader.fragmentShader).toContain('uWaterSunScatter');
    expect(shader.fragmentShader).toContain('waterSunLobe');
    expect(shader.fragmentShader).toContain('waterSurfaceFactor');
    expect(shader.fragmentShader.indexOf('waterComposed')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <tonemapping_fragment>'),
    );
    expect(shader.fragmentShader).not.toContain('sRGBTransferOETF');
    mesh.geometry.dispose();
    material.dispose();
  });
});
