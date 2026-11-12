import {
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { RockAssets } from './RockAsset';
import {
  ROCK_NAMES,
  ROCK_DIMENSIONS,
  allPlacements,
  type RockKind,
  type RockLayout,
  type RockName,
  type RockPlacement,
} from './rockPlacement';

/**
 * Builds one InstancedMesh per rock/dune type from the deterministic layout.
 *
 * All 13 types share two materials (rock / dune), each instance has its own
 * transform and palette tint, and frustum culling is disabled because the
 * InstancedMesh bounds describe a single instance, not the whole scatter.
 */

const ROCK_TINTS = [0xb8d1de, 0xc3dae5, 0xacc8d5] as const;
const DUNE_TINTS = [0xbfd3da, 0xcadde3] as const;

export class RockScatter {
  readonly rockGroup = new Group();
  readonly duneGroup = new Group();
  readonly counts: Record<RockKind, number> = { large: 0, medium: 0, debris: 0, dune: 0 };
  readonly meshCount: number;
  private readonly meshes: InstancedMesh[] = [];
  private readonly anchoredLarge = new Map<
    number,
    { mesh: InstancedMesh; instance: number; matrix: Matrix4 }
  >();

  constructor(assets: RockAssets, layout: RockLayout) {
    this.rockGroup.name = 'glbRockScatter';
    this.duneGroup.name = 'glbSeabedDunes';

    const byName = new Map<RockName, RockPlacement[]>();
    for (const placement of allPlacements(layout)) {
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

    for (const name of ROCK_NAMES) {
      const placements = byName.get(name);
      if (!placements || placements.length === 0) continue;
      const geometry = assets.geometries.get(name);
      if (!geometry) throw new Error(`Missing geometry for ${name}.`);
      const dimensions = ROCK_DIMENSIONS[name];
      const isDune = dimensions.kind === 'dune';
      const material = isDune ? assets.duneMaterial : assets.rockMaterial;
      const mesh = new InstancedMesh(geometry, material, placements.length);
      mesh.name = `glb_${name}`;
      mesh.frustumCulled = false;

      placements.forEach((placement, index) => {
        euler.set(
          (placement.tiltX * Math.PI) / 180,
          (placement.yaw * Math.PI) / 180,
          (placement.tiltZ * Math.PI) / 180,
          'YXZ',
        );
        rotation.setFromEuler(euler);
        position.set(placement.x, placement.y, placement.z);
        scale.setScalar(placement.scale);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);

        const palette = isDune ? DUNE_TINTS : ROCK_TINTS;
        color.setHex(palette[placement.tint % palette.length]);
        mesh.setColorAt(index, color);
        this.counts[dimensions.kind] += 1;
        if (placement.anchorIndex !== undefined) {
          this.anchoredLarge.set(placement.anchorIndex, {
            mesh,
            instance: index,
            matrix: matrix.clone(),
          });
        }
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      (isDune ? this.duneGroup : this.rockGroup).add(mesh);
      this.meshes.push(mesh);
    }

    this.meshCount = this.meshes.length;
  }

  setRocksVisible(visible: boolean): void {
    this.rockGroup.visible = visible;
  }

  /**
   * Hide the visual rock anchored to one simulation obstacle without changing
   * the layout, collision data or instance counts. Used by the hero reef
   * sample, which draws its own mesh at the same anchor.
   */
  hideAnchoredLarge(anchorIndex: number): boolean {
    const entry = this.anchoredLarge.get(anchorIndex);
    if (!entry) return false;
    const matrix = new Matrix4().makeScale(0, 0, 0);
    entry.mesh.setMatrixAt(entry.instance, matrix);
    entry.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  /**
   * Restore the visual rock after a failed reef load. The collision sphere was
   * never changed, so this only undoes the zero-scale matrix.
   */
  showAnchoredLarge(anchorIndex: number): boolean {
    const entry = this.anchoredLarge.get(anchorIndex);
    if (!entry) return false;
    entry.mesh.setMatrixAt(entry.instance, entry.matrix);
    entry.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      mesh.removeFromParent();
    }
    this.meshes.length = 0;
  }
}
