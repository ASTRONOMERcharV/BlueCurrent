# Experiment A — Reef Collision Proxy Refactoring

Status: implementation and validation complete (2026-11-11). Software-rendered captures
and CPU simulation evidence only; no GPU performance claims.
Scope: replace the five spherical fish-avoidance colliders with switchable, SDF-based
compound proxies built from the real reef GLB geometry. No changes to schooling,
separation/alignment/cohesion, predator behaviour, fixed-step timing or camera/UI
production paths.

## 1. Current data flow (audited 2026-11-11)

```
SimulationConfig (obstacleWeight / obstacleMargin / obstacleLookAhead)
        │
SimulationWorld ── owns ── ObstacleSystem (5 × {center, radius, variant})
        │                          │
        │                          ├─ computeAvoidance(x,y,z,vx,vy,vz, config, out)
        │                          │     predictive sphere test + radial normal + tangent
        │                          ├─ constrain(positions, velocities, offset, config, padding)
        │                          │     hard projection to sphere radius + padding, removes inward v
        │                          └─ blocksSegment(x0..z1)  (predator line-of-sight / fear)
        │
        ├─ BoidSystem.update() ── per fish: obstacles.computeAvoidance() at the end of the
        │     steering sum, then obstacles.constrain() after integration.
        └─ PredatorSystem.update() ── same computeAvoidance/constrain/blockSegment calls.

Rendering placement (independent of simulation):
  reefVariantSpecs.ts  ── target W/H/D, yaw, tiltX/Z, embedDepth, anchorIndex
  ReefSampleAsset.ts   ── near/mid/far GLB dimensions measured after load
  ReefSample.ts        ── group.position = (cx, floorHeightAt(cx,cz) − embedDepth, cz)
                          group.rotation = Euler(tiltX, yaw, tiltZ, 'YXZ')
                          group.scale    = (targetW/localW, targetH/localH, targetD/localD)
  Environment.ts       ── loads the five GLBs, hides the matching large-rock instances,
                          keeps the five obstacle spheres untouched.
```

The simulation and the renderer share only the five obstacle centers/radii
(`reefVariantSpecs.anchorIndex`). The visual group transform is never visible to the
simulation, which is why the sphere envelope and the visible rock drift apart.

## 2. Measured mismatch (world space, actual runtime transform)

Computed from the near-LOD GLBs with the real `position + Euler YXZ + non-uniform scale`
used by `ReefSample.ts` (`scripts/measure-reef-collision.ts` reproduces the table).

| Reef | Visible world Y | Sphere Y | Top − sphere top | Note |
|---|---|---|---|---|
| B / Spire | −0.69 … 5.91 | 0.00 … 6.80 | −0.89 m | sphere over-tall, over-wide in x/z |
| C / Platform | −0.13 … 4.16 | 0.00 … 7.00 | −2.84 m | 7 m sphere envelope vs 4.3 m rock |
| Hero | −0.50 … 8.90 | 0.00 … 7.20 | **+1.70 m** | visible top exits the sphere |
| D / Twin | −0.33 … 6.32 | 0.00 … 6.40 | −0.08 m | sphere fills the real twin gap |
| E / Terraces | −0.84 … 4.33 | 0.00 … 6.80 | −2.47 m | sphere over-tall |

These numbers match the reported symptoms: C/E early detours above the rocks, Hero
top clipping, D losing its two-column structure.

## 3. Design

### 3.1 Mode switch

`SimulationConfig.obstacleShapeMode: 'sphere' | 'reefProxy'`, default `'sphere'`
(current project behaviour, existing checksums untouched). Explicit selection:
`?obstacleShape=reefProxy|sphere`, Laboratory control, or `world.setObstacleShapeMode()`.
The sphere code path is preserved verbatim and remains the fallback when no proxy set
has been installed (`?reef=off`, failed GLB load).

### 3.2 SDF library (`src/simulation/sdf.ts`)

Pure functions, positive outside / zero on surface / negative inside:

- `sdRoundedBox(x,y,z, halfX,halfY,halfZ, rounding)`
- `sdCapsule(x,y,z, ax,ay,az, bx,by,bz, radius)`
- `sdEllipsoid(x,y,z, rx,ry,rz)` (IQ approximation)
- `unionDistance(...)` = min

Normals: analytic for box (clamped-corner direction), capsule (point − segment
closest point) and ellipsoid (gradient of the quadratic implicit form). Degenerate
cases (zero-length capsule, point on the axis, zero gradient, deep interior) fall back
to the primitive center → point direction, then +X. Compound union takes the normal of
the minimum primitive; central difference is only used if an analytic normal degenerates.

### 3.3 Proxies (`src/simulation/ReefCollisionProxy.ts`, `reefCollisionProxySpecs.ts`)

Each reef is a `ReefCollisionProxy` made of 2–4 primitives. Shape parameters are stored
as fractions of the measured local near-LOD bounds, so the proxy follows the actual
GLB dimensions at runtime (`assets.stats` from `ReefSampleAsset`) and the real world
transform: `T = (cx, floorHeightAt(cx,cz) − embed, cz)`, `R = Euler YXZ`, `S =
target/local`. Shapes:

| Reef | Compound shapes (local fractions of the measured near-LOD bounds) |
|---|---|
| B Spire | base rounded box + mid rounded box + lower-spire capsule + leaning tip capsule (4) |
| C Platform | wide flat rounded box (y ≈ 0–1.1 local) + small upper terrace box (2) |
| Hero | base rounded box + mid box + left-shoulder capsule + right-shoulder box + top ellipsoid (5) |
| D Twin | low connector box + left capsule + right capsule + thin back web box, front gap preserved (4) |
| E Terraces | base slab + mid terrace box + top terrace box (3) |

World mapping: a local rounded box under `S` and `R` is an exact oriented box with half
extents `half × S`; box rounding inflates by `rounding × max(Sx,Sy,Sz)` so tall/narrow
scales do not under-cover. Capsules keep their endpoints in local space and evaluate
`sdCapsule(localPoint)` exactly, then scale the distance by the smallest scale factor;
normals are transformed by `S⁻¹R` (inverse transpose) and renormalized, so non-uniform
scaling cannot pull the surface normal off the true nearest surface. Ellipsoid radii
scale per axis. All approximations are documented in `ReefCollisionProxy.ts` and covered
by tests.

Coverage against all near-LOD vertices with the real runtime transform
(`scripts/measure-reef-collision.ts`, world-space SDF, 2026-11-11):

| Reef | vertices outside proxy | outside > 0.05 m | max outside | primitives |
|---|---|---|---|---|
| B | 5.20 % (611 / 11,746) | 454 | 0.39 m | 4 |
| C | 0.50 % (57 / 11,428) | 13 | 0.12 m | 2 |
| Hero | 1.64 % (187 / 11,435) | 108 | 0.25 m | 5 |
| D | 12.07 % (1,510 / 12,512) | 1,145 | 0.62 m (thin interior web) | 4 |
| E | 0.91 % (115 / 12,597) | 42 | 0.12 m | 3 |

With `obstacleMargin = 1.25 m` the remaining deficits are far inside the stand-off band;
D's uncovered thin web is ≤ 0.62 m and is recorded as a calibration item. Local-space
proxy coverage is slightly lower than world-space coverage for every reef (e.g. Hero
305 vs 187 vertices outside), confirming that the runtime scale helps rather than hides
the fit.

### 3.4 Avoidance integration (`ObstacleSystem.ts`)

- `margin` is applied once, outside the SDF: `clearance = margin − sdf(point)`.
- `strength = clamp(max((margin − sdfCurrent)/margin, (margin − sdfPredicted)/margin, 0), 0, 1)`.
- Force = `maxAcceleration × obstacleWeight × strength²` along the nearest-surface
  normal; same tangent term (0.38) and same look-ahead.
- `constrain`: if `sdf < padding`, push `(padding − sdf)` along the normal and remove
  inward velocity. Sphere mode keeps the original center-radius math.
- `blocksSegment`: exact sphere test in sphere mode; conservative sampling (≤ 0.6 m
  step) against the SDF union in proxy mode, after a bounding-sphere reject.
- Broad phase: per-proxy bounding sphere (`center`, `radius`) vs point distance +
  `margin + speed × lookAhead`.

### 3.5 Diagnostics (`ReefObstacleMetrics.ts`)

Recorded only when enabled (Laboratory mode or `?obstacleMetrics=1`), never fed back
into steering and never used in checksums:

`proxyPenetrationCount`, `deepPenetrationDuration` (fish·s below −0.25 m, pre-projection),
`falseAvoidanceCount` (force while proxy SDF > margin), `averageObstacleForce`,
`p95ObstacleForce`, `passageThroughput` (B–C, C–Hero, Hero–D, B–Hero gates, cumulative
crossings), `stuckFishCount` (speed < 0.5 m/s within margin for > 2 s), `obstacleQueryTime`
(CPU ms, explicitly not GPU time). Per-reef breakdown for the five anchors, plus
school/clownfish totals. Values are exported through
`window.__blueCurrent.getObstacleDiagnostics()` and written to
`test-artifacts/reef-collision/`.

### 3.6 Laboratory debug

`CollisionDebugVisualizer` (rendering): proxy wireframes, margin-expanded shells,
selected-fish SDF normal arrow and numeric readout, red markers for fish inside a proxy.
Visible only in Laboratory mode with the matching toggles; production observation
rendering is untouched. URL `?collisiondebug=1` turns the master layer on at boot.

## 4. Files

New:

- `src/simulation/sdf.ts`
- `src/simulation/ReefCollisionProxy.ts`
- `src/simulation/reefCollisionProxySpecs.ts`
- `src/simulation/ReefObstacleMetrics.ts`
- `src/rendering/CollisionDebugVisualizer.ts`
- `tests/Sdf.test.ts`, `tests/ReefCollisionProxy.test.ts`, `tests/ReefObstacleMetrics.test.ts`
- `scripts/measure-reef-collision.ts`, `scripts/reef-collision-experiment.ts`,
  `scripts/reef-collision-capture.ts`

Modified:

- `src/simulation/SimulationConfig.ts` (mode field, default `sphere`)
- `src/simulation/ObstacleSystem.ts` (dispatch + proxy queries + metrics hooks)
- `src/simulation/SimulationWorld.ts` (proxy set install, metrics sampling, mode setter)
- `src/simulation/Scenarios.ts` (preserve explicit obstacle shape mode)
- `src/simulation/BoidSystem.ts` (metrics timing hooks only if needed)
- `src/rendering/ReefSample.ts` / `Environment.ts` / `SceneManager.ts` (expose real
  collision transform, mount debug visualizer)
- `src/ui/layout.ts` / `ControlPanel.ts` (Laboratory-only controls + readout)
- `src/main.ts` (URL flags, proxy install after reef set load, diagnostics API)
- tests for `ObstacleSystem` (both modes)

Unchanged on purpose: flocking weights, separation/alignment/cohesion, predator FSM,
fixed step, `kelpLayout`, camera presets, observation-mode UI, sphere baseline data.

## 5. Implementation order and gates

1. Data-flow audit + plan (this document).
2. SDF library + unit tests; C/E proxies + coverage checks.
3. B/Hero/D proxies + coverage checks.
4. Avoidance integration behind `obstacleShapeMode`; sphere checksum regression must
   stay bit-identical.
5. Laboratory debug visualization + screenshots.
6. Fixed-seed 17/43/52/60/63 s Sphere vs ReefProxy comparison, metrics, performance.
7. Final report with residual issues and manual-calibration parameters.

## 6. Validation results

### 6.1 Determinism and baseline preservation

`scripts/reef-collision-experiment.ts --verify` runs each mode twice. The 150-step
Encounter warm-up always uses the sphere collider (browser boot order: scenario before
the reef GLBs finish loading), so both modes start the measured run from the same state.

| Mode | 17 s | 43 s | 52 s | 60 s | 63 s | rerun |
|---|---|---|---|---|---|---|
| Sphere | `e9343dcd` | `e1f550b7` | `b33d33b9` | `a372c9c0` | `b6009e0c` | identical |
| ReefProxy | `cefb0cd2` | `b1d13b00` | `3ef29a36` | `f025595c` | `493eb4f3` | identical |

The sphere checksums match the pre-experiment `scripts/simulation-regression.ts`
baseline exactly, so the default path is bit-identical to before this experiment.
ReefProxy is deterministic across reruns; checksums cover fish/clownfish positions,
velocities, alive masks, predator state and step count, not wall-clock timings.

### 6.2 Sphere vs ReefProxy at 63 s (500 fish + 100 clownfish)

| Metric | Sphere | ReefProxy |
|---|---|---|
| proxyPenetrationCount | 0 | 0 |
| deepPenetrationDuration | 0 | 0 |
| falseAvoidanceCount (cumulative) | 61,429 | **0** |
| averageObstacleForce | 2.13 | 2.06 |
| p95ObstacleForce | 7.50 | 6.88 |
| stuckFishCount | 0 | 0 |
| passages B–C / C–Hero / Hero–D / B–Hero | 679 / 539 / 1,109 / 674 | 646 / 554 / 948 / 623 |
| obstacleQueryTime (CPU ms/step, average) | 0.495 | 0.773 (+56 %) |
| Hero fish above old sphere top | 1 (momentary) | 1 (momentary) |
| D twin-gap SDF clearance | 0.436 m | 0.436 m |
| fish inside D twin gap | 0 | 0 |

False avoidance per reef (sphere → ReefProxy), cumulative at 63 s:

| Reef | Sphere | ReefProxy | ReefProxy avg / p95 force | min fish clearance |
|---|---|---|---|---|
| B / Spire | 11,015 | 0 | 3.40 / 11.25 | 0.28 m |
| C / Platform | 8,531 | 0 | 2.05 / 7.50 | 0.50 m |
| Hero | 16,890 | 0 | 1.82 / 6.25 | 0.28 m |
| D / Twin | 7,118 | 0 | 2.38 / 7.50 | 0.33 m |
| E / Terraces | 17,875 | 0 | 1.80 / 5.62 | 0.51 m |

Time series (false avoidance cumulative):

| Time | Sphere | ReefProxy |
|---|---|---|
| 17 s | 23,767 | 0 |
| 43 s | 43,123 | 0 |
| 52 s | 57,426 | 0 |
| 60 s | 60,082 | 0 |
| 63 s | 61,429 | 0 |

The sphere mode pushes fish while the nearest visible rock is a metre or more away
(fish are inside the old spherical envelope but outside the rock); the proxy mode never
reports a force outside its own margin. B's average force is higher under the proxy
because the real base is wider than the sphere at low height, so fish legitimately
approach the rock more closely there before the margin force ramps up; this is geometry,
not a regression. C/E opened-space occupancy appears (C `open=8` at 63 s; transient Hero
2 at 43 s, E 1 at 17 s, B 1 / D 1 at 60 s), proving fish use the space that the old
spheres falsely occupied. No penetration, deep penetration or stuck fish were recorded in
either mode.

Query cost is CPU-only, measured in the Node simulation (no rendering), and varies by
run: observed ReefProxy 0.75–0.91 ms/step vs Sphere 0.50–0.63 ms/step (+44–56 %). It is
not GPU time and does not include debug visualization.

### 6.3 Interpretation against the reported symptoms

- B–C / C–Hero channels: passage counts stay in the same order of magnitude; the proxy
  removes the false detours that inflated the sphere counts at some times.
- C / E early detours above the rocks: the old spheres extended 2.84 m / 2.47 m above the
  visible tops; the new flat proxies sit on the actual platforms and fish occupy the
  opened space.
- Hero top clipping: the top ellipsoid covers the visible spire; `heroFishAboveOldSphereTop`
  no longer indicates fish above a collider-free top (1 momentary sample during the run).
- D twin gap: the proxy preserves a 0.44 m SDF gap between the two columns. With the
  current 1.25 m margin, fish still do not enter; the gap is geometrically open but the
  stand-off band seals it at this margin. This is a calibration decision, not a proxy bug.
- Long stalls / anomalous avoidance: zero stuck fish and zero false avoidance under the
  proxy; sphere false avoidance was continuous throughout the 63 s run.
- Clownfish: the experiment counts include the 100 clownfish flock; reef-adjacent
  activity continues with no penetration. Clownfish margin stays 0.55 m.

## 7. Laboratory debug screenshots

Captured from the production build `dist-reef-collision-6` with Playwright/SwiftShader,
Laboratory mode, all debug layers, `?obstacleShape=reefProxy&obstacleMetrics=1`:
`debug-overview.png`, `debug-spire-b.png`, `debug-platform-c.png`, `debug-hero.png`,
`debug-hero-margin.png`, `debug-hero-top.png`, `debug-twin-d.png`, `debug-twin-gap.png`,
`debug-terraces-e.png` under `test-artifacts/reef-collision/`. Screenshots show the
original reef mesh, proxy edges, margin shell, selected-fish normal and the numeric
readout (SDF distance, clearance = SDF − margin, penetration flag). SwiftShader FPS in
the screenshots is not representative of GPU performance. In the E capture the readout
names Reef B because the paused initial school has no fish whose nearest proxy is E; the
E proxy geometry itself is visible. `capture-results.json` records browser diagnostics
and zero page errors for the batches that completed.

## 8. Tests

- `npx tsc --noEmit`: clean.
- `npx vitest run --isolate=false`: **38 files / 266 tests passed** (Vitest 5.1.0).
- New tests: `Sdf.test.ts` (7), `ReefCollisionProxy.test.ts` (11),
  `ReefObstacleMetrics.test.ts` (4); `ObstacleSystem.test.ts` extended from 4 to 7
  (sphere baseline, proxy steering, proxy constrain, proxy line-of-sight). 25 new tests
  in total, all passing.
- Regression: the pre-existing 241 tests pass unchanged; sphere-mode checksums match the
  old baseline exactly.

## 9. Known issues and manual-calibration parameters

1. **D twin gap is sealed by the margin.** Gap SDF is 0.44 m while `obstacleMargin` is
   1.25 m; fish avoid entering. If gap passage is desired, reduce the margin locally
   (or add a gap-corridor exception) and re-run the D–Hero channel count. Do not shrink
   the two D capsules without re-checking coverage (currently 12.07 % outside, max 0.62 m
   on the interior web).
2. **B base force is stronger than the old sphere.** The proxy base is wider at low
   height (avg 3.40 vs 1.71, p95 11.25 vs 5.63). If the school hugs the base too
   tightly, reduce B's base half extents by ~5–10 % or lower `obstacleWeight`; the
   margin band is currently 1.25 m.
3. **CPU query cost +44–56 %.** 0.75–0.91 ms/step at 600 fish in Node. Optimisation
   options: cache per-fish nearest proxy for N steps, or a tighter broad phase. Do not
   report this as GPU cost.
4. **D interior web under-coverage.** 0.62 m maximum outside the proxy, inside the
   margin; acceptable now, but a future thin-web primitive would close it.
5. **Rounding on extreme non-uniform scales is conservative.** Box rounding scales by
   `max(S)`; the proxy is slightly puffy on tall reefs, which is safe for avoidance but
   visually loose in debug. Adjust per-reef rounding fractions if the shells look too
   thick.
6. **Debug readout is nearest-proxy based.** A selected fish is labelled with its nearest
   reef; in sparse initial states the nearest proxy may not be the reef being framed
   (seen in the E capture). This is display-only and does not affect simulation.
7. **No GPU acceptance yet.** All screenshots use SwiftShader; the user still needs a
   local hardware-GPU browser pass for visual acceptance. Performance metrics in this
   report are CPU simulation timings.
