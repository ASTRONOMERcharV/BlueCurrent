import {
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import { anemoneAnchorForReef } from '../environment/AnemoneHabitat';
import type { CoralAsset, CoralName } from './CoralAsset';
import { createRandom, floorHeightAt } from './rockPlacement';

export type CoralScatterMode = 'temperate' | 'full';

/** Low-profile species used as restrained temperate reef accents. */
export const TEMPERATE_CORAL_NAMES: readonly CoralName[] = ['coral_fan', 'coral_brain'];

/**
 * Subtle per-species multipliers. The textures carry the species colour; these
 * only counter the cyan water cast so pale table/brain colonies do not read as
 * concrete slabs next to the kelp.
 */
const CORAL_TINTS: Record<CoralName, readonly [number, number, number]> = {
  coral_branching: [1.0, 0.94, 0.86],
  coral_table: [1.0, 0.90, 0.78],
  sponge_tube: [0.96, 0.88, 1.0],
  coral_fan: [0.92, 1.0, 0.90],
  coral_brain: [1.0, 0.92, 0.82],
  anemone: [1.0, 0.97, 0.93],
};
const TEMPERATE_REEF_SCALE = 1.7;
const TEMPERATE_FOREGROUND_SCALE = 1.3;
/**
 * Full-tier species multipliers. The user judged the 2.4x pass still too small,
 * so tall branching/fan/sponge colonies now reach roughly 3-5 m while the flat
 * table and brain colonies get their own boost to read as broad reef shelves.
 */
const FULL_SPECIES_SCALE: Record<CoralName, number> = {
  coral_branching: 4.2,
  coral_table: 3.6,
  sponge_tube: 4.0,
  coral_fan: 4.2,
  coral_brain: 3.8,
  anemone: 4.0,
};
/** Background/foreground echoes stay smaller than the reef-base colonies. */
const FULL_BAND_SCALE = 0.58;
/**
 * Obstacle order: Spire / Platform / Hero / Twin / Terraces. The two low reefs
 * get lower accents so their silhouettes and the channels between them remain
 * visible; the hero keeps the strongest attached colony group.
 */
const FULL_REEF_HIERARCHY_SCALE = [0.78, 0.62, 1.0, 0.74, 0.66] as const;
/** Foreground branches frame the view rather than becoming isolated trees. */
const FULL_FOREGROUND_SPECIES_SCALE: Record<CoralName, number> = {
  coral_branching: 0.68,
  coral_table: 0.9,
  sponge_tube: 0.85,
  coral_fan: 0.78,
  coral_brain: 0.9,
  anemone: 0.85,
};

export interface CoralScatterOptions {
  readonly mode?: CoralScatterMode;
}

interface CoralPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
  readonly tilt: number;
  readonly background: boolean;
}

/**
 * Two composition tiers:
 * - `temperate`: two low-profile species, 12 colonies, kept smaller than full.
 * - `full` (default): six-species, 48-colony show reef with distant echoes.
 * Per-species multipliers above lift the authored colonies into roughly a
 * 1.2-5.0 m reef so they read against the 0.9-1.1 m fish and the kelp forest.
 */
export class CoralScatter {
  readonly group = new Group();
  readonly instanceCount: number;
  readonly triangleCount: number;
  readonly meshCount: number;
  readonly mode: CoralScatterMode;

  constructor(
    assets: readonly CoralAsset[],
    material: MeshStandardMaterial,
    obstacles: readonly ObstacleDefinition[],
    options: CoralScatterOptions = {},
  ) {
    this.group.name = 'glbCoralReef';
    const mode = options.mode ?? 'temperate';
    this.mode = mode;
    const random = createRandom(0xc0a17a11);
    const activeAssets = mode === 'temperate'
      ? assets.filter((asset) => TEMPERATE_CORAL_NAMES.includes(asset.name))
      : assets;
    if (mode === 'temperate' && activeAssets.length !== TEMPERATE_CORAL_NAMES.length) {
      throw new Error(
        `temperate coral composition needs ${TEMPERATE_CORAL_NAMES.join(', ')}; ` +
        `received ${activeAssets.map((asset) => asset.name).join(', ') || 'none'}`,
      );
    }

    const placements = new Map<string, CoralPlacement[]>();
    for (const asset of activeAssets) placements.set(asset.name, []);

    if (mode === 'temperate') {
      // One colony per species at each reef base, plus one foreground accent per
      // species beyond +Z = 20. No background colonies in the restrained tier.
      obstacles.forEach((obstacle, reefIndex) => {
        const [cx, , cz] = obstacle.center;
        activeAssets.forEach((asset, speciesIndex) => {
          const angle = reefIndex * 1.71 + speciesIndex * 2.39996;
          const radial = obstacle.radius * 1.04;
          const x = cx + Math.cos(angle) * radial;
          const z = cz + Math.sin(angle) * radial;
          placements.get(asset.name)!.push({
            x,
            y: floorHeightAt(x, z) - 0.025,
            z,
            scale: (0.55 + random() * 0.3) * TEMPERATE_REEF_SCALE,
            yaw: random() * Math.PI * 2,
            tilt: (random() - 0.5) * 0.08,
            background: false,
          });
        });
      });

      const foregroundSites = [
        [-14, 22],
        [14, 22.5],
      ] as const;
      activeAssets.forEach((asset, speciesIndex) => {
        const site = foregroundSites[speciesIndex % foregroundSites.length];
        placements.get(asset.name)!.push({
          x: site[0],
          y: floorHeightAt(site[0], site[1]) - 0.035,
          z: site[1],
          scale: (0.58 + random() * 0.27) * TEMPERATE_FOREGROUND_SCALE,
          yaw: random() * Math.PI * 2,
          tilt: (random() - 0.5) * 0.06,
          background: false,
        });
      });
    } else {
      obstacles.forEach((obstacle, reefIndex) => {
        const [cx, , cz] = obstacle.center;
        activeAssets.forEach((asset, speciesIndex) => {
          const angle = reefIndex * 1.71 + speciesIndex * 2.39996;
          const radial = obstacle.radius * (1.02 + (speciesIndex % 2) * 0.15);
          // The anemone anchor owns this placement so E4's clownfish habitat
          // points at the rendered instance. Other species keep the same formula.
          const anchor = asset.name === 'anemone'
            ? anemoneAnchorForReef(obstacle, reefIndex)
            : null;
          const x = anchor ? anchor.x : cx + Math.cos(angle) * radial;
          const z = anchor ? anchor.z : cz + Math.sin(angle) * radial;
          placements.get(asset.name)!.push({
            x,
            y: floorHeightAt(x, z) - 0.025,
            z,
            scale: (0.64 + random() * 0.34)
              * FULL_SPECIES_SCALE[asset.name]
              * FULL_REEF_HIERARCHY_SCALE[reefIndex],
            yaw: random() * Math.PI * 2,
            tilt: (random() - 0.5) * 0.12,
            background: false,
          });
        });
      });

      // Distant colonies live outside the simulation bounds and stay deliberately
      // sparse, leaving the central water column visually open.
      const backgroundSites = [
        [-22, -22], [-14, -27], [18, -25], [25, -15], [-25, 17], [24, 19],
      ] as const;
      activeAssets.forEach((asset, speciesIndex) => {
        for (let echo = 0; echo < 2; echo += 1) {
          const site = backgroundSites[(speciesIndex + echo * 3) % backgroundSites.length];
          const x = site[0] + (random() - 0.5) * 3;
          const z = site[1] + (random() - 0.5) * 3;
          placements.get(asset.name)!.push({
            x,
            y: floorHeightAt(x, z) - 0.04,
            z,
            scale: (1.15 + random() * 0.55) * FULL_SPECIES_SCALE[asset.name] * FULL_BAND_SCALE,
            yaw: random() * Math.PI * 2,
            tilt: (random() - 0.5) * 0.09,
            background: true,
          });
        }
      });

      // Low foreground colonies sit beyond the +Z swimming boundary. They frame
      // the view without introducing uncollided geometry into the school volume.
      const foregroundSites = [
        [-14, 22], [14, 22.5], [17, 21.5], [-18, 20.8], [11, 23], [-11, 23.5],
      ] as const;
      activeAssets.forEach((asset, speciesIndex) => {
        const site = foregroundSites[speciesIndex % foregroundSites.length];
        placements.get(asset.name)!.push({
          x: site[0],
          y: floorHeightAt(site[0], site[1]) - 0.035,
          z: site[1],
          scale: (1.08 + random() * 0.38)
            * FULL_SPECIES_SCALE[asset.name]
            * FULL_BAND_SCALE
            * FULL_FOREGROUND_SPECIES_SCALE[asset.name],
          yaw: random() * Math.PI * 2,
          tilt: (random() - 0.5) * 0.08,
          background: false,
        });
      });
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler();
    const tint = new Color();
    let instances = 0;
    let triangles = 0;
    let meshes = 0;

    for (const asset of activeAssets) {
      const entries = placements.get(asset.name)!;
      const coralTint = CORAL_TINTS[asset.name];
      const mesh = new InstancedMesh(asset.geometry, material, entries.length);
      mesh.name = `main_${asset.name}`;
      mesh.frustumCulled = false;
      entries.forEach((entry, index) => {
        position.set(entry.x, entry.y, entry.z);
        euler.set(entry.tilt, entry.yaw, entry.tilt * 0.7, 'YXZ');
        rotation.setFromEuler(euler);
        scale.set(entry.scale, entry.scale * (0.94 + random() * 0.12), entry.scale);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        // Keep the reef inside the same dark-teal value range as the kelp. The
        // authored textures carry the species colour; instanceColor sets how
        // much light the colony returns plus a subtle species tint.
        const lightness = entry.background
          ? 0.40 + random() * 0.08
          : 0.62 + random() * 0.18;
        tint.setRGB(
          lightness * coralTint[0],
          lightness * coralTint[1],
          lightness * coralTint[2],
        );
        mesh.setColorAt(index, tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      instances += entries.length;
      triangles += asset.stats.triangles * entries.length;
      meshes += 1;
    }
    this.instanceCount = instances;
    this.triangleCount = triangles;
    this.meshCount = meshes;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}
