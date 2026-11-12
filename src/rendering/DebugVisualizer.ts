import {
  ArrowHelper,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { SimulationWorld } from '../simulation/SimulationWorld';

export type DebugLayer = 'neighbors' | 'vectors' | 'forces' | 'predator' | 'escape';
export type DebugVisibility = Record<DebugLayer, boolean>;

const UP = new Vector3(0, 1, 0);
const MAX_NEIGHBOR_LINKS = 24;
const COLORS = {
  velocity: 0xd7eef0,
  separation: 0xe49a68,
  alignment: 0x70c8d0,
  cohesion: 0xa9c79b,
  escape: 0xffb07d,
} as const;

function makeArrow(color: number): ArrowHelper {
  const arrow = new ArrowHelper(UP, new Vector3(), 1, color, 0.24, 0.12);
  arrow.visible = false;
  for (const object of [arrow.line, arrow.cone]) {
    const material = object.material as LineBasicMaterial | MeshBasicMaterial;
    material.depthTest = false;
    material.transparent = true;
    material.opacity = 0.9;
  }
  arrow.renderOrder = 8;
  return arrow;
}

/** Read-only visualization of telemetry captured during the ordinary boid step. */
export class DebugVisualizer {
  readonly group = new Group();
  private readonly neighborLines: LineSegments;
  private readonly perception: Mesh;
  private readonly targetLine: LineSegments;
  private readonly velocity = makeArrow(COLORS.velocity);
  private readonly separation = makeArrow(COLORS.separation);
  private readonly alignment = makeArrow(COLORS.alignment);
  private readonly cohesion = makeArrow(COLORS.cohesion);
  private readonly escape = makeArrow(COLORS.escape);
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly endpoint = new Vector3();
  private laboratory = false;
  private selectedIndex = -1;
  private manualIndex = -1;
  private readonly visibility: DebugVisibility = {
    neighbors: false,
    vectors: false,
    forces: false,
    predator: false,
    escape: false,
  };

  constructor(scene: Scene) {
    this.group.name = 'laboratoryDebug';
    this.group.visible = false;

    this.neighborLines = new LineSegments(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)),
      new LineBasicMaterial({ color: 0x8bc7cf, transparent: true, opacity: 0.24, depthTest: false }),
    );
    this.neighborLines.frustumCulled = false;
    this.neighborLines.renderOrder = 7;
    this.group.add(this.neighborLines);

    this.perception = new Mesh(
      new SphereGeometry(1, 16, 10),
      new MeshBasicMaterial({ color: 0x70c8d0, wireframe: true, transparent: true, opacity: 0.10, depthTest: false }),
    );
    this.perception.renderOrder = 6;
    this.group.add(this.perception);

    this.targetLine = new LineSegments(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)),
      new LineBasicMaterial({ color: 0xe49a68, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.targetLine.frustumCulled = false;
    this.targetLine.renderOrder = 8;
    this.group.add(this.targetLine);

    this.group.add(this.velocity, this.separation, this.alignment, this.cohesion, this.escape);
    scene.add(this.group);
  }

  setLaboratoryMode(enabled: boolean): void {
    this.laboratory = enabled;
    this.group.visible = enabled;
  }

  setLayer(layer: DebugLayer, visible: boolean): void {
    this.visibility[layer] = visible;
  }

  getLayerVisibility(): DebugVisibility {
    return { ...this.visibility };
  }

  getSampleIndex(): number {
    return this.selectedIndex;
  }

  /** Pin the inspected fish (experiment captures); pass -1 to clear. */
  setManualSampleIndex(index: number): void {
    this.manualIndex = index;
  }

  update(world: SimulationWorld, alpha: number): void {
    this.group.visible = this.laboratory;
    if (!this.laboratory) return;

    this.selectedIndex = this.chooseSampleFish(world);
    world.boids.debugFishIndex = this.selectedIndex;
    const sample = world.boids.debugSample;
    const hasCurrentSample = sample.index === this.selectedIndex && this.selectedIndex >= 0;
    const hasFish = this.selectedIndex >= 0 && world.flock.alive[this.selectedIndex] === 1;

    this.neighborLines.visible = hasCurrentSample && this.visibility.neighbors && sample.neighborCount > 0;
    this.perception.visible = hasFish && this.visibility.neighbors;
    this.velocity.visible = hasFish && this.visibility.vectors;
    this.separation.visible = hasCurrentSample && this.visibility.forces;
    this.alignment.visible = this.separation.visible;
    this.cohesion.visible = this.separation.visible;
    this.escape.visible = hasCurrentSample && this.visibility.escape && Math.hypot(...sample.escape) > 1e-5;

    if (!hasFish) {
      this.targetLine.visible = false;
      return;
    }

    const offset = this.selectedIndex * 3;
    this.origin.set(
      world.flock.previousPositions[offset] + (world.flock.positions[offset] - world.flock.previousPositions[offset]) * alpha,
      world.flock.previousPositions[offset + 1] + (world.flock.positions[offset + 1] - world.flock.previousPositions[offset + 1]) * alpha,
      world.flock.previousPositions[offset + 2] + (world.flock.positions[offset + 2] - world.flock.previousPositions[offset + 2]) * alpha,
    );
    this.perception.position.copy(this.origin);
    this.perception.scale.setScalar(Math.max(
      world.config.separationRadius,
      world.config.alignmentRadius,
      world.config.cohesionRadius,
    ));

    if (this.neighborLines.visible) this.updateNeighborLines(world, sample.neighbors, sample.neighborCount);
    if (this.velocity.visible) {
      this.direction.set(
        world.flock.velocities[offset],
        world.flock.velocities[offset + 1],
        world.flock.velocities[offset + 2],
      );
      this.setArrow(this.velocity, this.direction, Math.min(3.4, Math.max(0.8, this.direction.length() * 0.48)));
    }
    if (hasCurrentSample && this.visibility.forces) {
      this.setArrow(this.separation, this.direction.fromArray(sample.separation), 2.1);
      this.setArrow(this.alignment, this.direction.fromArray(sample.alignment), 2.7);
      this.setArrow(this.cohesion, this.direction.fromArray(sample.cohesion), 3.3);
    }
    if (this.escape.visible) this.setArrow(this.escape, this.direction.fromArray(sample.escape), 3.8);
    this.updatePredatorTarget(world, alpha, offset);
  }

  private chooseSampleFish(world: SimulationWorld): number {
    if (this.manualIndex >= 0 && world.flock.alive[this.manualIndex] === 1) {
      return this.manualIndex;
    }
    const predatorTarget = world.predator.targetIndex;
    if (predatorTarget >= 0 && world.flock.alive[predatorTarget] === 1) return predatorTarget;
    if (this.selectedIndex >= 0 && world.flock.alive[this.selectedIndex] === 1) return this.selectedIndex;
    for (let index = 0; index < world.flock.count; index += 1) {
      if (world.flock.alive[index] === 1) return index;
    }
    return -1;
  }

  private setArrow(arrow: ArrowHelper, vector: Vector3, length: number): void {
    arrow.position.copy(this.origin);
    if (vector.lengthSq() < 1e-8) {
      arrow.visible = false;
      return;
    }
    arrow.setDirection(vector.normalize());
    arrow.setLength(length, Math.min(0.28, length * 0.18), 0.13);
  }

  private updateNeighborLines(world: SimulationWorld, neighbors: Int32Array, count: number): void {
    const nearest = Array.from(neighbors.subarray(0, count));
    const offset = this.selectedIndex * 3;
    const px = world.flock.positions[offset];
    const py = world.flock.positions[offset + 1];
    const pz = world.flock.positions[offset + 2];
    nearest.sort((a, b) => {
      const aOffset = a * 3;
      const bOffset = b * 3;
      const aDistance = (world.flock.positions[aOffset] - px) ** 2
        + (world.flock.positions[aOffset + 1] - py) ** 2
        + (world.flock.positions[aOffset + 2] - pz) ** 2;
      const bDistance = (world.flock.positions[bOffset] - px) ** 2
        + (world.flock.positions[bOffset + 1] - py) ** 2
        + (world.flock.positions[bOffset + 2] - pz) ** 2;
      return aDistance - bDistance;
    });
    const shown = Math.min(MAX_NEIGHBOR_LINKS, nearest.length);
    const positions = new Float32Array(shown * 6);
    for (let index = 0; index < shown; index += 1) {
      const otherOffset = nearest[index] * 3;
      const cursor = index * 6;
      positions[cursor] = this.origin.x;
      positions[cursor + 1] = this.origin.y;
      positions[cursor + 2] = this.origin.z;
      positions[cursor + 3] = world.flock.positions[otherOffset];
      positions[cursor + 4] = world.flock.positions[otherOffset + 1];
      positions[cursor + 5] = world.flock.positions[otherOffset + 2];
    }
    this.neighborLines.geometry.dispose();
    this.neighborLines.geometry = new BufferGeometry();
    this.neighborLines.geometry.setAttribute('position', new BufferAttribute(positions, 3));
  }

  private updatePredatorTarget(world: SimulationWorld, alpha: number, fishOffset: number): void {
    const target = world.predator.targetIndex;
    this.targetLine.visible = this.visibility.predator && world.config.predatorEnabled
      && target >= 0 && target * 3 === fishOffset;
    if (!this.targetLine.visible) return;
    this.endpoint.set(
      world.predator.previousPosition[0] + (world.predator.position[0] - world.predator.previousPosition[0]) * alpha,
      world.predator.previousPosition[1] + (world.predator.position[1] - world.predator.previousPosition[1]) * alpha,
      world.predator.previousPosition[2] + (world.predator.position[2] - world.predator.previousPosition[2]) * alpha,
    );
    const attribute = this.targetLine.geometry.getAttribute('position') as BufferAttribute;
    attribute.setXYZ(0, this.endpoint.x, this.endpoint.y, this.endpoint.z);
    attribute.setXYZ(1, this.origin.x, this.origin.y, this.origin.z);
    attribute.needsUpdate = true;
    this.targetLine.geometry.computeBoundingSphere();
  }
}
