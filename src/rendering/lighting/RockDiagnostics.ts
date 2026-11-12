import {
  BackSide,
  Color,
  DoubleSide,
  InstancedMesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Material,
  type Mesh,
  type Texture,
} from 'three';

/**
 * Read-only rock audit used by the P2 lighting diagnosis.
 *
 * Nothing in this module changes geometry, materials or transforms: it reports
 * what the renderer will actually consume (normal attributes, instance
 * determinants, texture color spaces, material gates) so a black silhouette can
 * be traced to a concrete cause instead of being hidden behind extra fill light.
 */

export type RockCategory =
  | 'primary-core'
  | 'primary-core-glb'
  | 'procedural-boulder'
  | 'foreground'
  | 'legacy-distant'
  | 'rock-scatter-large'
  | 'rock-scatter-medium'
  | 'rock-scatter-debris'
  | 'seabed-dune'
  | 'terrain-decor-midground'
  | 'terrain-decor-far'
  | 'reef-variant-body'
  | 'reef-variant-apron';

export interface RockTarget {
  readonly object: Mesh;
  readonly category: RockCategory;
  readonly label: string;
}

export interface RockTextureSlot {
  readonly present: boolean;
  readonly colorSpace: string | null;
  readonly expected: string;
  readonly ok: boolean;
}

export interface RockMaterialDiagnostics {
  readonly name: string;
  readonly type: string;
  readonly side: number;
  readonly sideName: 'front' | 'back' | 'double';
  readonly roughness: number | null;
  readonly metalness: number | null;
  readonly color: string;
  readonly colorLuminance: number;
  readonly emissive: string | null;
  readonly emissiveIntensity: number | null;
  readonly flatShading: boolean | null;
  readonly vertexColors: boolean;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly depthWrite: boolean;
  readonly normalScale: readonly [number, number] | null;
  readonly aoMapIntensity: number | null;
  readonly maps: {
    readonly map: RockTextureSlot;
    readonly normalMap: RockTextureSlot;
    readonly aoMap: RockTextureSlot;
    readonly roughnessMap: RockTextureSlot;
    readonly metalnessMap: RockTextureSlot;
  };
}

export interface RockGeometryDiagnostics {
  readonly vertices: number;
  readonly triangles: number;
  readonly indexed: boolean;
  readonly hasNormal: boolean;
  readonly normalCount: number;
  readonly hasUv: boolean;
  readonly normalAttributeNormalized: boolean;
  readonly normalUnitFraction: number;
  readonly outwardFraction: number | null;
  /** Mean dot(normal, direction from the bounding-box centre); global sign test. */
  readonly meanAlignment: number | null;
  readonly orientation: 'outward' | 'mixed' | 'inward' | 'unknown';
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  } | null;
}

export interface RockTintDiagnostics {
  readonly present: boolean;
  readonly minLuminance: number;
  readonly maxLuminance: number;
  readonly minColor: string;
  readonly maxColor: string;
  readonly darkInstances: number;
}

export interface RockInstanceDiagnostics {
  readonly count: number;
  readonly negativeScale: number;
  readonly zeroScale: number;
  readonly minDeterminant: number;
  readonly maxDeterminant: number;
  readonly tint: RockTintDiagnostics;
}

export interface RockObjectDiagnostics {
  readonly label: string;
  readonly category: RockCategory;
  readonly name: string;
  readonly type: string;
  readonly visible: boolean;
  readonly inScene: boolean;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly triangles: number;
  readonly worldDeterminant: number;
  readonly geometry: RockGeometryDiagnostics;
  readonly materials: readonly RockMaterialDiagnostics[];
  readonly instances: RockInstanceDiagnostics | null;
  readonly flags: readonly string[];
}

export interface RockDiagnosticsSummary {
  readonly objects: number;
  readonly instances: number;
  readonly triangles: number;
  readonly missingNormals: number;
  readonly inwardNormals: number;
  readonly mixedNormals: number;
  readonly negativeDeterminants: number;
  readonly zeroScaleInstances: number;
  readonly colorSpaceIssues: number;
  readonly doubleSided: number;
  readonly transparent: number;
  readonly darkInstanceTints: number;
  readonly anomalyCount: number;
}

export interface RockDiagnosticsReport {
  readonly objects: readonly RockObjectDiagnostics[];
  readonly summary: RockDiagnosticsSummary;
}

const NORMAL_SAMPLE_LIMIT = 256;
const UNIT_NORMAL_TOLERANCE = 1e-3;
const ZERO_DETERMINANT = 1e-9;
/** Only tint darkening on lit reef rock is suspicious; far decor is dark by design. */
const TINT_AUDIT_CATEGORIES: ReadonlySet<RockCategory> = new Set([
  'primary-core',
  'primary-core-glb',
  'procedural-boulder',
  'foreground',
  'rock-scatter-large',
  'rock-scatter-medium',
  'rock-scatter-debris',
  'reef-variant-body',
  'reef-variant-apron',
]);
const DARK_TINT_LUMINANCE = 0.1;

function sideName(side: number): 'front' | 'back' | 'double' {
  if (side === DoubleSide) return 'double';
  if (side === BackSide) return 'back';
  return 'front';
}

function textureSlot(texture: Texture | null, expected: string): RockTextureSlot {
  const displayExpected = expected === NoColorSpace ? 'none' : expected;
  if (!texture) {
    return { present: false, colorSpace: null, expected: displayExpected, ok: true };
  }
  return {
    present: true,
    colorSpace: texture.colorSpace === NoColorSpace ? 'none' : texture.colorSpace,
    expected: displayExpected,
    ok: texture.colorSpace === expected,
  };
}

/** sRGB <-> linear helpers kept local so the report never mutates material colours. */
function luminance(color: Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function inspectMaterial(material: Material): RockMaterialDiagnostics {
  const standard = material instanceof MeshStandardMaterial ? material : null;
  const color = standard ? standard.color.clone() : new Color(0xffffff);
  return {
    name: material.name || material.uuid,
    type: material.type,
    side: material.side,
    sideName: sideName(material.side),
    roughness: standard ? standard.roughness : null,
    metalness: standard ? standard.metalness : null,
    color: color.getHexString(),
    colorLuminance: luminance(color),
    emissive: standard ? standard.emissive.getHexString() : null,
    emissiveIntensity: standard ? standard.emissiveIntensity : null,
    flatShading: standard ? standard.flatShading : null,
    vertexColors: material.vertexColors,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    normalScale: standard ? [standard.normalScale.x, standard.normalScale.y] : null,
    aoMapIntensity: standard ? standard.aoMapIntensity : null,
    maps: {
      map: textureSlot(standard?.map ?? null, SRGBColorSpace),
      normalMap: textureSlot(standard?.normalMap ?? null, NoColorSpace),
      aoMap: textureSlot(standard?.aoMap ?? null, NoColorSpace),
      roughnessMap: textureSlot(standard?.roughnessMap ?? null, NoColorSpace),
      metalnessMap: textureSlot(standard?.metalnessMap ?? null, NoColorSpace),
    },
  };
}

function inspectGeometry(target: RockTarget): RockGeometryDiagnostics {
  const geometry = target.object.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const vertices = position ? position.count : 0;
  const triangles = geometry.index ? geometry.index.count / 3 : vertices / 3;

  if (!position) {
    return {
      vertices: 0,
      triangles: 0,
      indexed: Boolean(geometry.index),
      hasNormal: false,
      normalCount: 0,
      hasUv: Boolean(uv),
      normalAttributeNormalized: false,
      normalUnitFraction: 0,
      outwardFraction: null,
      meanAlignment: null,
      orientation: 'unknown',
      bounds: null,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;

  let unitNormals = 0;
  let outward = 0;
  let sampled = 0;
  let aligned = 0;
  let alignmentSum = 0;
  if (normal) {
    const step = Math.max(1, Math.floor(vertices / NORMAL_SAMPLE_LIMIT));
    for (let index = 0; index < vertices; index += step) {
      const nx = normal.getX(index);
      const ny = normal.getY(index);
      const nz = normal.getZ(index);
      const length = Math.hypot(nx, ny, nz);
      if (Math.abs(length - 1) <= UNIT_NORMAL_TOLERANCE) unitNormals += 1;
      if (length > 1e-6) {
        const dx = position.getX(index) - centerX;
        const dy = position.getY(index) - centerY;
        const dz = position.getZ(index) - centerZ;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > 1e-6) {
          const dot = (nx / length) * (dx / distance)
            + (ny / length) * (dy / distance)
            + (nz / length) * (dz / distance);
          alignmentSum += dot;
          aligned += 1;
          if (dot > 0) outward += 1;
        }
      }
      sampled += 1;
    }
  }

  const normalUnitFraction = sampled > 0 ? unitNormals / sampled : 0;
  const outwardFraction = sampled > 0 ? outward / sampled : null;
  const meanAlignment = aligned > 0 ? alignmentSum / aligned : null;
  let orientation: RockGeometryDiagnostics['orientation'] = 'unknown';
  if (meanAlignment !== null) {
    // Concave rocks are not star-shaped around their bbox centre, so the raw
    // outward fraction can dip below 0.85 without being a normal bug. The
    // global mean keeps its sign under inversion: an inverted mesh averages
    // strongly negative, a merely concave one stays mildly positive.
    if (meanAlignment >= 0.3) orientation = 'outward';
    else if (meanAlignment <= -0.3) orientation = 'inward';
    else orientation = 'mixed';
  }

  return {
    vertices,
    triangles: Math.round(triangles),
    indexed: Boolean(geometry.index),
    hasNormal: Boolean(normal),
    normalCount: normal ? normal.count : 0,
    hasUv: Boolean(uv),
    normalAttributeNormalized: normal ? normal.normalized : false,
    normalUnitFraction,
    outwardFraction,
    meanAlignment,
    orientation,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}

function determinant3(
  m0: number,
  m1: number,
  m2: number,
  m4: number,
  m5: number,
  m6: number,
  m8: number,
  m9: number,
  m10: number,
): number {
  return m0 * (m5 * m10 - m9 * m6)
    - m4 * (m1 * m10 - m9 * m2)
    + m8 * (m1 * m6 - m5 * m2);
}

function inspectInstances(target: RockTarget): RockInstanceDiagnostics | null {
  const object = target.object;
  if (!(object instanceof InstancedMesh)) return null;
  const matrix = object.instanceMatrix.array;
  const count = object.count;
  let negativeScale = 0;
  let zeroScale = 0;
  let minDeterminant = Infinity;
  let maxDeterminant = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 16;
    const determinant = determinant3(
      matrix[offset],
      matrix[offset + 1],
      matrix[offset + 2],
      matrix[offset + 4],
      matrix[offset + 5],
      matrix[offset + 6],
      matrix[offset + 8],
      matrix[offset + 9],
      matrix[offset + 10],
    );
    if (Math.abs(determinant) <= ZERO_DETERMINANT) zeroScale += 1;
    else if (determinant < 0) negativeScale += 1;
    if (determinant < minDeterminant) minDeterminant = determinant;
    if (determinant > maxDeterminant) maxDeterminant = determinant;
  }

  let tint: RockTintDiagnostics = {
    present: false,
    minLuminance: 1,
    maxLuminance: 1,
    minColor: 'ffffff',
    maxColor: 'ffffff',
    darkInstances: 0,
  };
  const instanceColor = object.instanceColor;
  if (instanceColor) {
    const values = instanceColor.array;
    let min = Infinity;
    let max = -Infinity;
    let minColor = 'ffffff';
    let maxColor = 'ffffff';
    let darkInstances = 0;
    const color = new Color();
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      color.setRGB(values[offset], values[offset + 1], values[offset + 2]);
      const value = luminance(color);
      const hex = color.getHexString();
      if (value < min) {
        min = value;
        minColor = hex;
      }
      if (value > max) {
        max = value;
        maxColor = hex;
      }
      if (value < DARK_TINT_LUMINANCE) darkInstances += 1;
    }
    tint = {
      present: true,
      minLuminance: min,
      maxLuminance: max,
      minColor,
      maxColor,
      darkInstances,
    };
  }

  return {
    count,
    negativeScale,
    zeroScale,
    minDeterminant: count > 0 ? minDeterminant : 0,
    maxDeterminant: count > 0 ? maxDeterminant : 0,
    tint,
  };
}

function isInSceneGraph(object: Mesh): boolean {
  let current: Mesh | null = object;
  while (current.parent) current = current.parent as Mesh;
  return current.type === 'Scene';
}

function inspectTarget(target: RockTarget): RockObjectDiagnostics {
  const object = target.object;
  object.updateWorldMatrix(true, false);
  const worldDeterminant = object.matrixWorld.determinant();
  const geometry = inspectGeometry(target);
  const materialsSource = Array.isArray(object.material) ? object.material : [object.material];
  const materials = materialsSource.map(inspectMaterial);
  const instances = inspectInstances(target);
  const flags: string[] = [];

  if (!geometry.hasNormal) flags.push('geometry:missing-normal');
  if (geometry.hasNormal && geometry.normalCount !== geometry.vertices) {
    flags.push('geometry:normal-count-mismatch');
  }
  if (geometry.hasNormal && geometry.normalUnitFraction < 0.99) {
    flags.push('geometry:non-unit-normals');
  }
  if (geometry.orientation === 'inward') flags.push('geometry:normals-inward');
  if (geometry.triangles === 0) flags.push('geometry:empty');

  for (const material of materials) {
    if (material.side === BackSide) flags.push('material:back-side');
    if (material.side === DoubleSide) flags.push('material:double-sided');
    if (material.transparent) flags.push('material:transparent');
    if (material.maps.map.present && !material.maps.map.ok) {
      flags.push('material:map-color-space');
    }
    if (material.maps.normalMap.present && !material.maps.normalMap.ok) {
      flags.push('material:normal-map-color-space');
    }
    if (material.maps.aoMap.present && !material.maps.aoMap.ok) {
      flags.push('material:ao-map-color-space');
    }
    if (material.maps.roughnessMap.present && !material.maps.roughnessMap.ok) {
      flags.push('material:roughness-map-color-space');
    }
    if (material.maps.metalnessMap.present && !material.maps.metalnessMap.ok) {
      flags.push('material:metalness-map-color-space');
    }
  }

  if (worldDeterminant < 0) flags.push('transform:negative-world-scale');
  if (instances && instances.negativeScale > 0) flags.push('transform:negative-instance-scale');
  if (instances && instances.zeroScale > 0) flags.push('transform:zero-scale-instances');
  if (
    instances
    && instances.tint.present
    && instances.tint.darkInstances > 0
    && TINT_AUDIT_CATEGORIES.has(target.category)
  ) {
    flags.push('tint:dark-instances');
  }

  return {
    label: target.label,
    category: target.category,
    name: object.name,
    type: object.type,
    visible: object.visible,
    inScene: isInSceneGraph(object),
    castShadow: object.castShadow,
    receiveShadow: object.receiveShadow,
    triangles: geometry.triangles,
    worldDeterminant,
    geometry,
    materials,
    instances,
    flags,
  };
}

export function collectRockDiagnostics(
  targets: readonly RockTarget[],
): RockDiagnosticsReport {
  const objects = targets.map(inspectTarget);
  let instances = 0;
  let triangles = 0;
  let missingNormals = 0;
  let inwardNormals = 0;
  let mixedNormals = 0;
  let negativeDeterminants = 0;
  let zeroScaleInstances = 0;
  let colorSpaceIssues = 0;
  let doubleSided = 0;
  let transparent = 0;
  let darkInstanceTints = 0;
  let anomalyCount = 0;

  for (const object of objects) {
    const count = object.instances?.count ?? 1;
    instances += count;
    triangles += object.triangles * count;
    if (!object.geometry.hasNormal) missingNormals += 1;
    if (object.geometry.orientation === 'inward') inwardNormals += 1;
    if (object.geometry.orientation === 'mixed') mixedNormals += 1;
    if (object.worldDeterminant < 0) negativeDeterminants += 1;
    if (object.instances) {
      negativeDeterminants += object.instances.negativeScale;
      zeroScaleInstances += object.instances.zeroScale;
      if (TINT_AUDIT_CATEGORIES.has(object.category)) {
        darkInstanceTints += object.instances.tint.darkInstances;
      }
    }
    for (const material of object.materials) {
      if (material.side === DoubleSide) doubleSided += 1;
      if (material.transparent) transparent += 1;
      const slots = Object.values(material.maps);
      colorSpaceIssues += slots.filter((slot) => slot.present && !slot.ok).length;
    }
    anomalyCount += object.flags.length;
  }

  return {
    objects,
    summary: {
      objects: objects.length,
      instances,
      triangles,
      missingNormals,
      inwardNormals,
      mixedNormals,
      negativeDeterminants,
      zeroScaleInstances,
      colorSpaceIssues,
      doubleSided,
      transparent,
      darkInstanceTints,
      anomalyCount,
    },
  };
}
