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
import { applyCurrentSway, updateCurrentSway } from './currentSway';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

export { localSwayDirection } from './currentSway';

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
  readonly sway: InstancedBufferAttribute;
  readonly sampleY: Float32Array;
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
      const sway = new InstancedBufferAttribute(new Float32Array(entries.length * 3), 3);
      sway.setUsage(DynamicDrawUsage);
      geometry.setAttribute('instanceSway', sway);
      const sampleY = new Float32Array(entries.length);
      entries.forEach((placement, index) => {
        sampleY[index] = placement.y + KELP_HEIGHT[asset.name] * placement.scale * 0.55;
      });
      this.swayLayers.push({ entries, sway, sampleY });

      const material = asset.material.clone();
      material.name = `kelp_sway_${asset.name}`;
      const currentSway = UNDERWATER_LIGHTING_CONFIG.water.currentSway;
      applyCurrentSway(material, {
        amplitude: spec.amplitude,
        frequency: spec.frequency,
        phaseGradient: PHASE_GRADIENT,
        swayExponent: 1.35,
        secondaryWeight: 0.38,
        speedAmplitude: currentSway.kelpSpeedAmplitude,
        speedFrequency: currentSway.kelpSpeedFrequency,
        referenceSpeed: currentSway.referenceSpeed,
      }, this.timeUniform);

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
      updateCurrentSway(layer, this.currentField, time);
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
