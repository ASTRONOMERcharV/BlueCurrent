/**
 * Phase 3 caustics: every art-directed number for the world-space caustic
 * field lives here. `surfaces.*.scale` is a multiplier on `pattern.baseFrequency`
 * (effective world frequency = baseFrequency * scale, radians per metre), so
 * seabed, rocks and dunes sample the same continuous world field while keeping
 * their prior relative densities. `strength` is the overall gate multiplier
 * (`water.causticsStrength` mirrors it for the water-medium API); base lighting
 * mode forces the effective uniform to 0.
 */
const CAUSTICS_CONFIG = {
  strength: 0.5,
  color: [0.46, 0.88, 0.78],
  pattern: {
    baseFrequency: 0.42,
    timeSpeed: 0.55,
    // Slightly stronger domain warp and a thinner ridge than the Phase 1
    // baseline: fewer "knitted fabric" bands, more separated filaments.
    warpStrength: 0.5,
    ridgePower: 9,
    fineMix: 0.3,
    fineFrequency: 5.1,
  },
  facing: {
    minimum: 0.12,
    power: 1.6,
  },
  macro: {
    base: 0.58,
    amplitude: 0.42,
    frequencyX: 0.085,
    frequencyZ: 0.115,
    speed: 0.07,
  },
  // Overview sits ~44 m from the target; keep the near/mid seabed readable and
  // let the far edge weaken instead of shimmering into the water.
  distanceFade: {
    start: 26,
    end: 64,
    minimum: 0.15,
  },
  surfaces: {
    floor: { intensity: 0.075, scale: 3.7 },
    rock: { intensity: 0.06, scale: 3.5 },
    dune: { intensity: 0.07, scale: 3.7 },
    coral: { intensity: 0.045, scale: 3.3 },
    glbCoral: { intensity: 0.04, scale: 3.3 },
    distant: { intensity: 0.025, scale: 3 },
    foreground: { intensity: 0.03, scale: 3 },
  },
} as const;

export type CausticSurfaceId = keyof typeof CAUSTICS_CONFIG.surfaces;

/**
 * Phase 4 light shafts: every art-directed value for the six crossed beam
 * planes lives here so `Environment.ts` holds no shaft magic numbers.
 *
 * `positions` are world XZ anchors with a yaw; each anchor gets two planes
 * `crossAngle` apart (3 anchors × 2 = the six shafts). The shader is
 * texture-free: a two-octave world-space value noise (`noise`) slowly modulates
 * brightness and width, `lateral` shapes the soft core + shoulder, and
 * `vertical`/`nearFade`/`farFade`/`seabedFade`/`occlusion` handle every edge.
 * Real depth-test occlusion still cuts the beams behind opaque geometry; the
 * seabed/rock fades are analytic approximations for contacts depth testing
 * cannot resolve (a plane sinking into sand or a rock volume).
 */
const SHAFTS_CONFIG = {
  color: 0x57b8c7,
  opacity: 0.06,
  positions: [
    { x: -12, z: -8, yaw: 0.2 },
    { x: 9, z: -3, yaw: 1.1 },
    { x: -19, z: 13, yaw: 0.7 },
  ],
  crossAngle: Math.PI / 2,
  width: 5.5,
  height: 26,
  centerHeight: 11.5,
  tilt: -0.18,
  // Slow, low-frequency evolution only: the coarse octave spans ~2.4 m and the
  // fine octave ~1.2 m of world space, both well above the pixel footprint at
  // the 38-100 m far-fade band, so distant beams cannot flicker or moiré.
  noise: {
    scale: 0.42,
    verticalScale: 0.55,
    speed: 0.045,
    contrast: 0.55,
    widthAmount: 0.42,
    octaveScale: 2.03,
    octaveWeight: 0.35,
  },
  lateral: {
    corePower: 3,
    coreWeight: 0.74,
    shoulderPower: 1.35,
    shoulderWeight: 0.42,
  },
  // UV fractions along the 26 m plane: both ends fade to zero.
  vertical: {
    bottomFadeEnd: 0.3,
    topFadeStart: 0.82,
  },
  // Camera inside/next to a beam fades it out instead of showing a quad edge.
  nearFade: { start: 3, end: 16 },
  // Distant beams keep only a faint hint; never a hard quad boundary.
  farFade: { start: 38, end: 100, minimum: 0.12 },
  // World-Y envelope above the analytic seabed crest (terrain waves peak at
  // y≈0.31); this is a height band, not a per-pixel floor comparison.
  seabedFade: { start: 1.2, end: 6.4 },
  // Soft shell around each reef core: hides beam fragments inside rock volume.
  occlusion: { rockMargin: 1.1 },
} as const;

/**
 * Central, render-only lighting configuration.
 *
 * Intensities are Three.js light units, not calibrated physical measurements
 * of sea water. Keeping them here makes the base-lighting A/B meaningful and
 * prevents scene assets from quietly acquiring independent lighting values.
 */
export const UNDERWATER_LIGHTING_CONFIG = {
  renderer: {
    exposure: 1.05,
    environmentIntensity: 0.55,
  },
  sun: {
    color: 0xb8e5e7,
    intensity: 2.05,
    position: [-18, 30, 12],
    target: [0, 3, 0],
    shadow: {
      enabled: true,
      mapSize: 1024,
      extent: 38,
      near: 1,
      far: 90,
      bias: -0.00025,
      normalBias: 0.035,
    },
  },
  hemisphere: {
    skyColor: 0x86c6d2,
    groundColor: 0x15414c,
    intensity: 0.8,
  },
  rim: {
    color: 0x9feaff,
    intensity: 0.38,
    distance: 14,
    lift: 6.5,
    positionDamping: 5,
    targetDamping: 6,
  },
  schoolRim: {
    color: [0.38, 0.82, 0.95],
    strength: 0.12,
    power: 3,
    heightShadeMinimum: 0.68,
  },
  predatorRim: {
    color: [0.55, 0.92, 1.0],
    strength: 0.58,
    power: 2.2,
    proceduralStrength: 0.42,
    heightShadeMinimum: 0.68,
    // Attack feedback belongs to the edge only, never the whole body.
    alertColor: [1.0, 0.36, 0.16],
    alertStrength: 0.16,
  },
  water: {
    // Clear temperate-kelp water palette. These are art-directed starting
    // points, not measured absorption spectra.
    background: 0x071e2a,
    color: 0x0a3546,
    scatterColor: 0x146078,
    // Phase 2 layered lit scattering. Near water keeps a teal cast; the far
    // field moves toward deep blue instead of a flat bright veil. The upper
    // column receives a modest lit tint, and the sun lobe is deliberately weak.
    scatterNearColor: 0x1a6878,
    scatterFarColor: 0x0a3a66,
    scatterColorDistance: 28,
    surfaceScatterColor: 0x2f7f8c,
    surfaceScatterStrength: 0.32,
    surfaceHeight: 18,
    deepHeight: 1,
    sunScatterColor: 0xaee6ec,
    sunScatterStrength: 0.2,
    fogDensity: 0.0055,
    attenuationRgb: [1.38, 1.06, 0.78],
    scatteringStrength: 0.9,
    scatteringAnisotropy: 0.35,
    domeDeepColor: 0x071e2a,
    domeMidColor: 0x0a3546,
    domeUpperColor: 0x146078,
    // Phase 2 only: slightly deeper mid/upper stops used when the lit far-water
    // layer is active. Base mode keeps the exact Phase 1 dome palette.
    domePhase2MidColor: 0x0a3f58,
    domePhase2UpperColor: 0x13596a,
    // The dome is the far-water background; give the upper column a weak
    // sunward lit gradient instead of a flat three-stop ramp. The base palette
    // stays close to the accepted water-clarity values; the lobe is narrow so
    // the lit patch does not lift the whole background above the school layer.
    domeSunColor: 0x4a98a5,
    domeSunStrength: 0.8,
    domeSunPower: 4.0,
    surfaceColor: 0xb5dde0,
    surfaceOpacity: 0.012,
    shaftColor: SHAFTS_CONFIG.color,
    shaftOpacity: SHAFTS_CONFIG.opacity,
    marineSnowColor: 0xb5dde0,
    marineSnowOpacity: 0.32,
    marineSnowDensity: 0.42,
    // Phase 3: overall caustic gate. `causticsStrength` is kept as the public
    // water-medium mirror of `caustics.strength` for API compatibility.
    causticsStrength: CAUSTICS_CONFIG.strength,
    caustics: CAUSTICS_CONFIG,
    volumetricStrength: 0.7,
    shafts: SHAFTS_CONFIG,
  },
  materials: {
    floorColor: 0x3b626b,
    rockAtlasTint: 0xffffff,
    duneAtlasTint: 0xe5eef1,
  },
} as const;

export type UnderwaterLightingMode = 'full' | 'base';
export type RgbTriple = readonly [number, number, number];
export type VectorTriple = readonly [number, number, number];

/** World-space direction from the lighting target toward the sun. */
export const UNDERWATER_SUN_DIRECTION: VectorTriple = (() => {
  const [px, py, pz] = UNDERWATER_LIGHTING_CONFIG.sun.position;
  const [tx, ty, tz] = UNDERWATER_LIGHTING_CONFIG.sun.target;
  const dx = px - tx;
  const dy = py - ty;
  const dz = pz - tz;
  const length = Math.hypot(dx, dy, dz);
  return [dx / length, dy / length, dz / length];
})();
