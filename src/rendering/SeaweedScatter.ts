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
import { SEAWEED_SPEC, type SeaweedAsset } from './SeaweedAsset';
import type { SeaweedPlacement } from './seaweedPlacement';
import { OceanCurrentField } from '../environment/OceanCurrentField';
import { applyCurrentSway, updateCurrentSway } from './currentSway';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

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

interface SwayLayer {
  readonly entries: readonly SeaweedPlacement[];
  readonly sway: InstancedBufferAttribute;
  readonly sampleY: Float32Array;
}

export class SeaweedScatter {
  readonly group = new Group();
  readonly instanceCount: number;
  readonly meshCount = 1;
  readonly triangleCount: number;
  private readonly mesh: InstancedMesh;
  private readonly material: MeshStandardMaterial;
  private readonly timeUniform = { value: 0 };
  private readonly currentField: OceanCurrentField;
  private readonly swayLayer: SwayLayer;

  constructor(
    asset: SeaweedAsset,
    placements: readonly SeaweedPlacement[],
    currentField = new OceanCurrentField(),
  ) {
    this.group.name = 'glbDetailSeaweed';
    this.currentField = currentField;

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
    const sway = new InstancedBufferAttribute(new Float32Array(placements.length * 3), 3);
    sway.setUsage(DynamicDrawUsage);
    geometry.setAttribute('instanceSway', sway);
    const sampleY = new Float32Array(placements.length);
    placements.forEach((placement, index) => {
      sampleY[index] = placement.y + asset.stats.height * placement.scale * 0.5;
    });
    this.swayLayer = { entries: placements, sway, sampleY };

    const material = asset.material.clone();
    material.name = 'seaweed_detail_sway';
    const currentSway = UNDERWATER_LIGHTING_CONFIG.water.currentSway;
    applyCurrentSway(material, {
      amplitude: SEAWEED_SPEC.amplitude,
      frequency: SEAWEED_SPEC.frequency,
      phaseGradient: PHASE_GRADIENT,
      swayExponent: 1.1,
      secondaryWeight: 0.35,
      speedAmplitude: currentSway.seaweedSpeedAmplitude,
      speedFrequency: currentSway.seaweedSpeedFrequency,
      referenceSpeed: currentSway.referenceSpeed,
    }, this.timeUniform);
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
    this.update(0);
  }

  update(time: number): void {
    this.timeUniform.value = time;
    updateCurrentSway(this.swayLayer, this.currentField, time);
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
