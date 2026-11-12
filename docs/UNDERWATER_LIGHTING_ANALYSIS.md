# Blue Current — Underwater Lighting Analysis (Phase 1)

Date: 2026-11-10  
Scope: current Three.js/WebGL renderer, base lighting, materials and colour management.  
Out of scope in this stage: new water scattering, caustics or light-shaft algorithms. A separate, concurrently edited water-quality layer is preserved as-is.

## 1. Current render pipeline

The main view is a single `WebGLRenderer`, not WebGPU:

- `SceneManager` owns one `Scene`, one `PerspectiveCamera` (`48°`, near `0.1`, far `180`) and one renderer.
- Renderer: `outputColorSpace = SRGBColorSpace`, `ACESFilmicToneMapping`, exposure `1.05`.
- No `EffectComposer`, no `OutputPass`, no screen-space post-processing. There is therefore one final output conversion, not two.
- `scene.environment` is generated once by `PMREMGenerator` from a small procedural equirectangular water gradient.
- The default water path is now a linear `UnderwaterMedium` injection before tone mapping. The legacy `FogExp2` display-space path remains only behind `?water=legacy` for comparison.
- The simulation is fixed-step and independent of these render changes. No Boids, obstacle, predator or scheduler code was changed.

The rendering layers are:

| Layer | Implementation | Phase 1 action |
| --- | --- | --- |
| Sun | DirectionalLight | Reconfigured and centralised |
| Ambient fill | HemisphereLight | Reconfigured and centralised |
| Shared rim | Camera-relative DirectionalLight | Reduced; remains one shared light |
| Creature rim | Fresnel fragment term on shark and school materials | Fixed skinning-space bug; attack changed to rim-only |
| Static shadows | WebGL shadow map | Added for floor/rocks only, rendered once |
| Water extinction | Built-in fog chunk replacement | Left to the water layer; can be disabled in base acceptance |
| Caustics | World-space shader injection on static surfaces | Left unchanged |
| Light shafts / marine snow / surface | Procedural meshes and points | Left unchanged; disabled in base acceptance |
| Background dome | Custom ShaderMaterial | Explicit tone mapping/colour-space output; depth-safe background |

## 2. Lighting structure before Phase 1

Phase 3 left a sensible three-light foundation, but its values and ownership were spread across different files:

- Sun: `0xe6f6ff`, intensity `1.7`, position `(-14, 34, 10)`.
- Hemisphere: sky `0x7fc4d6`, ground `0x082229`, intensity `0.65`.
- Camera-relative rim: `0x9feaff`, intensity `0.85`. This was 50% of the sun and applied to the whole scene, flattening the separation it was meant to create.
- Per-creature Fresnel: shark `0.75`, school `0.18`.
- Exposure `1.0`, environment intensity `0.42`.
- No shadow map and no static shadow casters.

The result was readable but low-directionality: fish, rocks and the seabed occupied similar blue-green luminance bands. The scene relied heavily on the fog/water layer for separation.

## 3. Material and colour-space audit

All visible surfaces use `MeshStandardMaterial`; fish and shark customisation is injected through `onBeforeCompile`. No material uses an unlit colour pipeline.

| Asset | Base colour | Normal / roughness / AO | Status |
| --- | --- | --- | --- |
| Rock atlas | `SRGBColorSpace` | explicit `NoColorSpace` | correct |
| Coral atlas | `SRGBColorSpace` | defaults were correct, now explicit `NoColorSpace` | corrected for clarity |
| Fish GLB | GLTFLoader-managed sRGB | GLTFLoader-managed data maps | correct |
| Shark GLB | GLTFLoader-managed sRGB | GLTFLoader-managed data maps | correct |
| Kelp / seaweed | GLTFLoader-managed | GLTFLoader-managed | correct |
| Procedural fish/rocks/floor | no texture maps | n/a | no issue |
| PMREM environment source | `SRGBColorSpace` before PMREM | resulting environment is linear | correct |

A runtime audit now traverses the actual loaded scene and reports any PBR map whose colour space is wrong. Real-browser diagnostics in full and base mode report `colorSpaceIssues: []`.

### Custom shader output

The background dome, light shafts and marine snow are custom `ShaderMaterial`s. Before this pass they wrote display-space-looking values directly and did not include Three.js output chunks. That left them outside the renderer's ACES/sRGB path and made their intended hex colours ambiguous.

They now use linear `THREE.Color` uniforms and end with:

```glsl
#include <tonemapping_fragment>
#include <colorspace_fragment>
```

The dome additionally renders first (`renderOrder = -1000`) with `depthWrite = false` and `depthTest = false`. This fixed a real regression found during browser acceptance where the dome could cover the entire scene depending on camera and material order.

### Fog colour handoff

Three r180 refreshes `fogColor` with `getUnlitUniformColorSpace(renderer)`, and the built-in `<fog_fragment>` executes after tone mapping and output conversion. The previous project fog chunk applied `sRGBTransferOETF` again before mixing, which was a real double encoding.

The concurrent water-quality pass now uses a default linear medium before tone mapping and retains the old formula only under `?water=legacy`. Phase 1 additionally disables the medium uniforms in base mode, so `?lighting=base` cannot hide behind any water tint. Diagnostics expose `waterMediumActive: false` for that case.

## 4. Creature lighting defects found

### 4.1 Full-body attack emissive

The shark's attack cue was implemented as:

```ts
bodyMaterial.emissive.copy(ATTACK_EMISSIVE);
bodyMaterial.emissiveIntensity = attackGlow * attackGlowStrength;
```

Despite the comment describing a rim cue, this added orange emission to every lit fragment. In the Predator Encounter screenshot the entire shark read pink and lost its grey dorsal / pale ventral countershading.

Phase 1 removes body emission entirely and drives an attack-coloured Fresnel edge through a shared `uRimAlert` uniform. At rest the edge is cool; during attack it warms without changing the body texture.

### 4.2 Skinned Fresnel world position

`applyFresnelRim` previously captured world position immediately after `<begin_vertex>`. For a `SkinnedMesh`, bone deformation happens later in `<skinning_vertex>`, so the rim estimate used the bind pose while the rendered shark used its current pose.

The injection now occurs after `<skinning_vertex>`, then applies `instanceMatrix` once for procedural instanced fish. This is correct for both school fish and the rigged shark.

### 4.3 Shared versus per-predator light

The shark does not get a new real-time light. It shares the sun, hemisphere and one scene rim, and adds only a shader edge term. School fish share the same edge term at less than one quarter of the predator strength. No per-fish lights exist.

## 5. Observation grid

The floor grid is already disabled in Observation mode and reduced to opacity `0.065` in Laboratory mode. It is now explicitly hidden at construction so the first Observation frame cannot depend on initialization order. The real-browser diagnostics report `observationGridVisible: false`.

## 6. Phase 1 target structure

Base lighting is centralised in `src/rendering/lighting/UnderwaterLightingConfig.ts`:

| Parameter | Value |
| --- | --- |
| Sun colour / intensity | `0xb8e5e7` / `2.05` |
| Sun direction | from `(-18, 30, 12)` toward `(0, 3, 0)` |
| Hemisphere sky / ground | `0x86c6d2` / `0x15414c` |
| Hemisphere / sun ratio | `0.80 / 2.05 = 39.0%` |
| Shared rim / sun ratio | `0.38 / 2.05 = 18.5%` |
| Shark / school Fresnel | `0.58` / `0.12` |
| Exposure / environment | `1.05` / `0.55` |
| Shadow map | `1024²`, static casters only |
| Floor / rock / dune tint | `0x3b626b` / `0xffffff` / `0xe5eef1` |

Static shadows are deliberately limited: the seabed, reef rocks and dunes receive; rocks cast; fish, shark, kelp, corals and light shafts do not cast. `shadowMap.autoUpdate = false` and a dirty flag requests a new map only when rock/obstacle geometry changes.

## 7. Baseline evidence

The pre-change source is archived at `test-artifacts/underwater-lighting-v1/phase-1-before-source.tar.gz` with a SHA-256 sidecar. Same-path 500-fish captures:

- [Calm overview before](../test-artifacts/underwater-lighting-v1/before/calm-environment.png)
- [Predator follow before](../test-artifacts/underwater-lighting-v1/before/encounter-predator-environment.png)

Baseline diagnostics: 500 procedural fish, rigged shark, 12 temperate coral colonies, 91 kelp instances, 48 draw calls, 143,025 render triangles in Calm; no browser errors. These are SwiftShader software-render captures and say nothing about hardware GPU performance.

## 8. Phase 1 acceptance hooks

- `?lighting=full` — all existing water/effect layers.
- `?lighting=base` — base sun/fill/rim/materials only; fog, caustics, shafts, surface and marine snow disabled.
- `window.__blueCurrent.getDiagnostics().lighting` — real renderer/lights/shadow state and colour-space audit.
- `scripts/visual-quality-capture.ts --lighting=base|full` — deterministic screenshot with the real-frame counter wait.
- `scripts/gpu-acceptance.ts --lighting=base|full` — same performance harness for both layers.

## 9. Risks carried into later phases

1. The default water path and its double-encoding fix are owned by the concurrent water-quality pass; `?water=legacy` intentionally preserves the old look only for A/B and must not ship as the default.
2. Static shadow quality is 1024² and covers the main reef, not the full 70 m floor. Increasing it is a visual decision with a one-time render cost, not a per-frame cost.
3. Custom shaft/particle shaders now tone-map individually. Their colours must be rechecked after any future `EffectComposer`/`OutputPass` adoption.
4. The shader injection searches exact Three r180 chunk names. A Three.js upgrade requires rerunning the unit tests and real-browser capture.
5. Hardware GPU FPS/P95 at 500/1000/2000 fish remains unverified in this environment; software counters are not substitutes.
6. Base mode now disables the water medium as well as local effects. Any future render layer added outside `Environment` must join the same base-mode gate.
