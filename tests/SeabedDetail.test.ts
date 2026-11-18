import { Color, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { applyCaustics } from '../src/rendering/Caustics';
import { applySeabedDetail } from '../src/rendering/SeabedDetail';
import { causticOptionsFor } from '../src/rendering/Environment';
import {
  SEABED_DETAIL_OPTIONS,
} from '../src/rendering/lighting/SeabedDetailOptions';
import { UNDERWATER_LIGHTING_CONFIG } from '../src/rendering/lighting/UnderwaterLightingConfig';
import {
  createSeabedGeometry,
  seabedPatchAt,
  seabedVertexColorInto,
} from '../src/rendering/terrain';

function compileDetailShader(material: MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: [
      '#include <common>',
      '#include <begin_vertex>',
      '#include <defaultnormal_vertex>',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      '#include <color_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <opaque_fragment>',
    ].join('\n'),
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('Phase D2 seabed detail configuration', () => {
  it('keeps every seabed value in one config block', () => {
    const seabed = UNDERWATER_LIGHTING_CONFIG.materials.seabed;
    expect(seabed.vertex.patchFrequency).toBeGreaterThan(0);
    expect(seabed.vertex.octaveScale).toBeGreaterThan(1);
    expect(seabed.vertex.octaveWeight).toBeGreaterThan(0);
    expect(seabed.vertex.patchContrast).toBeGreaterThanOrEqual(0);
    expect(seabed.vertex.patchContrast).toBeLessThanOrEqual(1);
    expect(seabed.vertex.slopeEnd).toBeGreaterThan(seabed.vertex.slopeStart);
    expect(seabed.vertex.heightRange).toBeGreaterThan(0);
    expect(seabed.fragment.fineFrequency).toBeGreaterThan(seabed.fragment.midFrequency);
    expect(seabed.fragment.fineWeight).toBeGreaterThanOrEqual(0);
    expect(seabed.fragment.fineWeight).toBeLessThanOrEqual(1);
    expect(seabed.fragment.fadeEnd).toBeGreaterThan(seabed.fragment.fadeStart);
    expect(seabed.fragment.roughnessMin).toBeGreaterThanOrEqual(0);
    expect(seabed.fragment.roughnessMin).toBeLessThan(1);
  });

  it('maps config values onto material options without magic numbers', () => {
    const fragment = UNDERWATER_LIGHTING_CONFIG.materials.seabed.fragment;
    expect(SEABED_DETAIL_OPTIONS.midFrequency).toBe(fragment.midFrequency);
    expect(SEABED_DETAIL_OPTIONS.fineFrequency).toBe(fragment.fineFrequency);
    expect(SEABED_DETAIL_OPTIONS.fadeStart).toBe(fragment.fadeStart);
    expect(SEABED_DETAIL_OPTIONS.fadeEnd).toBe(fragment.fadeEnd);
    expect(SEABED_DETAIL_OPTIONS.roughnessAmount).toBe(fragment.roughnessAmount);
    expect(SEABED_DETAIL_OPTIONS.tint).toHaveLength(3);
  });
});

describe('seabed patch field', () => {
  it('is deterministic and bounded', () => {
    for (let x = -30; x <= 30; x += 7) {
      for (let z = -30; z <= 30; z += 7) {
        const value = seabedPatchAt(x, z);
        expect(seabedPatchAt(x, z)).toBe(value);
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('varies across the authored reef instead of a flat colour', () => {
    const values = new Set<string>();
    for (let x = -20; x <= 20; x += 2.5) {
      for (let z = -20; z <= 20; z += 2.5) {
        values.add(seabedPatchAt(x, z).toFixed(4));
      }
    }
    expect(values.size).toBeGreaterThan(50);
  });
});

describe('seabed vertex colour', () => {
  it('is deterministic and position-dependent', () => {
    const first = new Color();
    const second = new Color();
    seabedVertexColorInto(4, -3, 1, -0.1, first);
    seabedVertexColorInto(4, -3, 1, -0.1, second);
    expect(first.toArray()).toEqual(second.toArray());

    const other = new Color();
    seabedVertexColorInto(-12, 8, 1, -0.3, other);
    expect(other.toArray()).not.toEqual(first.toArray());
  });

  it('lifts crests and darkens steep slopes', () => {
    const flatLow = new Color();
    const flatHigh = new Color();
    seabedVertexColorInto(2, 2, 1, -0.7, flatLow);
    seabedVertexColorInto(2, 2, 1, 0.15, flatHigh);
    expect(flatHigh.r + flatHigh.g + flatHigh.b).toBeGreaterThan(
      flatLow.r + flatLow.g + flatLow.b,
    );

    const steep = new Color();
    seabedVertexColorInto(2, 2, 0.5, -0.7, steep);
    expect(steep.g).toBeLessThan(flatLow.g);
  });

  it('produces visible colour variance inside the reef and deep colour far out', () => {
    const geometry = createSeabedGeometry();
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    let deepChecked = 0;
    const background = new Color(UNDERWATER_LIGHTING_CONFIG.water.background);
    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(positions.getX(index), positions.getZ(index));
      const luminance = colors.getX(index) * 0.2126
        + colors.getY(index) * 0.7152
        + colors.getZ(index) * 0.0722;
      if (radius < 45) {
        minimum = Math.min(minimum, luminance);
        maximum = Math.max(maximum, luminance);
      } else if (radius > 260) {
        expect(Math.abs(colors.getX(index) - background.r)).toBeLessThan(0.03);
        expect(Math.abs(colors.getY(index) - background.g)).toBeLessThan(0.03);
        expect(Math.abs(colors.getZ(index) - background.b)).toBeLessThan(0.03);
        deepChecked += 1;
      }
    }
    expect(maximum - minimum).toBeGreaterThan(0.004);
    expect(deepChecked).toBeGreaterThan(10);
  });
});

describe('seabed detail shader', () => {
  it('injects noise, distance fade and roughness modulation', () => {
    const material = new MeshStandardMaterial();
    applySeabedDetail(material, SEABED_DETAIL_OPTIONS);
    const shader = compileDetailShader(material);
    const fragment = UNDERWATER_LIGHTING_CONFIG.materials.seabed.fragment;

    expect(shader.uniforms.uSeabedMidFrequency.value).toBe(fragment.midFrequency);
    expect(shader.uniforms.uSeabedFineFrequency.value).toBe(fragment.fineFrequency);
    expect(shader.uniforms.uSeabedFadeStart.value).toBe(fragment.fadeStart);
    expect(shader.uniforms.uSeabedFadeEnd.value).toBe(fragment.fadeEnd);
    expect(shader.fragmentShader).toContain('bcSeabedNoise');
    expect(shader.fragmentShader).toContain('distance(vSeabedWorld, cameraPosition)');
    expect(shader.fragmentShader).toContain('roughnessFactor');
    expect(shader.vertexShader).toContain('vSeabedWorld');
    expect(material.customProgramCacheKey()).toContain('seabed-detail:');
  });

  it('chains with caustics instead of replacing it', () => {
    const material = new MeshStandardMaterial();
    applyCaustics(
      material,
      { time: { value: 0 }, strength: { value: 0.5 } },
      causticOptionsFor('floor'),
    );
    applySeabedDetail(material, SEABED_DETAIL_OPTIONS);
    const shader = compileDetailShader(material);

    expect(shader.uniforms.uCausticIntensity).toBeDefined();
    expect(shader.uniforms.uSeabedMidFrequency).toBeDefined();
    expect(shader.fragmentShader).toContain('vCausticWorld');
    expect(shader.fragmentShader).toContain('bcSeabedNoise');
    expect(material.customProgramCacheKey()).toContain('caustics:');
    expect(material.customProgramCacheKey()).toContain('seabed-detail:');
  });

  it('throws when an injection point is missing', () => {
    const material = new MeshStandardMaterial();
    applySeabedDetail(material, SEABED_DETAIL_OPTIONS);
    expect(() => material.onBeforeCompile({
      uniforms: {},
      vertexShader: '',
      fragmentShader: '',
    } as never, undefined as never)).toThrow(/injection point/);
  });
});
