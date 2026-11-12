import {
  ArrowHelper,
  CapsuleGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SimulationWorld } from '../simulation/SimulationWorld';
import type {
  ReefCollisionProxy,
  ReefProxySet,
  WorldSdfPrimitive,
} from '../simulation/ReefCollisionProxy';
import { createReefProxyQueryResult } from '../simulation/ReefCollisionProxy';

export type CollisionDebugLayer = 'proxy' | 'margin' | 'sdf' | 'penetration';
export type CollisionDebugVisibility = Record<CollisionDebugLayer, boolean>;

export interface CollisionSelectedInfo {
  readonly active: boolean;
  readonly reefId: string | null;
  readonly signedDistance: number;
  readonly clearance: number;
  readonly inside: boolean;
  readonly penetratingFish: number;
}

const MAX_PENETRATION_MARKERS = 256;
const UP = new Vector3(0, 1, 0);
const PROXY_COLOR = 0x74d6e2;
const MARGIN_COLOR = 0xffb07d;
const PENETRATION_COLOR = 0xff5c5c;

function makeLineMaterial(color: number, opacity: number): LineBasicMaterial {
  return new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
}

function makeShellMaterial(color: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * Laboratory-only wireframes for the SDF collider. Nothing here is added to
 * the observation scene: the group is hidden unless Laboratory mode and the
 * matching layer are on. Mesh geometry is derived from the same world-space
 * primitive data the avoidance queries use, so the picture cannot drift from
 * the physics.
 */
export class CollisionDebugVisualizer {
  readonly group = new Group();
  private readonly proxyGroup = new Group();
  private readonly marginGroup = new Group();
  private readonly proxyMaterial = makeLineMaterial(PROXY_COLOR, 0.9);
  private readonly marginMaterial = makeShellMaterial(MARGIN_COLOR, 0.07);
  private readonly marginEdgeMaterial = makeLineMaterial(MARGIN_COLOR, 0.22);
  private readonly penetrationMaterial = new MeshBasicMaterial({
    color: PENETRATION_COLOR,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  private readonly markers: InstancedMesh;
  private readonly selectedMarker: Mesh;
  private readonly normalArrow: ArrowHelper;
  private readonly query = createReefProxyQueryResult();
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly rotationMatrix = new Matrix4();
  private currentSet?: ReefProxySet;
  private laboratory = false;
  private selected: CollisionSelectedInfo = {
    active: false,
    reefId: null,
    signedDistance: Number.NaN,
    clearance: Number.NaN,
    inside: false,
    penetratingFish: 0,
  };
  private readonly visibility: CollisionDebugVisibility = {
    proxy: true,
    margin: false,
    sdf: true,
    penetration: true,
  };

  constructor(scene: Scene) {
    this.group.name = 'collisionDebug';
    this.group.visible = false;
    this.proxyGroup.name = 'collisionDebugProxy';
    this.marginGroup.name = 'collisionDebugMargin';
    this.group.add(this.proxyGroup, this.marginGroup);

    this.markers = new InstancedMesh(
      new OctahedronGeometry(0.24, 0),
      this.penetrationMaterial,
      MAX_PENETRATION_MARKERS,
    );
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 10;
    this.markers.count = 0;
    this.group.add(this.markers);

    this.selectedMarker = new Mesh(
      new SphereGeometry(0.16, 10, 8),
      new MeshBasicMaterial({ color: 0xffe08a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 }),
    );
    this.selectedMarker.renderOrder = 10;
    this.selectedMarker.visible = false;
    this.group.add(this.selectedMarker);

    this.normalArrow = new ArrowHelper(UP, new Vector3(), 1.4, 0xffe08a, 0.28, 0.14);
    for (const object of [this.normalArrow.line, this.normalArrow.cone]) {
      const material = object.material as LineBasicMaterial | MeshBasicMaterial;
      material.depthTest = false;
      material.transparent = true;
      material.opacity = 0.95;
    }
    this.normalArrow.renderOrder = 10;
    this.normalArrow.visible = false;
    this.group.add(this.normalArrow);

    scene.add(this.group);
  }

  setLaboratoryMode(enabled: boolean): void {
    this.laboratory = enabled;
    this.group.visible = enabled;
  }

  setLayer(layer: CollisionDebugLayer, visible: boolean): void {
    this.visibility[layer] = visible;
  }

  getLayerVisibility(): CollisionDebugVisibility {
    return { ...this.visibility };
  }

  getSelectedInfo(): CollisionSelectedInfo {
    return this.selected;
  }

  update(world: SimulationWorld, alpha: number): void {
    const proxySet = world.obstacles.getProxySet();
    if (proxySet !== this.currentSet) {
      this.rebuild(proxySet);
    }
    this.group.visible = this.laboratory;
    if (!this.laboratory) return;
    this.proxyGroup.visible = this.visibility.proxy;
    this.marginGroup.visible = this.visibility.margin;

    this.updatePenetration(world, proxySet);
    this.updateSelected(world, proxySet, alpha);
  }

  private rebuild(set?: ReefProxySet): void {
    this.currentSet = set;
    for (const group of [this.proxyGroup, this.marginGroup]) {
      for (const child of [...group.children]) {
        group.remove(child);
        this.disposeGeometry(child);
      }
    }
    if (!set) return;
    const margin = this.margin;
    for (const proxy of set.proxies) {
      this.proxyGroup.add(...this.buildProxyEdges(proxy, 0, this.proxyMaterial));
      this.marginGroup.add(...this.buildProxyEdges(proxy, margin, this.marginEdgeMaterial));
      this.marginGroup.add(...this.buildMarginShells(proxy, margin));
    }
  }

  private margin = 1.25;

  /** Called once from SceneManager with the active obstacle margin. */
  setMargin(margin: number): void {
    if (Math.abs(margin - this.margin) < 1e-4) return;
    this.margin = margin;
    const set = this.currentSet;
    this.currentSet = undefined;
    this.rebuild(set);
  }

  private buildProxyEdges(
    proxy: ReefCollisionProxy,
    inflate: number,
    material: LineBasicMaterial,
  ): LineSegments[] {
    const lines: LineSegments[] = [];
    for (const primitive of proxy.primitives) {
      const geometry = this.buildGeometry(primitive, inflate);
      const edges = new EdgesGeometry(geometry, 18);
      geometry.dispose();
      const line = new LineSegments(edges, material);
      line.renderOrder = 9;
      line.frustumCulled = false;
      this.positionPrimitive(line, primitive);
      lines.push(line);
    }
    return lines;
  }

  private buildMarginShells(proxy: ReefCollisionProxy, inflate: number): Mesh[] {
    const meshes: Mesh[] = [];
    for (const primitive of proxy.primitives) {
      const mesh = new Mesh(this.buildGeometry(primitive, inflate), this.marginMaterial);
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      this.positionPrimitive(mesh, primitive);
      meshes.push(mesh);
    }
    return meshes;
  }

  private positionPrimitive(object: Object3D, primitive: WorldSdfPrimitive): void {
    if (primitive.debug.rotation && primitive.kind !== 'capsule') {
      const r = primitive.debug.rotation;
      this.rotationMatrix.set(
        r[0], r[1], r[2], 0,
        r[3], r[4], r[5], 0,
        r[6], r[7], r[8], 0,
        0, 0, 0, 1,
      );
      object.quaternion.setFromRotationMatrix(this.rotationMatrix);
    }
    const [cx, cy, cz] = primitive.debug.center;
    object.position.set(cx, cy, cz);
    if (primitive.kind === 'capsule') {
      const a = primitive.debug.a!;
      const b = primitive.debug.b!;
      this.direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const length = this.direction.length();
      this.origin.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      object.position.copy(this.origin);
      if (length > 1e-6) {
        this.quaternion.setFromUnitVectors(UP, this.direction.multiplyScalar(1 / length));
        object.quaternion.copy(this.quaternion);
      }
    }
  }

  private buildGeometry(primitive: WorldSdfPrimitive, inflate: number): BufferGeometry {
    const debug = primitive.debug;
    if (debug.kind === 'roundedBox') {
      const half = debug.half!;
      const rounding = debug.rounding ?? 0;
      const radius = rounding + inflate;
      return new RoundedBoxGeometry(
        Math.max(0.02, 2 * (half[0] + radius)),
        Math.max(0.02, 2 * (half[1] + radius)),
        Math.max(0.02, 2 * (half[2] + radius)),
        2,
        Math.max(0.001, radius),
      );
    }
    if (debug.kind === 'capsule') {
      const a = debug.a!;
      const b = debug.b!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      return new CapsuleGeometry(Math.max(0.005, (debug.radius ?? 0.1) + inflate), length, 4, 10);
    }
    const radii = debug.radii!;
    const geometry = new SphereGeometry(1, 16, 12);
    geometry.scale(radii[0] + inflate, radii[1] + inflate, radii[2] + inflate);
    return geometry;
  }

  private updatePenetration(world: SimulationWorld, proxySet?: ReefProxySet): void {
    if (!proxySet || !this.visibility.penetration) {
      this.markers.count = 0;
      this.selected = { ...this.selected, penetratingFish: 0 };
      return;
    }
    let count = 0;
    const visit = (flock: SimulationWorld['flock']): void => {
      const { positions, alive, count: total } = flock;
      for (let fish = 0; fish < total && count < MAX_PENETRATION_MARKERS; fish += 1) {
        if (alive[fish] === 0) continue;
        const offset = fish * 3;
        const x = positions[offset];
        const y = positions[offset + 1];
        const z = positions[offset + 2];
        if (!proxySet.queryNearest(x, y, z, this.query) || this.query.distance >= 0) continue;
        this.matrix.makeTranslation(x, y, z);
        this.markers.setMatrixAt(count, this.matrix);
        count += 1;
      }
    };
    visit(world.flock);
    visit(world.clownfishFlock);
    this.markers.count = count;
    this.markers.instanceMatrix.needsUpdate = true;
    this.selected = { ...this.selected, penetratingFish: count };
  }

  private updateSelected(world: SimulationWorld, proxySet: ReefProxySet | undefined, alpha: number): void {
    const index = world.boids.debugFishIndex;
    const valid = this.visibility.sdf
      && proxySet !== undefined
      && index >= 0
      && index < world.flock.count
      && world.flock.alive[index] === 1;
    if (!valid) {
      this.normalArrow.visible = false;
      this.selectedMarker.visible = false;
      this.selected = {
        active: false,
        reefId: null,
        signedDistance: Number.NaN,
        clearance: Number.NaN,
        inside: false,
        penetratingFish: this.selected.penetratingFish,
      };
      return;
    }
    const offset = index * 3;
    const previous = world.flock.previousPositions;
    const current = world.flock.positions;
    this.origin.set(
      previous[offset] + (current[offset] - previous[offset]) * alpha,
      previous[offset + 1] + (current[offset + 1] - previous[offset + 1]) * alpha,
      previous[offset + 2] + (current[offset + 2] - previous[offset + 2]) * alpha,
    );
    const found = proxySet!.queryNearest(this.origin.x, this.origin.y, this.origin.z, this.query);
    if (!found) {
      this.normalArrow.visible = false;
      this.selectedMarker.visible = false;
      return;
    }
    this.selectedMarker.position.copy(this.origin);
    this.selectedMarker.visible = true;
    this.direction.set(this.query.normal[0], this.query.normal[1], this.query.normal[2]);
    this.normalArrow.position.copy(this.origin);
    this.normalArrow.setDirection(this.direction);
    this.normalArrow.setLength(1.4, 0.28, 0.14);
    this.normalArrow.visible = true;
    const margin = this.margin;
    this.selected = {
      active: true,
      reefId: this.query.id,
      signedDistance: this.query.distance,
      clearance: this.query.distance - margin,
      inside: this.query.distance < 0,
      penetratingFish: this.selected.penetratingFish,
    };
  }

  private disposeGeometry(object: Object3D): void {
    if (object instanceof Mesh || object instanceof LineSegments) {
      object.geometry.dispose();
    }
    // Materials are shared per layer; they are disposed with the visualizer.
  }

  dispose(): void {
    this.group.removeFromParent();
    this.proxyMaterial.dispose();
    this.marginMaterial.dispose();
    this.marginEdgeMaterial.dispose();
    this.penetrationMaterial.dispose();
    this.markers.geometry.dispose();
    this.selectedMarker.geometry.dispose();
    (this.selectedMarker.material as Material).dispose();
  }
}
