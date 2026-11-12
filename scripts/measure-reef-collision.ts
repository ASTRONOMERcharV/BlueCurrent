import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  buildReefCollisionProxy,
  type ReefWorldTransform,
} from '../src/simulation/ReefCollisionProxy';
import { REEF_NEAR_LOCAL_SIZE } from '../src/simulation/reefCollisionProxySpecs';
import { REEF_VARIANT_SPECS } from '../src/rendering/reefVariantSpecs';
import { floorHeightAt } from '../src/rendering/rockPlacement';

/**
 * Offline audit of the reef collision proxies against the authored near-LOD
 * vertices. Reproduces the local meshes with the real GLB node transforms and
 * evaluates the same world-space SDF used by the simulation.
 *
 * Usage: npx tsx scripts/measure-reef-collision.ts
 * Output: test-artifacts/reef-collision/proxy-coverage.json
 */

const MODEL_DIR = 'public/models/reef';
const CENTERS: Record<string, readonly [number, number, number]> = {
  b: [-7, 3.4, -3],
  c: [5, 3.5, 4],
  hero: [0, 3.6, -9],
  d: [11, 3.2, -7],
  e: [-12, 3.4, 9],
};

interface GlbData {
  json: {
    accessors: Array<Record<string, unknown>>;
    bufferViews: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    meshes: Array<Record<string, unknown>>;
    scenes: Array<Record<string, unknown>>;
    scene?: number;
  };
  bin: Buffer;
}

function parseGlb(path: string): GlbData {
  const data = readFileSync(path);
  const magic = data.subarray(0, 4).toString('ascii');
  if (magic !== 'glTF') throw new Error(`${path} is not a GLB`);
  let offset = 12;
  let json: GlbData['json'] | undefined;
  let bin = Buffer.alloc(0);
  while (offset < data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8')) as GlbData['json'];
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error(`${path} has no JSON chunk`);
  return { json, bin };
}

function accessorPositions(glb: GlbData, accessorIndex: number): Vector3[] {
  const accessor = glb.json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
  };
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3') {
    throw new Error(`Unsupported POSITION accessor ${accessorIndex}`);
  }
  const view = glb.json.bufferViews[accessor.bufferView] as {
    byteOffset?: number;
    byteStride?: number;
  };
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const points: Vector3[] = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const offset = base + index * stride;
    points.push(new Vector3(
      glb.bin.readFloatLE(offset),
      glb.bin.readFloatLE(offset + 4),
      glb.bin.readFloatLE(offset + 8),
    ));
  }
  return points;
}

function meshVertices(glb: GlbData): Vector3[] {
  const nodes = glb.json.nodes;
  const meshes = glb.json.meshes as Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  const scenes = glb.json.scenes;
  const roots = scenes[glb.json.scene ?? 0]?.nodes as number[] | undefined
    ?? nodes.map((_, index) => index);
  const points: Vector3[] = [];
  const identity = new Matrix4();

  const walk = (nodeIndex: number, parent: Matrix4): void => {
    const node = nodes[nodeIndex] as {
      translation?: number[];
      rotation?: number[];
      scale?: number[];
      matrix?: number[];
      mesh?: number;
      children?: number[];
    };
    const local = new Matrix4();
    if (node.matrix) {
      local.fromArray(node.matrix);
    } else {
      const translation = new Vector3().fromArray(node.translation ?? [0, 0, 0]);
      const rotation = new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]);
      const scale = new Vector3().fromArray(node.scale ?? [1, 1, 1]);
      local.compose(translation, rotation, scale);
    }
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const primitive of meshes[node.mesh].primitives) {
        for (const point of accessorPositions(glb, primitive.attributes.POSITION)) {
          points.push(point.applyMatrix4(world));
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  for (const root of roots) walk(root, identity);
  return points;
}

function bounds(points: readonly Vector3[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    min.min(point);
    max.max(point);
  }
  return { min, max };
}

function worldTransform(id: 'b' | 'c' | 'hero' | 'd' | 'e'): ReefWorldTransform {
  const spec = REEF_VARIANT_SPECS.find((candidate) => candidate.id === id)!;
  const localSize = REEF_NEAR_LOCAL_SIZE[id];
  const [x, , z] = CENTERS[id];
  return {
    id,
    anchorIndex: spec.anchorIndex,
    position: [x, floorHeightAt(x, z) - spec.embedDepth, z],
    yaw: (spec.yawDegrees * Math.PI) / 180,
    tiltX: (spec.tiltXDegrees * Math.PI) / 180,
    tiltZ: (spec.tiltZDegrees * Math.PI) / 180,
    scale: [
      spec.targetWidth / localSize[0],
      spec.targetHeight / localSize[1],
      spec.targetDepth / localSize[2],
    ],
    localSize,
  };
}

const results = [];
const useOriginal = process.argv.includes('--old');
const originalPrefix: Record<string, string> = {
  hero: 'reef_sample',
  d: 'reef_variant_d',
};
for (const id of ['b', 'c', 'hero', 'd', 'e'] as const) {
  const spec = REEF_VARIANT_SPECS.find((candidate) => candidate.id === id)!;
  const prefix = useOriginal ? originalPrefix[id] ?? spec.assetPrefix : spec.assetPrefix;
  const glb = parseGlb(`${MODEL_DIR}/${prefix}_near.glb`);
  const localPoints = meshVertices(glb);
  const local = bounds(localPoints);
  const transform = worldTransform(id);
  const rotation = new Euler(transform.tiltX, transform.yaw, transform.tiltZ, 'YXZ');
  const rotationMatrix = new Matrix4().makeRotationFromEuler(rotation);
  const worldMatrix = new Matrix4()
    .compose(
      new Vector3(...transform.position),
      new Quaternion().setFromRotationMatrix(rotationMatrix),
      new Vector3(...transform.scale),
    );
  const worldPoints = localPoints.map((point) => point.clone().applyMatrix4(worldMatrix));
  const world = bounds(worldPoints);
  const proxy = buildReefCollisionProxy(transform);
  const localProxy = buildReefCollisionProxy({
    ...transform,
    position: [0, 0, 0],
    yaw: 0,
    tiltX: 0,
    tiltZ: 0,
    scale: [1, 1, 1],
  });
  let outside = 0;
  let outsideFiveCentimeters = 0;
  let maxOutside = -Infinity;
  let localOutside = 0;
  const bands = new Map<number, { count: number; max: number; xMin: number; xMax: number; zMin: number; zMax: number }>();
  for (let index = 0; index < worldPoints.length; index += 1) {
    const point = worldPoints[index];
    const distance = proxy.distance(point.x, point.y, point.z);
    const localDistance = localProxy.distance(localPoints[index].x, localPoints[index].y, localPoints[index].z);
    if (localDistance > 0) localOutside += 1;
    if (distance > 0) outside += 1;
    if (distance > 0.05) outsideFiveCentimeters += 1;
    if (distance > maxOutside) maxOutside = distance;
    if (distance > 0) {
      const local = localPoints[index];
      const band = Math.floor((local.y / transform.localSize[1]) * 10) / 10;
      const record = bands.get(band) ?? { count: 0, max: 0, xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity };
      record.count += 1;
      record.max = Math.max(record.max, distance);
      record.xMin = Math.min(record.xMin, local.x);
      record.xMax = Math.max(record.xMax, local.x);
      record.zMin = Math.min(record.zMin, local.z);
      record.zMax = Math.max(record.zMax, local.z);
      bands.set(band, record);
    }
  }
  if (process.argv.includes('--bins') && (id === 'hero' || id === 'd')) {
    console.log(`bands ${id}:`);
    for (const [band, record] of [...bands.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(
        `  y ${band.toFixed(1)} count ${record.count} max ${record.max.toFixed(2)} ` +
        `x ${record.xMin.toFixed(2)}..${record.xMax.toFixed(2)} z ${record.zMin.toFixed(2)}..${record.zMax.toFixed(2)}`,
      );
    }
  }
  const definitionIndex = transform.anchorIndex;
  const sphereCenters: Array<[number, number, number, number]> = [
    [-7, 3.4, -3, 3.4],
    [5, 3.5, 4, 3.5],
    [0, 3.6, -9, 3.6],
    [11, 3.2, -7, 3.2],
    [-12, 3.4, 9, 3.4],
  ];
  const [cx, cy, cz, radius] = sphereCenters[definitionIndex];
  const entry = {
    id,
    localSize: [local.max.x - local.min.x, local.max.y - local.min.y, local.max.z - local.min.z],
    scale: transform.scale,
    worldMin: world.min.toArray(),
    worldMax: world.max.toArray(),
    sphere: { center: [cx, cy, cz], radius, top: cy + radius },
    topAboveSphere: world.max.y - (cy + radius),
    vertices: worldPoints.length,
    localOutsideProxy: localOutside,
    outsideProxy: outside,
    outsideProxyFraction: outside / worldPoints.length,
    outsideFiveCentimeters,
    maxOutsideMeters: maxOutside,
    primitiveCount: proxy.primitives.length,
  };
  results.push(entry);
  console.log(
    `${id.padEnd(4)} local ${entry.localSize.map((v) => v.toFixed(2)).join('×')} ` +
    `worldY ${world.min.y.toFixed(2)}..${world.max.y.toFixed(2)} ` +
    `sphereTop ${entry.sphere.top.toFixed(2)} Δ ${entry.topAboveSphere.toFixed(2)} ` +
    `outside ${(entry.outsideProxyFraction * 100).toFixed(1)}% max ${maxOutside.toFixed(2)}m`,
  );
}

mkdirSync('test-artifacts/reef-collision', { recursive: true });
writeFileSync(
  'test-artifacts/reef-collision/proxy-coverage.json',
  `${JSON.stringify({ reefs: results }, null, 2)}\n`,
);
console.log('wrote test-artifacts/reef-collision/proxy-coverage.json');
