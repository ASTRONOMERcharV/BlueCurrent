import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  BackSide,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  GridHelper,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import type { ObstacleSystem } from '../simulation/ObstacleSystem';
import type { ObstacleDefinition } from '../simulation/ObstacleSystem';
import type { SimulationConfig } from '../simulation/SimulationConfig';
import { loadRockAssets, type RockAssets } from './RockAsset';
import { RockScatter } from './RockScatter';
import { generateRockLayout, ROCK_DIMENSIONS, type RockKind, type RockName } from './rockPlacement';
import { ReefSample } from './ReefSample';
import type { ReefSampleStats } from './ReefSample';
import type { ReefWorldTransform } from '../simulation/ReefCollisionProxy';
import { loadReefSampleAssets, type ReefSampleAssets } from './ReefSampleAsset';
import { HERO_REEF_SPEC, REEF_VARIANT_SPECS, type ReefVariantSpec } from './reefVariantSpecs';
import { loadEpibiontAssets } from './EpibiontAsset';
import type { EpibiontAsset } from './EpibiontAsset';
import { loadKelpAssets, type KelpAsset } from './KelpAsset';
import { KelpScatter } from './KelpScatter';
import type { KelpPlacement } from './kelpPlacement';
import { createCoralMaterial, loadCoralAssets, loadCoralAtlas, TEMPERATE_CORAL_SPECS } from './CoralAsset';
import type { CoralAsset, CoralAtlas } from './CoralAsset';
import { CoralScatter } from './CoralScatter';
import type { CoralScatterMode } from './CoralScatter';
import { loadSeaweedAsset, type SeaweedAsset } from './SeaweedAsset';
import { SeaweedScatter } from './SeaweedScatter';
import { generateSeaweedLayout } from './seaweedPlacement';
import { createReefVortices, OceanCurrentField } from '../environment/OceanCurrentField';
import { UnderwaterLighting } from './UnderwaterLighting';
import { applyCaustics } from './Caustics';
import { causticOptionsFor } from './lighting/CausticOptions';
import { createLegacySeabedGeometry, createSeabedGeometry } from './terrain';
import { createTerrainDecor, generateTerrainDecor } from './terrainDecor';
import { MarineSnow } from './MarineSnow';
import { UNDERWATER_LIGHTING_CONFIG, UNDERWATER_SUN_DIRECTION } from './lighting/UnderwaterLightingConfig';
import type { UnderwaterLightingMode } from './lighting/UnderwaterLightingConfig';
import { createLightShaftGroup } from './lighting/LightShafts';
import {
  collectRockDiagnostics,
  type RockCategory,
  type RockDiagnosticsReport,
  type RockTarget,
} from './lighting/RockDiagnostics';
import {
  UNDERWATER_BACKGROUND_COLOR,
  UNDERWATER_WATER_COLOR,
  type LocalWaterDebugLayer,
} from './UnderwaterMedium';

const ROCK_TINTS = [0x3c626e, 0x466b76, 0x355a65] as const;

export { causticOptionsFor };


export type GlbRockMode = 'off' | 'legacy' | 'set';
export type GlbKelpMode = 'off' | 'blender';
export type GlbSeaweedMode = 'off' | 'blender';
export type TerrainMode = 'continuous' | 'legacy';
/** Temporary material override for the P2 rock-normal audit; never a default. */
export type RockDebugMode = 'off' | 'normal';

export interface GlbRockCounts {
  readonly large: number;
  readonly medium: number;
  readonly debris: number;
  readonly dune: number;
}

export function createFishGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.5, 10, 6);
  body.scale(0.54, 0.38, 1.24);
  const tail = new ConeGeometry(0.29, 0.48, 3);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -0.82);
  const dorsal = new ConeGeometry(0.13, 0.28, 3);
  dorsal.translate(0, 0.25, -0.03);
  const leftFin = new ConeGeometry(0.1, 0.27, 3);
  leftFin.rotateZ(Math.PI / 2);
  leftFin.translate(-0.3, -0.03, 0.13);
  const rightFin = new ConeGeometry(0.1, 0.27, 3);
  rightFin.rotateZ(-Math.PI / 2);
  rightFin.translate(0.3, -0.03, 0.13);
  const sourceGeometries = [body, tail, dorsal, leftFin, rightFin];
  const geometries = sourceGeometries.map((geometry) => geometry.toNonIndexed());
  const merged = mergeGeometries(geometries, false);
  for (const geometry of sourceGeometries) geometry.dispose();
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Could not construct procedural fish geometry.');
  merged.computeVertexNormals();
  return merged;
}

export class Environment {
  private readonly scene: Scene;
  private readonly fog: FogExp2;
  private waterEffects = true;
  private readonly waterLayers: Record<LocalWaterDebugLayer, boolean> = {
    marineParticles: true,
    lightShafts: true,
    caustics: true,
    surfaceLight: true,
  };
  private shadowsDirty = true;
  private obstaclesVisible = true;
  private _lightingMode: UnderwaterLightingMode;
  private _terrainMode: TerrainMode;
  private readonly obstacleDefinitions: readonly ObstacleDefinition[];
  private readonly currentField: OceanCurrentField;
  private readonly reefGroup = new Group();
  private readonly lighting: UnderwaterLighting;
  private readonly marineSnow: MarineSnow;
  private readonly boundsHelper: Box3Helper;
  private readonly floorGrid: GridHelper;
  private readonly surface: Mesh;
  private readonly dome: Mesh;
  private readonly lightShafts: Group;
  private domeMaterial?: ShaderMaterial;
  private waterScatteringVisible = true;
  private readonly waterTime = { value: 0 };
  private readonly causticStrength: { value: number } =
    { value: UNDERWATER_LIGHTING_CONFIG.water.caustics.strength };
  private readonly proceduralCorals: Group[] = [];
  private readonly primaryRocks: { mesh: Mesh; variant: number; radius: number }[] = [];
  private glbRockModeState: GlbRockMode = 'off';
  private rockScatter?: RockScatter;
  private rockAssets?: RockAssets;
  private glbKelpModeState: GlbKelpMode = 'off';
  private kelpScatter?: KelpScatter;
  private kelpAssets?: KelpAsset[];
  private coralScatter?: CoralScatter;
  private coralAssets?: CoralAsset[];
  private coralAtlas?: CoralAtlas;
  private coralMaterial?: MeshStandardMaterial;
  private coralModeState: CoralScatterMode | 'off' = 'off';
  private reefSample?: ReefSample;
  private reefSamples: ReefSample[] = [];
  private reefEpibiontAssets?: EpibiontAsset[];
  private reefEpibiontMaterial?: MeshStandardMaterial;
  private reefEpibiontAtlas?: CoralAtlas;
  private reefApronMaterial?: MeshStandardMaterial;
  private glbSeaweedModeState: GlbSeaweedMode = 'off';
  private seaweedScatter?: SeaweedScatter;
  private seaweedAsset?: SeaweedAsset;
  private terrainDecorCounts = { midground: 0, far: 0 };
  /** Every mesh that renders solid reef rock, for diagnostics/debug/mask only. */
  private readonly rockTargets: RockTarget[] = [];
  private rockDebugModeState: RockDebugMode = 'off';
  private readonly rockDebugOriginalMaterials = new Map<Mesh, Material | Material[]>();
  private readonly rockNormalMaterial = new MeshNormalMaterial();

  constructor(
    scene: Scene,
    obstacles: ObstacleSystem,
    config: SimulationConfig,
    lightingMode: UnderwaterLightingMode = 'full',
    terrainMode: TerrainMode = 'continuous',
  ) {
    this._lightingMode = lightingMode;
    this._terrainMode = terrainMode;
    this.scene = scene;
    this.obstacleDefinitions = obstacles.definitions;
    this.currentField = new OceanCurrentField({
      vortices: createReefVortices(obstacles.definitions),
    });
    scene.background = new Color(UNDERWATER_BACKGROUND_COLOR);
    this.fog = new FogExp2(
      UNDERWATER_WATER_COLOR,
      UNDERWATER_LIGHTING_CONFIG.water.fogDensity,
    );
    scene.fog = lightingMode === 'full' ? this.fog : null;
    this.lighting = new UnderwaterLighting(scene);

    const legacyTerrain = terrainMode === 'legacy';
    const floorGeometry = legacyTerrain ? createLegacySeabedGeometry() : createSeabedGeometry();
    const floorMaterial = legacyTerrain
      ? new MeshStandardMaterial({
        color: UNDERWATER_LIGHTING_CONFIG.materials.floorColor,
        roughness: 0.97,
        metalness: 0,
        flatShading: true,
      })
      : new MeshStandardMaterial({
        // The seabed carries its own vertex palette: authored reef sand in the
        // centre, gradually blending to the far-water scattering colour so the
        // extended shelf disappears into the medium instead of ending at a seam.
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.97,
        metalness: 0,
        flatShading: false,
      });
    applyCaustics(
      floorMaterial,
      { time: this.waterTime, strength: this.causticStrength },
      causticOptionsFor('floor'),
    );
    const floor = new Mesh(floorGeometry, floorMaterial);
    floor.name = 'staticSeabed';
    floor.receiveShadow = true;
    scene.add(floor);

    this.floorGrid = new GridHelper(60, 30, 0x5d9189, 0x416f69);
    this.floorGrid.position.y = -0.03;
    const gridMaterial = this.floorGrid.material as LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.065;
    this.floorGrid.visible = false;
    scene.add(this.floorGrid);

    // The reef group uses the exact same sphere definitions as the simulation.
    const reefGroup = this.reefGroup;
    const rockMaterials = [
      new MeshStandardMaterial({ color: 0x3c626e, roughness: 0.94, flatShading: true }),
      new MeshStandardMaterial({ color: 0x466b76, roughness: 0.95, flatShading: true }),
      new MeshStandardMaterial({ color: 0x355a65, roughness: 0.92, flatShading: true }),
    ];
    const coralMaterials = [
      new MeshStandardMaterial({
        color: 0xc77f66,
        emissive: 0x3a1711,
        emissiveIntensity: 0.24,
        roughness: 0.8,
        flatShading: true,
      }),
      new MeshStandardMaterial({
        color: 0xb79660,
        emissive: 0x302610,
        emissiveIntensity: 0.2,
        roughness: 0.84,
        flatShading: true,
      }),
    ];
    const causticUniforms = { time: this.waterTime, strength: this.causticStrength };
    for (const material of rockMaterials) {
      applyCaustics(material, causticUniforms, causticOptionsFor('rock'));
    }
    for (const material of coralMaterials) {
      applyCaustics(material, causticUniforms, causticOptionsFor('coral'));
    }
    let coreIndex = 0;
    for (const obstacle of obstacles.definitions) {
      const [x, y, z] = obstacle.center;
      const rock = new Mesh(new IcosahedronGeometry(obstacle.radius, 1), rockMaterials[obstacle.variant]);
      rock.position.set(x, y - 0.25, z);
      rock.scale.set(1, 1.08, 0.9);
      rock.rotation.set(obstacle.variant * 0.3, obstacle.variant * 1.7, 0.12);
      rock.castShadow = true;
      rock.receiveShadow = true;
      reefGroup.add(rock);
      this.primaryRocks.push({ mesh: rock, variant: obstacle.variant, radius: obstacle.radius });
      this.registerRock(rock, 'primary-core', `reef-core-${coreIndex}`);

      for (let chunk = 0; chunk < 2; chunk += 1) {
        const offsetAngle = obstacle.variant * 1.9 + chunk * 2.8;
        const boulder = new Mesh(
          new IcosahedronGeometry(obstacle.radius * (0.25 + chunk * 0.07), 0),
          rockMaterials[(obstacle.variant + chunk + 1) % rockMaterials.length],
        );
        boulder.position.set(
          x + Math.cos(offsetAngle) * obstacle.radius * 0.92,
          0.15 + chunk * 0.08,
          z + Math.sin(offsetAngle) * obstacle.radius * 0.92,
        );
        boulder.scale.set(1, 0.72, 0.86);
        boulder.rotation.set(chunk * 0.7, offsetAngle, 0.1);
        boulder.castShadow = true;
        boulder.receiveShadow = true;
        reefGroup.add(boulder);
        this.registerRock(boulder, 'procedural-boulder', `reef-boulder-${coreIndex}-${chunk}`);
      }

      for (let branch = 0; branch < 5; branch += 1) {
        const height = 1.05 + (branch % 3) * 0.28;
        const angle = branch * 1.45 + obstacle.variant * 0.8;
        const radialOffset = obstacle.radius * (1.04 + (branch % 2) * 0.12);
        const coral = new Group();
        coral.position.set(
          x + Math.cos(angle) * radialOffset,
          0.3,
          z + Math.sin(angle) * radialOffset,
        );
        coral.rotation.z = Math.cos(angle) * 0.22;
        coral.rotation.x = Math.sin(angle) * 0.18;
        const stem = new Mesh(new CylinderGeometry(0.05, 0.15, height, 5), coralMaterials[branch % 2]);
        stem.position.y = height * 0.5;
        stem.receiveShadow = true;
        coral.add(stem);
        const tip = new Mesh(new SphereGeometry(0.12, 5, 4), coralMaterials[(branch + 1) % 2]);
        tip.position.y = height + 0.045;
        tip.scale.set(0.8, 1.15, 0.8);
        tip.receiveShadow = true;
        coral.add(tip);
        reefGroup.add(coral);
        this.proceduralCorals.push(coral);
      }
      coreIndex += 1;
    }
    scene.add(this.reefGroup);

    if (legacyTerrain) {
      // Exact pre-P1 decorative formations for the ?terrain=legacy A/B path.
      const distantMaterial = new MeshStandardMaterial({
        color: 0x1a414c,
        roughness: 1,
        flatShading: true,
      });
      applyCaustics(distantMaterial, causticUniforms, causticOptionsFor('distant'));
      const distantFormations = [
        [-27, 4.5, -29, 7],
        [23, 3, -34, 5.5],
        [31, 2.5, 8, 4.5],
        [-31, 2.2, 15, 3.8],
        [8, 2.8, -31, 4.2],
        [-17, 4.8, -31, 7.2],
        [3, 5.4, -34, 8.5],
        [18, 3.8, -30, 6.1],
      ] as const;
      for (const [index, [x, y, z, radius]] of distantFormations.entries()) {
        const formation = new Mesh(new IcosahedronGeometry(radius, 1), distantMaterial);
        formation.name = `legacyDistantRock${index}`;
        formation.position.set(x, y, z);
        formation.scale.set(1, 0.7, 0.85);
        formation.rotation.y = x * 0.13;
        formation.receiveShadow = true;
        scene.add(formation);
        this.registerRock(formation, 'legacy-distant', formation.name);
      }
    } else {
      // Purely decorative mid/far formations. They sit on the extended terrain,
      // use their own seeded layout and never enter collision or the simulation.
      const terrainDecor = createTerrainDecor(generateTerrainDecor(), causticUniforms);
      this.terrainDecorCounts = { ...terrainDecor.counts };
      scene.add(terrainDecor.group);
      terrainDecor.group.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const category: RockCategory = object.name === 'terrainDecorFar'
          ? 'terrain-decor-far'
          : 'terrain-decor-midground';
        this.registerRock(object, category, object.name);
      });
    }

    const foregroundMaterial = new MeshStandardMaterial({ color: 0x1b434d, roughness: 1, flatShading: true });
    applyCaustics(foregroundMaterial, causticUniforms, causticOptionsFor('foreground'));
    const foregroundFormations = [
      [-20, 1.0, 24, 3.4],
      [19, 1.2, 25, 3.8],
    ] as const;
    for (const [index, [x, y, z, radius]] of foregroundFormations.entries()) {
      const foreground = new Mesh(new IcosahedronGeometry(radius, 1), foregroundMaterial);
      foreground.name = `foregroundRock${index === 0 ? 'A' : 'B'}`;
      foreground.position.set(x, y, z);
      foreground.scale.set(1.15, 0.58, 0.82);
      foreground.rotation.y = x * 0.09;
      foreground.receiveShadow = true;
      scene.add(foreground);
      this.registerRock(foreground, 'foreground', foreground.name);
    }

    // Marine snow and micro-bubbles are advected by the same current field as
    // the kelp, so the particle layer never drifts independently of the water.
    this.marineSnow = new MarineSnow(scene, this.currentField);

    this.surface = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({
      color: UNDERWATER_LIGHTING_CONFIG.water.surfaceColor,
      transparent: true,
      opacity: UNDERWATER_LIGHTING_CONFIG.water.surfaceOpacity,
      side: DoubleSide,
      depthWrite: false,
    }));
    this.surface.rotation.x = Math.PI / 2;
    this.surface.position.y = 20.2;
    scene.add(this.surface);

    // Six crossed beam planes; every art-directed value (placement, size,
    // noise, lateral/vertical falloff, near/far fade, seabed/rock contact)
    // lives in `water.shafts`. Shafts share one geometry and one material.
    this.lightShafts = createLightShaftGroup(this.obstacleDefinitions, this.waterTime);
    scene.add(this.lightShafts);

    const minimum = new Vector3(...config.bounds.min);
    const maximum = new Vector3(...config.bounds.max);
    this.boundsHelper = new Box3Helper(new Box3(minimum, maximum), 0x74bdb5);
    const boundsMaterial = this.boundsHelper.material as MeshBasicMaterial;
    boundsMaterial.transparent = true;
    boundsMaterial.opacity = 0.13;
    scene.add(this.boundsHelper);

    const domeMaterial = new ShaderMaterial({
      uniforms: {
        uDeepColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.domeDeepColor) },
        uMidColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.domeMidColor) },
        uUpperColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.domeUpperColor) },
        uPhase2MidColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.domePhase2MidColor) },
        uPhase2UpperColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.domePhase2UpperColor) },
        uSunColor: { value: new Color(UNDERWATER_LIGHTING_CONFIG.water.domeSunColor) },
        uSunStrength: { value: UNDERWATER_LIGHTING_CONFIG.water.domeSunStrength },
        uSunPower: { value: UNDERWATER_LIGHTING_CONFIG.water.domeSunPower },
        uSunDirection: { value: new Vector3(...UNDERWATER_SUN_DIRECTION) },
        uPhase2: { value: 1 },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: `varying float vHeight;
        varying vec3 vWorldDirection;
        void main() {
          vHeight = normalize(position).y;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldDirection = worldPosition.xyz - cameraPosition;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform vec3 uDeepColor;
        uniform vec3 uMidColor;
        uniform vec3 uUpperColor;
        uniform vec3 uPhase2MidColor;
        uniform vec3 uPhase2UpperColor;
        uniform vec3 uSunColor;
        uniform float uSunStrength;
        uniform float uSunPower;
        uniform vec3 uSunDirection;
        uniform float uPhase2;
        varying float vHeight;
        varying vec3 vWorldDirection;
        void main() {
          float lower = smoothstep(-0.9, 0.12, vHeight);
          float phase1Upper = smoothstep(0.05, 0.9, vHeight);
          float phase2Upper = smoothstep(0.0, 0.85, vHeight);
          float upperMix = mix(phase1Upper, phase2Upper, uPhase2);
          vec3 midColor = mix(uMidColor, uPhase2MidColor, uPhase2);
          vec3 upperColor = mix(uUpperColor, uPhase2UpperColor, uPhase2);
          vec3 color = mix(uDeepColor, midColor, lower);
          color = mix(color, upperColor, upperMix);
          // Far-water lit scattering: a broad, weak lobe toward the sun,
          // not a visible sun disk. Keeps the upper column directional.
          vec3 viewDirection = normalize(vWorldDirection);
          float sunAmount = pow(max(dot(viewDirection, uSunDirection), 0.0), uSunPower);
          color = mix(color, uSunColor, sunAmount * uSunStrength * uPhase2);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.domeMaterial = domeMaterial;
    const dome = new Mesh(new SphereGeometry(95, 24, 16), domeMaterial);
    dome.name = 'underwaterBackgroundDome';
    dome.renderOrder = -1000;
    scene.add(dome);
    this.dome = dome;
    this.applyDomeScattering();
    this.applyEffectVisibility();
  }

  get glbRocksEnabled(): boolean {
    return this.glbRockModeState !== 'off';
  }

  get glbRockMode(): GlbRockMode {
    return this.glbRockModeState;
  }

  get glbRockInstanceCounts(): GlbRockCounts {
    return this.rockScatter?.counts ?? { large: 0, medium: 0, debris: 0, dune: 0 };
  }

  get glbRockStats(): { triangles: number; assets: number; textures: number } | null {
    return this.rockAssets?.stats ?? null;
  }

  /**
   * Per-rock audit for P2.1. Read-only: it never swaps materials, edits
   * geometry or changes visibility; the debug override is a separate call.
   */
  getRockDiagnostics(): RockDiagnosticsReport {
    return collectRockDiagnostics(this.rockTargets);
  }

  /** Solid-rock meshes only, used by the mask renderer and debug override. */
  getRockMeshes(): readonly Mesh[] {
    return this.rockTargets.map((target) => target.object);
  }

  get rockDebugMode(): RockDebugMode {
    return this.rockDebugModeState;
  }

  /**
   * Temporary material override for `?rockdebug=normal`. The original material
   * objects are kept by reference and restored exactly; no material is cloned
   * or disposed, so this cannot leak into the normal path.
   */
  setRockDebugMode(mode: RockDebugMode): void {
    if (mode === this.rockDebugModeState) return;
    if (mode === 'normal') {
      for (const { object } of this.rockTargets) {
        this.rockDebugOriginalMaterials.set(object, object.material);
        object.material = this.rockNormalMaterial;
      }
    } else {
      for (const [object, material] of this.rockDebugOriginalMaterials) {
        object.material = material;
      }
      this.rockDebugOriginalMaterials.clear();
    }
    this.rockDebugModeState = mode;
  }

  private registerRock(mesh: Mesh, category: RockCategory, label: string): void {
    if (this.rockTargets.some((target) => target.object === mesh)) return;
    this.rockTargets.push({ object: mesh, category, label });
  }

  /** `glb_<rockName>` instanced meshes map back to their placement category. */
  private registerScatterMesh(mesh: Mesh): void {
    if (!mesh.name.startsWith('glb_')) return;
    const name = mesh.name.slice(4) as RockName;
    const kind: RockKind = ROCK_DIMENSIONS[name]?.kind ?? 'large';
    let category: RockCategory;
    if (kind === 'dune') category = 'seabed-dune';
    else if (kind === 'large') category = 'rock-scatter-large';
    else if (kind === 'medium') category = 'rock-scatter-medium';
    else category = 'rock-scatter-debris';
    this.registerRock(mesh, category, mesh.name);
  }

  private unregisterRock(mesh: Mesh): void {
    const index = this.rockTargets.findIndex((target) => target.object === mesh);
    if (index >= 0) this.rockTargets.splice(index, 1);
  }

  get glbKelpEnabled(): boolean {
    return this.glbKelpModeState === 'blender';
  }

  get glbKelpMode(): GlbKelpMode {
    return this.glbKelpModeState;
  }

  get glbKelpInstanceCounts(): { kelp_a: number; kelp_b: number } {
    return this.kelpScatter?.counts ?? { kelp_a: 0, kelp_b: 0 };
  }

  get glbKelpStats(): { triangles: number; assets: number; meshes: number } | null {
    if (!this.glbKelpModeState || !this.kelpScatter || !this.kelpAssets) return null;
    return {
      triangles: this.kelpScatter.triangleCount,
      assets: this.kelpAssets.length,
      meshes: this.kelpScatter.meshCount,
    };
  }

  get glbCoralMode(): CoralScatterMode | 'off' {
    return this.coralModeState;
  }

  get glbCoralInstanceCount(): number {
    return this.coralScatter?.instanceCount ?? 0;
  }

  get glbCoralStats(): { triangles: number; assets: number; meshes: number; atlasMaps: number } | null {
    if (!this.coralScatter || !this.coralAssets) return null;
    return {
      triangles: this.coralScatter.triangleCount,
      assets: this.coralAssets.length,
      meshes: this.coralScatter.meshCount,
      atlasMaps: this.coralAtlas ? 3 : 0,
    };
  }

  get reefSampleActive(): boolean {
    return this.reefSample !== undefined;
  }

  get reefSetActive(): boolean {
    return this.reefSamples.length > 0;
  }

  get reefSampleStats(): ReefSampleStats | null {
    return this.reefSample?.stats ?? null;
  }

  get reefSetStats(): ReefSampleStats[] {
    return this.reefSamples.map((sample) => sample.stats);
  }

  /**
   * Real world placement of every loaded reef GLB, in the order they were
   * created. Used to build the SDF collision proxies from the actual meshes.
   */
  getReefCollisionTransforms(): ReefWorldTransform[] {
    return this.reefSamples.map((sample) => sample.collisionTransform);
  }

  get glbSeaweedMode(): GlbSeaweedMode {
    return this.glbSeaweedModeState;
  }

  get terrainDecorInstanceCounts(): { readonly midground: number; readonly far: number } {
    return this.terrainDecorCounts;
  }

  get glbSeaweedInstanceCount(): number {
    return this.seaweedScatter?.instanceCount ?? 0;
  }

  get glbSeaweedStats(): { triangles: number; assets: number; meshes: number; maps: number } | null {
    if (!this.seaweedScatter || !this.seaweedAsset) return null;
    return {
      triangles: this.seaweedScatter.triangleCount,
      assets: 1,
      meshes: this.seaweedScatter.meshCount,
      maps: this.seaweedAsset.stats.maps,
    };
  }

  async loadGlbRocks(): Promise<boolean> {
    if (this.glbRockModeState !== 'off') return true;
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/models/reef_rock_a.glb');
      const source = gltf.scene.getObjectByName('reef_rock_a');
      if (!(source instanceof Mesh)) {
        throw new Error('GLB does not contain a mesh named reef_rock_a.');
      }
      const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
      if (!(sourceMaterial instanceof MeshStandardMaterial)) {
        throw new Error('reef_rock_a.glb uses an unsupported material.');
      }

      for (const { mesh, variant, radius } of this.primaryRocks) {
        const label = this.rockTargets.find((target) => target.object === mesh)?.label
          ?? `reef-core-${variant}`;
        this.unregisterRock(mesh);
        const material = sourceMaterial.clone();
        material.color.setHex(ROCK_TINTS[variant % ROCK_TINTS.length]);
        material.flatShading = true;
        applyCaustics(
          material,
          { time: this.waterTime, strength: this.causticStrength },
          causticOptionsFor('rock'),
        );
        material.needsUpdate = true;

        const replacement = new Mesh(source.geometry, material);
        replacement.name = `reef_rock_a_${mesh.name}`;
        replacement.castShadow = true;
        replacement.receiveShadow = true;
        replacement.position.copy(mesh.position);
        replacement.rotation.copy(mesh.rotation);
        replacement.scale.set(
          mesh.scale.x * radius,
          mesh.scale.y * radius,
          mesh.scale.z * radius,
        );

        this.reefGroup.remove(mesh);
        mesh.geometry.dispose();
        this.reefGroup.add(replacement);
        this.registerRock(replacement, 'primary-core-glb', label);
      }

      this.glbRockModeState = 'legacy';
      this.shadowsDirty = true;
      return true;
    } catch (error) {
      console.warn('Could not load /models/reef_rock_a.glb; keeping procedural rocks.', error);
      return false;
    }
  }

  /**
   * Replace the five procedural reef cores with the full 13-asset GLB set:
   * 3 large reef silhouettes, 4 medium rocks, 4 debris pieces and 2 dune types,
   * scattered deterministically with scale/rotation/embedding variation.
   */
  async loadGlbRockSet(): Promise<boolean> {
    if (this.glbRockModeState === 'set') return true;
    let assets: RockAssets | undefined;
    try {
      assets = await loadRockAssets();
      // Cool the shared atlas so warm rock tiles sit inside the blue-green
      // water palette; per-instance tints still provide local variation.
      assets.rockMaterial.color.setHex(UNDERWATER_LIGHTING_CONFIG.materials.rockAtlasTint);
      assets.duneMaterial.color.setHex(UNDERWATER_LIGHTING_CONFIG.materials.duneAtlasTint);
      applyCaustics(
        assets.rockMaterial,
        { time: this.waterTime, strength: this.causticStrength },
        causticOptionsFor('rock'),
      );
      applyCaustics(
        assets.duneMaterial,
        { time: this.waterTime, strength: this.causticStrength },
        causticOptionsFor('dune'),
      );
      const layout = generateRockLayout(this.obstacleDefinitions);
      const scatter = new RockScatter(assets, layout);
      scatter.rockGroup.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      scatter.duneGroup.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = true;
      });

      for (const { mesh } of this.primaryRocks) {
        this.unregisterRock(mesh);
        this.reefGroup.remove(mesh);
        mesh.geometry.dispose();
      }
      scatter.rockGroup.traverse((object) => {
        if (object instanceof Mesh) this.registerScatterMesh(object);
      });
      scatter.duneGroup.traverse((object) => {
        if (object instanceof Mesh) this.registerScatterMesh(object);
      });
      this.reefGroup.add(scatter.rockGroup);
      this.scene.add(scatter.duneGroup);

      this.rockAssets = assets;
      this.rockScatter = scatter;
      this.glbRockModeState = 'set';
      this.shadowsDirty = true;
      const counts = scatter.counts;
      console.info(
        `GLB rock set: ${assets.stats.assets} assets, ${assets.stats.triangles} triangles, ` +
        `${scatter.meshCount} instanced meshes, ` +
        `${counts.large + counts.medium + counts.debris + counts.dune} instances ` +
        `(large ${counts.large}, medium ${counts.medium}, debris ${counts.debris}, dunes ${counts.dune})`,
      );
      return true;
    } catch (error) {
      assets?.dispose();
      console.warn('Could not load the GLB rock set; keeping procedural rocks.', error);
      return false;
    }
  }

  setObstaclesVisible(visible: boolean): void {
    if (this.obstaclesVisible !== visible) {
      this.obstaclesVisible = visible;
      this.shadowsDirty = true;
    }
    this.reefGroup.visible = visible;
  }

  setLaboratoryMode(enabled: boolean): void {
    this.floorGrid.visible = enabled;
    this.boundsHelper.visible = enabled;
  }

  get lightingMode(): UnderwaterLightingMode {
    return this._lightingMode;
  }

  get terrainMode(): TerrainMode {
    return this._terrainMode;
  }

  get observationGridVisible(): boolean {
    return this.floorGrid.visible;
  }

  get waterEffectsVisible(): boolean {
    return this.lightShafts.visible;
  }

  get domeScatteringActive(): boolean {
    return this.waterScatteringVisible && this._lightingMode === 'full';
  }

  get lightingSnapshot() {
    return this.lighting.snapshot();
  }

  setLightingMode(mode: UnderwaterLightingMode): void {
    this._lightingMode = mode;
    this.scene.fog = mode === 'full' ? this.fog : null;
    this.applyDomeScattering();
    this.applyEffectVisibility();
  }

  setWaterScatteringVisible(visible: boolean): void {
    this.waterScatteringVisible = visible;
    this.applyDomeScattering();
  }

  private applyDomeScattering(): void {
    const active = this.waterScatteringVisible && this._lightingMode === 'full';
    if (!this.domeMaterial) return;
    this.domeMaterial.uniforms.uPhase2.value = active ? 1 : 0;
    this.domeMaterial.uniforms.uSunStrength.value = active
      ? UNDERWATER_LIGHTING_CONFIG.water.domeSunStrength
      : 0;
  }

  setWaterEffects(enabled: boolean): void {
    this.waterEffects = enabled;
    this.applyEffectVisibility();
  }

  setWaterDebugLayer(layer: LocalWaterDebugLayer, enabled: boolean): void {
    this.waterLayers[layer] = enabled;
    this.applyEffectVisibility();
  }

  consumeShadowMapDirty(): boolean {
    const dirty = this.shadowsDirty;
    this.shadowsDirty = false;
    return dirty;
  }

  private applyEffectVisibility(): void {
    const visible = this.waterEffects && this._lightingMode === 'full';
    this.marineSnow.setVisible(visible && this.waterLayers.marineParticles);
    this.surface.visible = visible && this.waterLayers.surfaceLight;
    this.lightShafts.visible = visible && this.waterLayers.lightShafts;
    this.causticStrength.value = visible && this.waterLayers.caustics
      ? UNDERWATER_LIGHTING_CONFIG.water.caustics.strength
      : 0;
  }

  /** Effective caustic strength; 0 whenever the base/water gate is off. */
  get causticStrengthValue(): number {
    return this.causticStrength.value;
  }

  async loadGlbCorals(mode: CoralScatterMode = 'temperate'): Promise<boolean> {
    if (this.coralScatter) return true;
    let assets: CoralAsset[] | undefined;
    let atlas: CoralAtlas | undefined;
    let material: MeshStandardMaterial | undefined;
    try {
      [assets, atlas] = await Promise.all([
        loadCoralAssets(mode === 'temperate' ? TEMPERATE_CORAL_SPECS : undefined),
        loadCoralAtlas(),
      ]);
      material = createCoralMaterial(atlas);
      material.normalScale.set(0.65, 0.65);
      applyCaustics(
        material,
        { time: this.waterTime, strength: this.causticStrength },
        causticOptionsFor('glbCoral'),
      );
      const scatter = new CoralScatter(assets, material, this.obstacleDefinitions, { mode });
      scatter.group.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = true;
      });
      this.scene.add(scatter.group);
      for (const coral of this.proceduralCorals) coral.visible = false;
      this.coralAssets = assets;
      this.coralAtlas = atlas;
      this.coralScatter = scatter;
      this.coralMaterial = material;
      this.coralModeState = mode;
      console.info(
        `GLB coral reef (${mode}): ${scatter.instanceCount} colonies, ` +
        `${scatter.triangleCount} triangles, ${scatter.meshCount} instanced meshes.`,
      );
      return true;
    } catch (error) {
      for (const asset of assets ?? []) asset.geometry.dispose();
      if (atlas) for (const texture of Object.values(atlas)) texture.dispose();
      material?.dispose();
      if (mode === 'temperate') {
        // The restrained tier must not silently fall back to the original
        // 25 procedural tropical colonies. Hide them and show no coral.
        for (const coral of this.proceduralCorals) coral.visible = false;
      }
      console.warn(`Could not load the GLB coral set (${mode}); `, error);
      return false;
    }
  }

  /**
   * Shared biological cover for every reef variant. The show-coral material is
   * reused when available; with ?coral=off the reef set loads its own atlas so
   * the epibionts do not disappear.
   */
  private async ensureReefEpibiontMaterial(): Promise<MeshStandardMaterial> {
    if (this.reefEpibiontMaterial) return this.reefEpibiontMaterial;
    let material = this.coralMaterial;
    if (!material) {
      this.reefEpibiontAtlas = await loadCoralAtlas();
      material = createCoralMaterial(this.reefEpibiontAtlas);
      material.normalScale.set(0.85, 0.85);
      // Only the local fallback needs patching. The show-coral material was
      // already patched by loadGlbCorals(); applying twice redefines the
      // caustic varyings and the shader fails to compile.
      applyCaustics(
        material,
        { time: this.waterTime, strength: this.causticStrength },
        causticOptionsFor('glbCoral'),
      );
      material.needsUpdate = true;
    }
    this.reefEpibiontMaterial = material;
    return material;
  }

  /** The rubble apron is a merged mesh, so it needs one tinted shared material. */
  private ensureReefApronMaterial(): MeshStandardMaterial {
    if (this.reefApronMaterial) return this.reefApronMaterial;
    if (!this.rockAssets) throw new Error('reef apron needs the rock assets');
    const material = new MeshStandardMaterial({
      name: 'reef_variant_apron',
      map: this.rockAssets.rockMaterial.map,
      normalMap: this.rockAssets.rockMaterial.normalMap,
      aoMap: this.rockAssets.rockMaterial.aoMap,
      roughness: 0.95,
      metalness: 0,
      color: 0x6f8480,
    });
    applyCaustics(
      material,
      { time: this.waterTime, strength: this.causticStrength },
      causticOptionsFor('rock'),
    );
    this.reefApronMaterial = material;
    return material;
  }

  private async loadReefVariants(specsToLoad: readonly ReefVariantSpec[]): Promise<boolean> {
    if (this.glbRockModeState !== 'set' || !this.rockScatter || !this.rockAssets) {
      console.warn('Reef variants need the GLB rock set; keeping the standard rocks.');
      return false;
    }
    const missing = specsToLoad.filter(
      (spec) => !this.reefSamples.some((sample) => sample.stats.id === spec.id),
    );
    if (missing.length === 0) return true;

    let epibiontAssets = this.reefEpibiontAssets;
    const loadedAssets: ReefSampleAssets[] = [];
    const created: ReefSample[] = [];
    const hiddenAnchors: number[] = [];
    try {
      if (!epibiontAssets) {
        epibiontAssets = await loadEpibiontAssets();
        this.reefEpibiontAssets = epibiontAssets;
      }
      const epibiontMaterial = await this.ensureReefEpibiontMaterial();
      const apronMaterial = this.ensureReefApronMaterial();
      for (const spec of missing) {
        const assets = await loadReefSampleAssets(spec.assetPrefix);
        loadedAssets.push(assets);
        applyCaustics(
          assets.material,
          { time: this.waterTime, strength: this.causticStrength },
          causticOptionsFor('rock'),
        );
        assets.material.needsUpdate = true;
        const obstacle = this.obstacleDefinitions[spec.anchorIndex];
        if (!obstacle) throw new Error(`missing obstacle ${spec.anchorIndex}`);
        const sample = new ReefSample(
          assets,
          epibiontAssets,
          epibiontMaterial,
          this.rockAssets,
          obstacle,
          {
            id: spec.id,
            label: spec.label,
            anchorIndex: spec.anchorIndex,
            yawDegrees: spec.yawDegrees,
            tiltXDegrees: spec.tiltXDegrees,
            tiltZDegrees: spec.tiltZDegrees,
            embedDepth: spec.embedDepth,
            visualScale: [
              spec.targetWidth / assets.stats.width,
              spec.targetHeight / assets.stats.height,
              spec.targetDepth / assets.stats.depth,
            ] as const,
            lodDistances: spec.lodDistances,
            planSeed: spec.epibiontSeed,
            planOptions: spec.epibiontOptions,
            apronSeed: spec.apronSeed,
            apronMaterial,
          },
        );
        const hidden = this.rockScatter.hideAnchoredLarge(spec.anchorIndex);
        if (!hidden) throw new Error(`no anchored large rock for reef ${spec.id}`);
        hiddenAnchors.push(spec.anchorIndex);
        applyCaustics(
          sample.epibionts.material,
          { time: this.waterTime, strength: this.causticStrength },
          causticOptionsFor('glbCoral'),
        );
        sample.epibionts.material.needsUpdate = true;
        this.reefGroup.add(sample.group);
        this.reefGroup.add(sample.apron);
        this.reefGroup.add(sample.contact);
        sample.group.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          if (
            object.name === 'reefSampleNear'
            || object.name === 'reefSampleMid'
            || object.name === 'reefSampleFar'
          ) {
            const level = object.name.slice('reefSample'.length).toLowerCase();
            this.registerRock(object, 'reef-variant-body', `reef-${spec.id}-${level}`);
          }
        });
        this.registerRock(sample.apron, 'reef-variant-apron', `reef-${spec.id}-apron`);
        created.push(sample);
        if (spec.id === 'hero') this.reefSample = sample;
      }
      this.reefSamples.push(...created);
      this.shadowsDirty = true;
      console.info(
        `Reef set active: ${created.map((sample) => sample.stats.id).join(', ')}; ` +
        `${this.reefSamples.length} reefs, ` +
        `${this.reefSamples.reduce((sum, sample) => sum + sample.stats.epibiontInstances, 0)} epibionts.`,
      );
      return true;
    } catch (error) {
      for (const sample of created) sample.dispose();
      for (const anchor of hiddenAnchors) this.rockScatter.showAnchoredLarge(anchor);
      for (const assets of loadedAssets) assets.dispose();
      if (this.reefSample && !this.reefSamples.includes(this.reefSample)) {
        this.reefSample = undefined;
      }
      console.warn('Could not load the reef variant set; keeping the standard rocks.', error);
      return false;
    }
  }

  /**
   * Replace one visual mesh with the approved hero sample. Collision spheres,
   * avoidance margins and kelp-refuge semantics are untouched.
   */
  async loadReefSample(): Promise<boolean> {
    return this.loadReefVariants([HERO_REEF_SPEC]);
  }

  /**
   * Load the hero plus all four derived variants and hide the five anchored
   * large-rock instances. Only active with ?reef=set (default off).
   */
  async loadReefSet(): Promise<boolean> {
    return this.loadReefVariants(REEF_VARIANT_SPECS);
  }

  /**
   * Load the two Blender kelp assets and scatter them deterministically around
   * the reef cores and open sand. Sway is entirely GPU-side: one InstancedMesh
   * per species with per-instance phase/frequency/amplitude attributes.
   *
   * `placements` must be the exact layout owned by SimulationWorld so the
   * rendered forest and the physical refuge volume are the same 91 plants.
   */
  async loadGlbKelp(placements: readonly KelpPlacement[]): Promise<boolean> {
    if (this.glbKelpModeState === 'blender') return true;
    let assets: KelpAsset[] | undefined;
    try {
      assets = await loadKelpAssets();
      const scatter = new KelpScatter(assets, placements, this.currentField);
      this.scene.add(scatter.group);

      this.kelpAssets = assets;
      this.kelpScatter = scatter;
      this.glbKelpModeState = 'blender';
      const counts = scatter.counts;
      console.info(
        `GLB kelp: ${assets.length} assets, ${scatter.triangleCount} triangles, ` +
        `${scatter.meshCount} instanced meshes, ` +
        `${counts.kelp_a + counts.kelp_b} instances ` +
        `(kelp_a ${counts.kelp_a}, kelp_b ${counts.kelp_b})`,
      );
      return true;
    } catch (error) {
      for (const asset of assets ?? []) {
        asset.geometry.dispose();
        asset.material.dispose();
      }
      console.warn('Could not load the GLB kelp set; leaving the seabed without kelp.', error);
      return false;
    }
  }

  /**
   * Load the user-supplied detail seaweed clump and place six hero instances.
   * Textures stay embedded in the GLB; sway is GPU-side from `_SWAYWEIGHT` and
   * the 302 per-leaf `_BLADEPHASE` values.
   */
  async loadGlbSeaweed(): Promise<boolean> {
    if (this.glbSeaweedModeState === 'blender') return true;
    let asset: SeaweedAsset | undefined;
    try {
      asset = await loadSeaweedAsset();
      const layout = generateSeaweedLayout(this.obstacleDefinitions);
      const scatter = new SeaweedScatter(asset, layout);
      this.scene.add(scatter.group);

      this.seaweedAsset = asset;
      this.seaweedScatter = scatter;
      this.glbSeaweedModeState = 'blender';
      console.info(
        `GLB detail seaweed: ${asset.stats.triangles} triangles, ${asset.stats.maps} maps, ` +
        `${scatter.instanceCount} instances, ${scatter.triangleCount} instanced triangles.`,
      );
      return true;
    } catch (error) {
      asset?.geometry.dispose();
      asset?.material.dispose();
      console.warn('Could not load the detail seaweed GLB; leaving the reef without it.', error);
      return false;
    }
  }

  update(time: number, delta: number, camera: Camera, focus: Vector3, visualDelta = delta): void {
    this.waterTime.value = time;
    // The background dome is an infinite-water stand-in, not a world object:
    // following the camera keeps every allowed orbit inside it and prevents
    // the far-water gradient from being clipped or disappearing at max zoom.
    this.dome.position.copy(camera.position);
    this.marineSnow.update(time, visualDelta);
    this.lighting.update(camera, focus, delta);
    this.kelpScatter?.update(time);
    this.seaweedScatter?.update(time);
    for (const sample of this.reefSamples) sample.update(camera);
  }

  get marineSnowParticleCount(): number {
    return this.marineSnow.particleCount;
  }
}
