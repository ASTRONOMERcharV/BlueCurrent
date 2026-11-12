import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  LOD,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EpibiontAsset } from './EpibiontAsset';
import type { ReefSampleAssets } from './ReefSampleAsset';
import { EpibiontScatter } from './EpibiontScatter';
import {
  extractReefTriangles,
  planEpibionts,
  type EpibiontPlan,
  type EpibiontPlanOptions,
} from './reefEpibiontPlacement';
import type { RockAssets } from './RockAsset';
import {
  DEBRIS_ASSET_ORDER,
  ROCK_DIMENSIONS,
  createRandom,
  floorHeightAt,
  type RockName,
} from './rockPlacement';
import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import type { ReefProxyId } from '../simulation/reefCollisionProxySpecs';
import type { ReefWorldTransform } from '../simulation/ReefCollisionProxy';

/**
 * The hero reef: LOD rock + instanced epibiont clusters + a non-colliding
 * rubble apron. It replaces the visual mesh of one collision sphere only; the
 * sphere, avoidance margins and kelp refuge semantics are untouched.
 */

export const REEF_SAMPLE_ANCHOR_INDEX = 2;
export const REEF_SAMPLE_YAW_DEGREES = 12;
const LOD_DISTANCES: readonly [number, number] = [18, 38];
const EPIBIONT_VISIBLE_DISTANCE = 38;
const APRON_VISIBLE_DISTANCE = 48;
const EMBED_DEPTH = 0.07;
/** Contact-ring radii as multiples of the collision radius (hero: 2.45 m). */
const CONTACT_RADII = [0.63, 0.84, 1.04, 1.29] as const;

const APRON_SEED = 0x5eed7a11;

export interface ReefSampleStats {
  readonly id: string;
  readonly label: string;
  readonly anchorIndex: number;
  readonly trianglesNear: number;
  readonly trianglesMid: number;
  readonly trianglesFar: number;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly epibiontInstances: number;
  readonly epibiontTriangles: number;
  readonly epibiontMeshes: number;
  readonly epibiontCoverage: number;
  readonly apronTriangles: number;
  readonly apronPieces: number;
  readonly radius: number;
}

export interface ReefSampleOptions {
  readonly id?: ReefProxyId;
  readonly label?: string;
  readonly anchorIndex?: number;
  readonly yawDegrees?: number;
  /** Small leans break the repeated upright-pillar rhythm of secondary reefs. */
  readonly tiltXDegrees?: number;
  readonly tiltZDegrees?: number;
  readonly embedDepth?: number;
  /** Non-uniform visual scale applied to the authored LOD geometry. */
  readonly visualScale?: readonly [number, number, number];
  readonly lodDistances?: readonly [number, number];
  readonly epibiontVisibleDistance?: number;
  readonly apronVisibleDistance?: number;
  readonly planSeed?: number;
  readonly planOptions?: EpibiontPlanOptions;
  readonly apronSeed?: number;
  /** Optional tinted clone so the rubble does not read brighter than the reef. */
  readonly apronMaterial?: MeshStandardMaterial;
}

function buildContactRing(obstacle: ObstacleDefinition): Mesh {
  const [cx, , cz] = obstacle.center;
  const radii = CONTACT_RADII.map((factor) => factor * obstacle.radius);
  const alphas = [0.55, 0.34, 0.14, 0.0];
  const segments = 64;
  const positions: number[] = [];
  const alpha: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring < radii.length; ring += 1) {
    for (let step = 0; step <= segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radii[ring];
      const z = cz + Math.sin(angle) * radii[ring];
      positions.push(x, floorHeightAt(x, z) + 0.012, z);
      alpha.push(alphas[ring]);
    }
  }
  for (let ring = 0; ring < radii.length - 1; ring += 1) {
    const base = ring * (segments + 1);
    const next = (ring + 1) * (segments + 1);
    for (let step = 0; step < segments; step += 1) {
      const a = base + step;
      const b = a + 1;
      const c = next + step + 1;
      const d = next + step;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new Float32BufferAttribute(alpha, 1));
  geometry.setIndex(indices);
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Vector3(0.018, 0.032, 0.030) },
    },
    vertexShader: `attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'reefSampleContactAO';
  mesh.renderOrder = 2;
  return mesh;
}

function buildApron(
  rockAssets: RockAssets,
  obstacle: ObstacleDefinition,
  material: MeshStandardMaterial,
  seed: number,
): { mesh: Mesh; triangles: number; pieces: number } {
  const random = createRandom(seed);
  const geometries: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const euler = new Euler();
  const [cx, , cz] = obstacle.center;
  let pieces = 0;

  const addPiece = (radius: number, scaleBase: number): void => {
    const names = DEBRIS_ASSET_ORDER;
    const name = names[Math.floor(random() * names.length)] as RockName;
    const source = rockAssets.geometries.get(name);
    if (!source) return;
    const dimensions = ROCK_DIMENSIONS[name];
    const angle = random() * Math.PI * 2;
    const scaleValue = scaleBase * (0.7 + random() * 0.7);
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    const y = floorHeightAt(x, z) - dimensions.height * scaleValue * (0.36 + random() * 0.22);
    euler.set(
      (random() - 0.5) * 0.22,
      random() * Math.PI * 2,
      (random() - 0.5) * 0.22,
      'YXZ',
    );
    rotation.setFromEuler(euler);
    position.set(x, y, z);
    scale.setScalar(scaleValue);
    matrix.compose(position, rotation, scale);
    const clone = source.clone();
    clone.applyMatrix4(matrix);
    const nonIndexed = clone.index ? clone.toNonIndexed() : clone;
    if (nonIndexed !== clone) clone.dispose();
    nonIndexed.deleteAttribute('tangent');
    geometries.push(nonIndexed);
    pieces += 1;
  };

  // Broken rock at the base, coarse to fine. The ring hugs the collision
  // footprint and most pieces are buried, so it reads as eroded rock rather
  // than pebbles scattered on the sand.
  for (let index = 0; index < 11; index += 1) {
    addPiece(obstacle.radius * (0.80 + random() * 0.42), 0.85);
  }
  for (let index = 0; index < 7; index += 1) {
    addPiece(obstacle.radius * (1.10 + random() * 0.40), 0.42);
  }

  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Could not merge the reef-sample rubble apron.');
  merged.computeBoundingSphere();
  const mesh = new Mesh(merged, material);
  mesh.name = 'reefSampleRubbleApron';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  let triangles = 0;
  const index = merged.getIndex();
  triangles = (index ? index.count : merged.getAttribute('position').count) / 3;
  return { mesh, triangles, pieces };
}

export class ReefSample {
  readonly group = new Group();
  readonly apron: Mesh;
  readonly contact: Mesh;
  readonly lod: LOD;
  readonly epibionts: EpibiontScatter;
  readonly plan: EpibiontPlan;
  readonly stats: ReefSampleStats;
  /**
   * The exact placement used by the visual group. Read by the simulation to
   * build the SDF collider from the real GLB dimensions, YXZ rotation and
   * non-uniform scale — never from the obstacle sphere center alone.
   */
  readonly collisionTransform: ReefWorldTransform;
  private readonly worldPosition = new Vector3();
  private readonly epibiontVisibleDistance: number;
  private readonly apronVisibleDistance: number;
  private visible = true;

  constructor(
    asset: ReefSampleAssets,
    epibiontAssets: readonly EpibiontAsset[],
    coralMaterial: MeshStandardMaterial,
    rockAssets: RockAssets,
    obstacle: ObstacleDefinition,
    options: ReefSampleOptions = {},
  ) {
    const anchorIndex = options.anchorIndex ?? REEF_SAMPLE_ANCHOR_INDEX;
    const id = options.id ?? 'hero';
    const label = options.label ?? 'Hero sample';
    const yaw = (options.yawDegrees ?? REEF_SAMPLE_YAW_DEGREES) * (Math.PI / 180);
    const tiltX = (options.tiltXDegrees ?? 0) * (Math.PI / 180);
    const tiltZ = (options.tiltZDegrees ?? 0) * (Math.PI / 180);
    const lodDistances = options.lodDistances ?? LOD_DISTANCES;
    const visualScale = options.visualScale ?? [1, 1, 1] as const;
    this.epibiontVisibleDistance = options.epibiontVisibleDistance ?? EPIBIONT_VISIBLE_DISTANCE;
    this.apronVisibleDistance = options.apronVisibleDistance ?? APRON_VISIBLE_DISTANCE;
    const [x, , z] = obstacle.center;
    this.group.name = `reefSample_${id}`;
    this.group.position.set(x, floorHeightAt(x, z) - (options.embedDepth ?? EMBED_DEPTH), z);
    this.group.rotation.set(tiltX, yaw, tiltZ, 'YXZ');
    this.group.scale.set(visualScale[0], visualScale[1], visualScale[2]);
    this.collisionTransform = {
      id,
      anchorIndex,
      position: [this.group.position.x, this.group.position.y, this.group.position.z],
      yaw,
      tiltX,
      tiltZ,
      scale: [visualScale[0], visualScale[1], visualScale[2]],
      localSize: [asset.stats.width, asset.stats.height, asset.stats.depth],
    };

    const near = asset.lods.get('near')!;
    const mid = asset.lods.get('mid')!;
    const far = asset.lods.get('far')!;
    const lod = new LOD();
    lod.name = `reefSample_${id}_lod`;
    const nearMesh = new Mesh(near.geometry, asset.material);
    nearMesh.name = 'reefSampleNear';
    nearMesh.castShadow = true;
    nearMesh.receiveShadow = true;
    const midMesh = new Mesh(mid.geometry, asset.material);
    midMesh.name = 'reefSampleMid';
    midMesh.castShadow = false;
    midMesh.receiveShadow = true;
    const farMesh = new Mesh(far.geometry, asset.material);
    farMesh.name = 'reefSampleFar';
    farMesh.castShadow = false;
    farMesh.receiveShadow = true;
    lod.addLevel(nearMesh, 0);
    lod.addLevel(midMesh, lodDistances[0]);
    lod.addLevel(farMesh, lodDistances[1]);
    this.lod = lod;
    this.group.add(lod);

    const plan = planEpibionts(
      extractReefTriangles(near.geometry),
      options.planSeed,
      options.planOptions,
    );
    this.plan = plan;
    this.epibionts = new EpibiontScatter(plan, epibiontAssets, coralMaterial);
    this.group.add(this.epibionts.group);
    this.epibionts.group.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = false;
        object.receiveShadow = true;
      }
    });

    const apron = buildApron(
      rockAssets,
      obstacle,
      options.apronMaterial ?? rockAssets.rockMaterial,
      options.apronSeed ?? APRON_SEED,
    );
    this.apron = apron.mesh;
    this.contact = buildContactRing(obstacle);

    this.worldPosition.set(x, floorHeightAt(x, z), z);
    this.stats = {
      id,
      label,
      anchorIndex,
      trianglesNear: near.triangles,
      trianglesMid: mid.triangles,
      trianglesFar: far.triangles,
      height: asset.stats.height * visualScale[1],
      width: asset.stats.width * visualScale[0],
      depth: asset.stats.depth * visualScale[2],
      epibiontInstances: this.epibionts.instanceCount,
      epibiontTriangles: this.epibionts.triangleCount,
      epibiontMeshes: this.epibionts.meshCount,
      epibiontCoverage: this.epibionts.coverage,
      apronTriangles: apron.triangles,
      apronPieces: apron.pieces,
      radius: obstacle.radius,
    };
    console.info(
      `Reef ${id} (${label}): near ${near.triangles}, mid ${mid.triangles}, far ${far.triangles} tris; ` +
      `${this.epibionts.instanceCount} epibionts in ${plan.clusters.length} clusters ` +
      `(${(plan.coverage * 100).toFixed(1)}% estimated cover), apron ${apron.pieces} pieces/` +
      `${apron.triangles} tris, anchor ${anchorIndex}`,
    );
  }

  update(camera: Camera): void {
    const distance = camera.position.distanceTo(this.worldPosition);
    this.epibionts.group.visible = distance <= (this.epibiontVisibleDistance ?? EPIBIONT_VISIBLE_DISTANCE);
    this.apron.visible = distance <= (this.apronVisibleDistance ?? APRON_VISIBLE_DISTANCE);
    this.contact.visible = distance <= (this.apronVisibleDistance ?? APRON_VISIBLE_DISTANCE);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
    this.apron.visible = visible;
    this.contact.visible = visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.epibionts.dispose();
    this.apron.geometry.dispose();
    this.apron.removeFromParent();
    this.contact.geometry.dispose();
    this.contact.removeFromParent();
    (this.contact.material as ShaderMaterial).dispose();
    this.group.removeFromParent();
  }
}
