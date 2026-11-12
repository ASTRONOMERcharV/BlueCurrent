import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { REEF_VARIANT_SPECS } from '../src/rendering/reefVariantSpecs';
import { floorHeightAt } from '../src/rendering/rockPlacement';

/**
 * Offline projected-silhouette audit for the five primary reefs.
 *
 * Reproduces the production Overview camera and the runtime placement
 * transform, rasterizes the authored near-LOD triangles of every reef with a
 * depth buffer, and reports visible/full screen-space extents plus occlusion.
 *
 * Usage: npx tsx scripts/reef-hierarchy-probe.ts --out=reef-hierarchy/baseline
 * Output: <out>/metrics.json, <out>/silhouette-mask.png, <out>/hero-mask.png,
 *         <out>/d-mask.png
 */

const MODEL_DIR = 'public/models/reef';
const CENTERS: Record<string, readonly [number, number, number]> = {
  b: [-7, 3.4, -3],
  c: [5, 3.5, 4],
  hero: [0, 3.6, -9],
  d: [11, 3.2, -7],
  e: [-12, 3.4, 9],
};
const COLORS: Record<string, readonly [number, number, number]> = {
  hero: [255, 196, 64],
  d: [255, 64, 196],
  b: [80, 160, 255],
  c: [96, 224, 128],
  e: [64, 232, 232],
};
const ORDER = ['b', 'c', 'hero', 'd', 'e'] as const;
type ReefId = typeof ORDER[number];

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const out = argument('out', 'reef-hierarchy/baseline');
const width = Number.parseInt(argument('width', '1556'), 10);
const height = Number.parseInt(argument('height', '932'), 10);
const canvasLabel = argument('label', `${width}x${height}`);
const useOriginal = process.argv.includes('--old');
const ORIGINAL_PREFIX: Partial<Record<ReefId, string>> = {
  hero: 'reef_sample',
  d: 'reef_variant_d',
};
const assetPrefix = (id: ReefId, current: string): string => (
  useOriginal ? ORIGINAL_PREFIX[id] ?? current : current
);
mkdirSync(`test-artifacts/${out}`, { recursive: true });

interface GlbData {
  json: {
    accessors: Array<Record<string, unknown>>;
    bufferViews: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number }> }>;
    scenes: Array<{ nodes?: number[] }>;
    scene?: number;
  };
  bin: Buffer;
}

function parseGlb(path: string): GlbData {
  const data = readFileSync(path);
  if (data.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error(`${path} is not a GLB`);
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

function accessorFloats(glb: GlbData, accessorIndex: number, components: number): Float32Array {
  const accessor = glb.json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
    type: string;
  };
  if (accessor.componentType !== 5126) throw new Error(`Unsupported float accessor ${accessorIndex}`);
  const view = glb.json.bufferViews[accessor.bufferView] as { byteOffset?: number; byteStride?: number };
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * 4;
  const values = new Float32Array(accessor.count * components);
  for (let index = 0; index < accessor.count; index += 1) {
    for (let component = 0; component < components; component += 1) {
      values[index * components + component] = glb.bin.readFloatLE(base + index * stride + component * 4);
    }
  }
  return values;
}

function accessorIndices(glb: GlbData, accessorIndex: number): Uint32Array {
  const accessor = glb.json.accessors[accessorIndex] as {
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
  };
  const view = glb.json.bufferViews[accessor.bufferView] as { byteOffset?: number; byteStride?: number };
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const size = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
  const stride = view.byteStride ?? size;
  const indices = new Uint32Array(accessor.count);
  for (let index = 0; index < accessor.count; index += 1) {
    const offset = base + index * stride;
    indices[index] = size === 4
      ? glb.bin.readUInt32LE(offset)
      : size === 2
        ? glb.bin.readUInt16LE(offset)
        : glb.bin.readUInt8(offset);
  }
  return indices;
}

interface LocalMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

function localMesh(glb: GlbData): LocalMesh {
  const nodes = glb.json.nodes;
  const scenes = glb.json.scenes;
  const roots = scenes[glb.json.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  const positions: number[] = [];
  const indices: number[] = [];
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
    if (node.matrix) local.fromArray(node.matrix);
    else {
      local.compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
    }
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const primitive of glb.json.meshes[node.mesh].primitives) {
        if (primitive.mode !== undefined && primitive.mode !== 4) continue;
        const baseVertex = positions.length / 3;
        const raw = accessorFloats(glb, primitive.attributes.POSITION, 3);
        for (let index = 0; index < raw.length; index += 3) {
          const point = new Vector3(raw[index], raw[index + 1], raw[index + 2]).applyMatrix4(world);
          positions.push(point.x, point.y, point.z);
        }
        if (primitive.indices !== undefined) {
          for (const index of accessorIndices(glb, primitive.indices)) indices.push(baseVertex + index);
        } else {
          for (let index = 0; index < raw.length / 3; index += 1) indices.push(baseVertex + index);
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  for (const root of roots) walk(root, identity);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function meshBounds(mesh: LocalMesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

interface WorldTransformData {
  id: ReefId;
  position: [number, number, number];
  yaw: number;
  tiltX: number;
  tiltZ: number;
  scale: [number, number, number];
  localSize: [number, number, number];
  matrix: Matrix4;
}

function worldTransform(spec: (typeof REEF_VARIANT_SPECS)[number], localSize: readonly number[]): WorldTransformData {
  const [x, , z] = CENTERS[spec.id];
  const yaw = (spec.yawDegrees * Math.PI) / 180;
  const tiltX = (spec.tiltXDegrees * Math.PI) / 180;
  const tiltZ = (spec.tiltZDegrees * Math.PI) / 180;
  const scale: [number, number, number] = [
    spec.targetWidth / localSize[0],
    spec.targetHeight / localSize[1],
    spec.targetDepth / localSize[2],
  ];
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(tiltX, yaw, tiltZ, 'YXZ'));
  const matrix = new Matrix4().compose(
    new Vector3(x, floorHeightAt(x, z) - spec.embedDepth, z),
    new Quaternion().setFromRotationMatrix(rotation),
    new Vector3(...scale),
  );
  return {
    id: spec.id,
    position: [x, floorHeightAt(x, z) - spec.embedDepth, z],
    yaw,
    tiltX,
    tiltZ,
    scale,
    localSize: [localSize[0], localSize[1], localSize[2]],
    matrix,
  };
}

/**
 * Rasterize one pass. `points` holds world-space triangles per reef. Each pixel
 * stores the nearest inverse depth and the reef id.
 */
function rasterize(
  triangles: Array<{ id: ReefId; vertices: Float32Array }>,
  camera: PerspectiveCamera,
  w: number,
  h: number,
) {
  const depth = new Float32Array(w * h).fill(0);
  const ids = new Uint8Array(w * h);
  const fullMasks = new Map<ReefId, Uint8Array>();
  for (const id of ORDER) fullMasks.set(id, new Uint8Array(w * h));
  const idCode = new Map<ReefId, number>(ORDER.map((id, index) => [id, index + 1]));
  const projected = new Float32Array(9);

  for (const triangle of triangles) {
    const code = idCode.get(triangle.id)!;
    const full = fullMasks.get(triangle.id)!;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const point = new Vector3(
        triangle.vertices[vertex * 3],
        triangle.vertices[vertex * 3 + 1],
        triangle.vertices[vertex * 3 + 2],
      ).project(camera);
      const sx = (point.x * 0.5 + 0.5) * w;
      const sy = (1 - (point.y * 0.5 + 0.5)) * h;
      projected[vertex * 3] = sx;
      projected[vertex * 3 + 1] = sy;
      projected[vertex * 3 + 2] = point.z;
    }
    if (!Number.isFinite(projected[0]) || !Number.isFinite(projected[4]) || !Number.isFinite(projected[7])) continue;
    const xs = [projected[0], projected[3], projected[6]];
    const ys = [projected[1], projected[4], projected[7]];
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    if (minX > maxX || minY > maxY) continue;
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(area) < 1e-9) continue;
    const invArea = 1 / area;
    for (let py = minY; py <= maxY; py += 1) {
      const y = py + 0.5;
      for (let px = minX; px <= maxX; px += 1) {
        const x = px + 0.5;
        const w0 = ((xs[1] - x) * (ys[2] - y) - (xs[2] - x) * (ys[1] - y)) * invArea;
        const w1 = ((xs[2] - x) * (ys[0] - y) - (xs[0] - x) * (ys[2] - y)) * invArea;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const pixel = py * w + px;
        full[pixel] = 1;
        // NDC z is nonlinear, but for depth ordering (all in front) its
        // reciprocal is linear in screen space. Use interpolated 1/z.
        const invZ = w0 / projected[2] + w1 / projected[5] + w2 / projected[8];
        if (invZ > depth[pixel]) {
          depth[pixel] = invZ;
          ids[pixel] = code;
        }
      }
    }
  }
  return { depth, ids, fullMasks };
}

interface MaskStats {
  pixels: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

function maskStats(mask: Uint8Array, w: number, h: number): MaskStats {
  let pixels = 0;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      pixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    pixels,
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function writePng(path: string, w: number, h: number, rgba: Uint8Array): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.subarray(y * w * 4, (y + 1) * w * 4).forEach((value, index) => {
      raw[y * (w * 4 + 1) + 1 + index] = value;
    });
  }
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

const camera = new PerspectiveCamera(48, width / height, 0.1, 500);
camera.position.set(30, 18, 29);
camera.lookAt(0, 6.5, -2);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

const triangles: Array<{ id: ReefId; vertices: Float32Array }> = [];
const reefs: Record<string, unknown>[] = [];

for (const id of ORDER) {
  const spec = REEF_VARIANT_SPECS.find((candidate) => candidate.id === id)!;
  const prefix = assetPrefix(id, spec.assetPrefix);
  const glb = parseGlb(`${MODEL_DIR}/${prefix}_near.glb`);
  const mesh = localMesh(glb);
  const local = meshBounds(mesh);
  const transform = worldTransform(spec, local.size);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const point = new Vector3(mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2])
      .applyMatrix4(transform.matrix);
    mesh.positions[index] = point.x;
    mesh.positions[index + 1] = point.y;
    mesh.positions[index + 2] = point.z;
  }
  for (let index = 0; index < mesh.indices.length; index += 3) {
    triangles.push({
      id,
      vertices: new Float32Array([
        mesh.positions[mesh.indices[index] * 3], mesh.positions[mesh.indices[index] * 3 + 1], mesh.positions[mesh.indices[index] * 3 + 2],
        mesh.positions[mesh.indices[index + 1] * 3], mesh.positions[mesh.indices[index + 1] * 3 + 1], mesh.positions[mesh.indices[index + 1] * 3 + 2],
        mesh.positions[mesh.indices[index + 2] * 3], mesh.positions[mesh.indices[index + 2] * 3 + 1], mesh.positions[mesh.indices[index + 2] * 3 + 2],
      ]),
    });
  }
  reefs.push({
    id,
    assetPrefix: prefix,
    localBounds: local,
    scale: transform.scale,
    worldPosition: transform.position,
    worldMin: [
      Math.min(...Array.from({ length: 8 }, (_, corner) => (
        new Vector3(
          corner & 1 ? local.max[0] : local.min[0],
          corner & 2 ? local.max[1] : local.min[1],
          corner & 4 ? local.max[2] : local.min[2],
        ).applyMatrix4(transform.matrix).x
      ))),
      Math.min(...Array.from({ length: 8 }, (_, corner) => (
        new Vector3(
          corner & 1 ? local.max[0] : local.min[0],
          corner & 2 ? local.max[1] : local.min[1],
          corner & 4 ? local.max[2] : local.min[2],
        ).applyMatrix4(transform.matrix).y
      ))),
      Math.min(...Array.from({ length: 8 }, (_, corner) => (
        new Vector3(
          corner & 1 ? local.max[0] : local.min[0],
          corner & 2 ? local.max[1] : local.min[1],
          corner & 4 ? local.max[2] : local.min[2],
        ).applyMatrix4(transform.matrix).z
      ))),
    ],
    worldMax: [
      Math.max(...Array.from({ length: 8 }, (_, corner) => (
        new Vector3(
          corner & 1 ? local.max[0] : local.min[0],
          corner & 2 ? local.max[1] : local.min[1],
          corner & 4 ? local.max[2] : local.min[2],
        ).applyMatrix4(transform.matrix).x
      ))),
      Math.max(...Array.from({ length: 8 }, (_, corner) => (
        new Vector3(
          corner & 1 ? local.max[0] : local.min[0],
          corner & 2 ? local.max[1] : local.min[1],
          corner & 4 ? local.max[2] : local.min[2],
        ).applyMatrix4(transform.matrix).y
      ))),
      Math.max(...Array.from({ length: 8 }, (_, corner) => (
        new Vector3(
          corner & 1 ? local.max[0] : local.min[0],
          corner & 2 ? local.max[1] : local.min[1],
          corner & 4 ? local.max[2] : local.min[2],
        ).applyMatrix4(transform.matrix).z
      ))),
    ],
  });
}

const { ids, fullMasks } = rasterize(triangles, camera, width, height);

const full: Record<string, unknown> = {};
const visible: Record<string, unknown> = {};
for (const id of ORDER) {
  const mask = fullMasks.get(id)!;
  full[id] = maskStats(mask, width, height);
  const vis = new Uint8Array(width * height);
  const code = ORDER.indexOf(id) + 1;
  for (let index = 0; index < ids.length; index += 1) if (ids[index] === code) vis[index] = 1;
  visible[id] = maskStats(vis, width, height);
}

const heroFull = full.hero as MaskStats;
const dFull = full.d as MaskStats;
const heroVisible = visible.hero as MaskStats;
const dVisible = visible.d as MaskStats;

const maskRgba = new Uint8Array(width * height * 4);
for (let index = 0; index < ids.length; index += 1) {
  const code = ids[index];
  if (!code) continue;
  const id = ORDER[code - 1];
  const [r, g, b] = COLORS[id];
  maskRgba[index * 4] = r;
  maskRgba[index * 4 + 1] = g;
  maskRgba[index * 4 + 2] = b;
  maskRgba[index * 4 + 3] = 255;
}
writePng(`test-artifacts/${out}/silhouette-mask.png`, width, height, maskRgba);

for (const id of ['hero', 'd'] as const) {
  const vis = new Uint8Array(width * height);
  const code = ORDER.indexOf(id) + 1;
  for (let index = 0; index < ids.length; index += 1) if (ids[index] === code) vis[index] = 1;
  const rgba = new Uint8Array(width * height * 4);
  const [r, g, b] = COLORS[id];
  for (let index = 0; index < vis.length; index += 1) {
    if (!vis[index]) continue;
    rgba[index * 4] = r;
    rgba[index * 4 + 1] = g;
    rgba[index * 4 + 2] = b;
    rgba[index * 4 + 3] = 255;
  }
  writePng(`test-artifacts/${out}/${id}-mask.png`, width, height, rgba);
}

const groupMask = new Uint8Array(width * height);
for (let index = 0; index < ids.length; index += 1) if (ids[index]) groupMask[index] = 1;
const group = maskStats(groupMask, width, height);

const occlusion: Record<string, number> = {};
for (let index = 0; index < ids.length; index += 1) {
  if (!ids[index]) continue;
  for (const id of ORDER) {
    if (id === ORDER[ids[index] - 1]) continue;
    const mask = fullMasks.get(id)!;
    if (!mask[index]) continue;
    const key = `${ORDER[ids[index] - 1]} occludes ${id}`;
    occlusion[key] = (occlusion[key] ?? 0) + 1;
  }
}

const aabbProjected: Record<string, unknown> = {};
for (const reef of reefs) {
  const id = reef.id as ReefId;
  const spec = REEF_VARIANT_SPECS.find((candidate) => candidate.id === id)!;
  const local = reef.localBounds as { min: number[]; max: number[]; size: number[] };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let corner = 0; corner < 8; corner += 1) {
    const point = new Vector3(
      corner & 1 ? local.max[0] : local.min[0],
      corner & 2 ? local.max[1] : local.min[1],
      corner & 4 ? local.max[2] : local.min[2],
    );
    const transform = worldTransform(spec, local.size);
    point.applyMatrix4(transform.matrix).project(camera);
    const sx = (point.x * 0.5 + 0.5) * width;
    const sy = (1 - (point.y * 0.5 + 0.5)) * height;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }
  aabbProjected[id] = {
    minX, maxX, minY, maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

const summary = {
  canvas: { width, height, label: canvasLabel },
  camera: { position: camera.position.toArray(), target: [0, 6.5, -2], fov: 48 },
  reefs,
  aabbProjected,
  full,
  visible,
  group,
  occlusion,
  ratios: {
    aabbHeight: (aabbProjected.hero as { height: number }).height / (aabbProjected.d as { height: number }).height,
    fullSilhouetteHeight: heroFull.height / dFull.height,
    visibleSilhouetteHeight: heroVisible.height / dVisible.height,
    fullSilhouetteArea: heroFull.pixels / dFull.pixels,
    visibleSilhouetteArea: heroVisible.pixels / dVisible.pixels,
  },
  heroCenterPercent: {
    x: (heroVisible.centerX / width) * 100,
    y: (heroVisible.centerY / height) * 100,
  },
  dCenterPercent: {
    x: (dVisible.centerX / width) * 100,
    y: (dVisible.centerY / height) * 100,
  },
  groupPercent: {
    x: (group.width / width) * 100,
    y: (group.height / height) * 100,
    minX: (group.minX / width) * 100,
    maxX: (group.maxX / width) * 100,
    minY: (group.minY / height) * 100,
    maxY: (group.maxY / height) * 100,
  },
};

writeFileSync(`test-artifacts/${out}/metrics.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`wrote test-artifacts/${out}/metrics.json`);
console.log(
  `hero visible ${heroVisible.width}×${heroVisible.height} @ ${(heroVisible.centerX / width * 100).toFixed(1)}%/${(heroVisible.centerY / height * 100).toFixed(1)}% ` +
  `| d ${dVisible.width}×${dVisible.height} | ratio ${(heroVisible.height / dVisible.height).toFixed(3)} ` +
  `| aabb ratio ${(summary.ratios.aabbHeight).toFixed(3)} | group ${(group.width / width * 100).toFixed(1)}×${(group.height / height * 100).toFixed(1)}%`,
);
