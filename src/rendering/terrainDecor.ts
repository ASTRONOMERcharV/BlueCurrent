import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Euler,
  Vector3,
  Group,
} from 'three';
import { createRandom } from './rockPlacement';
import { terrainHeightAt } from './terrain';
import { causticOptionsFor } from './Environment';
import { applyCaustics } from './Caustics';

/**
 * Purely decorative mid/far seabed formations.
 *
 * This module has its own seeded PRNG and never touches the simulation random
 * stream, the collision spheres or the placed reef assets. Everything is
 * grounded through `terrainHeightAt` and embedded into the extended shelf, so
 * there are no floating silhouettes at the new world edge.
 */

export type TerrainDecorLayer = 'midground' | 'far';

export interface TerrainDecorInstance {
  readonly layer: TerrainDecorLayer;
  readonly clusterIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  readonly yaw: number;
  readonly tilt: number;
  readonly tint: number;
}

export interface TerrainDecorLayout {
  readonly midground: readonly TerrainDecorInstance[];
  readonly far: readonly TerrainDecorInstance[];
}

const MID_TINTS = [0x2f5b66, 0x35636f, 0x294f5a] as const;
const FAR_TINTS = [0x0a2d39, 0x082833, 0x0d3340] as const;

function makeInstance(
  random: () => number,
  layer: TerrainDecorLayer,
  clusterIndex: number,
  x: number,
  z: number,
  size: number,
  verticalFactor: number,
): TerrainDecorInstance {
  const scaleY = size * verticalFactor;
  return {
    layer,
    clusterIndex,
    x,
    y: terrainHeightAt(x, z) + scaleY * 0.45,
    z,
    scaleX: size * (1.0 + random() * 0.35),
    scaleY,
    scaleZ: size * (0.85 + random() * 0.35),
    yaw: random() * Math.PI * 2,
    tilt: (random() - 0.5) * 0.22,
    tint: Math.floor(random() * 3),
  };
}

interface ClusterSpec {
  readonly angle: number;
  readonly radius: number;
  readonly count: number;
  readonly size: number;
  readonly spread: number;
}

// Four distant reef echoes per band. A larger anchor with lower companions
// reads as an eroded formation rather than another field of isolated ovals.
const MIDGROUND_CLUSTERS: readonly ClusterSpec[] = [
  { angle: -2.55, radius: 54, count: 3, size: 2.3, spread: 3.4 },
  { angle: -1.70, radius: 63, count: 2, size: 2.0, spread: 3.0 },
  { angle: 0.35, radius: 58, count: 2, size: 2.1, spread: 3.1 },
  { angle: 2.30, radius: 61, count: 3, size: 2.2, spread: 3.3 },
];
const FAR_CLUSTERS: readonly ClusterSpec[] = [
  { angle: -2.40, radius: 145, count: 3, size: 7.2, spread: 12 },
  { angle: -1.45, radius: 172, count: 3, size: 6.4, spread: 13 },
  { angle: 0.45, radius: 160, count: 3, size: 6.8, spread: 12 },
  { angle: 2.35, radius: 205, count: 3, size: 7.6, spread: 14 },
];

function addCluster(
  random: () => number,
  layer: TerrainDecorLayer,
  clusterIndex: number,
  spec: ClusterSpec,
  output: TerrainDecorInstance[],
): void {
  const far = layer === 'far';
  const centerAngle = spec.angle + (random() - 0.5) * (far ? 0.04 : 0.08);
  const centerRadius = spec.radius + (random() - 0.5) * (far ? 8 : 4);
  const centerX = Math.cos(centerAngle) * centerRadius;
  const centerZ = Math.sin(centerAngle) * centerRadius;

  for (let index = 0; index < spec.count; index += 1) {
    const offset = index - (spec.count - 1) * 0.5;
    const tangent = offset * spec.spread + (random() - 0.5) * (far ? 2.4 : 1.2);
    const radial = (random() - 0.5) * spec.spread * 0.65;
    const x = centerX + Math.cos(centerAngle) * radial - Math.sin(centerAngle) * tangent;
    const z = centerZ + Math.sin(centerAngle) * radial + Math.cos(centerAngle) * tangent;
    const primary = index === 0;
    const size = spec.size * (primary ? 1.18 : 0.62 + random() * 0.22);
    const verticalFactor = primary
      ? (far ? 0.65 + random() * 0.20 : 0.75 + random() * 0.20)
      : (far ? 0.45 + random() * 0.20 : 0.50 + random() * 0.22);
    output.push(makeInstance(
      random,
      layer,
      clusterIndex,
      x,
      z,
      size,
      verticalFactor,
    ));
  }
}

export function generateTerrainDecor(seed = 0x51ed7a3): TerrainDecorLayout {
  const random = createRandom(seed);
  const midground: TerrainDecorInstance[] = [];
  const far: TerrainDecorInstance[] = [];
  MIDGROUND_CLUSTERS.forEach((spec, index) => {
    addCluster(random, 'midground', index, spec, midground);
  });
  FAR_CLUSTERS.forEach((spec, index) => {
    addCluster(random, 'far', index, spec, far);
  });
  return { midground, far };
}

function buildLayer(
  instances: readonly TerrainDecorInstance[],
  material: MeshStandardMaterial,
  tints: readonly number[],
  receiveShadow: boolean,
): InstancedMesh {
  const geometry = new IcosahedronGeometry(1, 1);
  const mesh = new InstancedMesh(geometry, material, instances.length);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = receiveShadow;
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const color = new Color();

  instances.forEach((instance, index) => {
    euler.set(instance.tilt, instance.yaw, instance.tilt * 0.6, 'YXZ');
    quaternion.setFromEuler(euler);
    position.set(instance.x, instance.y, instance.z);
    scale.set(instance.scaleX, instance.scaleY, instance.scaleZ);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    color.setHex(tints[instance.tint % tints.length]);
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

export interface TerrainDecorGroup {
  readonly group: Group;
  readonly counts: { readonly midground: number; readonly far: number };
}

export function createTerrainDecor(
  layout: TerrainDecorLayout,
  causticUniforms: { time: { value: number }; strength: { value: number } },
): TerrainDecorGroup {
  const midMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const farMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  applyCaustics(midMaterial, causticUniforms, causticOptionsFor('distant'));
  applyCaustics(farMaterial, causticUniforms, causticOptionsFor('distant'));

  const group = new Group();
  group.name = 'terrainDecor';
  const midMesh = buildLayer(layout.midground, midMaterial, MID_TINTS, true);
  midMesh.name = 'terrainDecorMidground';
  const farMesh = buildLayer(layout.far, farMaterial, FAR_TINTS, false);
  farMesh.name = 'terrainDecorFar';
  group.add(midMesh, farMesh);
  return {
    group,
    counts: { midground: layout.midground.length, far: layout.far.length },
  };
}
