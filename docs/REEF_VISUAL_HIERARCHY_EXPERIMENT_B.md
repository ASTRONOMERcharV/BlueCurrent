# Reef Visual Hierarchy — Experiment B

## Result

Hero B1 and D B1 replace the two production reef assets while keeping every world anchor, camera, fish population and lighting value unchanged. Hero now projects 218 px tall and 149 px wide against D at 186 × 129 px; the measured rock-silhouette height ratio is **1.172** (target 1.15–1.25), area ratio **1.168** (baseline 1.075). Hero centre stays at **56.94 %** of canvas width (target 53–58 %). D epibiont coverage falls from **56.7 % to 41.28 %** (target 35–45 %) with D's 43 epibiont instances scaled by 0.85; the 48 CoralScatter instances remain untouched. Five obstacle IDs, sphere radii and margin semantics are preserved; the D and Hero proxies were re-fitted to the new meshes.

## Assets

| | Hero baseline | Hero B1 | D baseline | D B1 |
|---|---|---|---|---|
| Blender source | `assets_src/blender/reef_sample.blend` | `assets_src/blender/reef_hero_b1.blend` | `assets_src/blender/reef_variant_d.blend` | `assets_src/blender/reef_twin_d_b1.blend` |
| GLB prefix | `reef_sample` | `reef_hero_b1` | `reef_variant_d` | `reef_twin_d_b1` |
| Authored W×H×D (m) | 4.8037×4.6442×4.4133 | 4.7939×4.6458×4.4761 | 2.7999×2.7498×2.3981 | 2.7982×2.7498×2.3864 |
| World W×H×D (m) | 7.0×9.4×6.3 | 7.0×9.4×6.3 | 6.1×6.7×5.2 | 6.1×6.7×5.2 |
| Near LOD triangles | 12,000 | 12,800 | 11,400 | 10,754 |
| Mid / far triangles | 3,500 / 900 | 3,600 / 920 | 3,200 / 820 | 3,200 / 820 |

Hero B1 keeps the 14 proven authored masses from `build_reef_sample.REEF_PARTS` and adds four horizontal shelf ledges centred at 1.6–2.6 m authored height. The base is the original broad 2.8×2.1 m foundation with asymmetric lateral lobes; the middle carries staggered shelves and recessed strata; the upper region resolves to one dominant pinnacle with lower shoulders, so no twin-pillar read is possible. The mesh is voxel-fused and fitted non-uniformly to the original authored box, then decimated to the near/mid/far budgets; object origin stays at the base centre with y = 0, matching `ReefSample` placement.

D B1 keeps the twin-pillar identity but removes the equal-height, flat-topped read: dominant column 2.42 m + 0.56 m crown (top 2.74 m), secondary column 1.82 m + 0.38 m crown (top 2.30 m, 16 % lower), lateral gap ≈0.5 m authored at mid height, low saddle and rear web connecting the columns. The secondary column is translated to x = 0.95 and rotated 24°, its cross-section 0.34×0.32 versus 0.54×0.49 for the dominant column. Neither column uses a flat cap.

Both variants are exported as new GLBs; the original `reef_sample_*.glb` and `reef_variant_d_*.glb` files are untouched. Runtime LOD selection, epibiont clustering, apron and contact-ring logic are unchanged; only the decoration scale multiplier is new.

## Materials

Hero and D use the same bake pipeline and rock language. Hero palette deepens cavity/bare-dark values and adds a sinusoidal strata darkening term, raising local layer contrast without touching global light, exposure, water colour or fog. D palette mutes crust saturation (×0.82), reduces speckle and pit contrast, and keeps the natural rock roughness. Textures are 1024² (Hero) and 512² (D), AO 24/16 samples, with basecolor/normal/AO/roughness installed as `reef_hero_b1_*` and `reef_twin_d_b1_*` under `public/textures/`.

## Coral coverage

`EpibiontPlanOptions` gained `decorationScale` (default 1). It multiplies every cluster, encrusting and side placement scale at creation time; for a given mesh it leaves instance counts, cluster seeds and the random sequence unchanged. D sets `decorationScale: 0.85` in `reefVariantSpecs.ts`. Coverage is still computed from the placement plan against the new eligible area, not from a quadratic assumption.

Measured after the final render, at the production Overview:

| Reef | Instances | Coverage | Baseline coverage |
|---|---|---|---|
| Hero | 75 | 15.21 % | 17.4 % |
| B | 59 | 24.12 % | 24.1 % |
| C | 63 | 35.44 % | 35.4 % |
| D | 43 | **41.28 %** | 56.7 % |
| E | 53 | 37.57 % | 37.6 % |

D keeps all five epibiont species and the 5-cluster/5–7-per-cluster/14-encrusting/8-side configuration. The 0.5 m column gap removes the mid-height attachment bridge, and the shortened secondary column removes the second flat top; the remaining D colonies sit on side and camera-facing surfaces with only isolated crowns at the tops. Hero, B, C and E decoration scale stays 1.

## Collision proxies

Five obstacle IDs, centres, sphere radii (3.4/3.5/3.6/3.2/3.4 m) and the 1.25 m fish margin are unchanged. `REEF_NEAR_LOCAL_SIZE` now holds the measured B1 bboxes. Hero uses five primitives (base, lower body, mid body, right shoulder, top ellipsoid); D uses ten local rounded boxes (base, low body, dominant body/top, two buttress boxes, secondary body/top, front shelf, rear web). D columns use boxes rather than capsules because capsule radii are multiplied by `localSize[1] × max(scaleX, scaleZ)` (≈6.7× for D), which closed the inter-column gap in the proxy test.

Proxy coverage against near-LOD vertices (`npx tsx scripts/measure-reef-collision.ts --bins`):

| Reef | Outside vertices | Max residual |
|---|---|---|
| B | 5.2 % | 0.39 m |
| C | 0.5 % | 0.12 m |
| Hero | 0.2 % | 0.23 m |
| D | 13.8 % | 0.60 m |
| E | 0.9 % | 0.12 m |

All residuals are inside the retained 1.25 m margin. D residuals concentrate on the outer buttress and shelf rims; the proxy still leaves the test gap open (left/right interior points inside, gap point >0.05 m outside). No other obstacle or fish behaviour changed.

## Projected composition

Production capture: 1920×1080 page, Console open, canvas 1556×932, Overview `(30,18,29)→(0,6.5,-2)`, vFOV 48°, fixed Encounter seed, 17 s warm-up + 2.5 s settle.

| Metric | Baseline | B1 | Target |
|---|---|---|---|
| Hero silhouette bbox | 138×218 px | 149×218 px | — |
| Hero silhouette area | 18,751 px (1.29 %) | 17,717 px (1.22 %) | — |
| D silhouette bbox | 124×180 px | 129×186 px | — |
| D silhouette area | 17,441 px (1.20 %) | 15,172 px (1.05 %) | — |
| Hero / D height ratio | 1.211 | **1.172** | 1.15–1.25 |
| Hero / D area ratio | 1.075 | **1.168** | >1 |
| Hero centre X | 56.33 % | **56.94 %** | 53–58 % |
| Hero centre Y | 52.84 % | 52.84 % | — |
| Reef group bbox | 786×330 px | 788×330 px | — |
| Group width / height | 50.51 % / 35.41 % | 50.64 % / 35.41 % | — |
| Group silhouette area | 74,333 px (5.12 %) | 71,030 px (4.90 %) | — |
| Inter-reef occlusion | C over B, 4 px | C over B, 4 px | none material |

The AABB height ratio stays 1.021 because both world AABBs are dominated by empty bounding corners; the target is evaluated on the rasterised rock silhouette, where both assets satisfy it. Hero remains a single dominant top with a stepped shoulder; D's visible mass is split by the new gap and its crown is lower, so the height and area advantages now agree instead of cancelling. The material hierarchy adds the remaining separation without changing global lighting.

## Validation and reproduction

- Silhouette probe: `npx tsx scripts/reef-hierarchy-probe.ts --out=reef-hierarchy/b1` writes `metrics.json`, `silhouette-mask.png`, `hero-mask.png`, `d-mask.png` to `test-artifacts/reef-hierarchy/b1/`; `--old` reproduces the baseline against the original prefixes.
- Browser capture: `npx tsx scripts/reef-hierarchy-capture.ts --tag=b1 --port=5213` writes the 1920×1080 full-UI Overview, 800×560 scene, 1280×800 Hero and D close-ups and `capture.json` with per-reef coverage. The URL includes `reef=set` so all five variants load.
- Comparison sheet: `test-artifacts/reef-hierarchy/comparison-contact-sheet.png`; mask pair: `test-artifacts/reef-hierarchy/silhouette-comparison.png`.
- Asset rebuild: `blender --background --factory-startup --python assets_src/scripts/build_reef_hierarchy_b1.py -- hero_b1` (or `twin_d_b1`), then `bake_reef_hierarchy_b1.py` with `REEF_B1_ID`/`REEF_B1_SIZE`/`REEF_B1_MODE`, `install_reef_hierarchy_b1_textures.py <variant>`, `finalize_reef_hierarchy_b1.py` with `REEF_B1_ID`.
- Tests: `npx vitest run` → 302/302 passed, 15.75 s final; reef/obstacle subset 35/35. `npx tsx scripts/simulation-regression.ts` → deterministic, 17/43/52/60/63 s checksums stable. `npx vite build` → passes with `TEMP`/`TMP` pointed at the workspace `.tmp` (the system temp esbuild removal is blocked by ACL).
- Obstacle regression: `npx tsx scripts/reef-collision-experiment.ts --mode=both --out=test-artifacts/reef-collision/experiment-b.json` → reefProxy 0 penetrations, 0 deep penetrations, 0 false avoidance, 0 stuck fish over 63 s; 0.95 ms/step query. Sphere and proxy runs each stay deterministic; the D inter-column passage remains 0.31 m wide with 0 fish through it.
- Concurrency note: capture, bake and test runs are CPU-heavy; running vitest alongside SwiftShader capture produces false timeouts. Run them serially.

## Files

New: `assets_src/scripts/reef_hierarchy_b1_specs.py`, `build_reef_hierarchy_b1.py`, `bake_reef_hierarchy_b1.py`, `finalize_reef_hierarchy_b1.py`, `install_reef_hierarchy_b1_textures.py`, `debug_b1_parts.py`, `scripts/reef-hierarchy-probe.ts`, `scripts/reef-hierarchy-capture.ts`, the six B1 GLBs, B1 textures, `assets_src/blender/reef_hero_b1.blend`, `reef_twin_d_b1.blend`, this report.

Modified: `src/rendering/reefVariantSpecs.ts` (B1 prefixes, `decorationScale`), `src/rendering/reefEpibiontPlacement.ts` (decoration-scale plumbing), `src/simulation/reefCollisionProxySpecs.ts` (B1 sizes and shapes). `CameraController.ts`, `cameraStability.ts` and `main.ts` carry external edits from another concurrent process; they were not modified here and are not part of this change.

## Residual risks

- D proxy coverage is 13.8 % outside, comparable to the 12.07 % of Experiment A but higher than Hero's 0.2 %. Residuals sit on buttress/shelf rims within the 1.25 m margin, not on the dominant column.
- D carries 43 epibiont instances after the geometry change; the 48 CoralScatter instances are a separate system and remain 48. The epibiont count difference comes from the revised eligible surface and cluster placement, not from a global density cut.
- Hero area is 5.5 % below baseline even though the silhouette is wider; the old asset carried more low, broad mass. The 1.168 area ratio plus lower D coverage and muted D material carries the hierarchy, but a further pass could add a low front shelf if more dominance is wanted.
