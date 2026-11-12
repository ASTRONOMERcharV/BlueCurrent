/**
 * Signed distance primitives for the reef collision proxies.
 *
 * Convention: positive outside, zero on the surface, negative inside.
 * All functions are pure and allocation-free so they can run per fish per step.
 *
 * The primitive distance functions are the standard Inigo Quilez formulations.
 * Analytic surface normals live with the world-space primitive objects in
 * `ReefCollisionProxy.ts`; `centralDifferenceNormal` is the documented fallback
 * for any primitive whose analytic gradient degenerates.
 */

export type SdfFunction = (x: number, y: number, z: number) => number;

/** Write `(x,y,z)` normalized into `out`; returns the original length. */
export function normalizeInto(out: Float32Array, x: number, y: number, z: number): number {
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length > 1e-12) {
    const inverse = 1 / length;
    out[0] = x * inverse;
    out[1] = y * inverse;
    out[2] = z * inverse;
  } else {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
  }
  return length;
}

export function sdSphere(x: number, y: number, z: number, radius: number): number {
  return Math.sqrt(x * x + y * y + z * z) - radius;
}

/**
 * Rounded box centered on the origin, axis aligned, `half*` are the inner box
 * half extents and `rounding` inflates every face/edge/corner. Total half extent
 * is `half + rounding`. Rounding may exceed a half extent: thin slabs then take
 * a capsule-like profile, which is exactly what the reef base slabs need.
 */
export function sdRoundedBox(
  x: number,
  y: number,
  z: number,
  halfX: number,
  halfY: number,
  halfZ: number,
  rounding: number,
): number {
  const radius = Math.max(0, rounding);
  const qx = Math.abs(x) - halfX;
  const qy = Math.abs(y) - halfY;
  const qz = Math.abs(z) - halfZ;
  const outside = Math.sqrt(
    Math.max(qx, 0) * Math.max(qx, 0)
    + Math.max(qy, 0) * Math.max(qy, 0)
    + Math.max(qz, 0) * Math.max(qz, 0),
  );
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return outside + inside - radius;
}

/** Capsule between points a and b with a spherical radius. */
export function sdCapsule(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lengthSquared > 1e-12) {
    t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const closestX = ax + dx * t;
  const closestY = ay + dy * t;
  const closestZ = az + dz * t;
  const px = x - closestX;
  const py = y - closestY;
  const pz = z - closestZ;
  return Math.sqrt(px * px + py * py + pz * pz) - radius;
}

/**
 * Approximate ellipsoid distance (IQ's k0/k1 form). Exact at the surface and
 * positive/negative in the right regions; the magnitude away from the surface
 * is approximate, which is acceptable for avoidance forces.
 */
export function sdEllipsoid(
  x: number,
  y: number,
  z: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
): number {
  const rx = Math.max(radiusX, 1e-4);
  const ry = Math.max(radiusY, 1e-4);
  const rz = Math.max(radiusZ, 1e-4);
  const qx = x / rx;
  const qy = y / ry;
  const qz = z / rz;
  const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const k1 = Math.sqrt(
    (qx / rx) * (qx / rx) + (qy / ry) * (qy / ry) + (qz / rz) * (qz / rz),
  );
  if (k1 < 1e-12) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

/** Union distance of any number of primitives: the nearest surface wins. */
export function unionDistance(...distances: number[]): number {
  let minimum = Infinity;
  for (let index = 0; index < distances.length; index += 1) {
    if (distances[index] < minimum) minimum = distances[index];
  }
  return minimum;
}

/**
 * Central-difference normal fallback. Returns false when the sampled field is
 * flat (all probes equal), leaving `out` as a safe +X direction.
 */
export function centralDifferenceNormal(
  sdf: SdfFunction,
  x: number,
  y: number,
  z: number,
  epsilon: number,
  out: Float32Array,
): boolean {
  const step = Math.max(epsilon, 1e-5);
  const inverse = 0.5 / step;
  const gx = (sdf(x + step, y, z) - sdf(x - step, y, z)) * inverse;
  const gy = (sdf(x, y + step, z) - sdf(x, y - step, z)) * inverse;
  const gz = (sdf(x, y, z + step) - sdf(x, y, z - step)) * inverse;
  const length = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (length < 1e-6) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    return false;
  }
  const inverseLength = 1 / length;
  out[0] = gx * inverseLength;
  out[1] = gy * inverseLength;
  out[2] = gz * inverseLength;
  return true;
}
