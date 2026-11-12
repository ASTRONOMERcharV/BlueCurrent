import {
  centralDifferenceNormal,
  normalizeInto,
  sdCapsule,
  sdEllipsoid,
  sdRoundedBox,
} from './sdf';
import {
  REEF_NEAR_LOCAL_SIZE,
  REEF_PROXY_SPECS,
  type ReefProxyId,
  type ReefProxyShapeSpec,
  type ReefProxySpec,
  type Vec3Fraction,
} from './reefCollisionProxySpecs';

/**
 * World-space compound SDF for one reef.
 *
 * The authored GLB is placed by `T * R * S` (position, Euler YXZ, non-uniform
 * scale). Local rounded boxes are axis aligned, so `R * S` maps them to exact
 * oriented boxes with half extents `half * S`. Capsules are near vertical; their
 * world radius uses `r * max(Sx, Sz)` so the horizontal cross-section stays
 * covered. Capsules are evaluated exactly in local space (inverse transform,
 * conservative `min(S)` distance scale, inverse-transpose normal). Ellipsoids
 * scale per axis. Box rounding uses the largest scale so the world box contains
 * the per-axis rounded authored shape. The remaining error is measured against
 * the near-LOD vertices in `docs/REEF_COLLISION_PROXY_EXPERIMENT.md`.
 */

export interface ReefWorldTransform {
  readonly id: ReefProxyId;
  readonly anchorIndex: number;
  /** World position of the GLB origin: reef anchor x/z, floor height − embed. */
  readonly position: readonly [number, number, number];
  /** Euler order 'YXZ', radians. */
  readonly yaw: number;
  readonly tiltX: number;
  readonly tiltZ: number;
  /** Non-uniform visual scale applied by `ReefSample`. */
  readonly scale: readonly [number, number, number];
  /** Authored near-LOD dimensions (width, height, depth). */
  readonly localSize: readonly [number, number, number];
}

export type ReefProxyPrimitiveKind = 'roundedBox' | 'capsule' | 'ellipsoid';

export interface SdfPrimitiveDebugShape {
  readonly kind: ReefProxyPrimitiveKind;
  readonly center: readonly [number, number, number];
  /** Row-major world rotation, boxes and ellipsoids only. */
  readonly rotation?: readonly number[];
  readonly half?: readonly [number, number, number];
  readonly rounding?: number;
  readonly a?: readonly [number, number, number];
  readonly b?: readonly [number, number, number];
  readonly radius?: number;
  readonly radii?: readonly [number, number, number];
}

export interface WorldSdfPrimitive {
  readonly kind: ReefProxyPrimitiveKind;
  /** Center of the primitive's bounding sphere. */
  readonly center: readonly [number, number, number];
  readonly boundRadius: number;
  /** Read-only shape data for the Laboratory wireframe (never used by physics). */
  readonly debug: SdfPrimitiveDebugShape;
  distance(x: number, y: number, z: number): number;
  /** Writes a unit normal; returns false when it used the degenerate fallback. */
  gradient(out: Float32Array, x: number, y: number, z: number): boolean;
}

/** Row-major 3×3 rotation for three.js Euler order 'YXZ': Ry * Rx * Rz. */
export function eulerYXZMatrix(
  yaw: number,
  tiltX: number,
  tiltZ: number,
  out: Float64Array = new Float64Array(9),
): Float64Array {
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cz = Math.cos(tiltZ);
  const sz = Math.sin(tiltZ);
  out[0] = cy * cz + sy * sx * sz;
  out[1] = -cy * sz + sy * sx * cz;
  out[2] = sy * cx;
  out[3] = cx * sz;
  out[4] = cx * cz;
  out[5] = -sx;
  out[6] = -sy * cz + cy * sx * sz;
  out[7] = sy * sz + cy * sx * cz;
  out[8] = cy * cx;
  return out;
}

function fallbackDirection(
  out: Float32Array,
  x: number,
  y: number,
  z: number,
  center: readonly [number, number, number],
): false {
  const dx = x - center[0];
  const dy = y - center[1];
  const dz = z - center[2];
  normalizeInto(out, dx, dy, dz);
  return false;
}

class WorldRoundedBox implements WorldSdfPrimitive {
  readonly kind = 'roundedBox' as const;
  readonly center: readonly [number, number, number];
  readonly boundRadius: number;
  readonly debug: SdfPrimitiveDebugShape;

  constructor(
    private readonly cx: number,
    private readonly cy: number,
    private readonly cz: number,
    private readonly halfX: number,
    private readonly halfY: number,
    private readonly halfZ: number,
    private readonly rounding: number,
    private readonly r0: number,
    private readonly r1: number,
    private readonly r2: number,
    private readonly r3: number,
    private readonly r4: number,
    private readonly r5: number,
    private readonly r6: number,
    private readonly r7: number,
    private readonly r8: number,
  ) {
    this.center = [cx, cy, cz];
    this.boundRadius = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ) + rounding;
    this.debug = {
      kind: 'roundedBox',
      center: this.center,
      rotation: [r0, r1, r2, r3, r4, r5, r6, r7, r8],
      half: [halfX, halfY, halfZ],
      rounding,
    };
  }

  distance(x: number, y: number, z: number): number {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const dz = z - this.cz;
    // Transpose of the row-major rotation.
    const lx = this.r0 * dx + this.r3 * dy + this.r6 * dz;
    const ly = this.r1 * dx + this.r4 * dy + this.r7 * dz;
    const lz = this.r2 * dx + this.r5 * dy + this.r8 * dz;
    return sdRoundedBox(lx, ly, lz, this.halfX, this.halfY, this.halfZ, this.rounding);
  }

  gradient(out: Float32Array, x: number, y: number, z: number): boolean {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const dz = z - this.cz;
    const lx = this.r0 * dx + this.r3 * dy + this.r6 * dz;
    const ly = this.r1 * dx + this.r4 * dy + this.r7 * dz;
    const lz = this.r2 * dx + this.r5 * dy + this.r8 * dz;
    const qx = Math.abs(lx) - this.halfX;
    const qy = Math.abs(ly) - this.halfY;
    const qz = Math.abs(lz) - this.halfZ;
    const outside = Math.sqrt(
      Math.max(qx, 0) * Math.max(qx, 0)
      + Math.max(qy, 0) * Math.max(qy, 0)
      + Math.max(qz, 0) * Math.max(qz, 0),
    );
    let gx = 0;
    let gy = 0;
    let gz = 0;
    if (outside > 1e-9) {
      if (qx > 0) gx = (lx >= 0 ? 1 : -1) * qx;
      if (qy > 0) gy = (ly >= 0 ? 1 : -1) * qy;
      if (qz > 0) gz = (lz >= 0 ? 1 : -1) * qz;
    } else {
      // Deep inside: push out through the nearest face.
      if (qx >= qy && qx >= qz) gx = lx >= 0 ? 1 : -1;
      else if (qy >= qz) gy = ly >= 0 ? 1 : -1;
      else gz = lz >= 0 ? 1 : -1;
    }
    const length = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (length < 1e-9) return fallbackDirection(out, x, y, z, this.center);
    const inverse = 1 / length;
    gx *= inverse;
    gy *= inverse;
    gz *= inverse;
    out[0] = this.r0 * gx + this.r1 * gy + this.r2 * gz;
    out[1] = this.r3 * gx + this.r4 * gy + this.r5 * gz;
    out[2] = this.r6 * gx + this.r7 * gy + this.r8 * gz;
    return true;
  }
}

class WorldScaledCapsule implements WorldSdfPrimitive {
  readonly kind = 'capsule' as const;
  readonly center: readonly [number, number, number];
  readonly boundRadius: number;
  readonly debug: SdfPrimitiveDebugShape;
  private readonly axisX: number;
  private readonly axisY: number;
  private readonly axisZ: number;
  private readonly axisLength: number;
  private readonly distanceScale: number;

  constructor(
    private readonly localAx: number,
    private readonly localAy: number,
    private readonly localAz: number,
    private readonly localBx: number,
    private readonly localBy: number,
    private readonly localBz: number,
    private readonly radius: number,
    private readonly transform: ReefWorldTransform,
    private readonly r0: number,
    private readonly r1: number,
    private readonly r2: number,
    private readonly r3: number,
    private readonly r4: number,
    private readonly r5: number,
    private readonly r6: number,
    private readonly r7: number,
    private readonly r8: number,
  ) {
    const [scaleX, scaleY, scaleZ] = transform.scale;
    const [tx, ty, tz] = transform.position;
    const localCenterX = (localAx + localBx) / 2;
    const localCenterY = (localAy + localBy) / 2;
    const localCenterZ = (localAz + localBz) / 2;
    this.center = [
      tx + r0 * localCenterX * scaleX + r1 * localCenterY * scaleY + r2 * localCenterZ * scaleZ,
      ty + r3 * localCenterX * scaleX + r4 * localCenterY * scaleY + r5 * localCenterZ * scaleZ,
      tz + r6 * localCenterX * scaleX + r7 * localCenterY * scaleY + r8 * localCenterZ * scaleZ,
    ];
    const ax = localBx - localAx;
    const ay = localBy - localAy;
    const az = localBz - localAz;
    this.axisX = ax;
    this.axisY = ay;
    this.axisZ = az;
    this.axisLength = Math.sqrt(ax * ax + ay * ay + az * az);
    this.distanceScale = Math.min(scaleX, scaleY, scaleZ);
    this.boundRadius = (this.axisLength / 2 + radius) * Math.max(scaleX, scaleY, scaleZ);

    // Wireframe approximation: exact horizontal cross-section, axis extended
    // by the vertical cap deficit so the drawn capsule reaches the authored
    // top/bottom. The physics below evaluates the capsule in local space.
    const worldRadius = radius * Math.max(scaleX, scaleZ);
    const worldAxisX = r0 * ax * scaleX + r1 * ay * scaleY + r2 * az * scaleZ;
    const worldAxisY = r3 * ax * scaleX + r4 * ay * scaleY + r5 * az * scaleZ;
    const worldAxisZ = r6 * ax * scaleX + r7 * ay * scaleY + r8 * az * scaleZ;
    const worldAxisLength = Math.sqrt(
      worldAxisX * worldAxisX + worldAxisY * worldAxisY + worldAxisZ * worldAxisZ,
    ) || 1;
    const verticalDeficit = Math.max(0, radius * (scaleY - Math.max(scaleX, scaleZ)));
    const extensionX = (worldAxisX / worldAxisLength) * verticalDeficit;
    const extensionY = (worldAxisY / worldAxisLength) * verticalDeficit;
    const extensionZ = (worldAxisZ / worldAxisLength) * verticalDeficit;
    const wa = this.toWorld(localAx, localAy, localAz, transform);
    const wb = this.toWorld(localBx, localBy, localBz, transform);
    this.debug = {
      kind: 'capsule',
      center: this.center,
      a: [wa[0] - extensionX, wa[1] - extensionY, wa[2] - extensionZ],
      b: [wb[0] + extensionX, wb[1] + extensionY, wb[2] + extensionZ],
      radius: worldRadius,
    };
  }

  private toWorld(
    x: number,
    y: number,
    z: number,
    transform: ReefWorldTransform,
  ): [number, number, number] {
    const [scaleX, scaleY, scaleZ] = transform.scale;
    const [tx, ty, tz] = transform.position;
    return [
      tx + this.r0 * x * scaleX + this.r1 * y * scaleY + this.r2 * z * scaleZ,
      ty + this.r3 * x * scaleX + this.r4 * y * scaleY + this.r5 * z * scaleZ,
      tz + this.r6 * x * scaleX + this.r7 * y * scaleY + this.r8 * z * scaleZ,
    ];
  }

  private toLocal(x: number, y: number, z: number, transform: ReefWorldTransform): [number, number, number] {
    const dx = x - transform.position[0];
    const dy = y - transform.position[1];
    const dz = z - transform.position[2];
    const lx = this.r0 * dx + this.r3 * dy + this.r6 * dz;
    const ly = this.r1 * dx + this.r4 * dy + this.r7 * dz;
    const lz = this.r2 * dx + this.r5 * dy + this.r8 * dz;
    return [
      lx / transform.scale[0],
      ly / transform.scale[1],
      lz / transform.scale[2],
    ];
  }

  distance(x: number, y: number, z: number): number {
    const transform = this.transform;
    const [lx, ly, lz] = this.toLocal(x, y, z, transform);
    return sdCapsule(
      lx, ly, lz,
      this.localAx, this.localAy, this.localAz,
      this.localBx, this.localBy, this.localBz,
      this.radius,
    ) * this.distanceScale;
  }

  gradient(out: Float32Array, x: number, y: number, z: number): boolean {
    const transform = this.transform;
    const [lx, ly, lz] = this.toLocal(x, y, z, transform);
    const dx = this.localBx - this.localAx;
    const dy = this.localBy - this.localAy;
    const dz = this.localBz - this.localAz;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    let t = 0;
    if (lengthSquared > 1e-12) {
      t = ((lx - this.localAx) * dx + (ly - this.localAy) * dy + (lz - this.localAz) * dz) / lengthSquared;
      t = Math.max(0, Math.min(1, t));
    }
    const px = lx - (this.localAx + dx * t);
    const py = ly - (this.localAy + dy * t);
    const pz = lz - (this.localAz + dz * t);
    let gx = px;
    let gy = py;
    let gz = pz;
    let length = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (length < 1e-6) {
      if (this.axisLength < 1e-9) return fallbackDirection(out, x, y, z, this.center);
      const axisX = this.axisX / this.axisLength;
      const axisY = this.axisY / this.axisLength;
      const axisZ = this.axisZ / this.axisLength;
      const referenceX = Math.abs(axisY) > 0.9 ? 1 : 0;
      const referenceY = Math.abs(axisY) > 0.9 ? 0 : 1;
      gx = -axisZ * referenceY;
      gy = axisZ * referenceX;
      gz = axisX * referenceY - axisY * referenceX;
      length = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (length < 1e-6) return fallbackDirection(out, x, y, z, this.center);
    }
    // Inverse-transpose of the local→world map: S⁻¹ then R.
    const sx = gx / (length * transform.scale[0]);
    const sy = gy / (length * transform.scale[1]);
    const sz = gz / (length * transform.scale[2]);
    let nx = this.r0 * sx + this.r1 * sy + this.r2 * sz;
    let ny = this.r3 * sx + this.r4 * sy + this.r5 * sz;
    let nz = this.r6 * sx + this.r7 * sy + this.r8 * sz;
    const worldLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (worldLength < 1e-9) return fallbackDirection(out, x, y, z, this.center);
    out[0] = nx / worldLength;
    out[1] = ny / worldLength;
    out[2] = nz / worldLength;
    return true;
  }
}

class WorldEllipsoid implements WorldSdfPrimitive {
  readonly kind = 'ellipsoid' as const;
  readonly center: readonly [number, number, number];
  readonly boundRadius: number;
  readonly debug: SdfPrimitiveDebugShape;

  constructor(
    private readonly cx: number,
    private readonly cy: number,
    private readonly cz: number,
    private readonly radiusX: number,
    private readonly radiusY: number,
    private readonly radiusZ: number,
    private readonly r0: number,
    private readonly r1: number,
    private readonly r2: number,
    private readonly r3: number,
    private readonly r4: number,
    private readonly r5: number,
    private readonly r6: number,
    private readonly r7: number,
    private readonly r8: number,
  ) {
    this.center = [cx, cy, cz];
    this.boundRadius = Math.max(radiusX, radiusY, radiusZ);
    this.debug = {
      kind: 'ellipsoid',
      center: this.center,
      rotation: [r0, r1, r2, r3, r4, r5, r6, r7, r8],
      radii: [radiusX, radiusY, radiusZ],
    };
  }

  distance(x: number, y: number, z: number): number {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const dz = z - this.cz;
    const lx = this.r0 * dx + this.r3 * dy + this.r6 * dz;
    const ly = this.r1 * dx + this.r4 * dy + this.r7 * dz;
    const lz = this.r2 * dx + this.r5 * dy + this.r8 * dz;
    return sdEllipsoid(lx, ly, lz, this.radiusX, this.radiusY, this.radiusZ);
  }

  gradient(out: Float32Array, x: number, y: number, z: number): boolean {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const dz = z - this.cz;
    const lx = this.r0 * dx + this.r3 * dy + this.r6 * dz;
    const ly = this.r1 * dx + this.r4 * dy + this.r7 * dz;
    const lz = this.r2 * dx + this.r5 * dy + this.r8 * dz;
    const gx = lx / (this.radiusX * this.radiusX);
    const gy = ly / (this.radiusY * this.radiusY);
    const gz = lz / (this.radiusZ * this.radiusZ);
    const length = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (length < 1e-9) return fallbackDirection(out, x, y, z, this.center);
    const inverse = 1 / length;
    const nx = gx * inverse;
    const ny = gy * inverse;
    const nz = gz * inverse;
    out[0] = this.r0 * nx + this.r1 * ny + this.r2 * nz;
    out[1] = this.r3 * nx + this.r4 * ny + this.r5 * nz;
    out[2] = this.r6 * nx + this.r7 * ny + this.r8 * nz;
    return true;
  }
}

export class ReefCollisionProxy {
  readonly boundCenter: readonly [number, number, number];
  readonly boundRadius: number;

  constructor(
    readonly id: ReefProxyId,
    readonly label: string,
    readonly anchorIndex: number,
    readonly primitives: readonly WorldSdfPrimitive[],
  ) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const primitive of this.primitives) {
      minX = Math.min(minX, primitive.center[0] - primitive.boundRadius);
      minY = Math.min(minY, primitive.center[1] - primitive.boundRadius);
      minZ = Math.min(minZ, primitive.center[2] - primitive.boundRadius);
      maxX = Math.max(maxX, primitive.center[0] + primitive.boundRadius);
      maxY = Math.max(maxY, primitive.center[1] + primitive.boundRadius);
      maxZ = Math.max(maxZ, primitive.center[2] + primitive.boundRadius);
    }
    this.boundCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    let radius = 0;
    for (const primitive of this.primitives) {
      const dx = primitive.center[0] - this.boundCenter[0];
      const dy = primitive.center[1] - this.boundCenter[1];
      const dz = primitive.center[2] - this.boundCenter[2];
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz) + primitive.boundRadius);
    }
    this.boundRadius = radius;
  }

  distance(x: number, y: number, z: number): number {
    let minimum = Infinity;
    for (let index = 0; index < this.primitives.length; index += 1) {
      const value = this.primitives[index].distance(x, y, z);
      if (value < minimum) minimum = value;
    }
    return minimum;
  }

  /** Nearest surface signed distance, writing the nearest primitive's normal. */
  query(x: number, y: number, z: number, normal: Float32Array): number {
    let minimum = Infinity;
    let nearest = 0;
    for (let index = 0; index < this.primitives.length; index += 1) {
      const value = this.primitives[index].distance(x, y, z);
      if (value < minimum) {
        minimum = value;
        nearest = index;
      }
    }
    this.primitives[nearest].gradient(normal, x, y, z);
    return minimum;
  }

  queryWithShape(
    x: number,
    y: number,
    z: number,
    normal: Float32Array,
  ): { distance: number; shapeIndex: number } {
    let minimum = Infinity;
    let nearest = 0;
    for (let index = 0; index < this.primitives.length; index += 1) {
      const value = this.primitives[index].distance(x, y, z);
      if (value < minimum) {
        minimum = value;
        nearest = index;
      }
    }
    this.primitives[nearest].gradient(normal, x, y, z);
    return { distance: minimum, shapeIndex: nearest };
  }
}

export interface ReefProxyQueryResult {
  index: number;
  id: ReefProxyId | null;
  anchorIndex: number;
  distance: number;
  shapeIndex: number;
  readonly normal: Float32Array;
}

export function createReefProxyQueryResult(): ReefProxyQueryResult {
  return {
    index: -1,
    id: null,
    anchorIndex: -1,
    distance: Infinity,
    shapeIndex: -1,
    normal: new Float32Array(3),
  };
}

export class ReefProxySet {
  constructor(readonly proxies: readonly ReefCollisionProxy[]) {}

  get(index: number): ReefCollisionProxy {
    return this.proxies[index];
  }

  /** Nearest proxy surface across the five reefs; false when the set is empty. */
  queryNearest(x: number, y: number, z: number, result: ReefProxyQueryResult): boolean {
    let minimum = Infinity;
    let nearest = -1;
    let nearestShape = -1;
    const normal = result.normal;
    let nx = 1;
    let ny = 0;
    let nz = 0;
    for (let index = 0; index < this.proxies.length; index += 1) {
      const proxy = this.proxies[index];
      const hit = proxy.queryWithShape(x, y, z, normal);
      if (hit.distance < minimum) {
        minimum = hit.distance;
        nearest = index;
        nearestShape = hit.shapeIndex;
        nx = normal[0];
        ny = normal[1];
        nz = normal[2];
      }
    }
    if (nearest < 0) {
      result.index = -1;
      result.id = null;
      result.anchorIndex = -1;
      result.distance = Infinity;
      result.shapeIndex = -1;
      return false;
    }
    result.index = nearest;
    result.id = this.proxies[nearest].id;
    result.anchorIndex = this.proxies[nearest].anchorIndex;
    result.distance = minimum;
    result.shapeIndex = nearestShape;
    normal[0] = nx;
    normal[1] = ny;
    normal[2] = nz;
    return true;
  }
}

function localPoint(fraction: Vec3Fraction, localSize: readonly [number, number, number]): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: fraction[0] * (localSize[0] / 2),
    y: fraction[1] * localSize[1],
    z: fraction[2] * (localSize[2] / 2),
  };
}

function buildPrimitive(
  spec: ReefProxyShapeSpec,
  transform: ReefWorldTransform,
  rotation: Float64Array,
): WorldSdfPrimitive {
  const [scaleX, scaleY, scaleZ] = transform.scale;
  const [positionX, positionY, positionZ] = transform.position;
  const localSize = transform.localSize;
  const r0 = rotation[0];
  const r1 = rotation[1];
  const r2 = rotation[2];
  const r3 = rotation[3];
  const r4 = rotation[4];
  const r5 = rotation[5];
  const r6 = rotation[6];
  const r7 = rotation[7];
  const r8 = rotation[8];
  const toWorld = (localX: number, localY: number, localZ: number): [number, number, number] => {
    const sx = localX * scaleX;
    const sy = localY * scaleY;
    const sz = localZ * scaleZ;
    return [
      positionX + r0 * sx + r1 * sy + r2 * sz,
      positionY + r3 * sx + r4 * sy + r5 * sz,
      positionZ + r6 * sx + r7 * sy + r8 * sz,
    ];
  };

  if (spec.kind === 'roundedBox') {
    const center = localPoint(spec.center, localSize);
    const [cx, cy, cz] = toWorld(center.x, center.y, center.z);
    const halfX = spec.half[0] * (localSize[0] / 2) * scaleX;
    const halfY = spec.half[1] * localSize[1] * scaleY;
    const halfZ = spec.half[2] * (localSize[2] / 2) * scaleZ;
    const rounding = spec.rounding * localSize[1] * Math.max(scaleX, scaleY, scaleZ);
    return new WorldRoundedBox(cx, cy, cz, halfX, halfY, halfZ, rounding, r0, r1, r2, r3, r4, r5, r6, r7, r8);
  }

  if (spec.kind === 'capsule') {
    const a = localPoint(spec.a, localSize);
    const b = localPoint(spec.b, localSize);
    const radius = spec.radius * localSize[1];
    return new WorldScaledCapsule(
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      radius,
      transform,
      r0, r1, r2, r3, r4, r5, r6, r7, r8,
    );
  }

  const center = localPoint(spec.center, localSize);
  const [cx, cy, cz] = toWorld(center.x, center.y, center.z);
  const radiusX = spec.radii[0] * (localSize[0] / 2) * scaleX;
  const radiusY = spec.radii[1] * localSize[1] * scaleY;
  const radiusZ = spec.radii[2] * (localSize[2] / 2) * scaleZ;
  return new WorldEllipsoid(cx, cy, cz, radiusX, radiusY, radiusZ, r0, r1, r2, r3, r4, r5, r6, r7, r8);
}

export function buildReefCollisionProxy(
  transform: ReefWorldTransform,
  spec?: ReefProxySpec,
): ReefCollisionProxy {
  const proxySpec = spec ?? REEF_PROXY_SPECS.find((candidate) => candidate.id === transform.id);
  if (!proxySpec) throw new Error(`No proxy spec for reef ${transform.id}`);
  const rotation = new Float64Array(9);
  eulerYXZMatrix(transform.yaw, transform.tiltX, transform.tiltZ, rotation);
  const primitives = proxySpec.shapes.map((shape) => buildPrimitive(shape, transform, rotation));
  return new ReefCollisionProxy(proxySpec.id, proxySpec.label, proxySpec.anchorIndex, primitives);
}

/** Build the full set; transform order is preserved for stable indices. */
export function buildReefProxySet(transforms: readonly ReefWorldTransform[]): ReefProxySet {
  const proxies = transforms.map((transform) => buildReefCollisionProxy(transform));
  return new ReefProxySet(proxies);
}

/** Convenience for tests and the measure script: measured local size lookup. */
export function measuredLocalSize(id: ReefProxyId): readonly [number, number, number] {
  return REEF_NEAR_LOCAL_SIZE[id];
}

/** Exported only so tests can check the analytic-vs-finite-difference agreement. */
export function numericNormal(
  proxy: ReefCollisionProxy,
  x: number,
  y: number,
  z: number,
  epsilon: number,
  out: Float32Array,
): boolean {
  return centralDifferenceNormal(
    (px, py, pz) => proxy.distance(px, py, pz),
    x,
    y,
    z,
    epsilon,
    out,
  );
}
