import {
  Color,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { SEAWEED_SPEC, type SeaweedAsset } from './SeaweedAsset';
import type { SeaweedPlacement } from './seaweedPlacement';

/**
 * Instanced detail-seaweed renderer with GPU sway.
 *
 * The GLB's 302 leaf components carry `_BLADEPHASE`; each instance adds its
 * own random phase, frequency and amplitude. Rock/starfish base components
 * have `_SWAYWEIGHT = 0`, so only the leaves move. Formula matches the kelp
 * sway in docs/ASSET_SPEC.md section 15 with a gentler amplitude because the
 * textured clump is compact.
 */

const TINTS = [0xe8f0df, 0xdfe9d4, 0xf0f5e7] as const;
const PHASE_GRADIENT = 1.7;

export class SeaweedScatter {
  readonly group = new Group();
  readonly instanceCount: number;
  readonly meshCount = 1;
  readonly triangleCount: number;
  private readonly mesh: InstancedMesh;
  private readonly material: MeshStandardMaterial;
  private readonly timeUniform = { value: 0 };

  constructor(asset: SeaweedAsset, placements: readonly SeaweedPlacement[]) {
    this.group.name = 'glbDetailSeaweed';

    const geometry = asset.geometry;
    const phases = new Float32Array(placements.length);
    const frequencies = new Float32Array(placements.length);
    const amplitudes = new Float32Array(placements.length);
    placements.forEach((placement, index) => {
      phases[index] = placement.phase;
      frequencies[index] = placement.frequency;
      amplitudes[index] = placement.amplitude;
    });
    geometry.setAttribute('instancePhase', new InstancedBufferAttribute(phases, 1));
    geometry.setAttribute('instanceFrequency', new InstancedBufferAttribute(frequencies, 1));
    geometry.setAttribute('instanceAmplitude', new InstancedBufferAttribute(amplitudes, 1));

    const material = asset.material.clone();
    material.name = 'seaweed_detail_sway';
    const timeUniform = this.timeUniform;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSeaweedTime = timeUniform;
      shader.uniforms.uSeaweedAmplitude = { value: SEAWEED_SPEC.amplitude };
      shader.uniforms.uSeaweedFrequency = { value: SEAWEED_SPEC.frequency };
      shader.uniforms.uSeaweedPhaseGradient = { value: PHASE_GRADIENT };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uSeaweedTime;
          uniform float uSeaweedAmplitude;
          uniform float uSeaweedFrequency;
          uniform float uSeaweedPhaseGradient;
          attribute float aSwayWeight;
          attribute float aBladePhase;
          attribute float instancePhase;
          attribute float instanceFrequency;
          attribute float instanceAmplitude;
        `)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float swayWeight = pow(clamp(aSwayWeight, 0.0, 1.0), 1.1);
          float swayPhase = uSeaweedTime * uSeaweedFrequency * instanceFrequency
            + uSeaweedPhaseGradient * position.y
            + instancePhase + aBladePhase;
          float sway = sin(swayPhase) * uSeaweedAmplitude * instanceAmplitude * swayWeight;
          transformed.x += sway;
          transformed.z += cos(swayPhase * 0.83 + 1.2) * uSeaweedAmplitude * 0.35 * instanceAmplitude * swayWeight;
        `);
    };
    material.customProgramCacheKey = () => 'blue-current-seaweed-detail-v1';
    material.needsUpdate = true;
    this.material = material;

    const mesh = new InstancedMesh(geometry, material, placements.length);
    mesh.name = 'glb_seaweed_detail';
    mesh.frustumCulled = false;

    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler();
    const color = new Color();
    placements.forEach((placement, index) => {
      euler.set(placement.tiltX, placement.yaw, placement.tiltZ, 'YXZ');
      rotation.setFromEuler(euler);
      position.set(placement.x, placement.y, placement.z);
      scale.setScalar(placement.scale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);

      color.setHex(TINTS[placement.tint % TINTS.length]);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.mesh = mesh;
    this.group.add(mesh);
    this.instanceCount = placements.length;
    this.triangleCount = asset.stats.triangles * placements.length;
  }

  update(time: number): void {
    this.timeUniform.value = time;
  }

  get swayTime(): number {
    return this.timeUniform.value;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
    this.material.dispose();
  }
}
