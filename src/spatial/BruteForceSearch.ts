import type { FlockData } from '../simulation/FlockData';
import type { NeighborSearch } from './NeighborSearch';

export class BruteForceSearch implements NeighborSearch {
  readonly mode = 'brute-force' as const;
  candidatesExamined = 0;
  private flock: FlockData | null = null;

  rebuild(flock: FlockData, _radius?: number): void {
    this.flock = flock;
    this.candidatesExamined = 0;
  }

  collect(index: number, radius: number, output: Int32Array): number {
    const flock = this.flock;
    if (!flock) throw new Error('BruteForceSearch.collect called before rebuild.');
    const { positions, alive, count } = flock;
    const offset = index * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const radiusSquared = radius * radius;
    let found = 0;

    for (let other = 0; other < count; other += 1) {
      if (other === index || alive[other] === 0) continue;
      this.candidatesExamined += 1;
      const otherOffset = other * 3;
      const dx = positions[otherOffset] - x;
      const dy = positions[otherOffset + 1] - y;
      const dz = positions[otherOffset + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= radiusSquared) {
        output[found] = other;
        found += 1;
      }
    }
    return found;
  }
}
