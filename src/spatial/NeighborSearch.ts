import type { FlockData } from '../simulation/FlockData';
import type { NeighborSearchMode } from '../simulation/SimulationConfig';

export interface NeighborSearch {
  readonly mode: NeighborSearchMode;
  candidatesExamined: number;
  rebuild(flock: FlockData, radius: number): void;
  collect(index: number, radius: number, output: Int32Array): number;
}
