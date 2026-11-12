import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Scene } from 'three';
import type { UniformGrid3D } from '../spatial/UniformGrid3D';

const EDGES: readonly [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export class GridVisualizer {
  private readonly lines: LineSegments;

  constructor(scene: Scene) {
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({
      color: 0x80e9d9,
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  setVisible(visible: boolean): void {
    this.lines.visible = visible;
  }

  update(grid: UniformGrid3D): void {
    if (!this.lines.visible) return;
    const { positions, count } = grid.occupiedCellCorners(700);
    const vertices = new Float32Array(count * EDGES.length * 2 * 3);
    let cursor = 0;
    const size = grid.cellSize;
    for (let cell = 0; cell < count; cell += 1) {
      const x = positions[cell * 3];
      const y = positions[cell * 3 + 1];
      const z = positions[cell * 3 + 2];
      for (const [a, b] of EDGES) {
        for (const corner of [a, b]) {
          vertices[cursor++] = x + (corner & 1) * size;
          vertices[cursor++] = y + ((corner >> 1) & 1) * size;
          vertices[cursor++] = z + ((corner >> 2) & 1) * size;
        }
      }
    }
    this.lines.geometry.dispose();
    this.lines.geometry = new BufferGeometry();
    this.lines.geometry.setAttribute('position', new BufferAttribute(vertices, 3));
  }
}
