export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function length3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function limitVector(vector: Float32Array, offset: number, maximum: number): void {  const x = vector[offset];
  const y = vector[offset + 1];
  const z = vector[offset + 2];
  const lengthSquared = x * x + y * y + z * z;
  if (lengthSquared > maximum * maximum && lengthSquared > 0) {
    const scale = maximum / Math.sqrt(lengthSquared);
    vector[offset] = x * scale;
    vector[offset + 1] = y * scale;
    vector[offset + 2] = z * scale;
  }
}

/**
 * Limit the per-step direction change while preserving the new speed.
 * Returns the clamped vector in out[0..2].
 */
export function clampVelocityTurn(
  vx: number,
  vy: number,
  vz: number,
  nextX: number,
  nextY: number,
  nextZ: number,
  maximumTurnRate: number,
  delta: number,
  out: Float32Array,
): void {
  out[0] = nextX;
  out[1] = nextY;
  out[2] = nextZ;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const nextSpeed = Math.sqrt(nextX * nextX + nextY * nextY + nextZ * nextZ);
  if (!(maximumTurnRate > 0) || !Number.isFinite(maximumTurnRate) || speed < 1e-5 || nextSpeed < 1e-5) {
    return;
  }
  const oldX = vx / speed;
  const oldY = vy / speed;
  const oldZ = vz / speed;
  const newX = nextX / nextSpeed;
  const newY = nextY / nextSpeed;
  const newZ = nextZ / nextSpeed;
  const cosine = Math.max(-1, Math.min(1, oldX * newX + oldY * newY + oldZ * newZ));
  const maximumAngle = Math.max(0, maximumTurnRate * delta);
  const cosineLimit = Math.cos(maximumAngle);
  if (cosine >= cosineLimit) return;

  const perpendicularX = newX - oldX * cosine;
  const perpendicularY = newY - oldY * cosine;
  const perpendicularZ = newZ - oldZ * cosine;
  const perpendicularLength = Math.sqrt(
    perpendicularX * perpendicularX
    + perpendicularY * perpendicularY
    + perpendicularZ * perpendicularZ,
  );
  if (perpendicularLength < 1e-8) return;
  const sine = Math.sin(maximumAngle);
  const perpendicularScale = sine / perpendicularLength;
  out[0] = (
    oldX * cosineLimit + perpendicularX * perpendicularScale
  ) * nextSpeed;
  out[1] = (
    oldY * cosineLimit + perpendicularY * perpendicularScale
  ) * nextSpeed;
  out[2] = (
    oldZ * cosineLimit + perpendicularZ * perpendicularScale
  ) * nextSpeed;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  reset(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }
}
