import type { FlockData } from '../simulation/FlockData';
import type { SimulationConfig } from '../simulation/SimulationConfig';
import { clamp } from '../simulation/math';
import type { NeighborSearch } from './NeighborSearch';

/** Linked-cell 3D grid. With cellSize >= query radius, 27 cells are sufficient. */
export class UniformGrid3D implements NeighborSearch {
  readonly mode = 'grid' as const;
  candidatesExamined = 0;
  cellSize = 1;
  occupiedCellCount = 0;
  readonly dimensions: [number, number, number] = [1, 1, 1];

  private readonly min: readonly [number, number, number];
  private readonly max: readonly [number, number, number];
  private readonly capacity: number;
  private flock: FlockData | null = null;
  private cellStart = new Int32Array(1);
  private cellCounts = new Int32Array(1);
  private writeCursor = new Int32Array(1);
  private cellItems: Int32Array;
  private cellOf: Int32Array;
  private marks = new Uint8Array(1);

  constructor(config: SimulationConfig, capacity: number) {
    this.min = config.bounds.min;
    this.max = config.bounds.max;
    this.capacity = capacity;
    this.cellItems = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  rebuild(flock: FlockData, radius: number): void {
    this.flock = flock;
    this.candidatesExamined = 0;
    this.cellSize = Math.max(0.001, radius);
    const cellSize = this.cellSize;
    const dimX = Math.max(1, Math.ceil((this.max[0] - this.min[0]) / cellSize));
    const dimY = Math.max(1, Math.ceil((this.max[1] - this.min[1]) / cellSize));
    const dimZ = Math.max(1, Math.ceil((this.max[2] - this.min[2]) / cellSize));
    this.dimensions[0] = dimX;
    this.dimensions[1] = dimY;
    this.dimensions[2] = dimZ;
    const cellCount = dimX * dimY * dimZ;

    if (this.cellStart.length !== cellCount + 1) {
      this.cellStart = new Int32Array(cellCount + 1);
      this.cellCounts = new Int32Array(cellCount);
      this.writeCursor = new Int32Array(cellCount);
      this.marks = new Uint8Array(cellCount);
    }
    if (this.cellItems.length < this.capacity) this.cellItems = new Int32Array(this.capacity);
    if (this.cellOf.length < this.capacity) this.cellOf = new Int32Array(this.capacity);
    const cellStart = this.cellStart;
    const cellCounts = this.cellCounts;
    const writeCursor = this.writeCursor;
    const cellItems = this.cellItems;
    const cellOf = this.cellOf;
    const marks = this.marks;
    const minX = this.min[0];
    const minY = this.min[1];
    const minZ = this.min[2];
    const positions = flock.positions;
    const alive = flock.alive;
    cellCounts.fill(0);
    marks.fill(0);
    this.occupiedCellCount = 0;

    for (let i = 0; i < flock.count; i += 1) {
      if (alive[i] === 0) continue;
      const offset = i * 3;
      const cx = clamp(Math.floor((positions[offset] - minX) / cellSize), 0, dimX - 1);
      const cy = clamp(Math.floor((positions[offset + 1] - minY) / cellSize), 0, dimY - 1);
      const cz = clamp(Math.floor((positions[offset + 2] - minZ) / cellSize), 0, dimZ - 1);
      const cellIndex = cx + dimX * (cy + dimY * cz);
      cellOf[i] = cellIndex;
      cellCounts[cellIndex] += 1;
      if (marks[cellIndex] === 0) {
        marks[cellIndex] = 1;
        this.occupiedCellCount += 1;
      }
    }

    let cursor = 0;
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      cellStart[cellIndex] = cursor;
      writeCursor[cellIndex] = cursor;
      cursor += cellCounts[cellIndex];
    }
    cellStart[cellCount] = cursor;

    for (let i = 0; i < flock.count; i += 1) {
      if (alive[i] === 0) continue;
      const cellIndex = cellOf[i];
      cellItems[writeCursor[cellIndex]] = i;
      writeCursor[cellIndex] += 1;
    }
  }

  collect(index: number, radius: number, output: Int32Array): number {
    const flock = this.flock;
    if (!flock) throw new Error('UniformGrid3D.collect called before rebuild.');
    if (radius > this.cellSize + 1e-9) {
      throw new Error(`Query radius ${radius} exceeds grid cell size ${this.cellSize}.`);
    }

    const { positions } = flock;
    const offset = index * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const radiusSquared = radius * radius;
    const cellSize = this.cellSize;
    const nx = this.dimensions[0];
    const ny = this.dimensions[1];
    const nz = this.dimensions[2];
    const cx = clamp(Math.floor((x - this.min[0]) / cellSize), 0, nx - 1);
    const cy = clamp(Math.floor((y - this.min[1]) / cellSize), 0, ny - 1);
    const cz = clamp(Math.floor((z - this.min[2]) / cellSize), 0, nz - 1);
    const cellStart = this.cellStart;
    const cellCounts = this.cellCounts;
    const cellItems = this.cellItems;
    let found = 0;
    let candidates = 0;

    for (let dz = -1; dz <= 1; dz += 1) {
      const gz = cz + dz;
      if (gz < 0 || gz >= nz) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const gy = cy + dy;
        if (gy < 0 || gy >= ny) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const gx = cx + dx;
          if (gx < 0 || gx >= nx) continue;
          const cellIndex = gx + nx * (gy + ny * gz);
          const start = cellStart[cellIndex];
          const end = start + cellCounts[cellIndex];
          candidates += end - start;
          for (let item = start; item < end; item += 1) {
            const other = cellItems[item];
            // The grid is rebuilt immediately before each Boid pass, so the
            // alive set is fixed here; dead fish cannot enter the lists.
            if (other !== index) {
              const otherOffset = other * 3;
              const ox = positions[otherOffset] - x;
              const oy = positions[otherOffset + 1] - y;
              const oz = positions[otherOffset + 2] - z;
              if (ox * ox + oy * oy + oz * oz <= radiusSquared) {
                output[found] = other;
                found += 1;
              }
            }
          }
        }
      }
    }
    this.candidatesExamined += candidates;
    return found;
  }

  /** Actual occupied-cell wireframes for the debug view; no synthetic grid data. */
  occupiedCellCorners(maximumCells = 1200): { positions: Float32Array; count: number } {
    const [nx, ny, nz] = this.dimensions;
    const corners: number[] = [];
    let count = 0;
    for (let z = 0; z < nz && count < maximumCells; z += 1) {
      for (let y = 0; y < ny && count < maximumCells; y += 1) {
        for (let x = 0; x < nx && count < maximumCells; x += 1) {
          if (this.marks[x + nx * (y + ny * z)] === 0) continue;
          corners.push(
            this.min[0] + x * this.cellSize,
            this.min[1] + y * this.cellSize,
            this.min[2] + z * this.cellSize,
          );
          count += 1;
        }
      }
    }
    return { positions: new Float32Array(corners), count };
  }
}
