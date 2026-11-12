import { BufferAttribute, BufferGeometry, Color, PlaneGeometry } from 'three';
import { floorHeightAt } from './rockPlacement';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

/**
 * Continuous seabed used by rendering only.
 *
 * `floorHeightAt` remains the single height contract for every existing
 * simulation-adjacent placement (kelp, coral, rocks, habitat and current
 * queries). This module extends that same surface outward for the camera:
 * the inner 70 m square is byte-for-byte the old floor height, the outer shelf
 * starts beyond the last placement and rolls gently downward so the world has
 * no visible rectangular edge, vertical plate side or floating-island base.
 */

export const TERRAIN_INNER_HALF = 35;
export const TERRAIN_INNER_SEGMENTS = 48;
export const TERRAIN_OUTER_SEGMENTS = 36;
export const TERRAIN_OUTER_FIRST_STEP = 1.35;
export const TERRAIN_OUTER_RATIO = 1.13;
export const TERRAIN_RADIUS = TERRAIN_INNER_HALF
  + TERRAIN_OUTER_FIRST_STEP
    * ((TERRAIN_OUTER_RATIO ** TERRAIN_OUTER_SEGMENTS - 1) / (TERRAIN_OUTER_RATIO - 1));
export const CAMERA_FLOOR_CLEARANCE = 1.1;
export const CAMERA_WORLD_RADIUS = 280;
export const CAMERA_TARGET_LIMIT_XZ = 28;
export const CAMERA_TARGET_MIN_Y = 1.2;
export const CAMERA_TARGET_MAX_Y = 18.5;

const OUTER_START = 34;
const OUTER_FULL = 90;

function smoothstep(minimum: number, maximum: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return t * t * (3 - 2 * t);
}

export function terrainHeightAt(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const base = floorHeightAt(x, z);
  if (radius <= OUTER_START) return base;

  // The drop begins outside every existing decoration (max radius ~27 m),
  // so the central swimming floor and all placements keep the old height.
  const blend = smoothstep(OUTER_START, OUTER_FULL, radius);
  const beyondShelf = Math.max(0, radius - OUTER_FULL);
  const drop = -0.45 * blend - beyondShelf * 0.026;
  const roll = blend * (
    Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.018 - 0.4) * 0.55
    + Math.sin((x + z) * 0.011 + 0.3) * 0.9
  );
  return base + drop + roll;
}

export interface CameraConstrainable {
  x: number;
  y: number;
  z: number;
}

/** Keep the orbit camera above the seabed and inside the generated world. */
export function constrainCameraPosition(position: CameraConstrainable): boolean {
  let changed = false;
  const horizontal = Math.hypot(position.x, position.z);
  if (horizontal > CAMERA_WORLD_RADIUS) {
    const scale = CAMERA_WORLD_RADIUS / horizontal;
    position.x *= scale;
    position.z *= scale;
    changed = true;
  }
  const minimumY = terrainHeightAt(position.x, position.z) + CAMERA_FLOOR_CLEARANCE;
  if (position.y < minimumY) {
    position.y = minimumY;
    changed = true;
  }
  return changed;
}

/**
 * Keep the observation target inside the authored reef. Preset targets
 * (school centroid, predator position) are already inside the simulation
 * bounds; this only stops free panning from visiting empty world space.
 */
export function constrainCameraTarget(target: CameraConstrainable): boolean {
  const limit = CAMERA_TARGET_LIMIT_XZ;
  const x = Math.max(-limit, Math.min(limit, target.x));
  const z = Math.max(-limit, Math.min(limit, target.z));
  const y = Math.max(CAMERA_TARGET_MIN_Y, Math.min(CAMERA_TARGET_MAX_Y, target.y));
  if (x === target.x && y === target.y && z === target.z) return false;
  target.x = x;
  target.y = y;
  target.z = z;
  return true;
}

function terrainAxis(): number[] {
  const axis: number[] = [];
  const innerStep = (TERRAIN_INNER_HALF * 2) / TERRAIN_INNER_SEGMENTS;
  for (let index = 0; index <= TERRAIN_INNER_SEGMENTS; index += 1) {
    axis.push(-TERRAIN_INNER_HALF + index * innerStep);
  }

  let step = TERRAIN_OUTER_FIRST_STEP;
  let outerRadius = TERRAIN_INNER_HALF;
  for (let index = 0; index < TERRAIN_OUTER_SEGMENTS; index += 1) {
    outerRadius += step;
    axis.push(outerRadius);
    axis.unshift(-outerRadius);
    step *= TERRAIN_OUTER_RATIO;
  }
  return axis;
}

/**
 * Exact pre-P1 70 m square floor, kept as an A/B and rollback path.
 */
export function createLegacySeabedGeometry(): BufferGeometry {
  const geometry = new PlaneGeometry(70, 70, 48, 48);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, floorHeightAt(positions.getX(index), positions.getZ(index)));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One non-uniform grid: 1.46 m cells in the authored 70 m reef, then
 * geometrically growing cells out to the fog-dominated shelf. The density
 * change is entirely outside the swim bounds, so fish-scale detail is intact.
 */
export function createSeabedGeometry(): BufferGeometry {
  const axis = terrainAxis();
  const columns = axis.length;
  const vertexCount = columns * columns;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const floorColor = new Color(UNDERWATER_LIGHTING_CONFIG.materials.floorColor);
  const farColor = new Color(UNDERWATER_LIGHTING_CONFIG.water.scatterFarColor);
  const deepColor = new Color(UNDERWATER_LIGHTING_CONFIG.water.background);
  const color = new Color();

  for (let row = 0; row < columns; row += 1) {
    const z = axis[row];
    for (let column = 0; column < columns; column += 1) {
      const x = axis[column];
      const index = (row * columns + column) * 3;
      positions[index] = x;
      positions[index + 1] = terrainHeightAt(x, z);
      positions[index + 2] = z;

      // Resolution-independent smooth normal from the analytic height function.
      // Face-averaged normals would make 1.4 m reef cells and 40 m shelf cells
      // shade differently and draw a visible line at the LOD boundary.
      const epsilon = 0.35;
      const dx = (terrainHeightAt(x + epsilon, z) - terrainHeightAt(x - epsilon, z))
        / (epsilon * 2);
      const dz = (terrainHeightAt(x, z + epsilon) - terrainHeightAt(x, z - epsilon))
        / (epsilon * 2);
      const normalLength = Math.hypot(-dx, 1, -dz);
      normals[index] = -dx / normalLength;
      normals[index + 1] = 1 / normalLength;
      normals[index + 2] = -dz / normalLength;

      const radius = Math.hypot(x, z);
      const farBlend = smoothstep(60, 150, radius) * 0.7;
      const deepBlend = smoothstep(120, 300, radius);
      color.copy(floorColor).lerp(farColor, farBlend).lerp(deepColor, deepBlend);
      colors[index] = color.r;
      colors[index + 1] = color.g;
      colors[index + 2] = color.b;
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < columns - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = (row + 1) * columns + column;
      const c = (row + 1) * columns + column + 1;
      const d = row * columns + column + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
