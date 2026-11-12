import {
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { KELP_SPECS, type KelpAsset, type KelpName } from './KelpAsset';
import type { KelpPlacement } from './kelpPlacement';
import { OceanCurrentField } from '../environment/OceanCurrentField';

/**
 * Instanced kelp renderer with GPU sway.
 *
 * The formula follows docs/ASSET_SPEC.md section 15:
 *   dx = A(swayWeight) * sin(time * frequency + phaseGradient * y + phase)
 * `phase` is the sum of a per-instance random phase and a per-blade phase
 * baked into `_BLADEPHASE`, so neighbouring clumps and even blades in the
 * same clump never move in lockstep. Instances also vary frequency and
 * amplitude slightly. No bones, no per-frame geometry uploads.
 */

const KELP_TINTS: Record<KelpName, readonly number[]> = {
  kelp_a: [0x74986a, 0x698e61, 0x7fa274],
  kelp_b: [0x688e64, 0x5f845a, 0x769a70],
};

const PHASE_GRADIENT = 1.45;
const KELP_HEIGHT: Record<KelpName, number> = { kelp_a: 3.55, kelp_b: 2.8 };

interface SwayLayer {
  readonly entries: readonly KelpPlacement[];
  readonly directionX: InstancedBufferAttribute;
  readonly directionZ: InstancedBufferAttribute;
  readonly sampleY: Float32Array;
}

/** Rotate a world-space current direction into an instance's local XZ axes. */
export function localSwayDirection(
  currentX: number,
  currentZ: number,
  yaw: number,
  out: Float32Array,
): void {
  const length = Math.hypot(currentX, currentZ);
  if (length < 1e-8) {
    out[0] = 1;
    out[1] = 0;
    return;
  }
  const worldX = currentX / length;
  const worldZ = currentZ / length;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  out[0] = cosine * worldX - sine * worldZ;
  out[1] = sine * worldX + cosine * worldZ;
}

export class KelpScatter {
  readonly group = new Group();
  readonly counts: Record<KelpName, number> = { kelp_a: 0, kelp_b: 0 };
  readonly meshCount: number;
  readonly triangleCount: number;
  private readonly meshes: InstancedMesh[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly swayLayers: SwayLayer[] = [];
  private readonly currentField: OceanCurrentField;
  private readonly currentSample = new Float32Array(3);
  private readonly localDirection = new Float32Array(2);
  private readonly timeUniform = { value: 0 };

  constructor(
    assets: readonly KelpAsset[],
    placements: readonly KelpPlacement[],
    currentField = new OceanCurrentField(),
  ) {
    this.currentField = currentField;
    this.group.name = 'glbKelp';

    const byName = new Map<KelpName, KelpPlacement[]>();
    for (const placement of placements) {
      const list = byName.get(placement.name) ?? [];
      list.push(placement);
      byName.set(placement.name, list);
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler();
    const color = new Color();

    let triangles = 0;
    let meshes = 0;

    for (const asset of assets) {
      const entries = byName.get(asset.name);
      if (!entries || entries.length === 0) continue;
      const spec = KELP_SPECS.find((candidate) => candidate.name === asset.name);
      if (!spec) throw new Error(`Missing kelp spec for ${asset.name}.`);

      const geometry = asset.geometry;
      const phases = new Float32Array(entries.length);
      const frequencies = new Float32Array(entries.length);
      const amplitudes = new Float32Array(entries.length);
      entries.forEach((placement, index) => {
        phases[index] = placement.phase;
        frequencies[index] = placement.frequency;
        amplitudes[index] = placement.amplitude;
      });
      geometry.setAttribute('instancePhase', new InstancedBufferAttribute(phases, 1));
      geometry.setAttribute('instanceFrequency', new InstancedBufferAttribute(frequencies, 1));
      geometry.setAttribute('instanceAmplitude', new InstancedBufferAttribute(amplitudes, 1));
      const directionX = new InstancedBufferAttribute(new Float32Array(entries.length), 1);
      const directionZ = new InstancedBufferAttribute(new Float32Array(entries.length), 1);
      directionX.setUsage(DynamicDrawUsage);
      directionZ.setUsage(DynamicDrawUsage);
      geometry.setAttribute('instanceSwayX', directionX);
      geometry.setAttribute('instanceSwayZ', directionZ);
      const sampleY = new Float32Array(entries.length);
      entries.forEach((placement, index) => {
        sampleY[index] = placement.y + KELP_HEIGHT[asset.name] * placement.scale * 0.55;
      });
      this.swayLayers.push({ entries, directionX, directionZ, sampleY });

      const material = asset.material.clone();
      material.name = `kelp_sway_${asset.name}`;
      const timeUniform = this.timeUniform;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uKelpTime = timeUniform;
        shader.uniforms.uKelpAmplitude = { value: spec.amplitude };
        shader.uniforms.uKelpFrequency = { value: spec.frequency };
        shader.uniforms.uKelpPhaseGradient = { value: PHASE_GRADIENT };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uKelpTime;
            uniform float uKelpAmplitude;
            uniform float uKelpFrequency;
            uniform float uKelpPhaseGradient;
            attribute float aSwayWeight;
            attribute float aBladePhase;
            attribute float instancePhase;
            attribute float instanceFrequency;
            attribute float instanceAmplitude;
            attribute float instanceSwayX;
            attribute float instanceSwayZ;
          `)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float swayWeight = pow(clamp(aSwayWeight, 0.0, 1.0), 1.35);
            float swayPhase = uKelpTime * uKelpFrequency * instanceFrequency
              + uKelpPhaseGradient * position.y
              + instancePhase + aBladePhase;
            float sway = sin(swayPhase) * uKelpAmplitude * instanceAmplitude * swayWeight;
            float secondary = cos(swayPhase * 0.81 + 1.7) * uKelpAmplitude * 0.38 * instanceAmplitude * swayWeight;
            transformed.x += sway * instanceSwayX - secondary * instanceSwayZ;
            transformed.z += sway * instanceSwayZ + secondary * instanceSwayX;
          `);
      };
      material.customProgramCacheKey = () => `blue-current-kelp-${asset.name}-v1`;
      material.needsUpdate = true;

      const mesh = new InstancedMesh(geometry, material, entries.length);
      mesh.name = `glb_${asset.name}`;
      mesh.frustumCulled = false;

      entries.forEach((placement, index) => {
        euler.set(placement.tiltX, placement.yaw, placement.tiltZ, 'YXZ');
        rotation.setFromEuler(euler);
        position.set(placement.x, placement.y, placement.z);
        scale.setScalar(placement.scale);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);

        const palette = KELP_TINTS[asset.name];
        color.setHex(palette[placement.tint % palette.length]);
        const depthLight = placement.band === 'background' ? 0.56 : placement.band === 'foreground' ? 1 : 0.82;
        color.multiplyScalar(depthLight);
        mesh.setColorAt(index, color);
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(material);
      this.counts[asset.name] = entries.length;
      triangles += asset.stats.triangles * entries.length;
      meshes += 1;
    }

    this.meshCount = meshes;
    this.triangleCount = triangles;
    this.update(0);
  }

  update(time: number): void {
    this.timeUniform.value = time;
    for (const layer of this.swayLayers) {
      layer.entries.forEach((placement, index) => {
        this.currentField.sample(
          placement.x,
          layer.sampleY[index],
          placement.z,
          time,
          this.currentSample,
        );
        localSwayDirection(
          this.currentSample[0],
          this.currentSample[2],
          placement.yaw,
          this.localDirection,
        );
        layer.directionX.setX(index, this.localDirection[0]);
        layer.directionZ.setX(index, this.localDirection[1]);
      });
      layer.directionX.needsUpdate = true;
      layer.directionZ.needsUpdate = true;
    }
  }

  get swayTime(): number {
    return this.timeUniform.value;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    for (const material of this.materials) material.dispose();
    this.meshes.length = 0;
    this.materials.length = 0;
  }
}
