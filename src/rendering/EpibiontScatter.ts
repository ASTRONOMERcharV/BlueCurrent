import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EpibiontAsset } from './EpibiontAsset';
import type { EpibiontPlan } from './reefEpibiontPlacement';
import { EPIBIONT_SPECIES } from './reefEpibiontPlacement';

/**
 * Static-batched epibiont colonies on the hero reef.
 *
 * All colonies of all species are transformed and merged into one geometry
 * with per-vertex tints, so the entire biological cover costs one draw call
 * rather than five. The simplified 620-780 triangle species LODs keep the set
 * near 50k triangles for 70+ colonies.
 */

const EPIBIONT_TINTS: Record<string, readonly [number, number, number]> = {
  coral_brain: [1.0, 0.93, 0.84],
  coral_table: [0.98, 0.90, 0.80],
  coral_branching: [1.0, 0.92, 0.80],
  coral_fan: [0.94, 1.0, 0.90],
  sponge_tube: [0.88, 0.80, 0.82],
};

/** Tall/colourful species stay darker so epibionts do not read as mini show reef. */
const EPIBIONT_LIGHTNESS: Record<string, number> = {
  coral_brain: 0.80,
  coral_table: 0.78,
  coral_branching: 0.66,
  coral_fan: 0.68,
  sponge_tube: 0.56,
};

const KEEP_ATTRIBUTES = new Set(['position', 'normal', 'uv']);

export class EpibiontScatter {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;
  readonly instanceCount: number;
  readonly triangleCount: number;
  readonly meshCount: number;
  readonly coverage: number;

  constructor(
    plan: EpibiontPlan,
    assets: readonly EpibiontAsset[],
    coralMaterial: MeshStandardMaterial,
  ) {
    this.group.name = 'reefSampleEpibionts';
    const byName = new Map(assets.map((asset) => [asset.name, asset]));
    const transformed: BufferGeometry[] = [];
    const position = new Vector3();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const normal = new Vector3();
    const align = new Quaternion();
    const spin = new Quaternion();
    const rotation = new Quaternion();
    const matrix = new Matrix4();
    const tint = new Color();
    let instances = 0;
    let triangles = 0;

    for (const placement of plan.placements) {
      const species = EPIBIONT_SPECIES[placement.species];
      const asset = byName.get(species.name as EpibiontAsset['name']);
      if (!asset) continue;
      normal.set(placement.nx, placement.ny, placement.nz).normalize();
      align.setFromUnitVectors(up, normal);
      spin.setFromAxisAngle(up, placement.yaw);
      rotation.copy(align).multiply(spin);
      position.set(placement.x, placement.y, placement.z);
      scale.set(
        placement.scale,
        placement.scale * (0.55 + 0.45 * species.upright),
        placement.scale,
      );
      matrix.compose(position, rotation, scale);

      const geometry = asset.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (!KEEP_ATTRIBUTES.has(name)) geometry.deleteAttribute(name);
      }
      geometry.applyMatrix4(matrix);
      const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
      if (nonIndexed !== geometry) geometry.dispose();

      const speciesTint = EPIBIONT_TINTS[species.name] ?? [1, 1, 1];
      const baseLightness = EPIBIONT_LIGHTNESS[species.name] ?? 0.78;
      const lightness = baseLightness + (instances % 5) * 0.02;
      tint.setRGB(
        lightness * speciesTint[0],
        lightness * speciesTint[1],
        lightness * speciesTint[2],
      );
      const vertexCount = nonIndexed.getAttribute('position').count;
      const colors = new Float32Array(vertexCount * 3);
      for (let index = 0; index < vertexCount; index += 1) {
        colors[index * 3] = tint.r;
        colors[index * 3 + 1] = tint.g;
        colors[index * 3 + 2] = tint.b;
      }
      nonIndexed.setAttribute('color', new Float32BufferAttribute(colors, 3));
      transformed.push(nonIndexed);
      instances += 1;
      triangles += asset.triangles;
    }

    const merged = transformed.length > 0 ? mergeGeometries(transformed, false) : null;
    for (const geometry of transformed) geometry.dispose();
    this.instanceCount = instances;
    this.triangleCount = triangles;
    this.coverage = plan.coverage;
    this.meshCount = merged ? 1 : 0;

    this.material = coralMaterial.clone();
    this.material.name = 'reef_epibiont_batch';
    this.material.vertexColors = true;
    this.material.needsUpdate = true;

    if (merged) {
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, this.material);
      mesh.name = 'reefEpibiontBatch';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const child of this.group.children) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.material.dispose();
    this.group.clear();
  }
}
