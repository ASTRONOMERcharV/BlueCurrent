# Predator Procedural Swimming Animation — Analysis (Stage 1)

Date: 2026-11-09
Scope: Blue Current predator (shayu, user-supplied GLB), Three.js renderer.
Status: analysis only; no runtime change yet.

## 1. What the current implementation actually does

The predator is a **static mesh**. `public/models/predator_shayu.glb` contains no
armature, no skin and no animation clip (6,570 vertices / 9,826 triangles /
3 materials). All apparent motion is produced by three mechanisms:

1. **Root transform** — `PredatorRenderer.update()` copies the simulation
   position, and every frame builds a target quaternion from the velocity
   vector with `setFromUnitVectors(FORWARD, velocity)` and then
   `renderQuaternion.slerp(target, 1 - exp(-dt * 9))`
   (`src/rendering/PredatorRenderer.ts:330-342`).
2. **A vertex-shader lateral shear** — at `PredatorRenderer.ts:113-130` the
   shader adds `swimOffset` to `position.x`, where
   `swimOffset = (sin(phase + z*1.05) + 0.28*sin(...)) * tailWeight * amplitude`,
   and `amplitude = (0.15 + 0.035*speed) * (0.35 + 0.65*tailWeight)`.
3. **A vertex-shader rotation field for turning** — around a head pivot at
   `z = 2.45`, angle `-turn * 0.38 * pow(bodyT, 1.35)`, with a slower
   `uTurnLag` signal blended into the tail. Normals get the same rotation.

There is no skeletal deformation anywhere in the pipeline.

## 2. Root causes of the reported problems

### A. The body still looks like a stick

The swim wave is a **shear**, not a bend. Every cross-section keeps its
original orientation and only slides sideways; cross-sections near the head and
near the tail move almost in parallel. A real fish swim travels as a curvature
wave: each cross-section **rotates** about its own spine joint, and the
displacement of the tail is the accumulated rotation of the whole rear body.

Three further details make it weak:

- The amplitude envelope is `0.35 + 0.65 * tailWeight`, so the head still
  receives 35 % of the wave and sways with the tail instead of staying stable.
- The absolute amplitude is only ~0.17 world units at cruise for a 5.28-unit
  shark — a visible shiver, not a propulsive body wave.
- Normals are **not** rotated for the swim wave (only for the turn field), so
  the lighting does not follow the deformation and the surface reads as rubber.

### B. The tail fin does not really beat

The caudal fin is part of the same static mesh. The shader only translates it
sideways. It never pitches about the peduncle, so the fin stays parallel to the
flow instead of sweeping through an angle of attack. There is no peduncle bone,
no tail-fin bone, and no phase relationship between body wave and fin.

### C. Turning is a rigid rotation plus a uniform arc

The current turn field rotates the whole rear body around one pivot with a
single `turn` value. That produces a smooth **arc**, but:

- curvature is distributed by a fixed `t^1.35` curve, independent of real
  angular velocity;
- there is no head-leads / body-follows / tail-lags chain — only one delayed
  scalar applied over the whole tail;
- the pectoral fins do not participate at all.

### D. Ascending / descending is abrupt

`setFromUnitVectors` aligns the model's +Z with the instantaneous velocity. This:

- has no pitch-rate limit, so a vertical velocity change snaps the nose;
- mixes yaw, pitch and roll into one minimal rotation, which introduces
  unintended roll whenever lateral and vertical motion combine;
- becomes unstable when horizontal speed approaches zero;
- is then re-composed with a separate `bankQuaternion` around local +Z, so the
  final roll is not a controlled quantity.

There is no separate pitch controller, no damping, and no pectoral fin
adjustment for vertical maneuvering.

## 3. Model inspection (why the rig has to be built positionally)

Inspected directly in Blender (`assets_src/blender/predator_shayu.blend`):

| Item | Value |
| --- | --- |
| Vertices / polygons | 6,570 / 9,826 |
| Objects | 1 mesh `predator_shayu`, no armature, no modifiers |
| Materials | `predator_body`, `predator_mouth`, `predator_teeth` |
| Blender bbox | x −1.3213..1.3213, y −2.64..2.64, z −1.014..1.014 |
| Blender axes | length along Y, **head at y = −2.64**, up = +Z |
| glTF axes | head at +Z, up = +Y (export maps Blender −Y → glTF +Z) |
| Connected components | **84** shells |

The mesh is not a clean single surface. The body is split into left/right and
upper/lower shells (largest components: 629, 589, 381, 345, 277, 277 vertices),
and fins, teeth and mouth are separate shells. Consequences:

1. Weights **must be computed from world position**, not per connected
   component, or the split body halves will separate at the midline when bent.
2. The pectoral fins are partly fused into the lower body shells. They are
   still uniquely identifiable by position: every body vertex has
   `|x| ≤ 0.543`, while the pectoral region has `|x| = 0.559..1.321`,
   `y = −0.905..0.153`, `z = −0.794..−0.579` (~320 vertices per side).
3. The caudal fin occupies `y ≈ 1.9..2.64`, with the peduncle around
   `y ≈ 1.85..2.25` and the fin tip swept upward. A tail-fin bone at the end
   of the chain can articulate it without cutting the mesh.

## 4. Chosen approach

**Blender armature + Three.js SkinnedMesh, driven procedurally from the real
simulation state.** This follows the requested architecture:

- Simulation keeps owning position / velocity / state; animation only reads it.
- A bone chain provides true cross-section rotation, so the body wave is
  curvature, not shear.
- The tail fin and pectoral fins become independent bones.
- Skinning normals deform correctly with the mesh; no shader hacks.
- Cost is negligible for one predator (≈6.6 k skinned vertices).

Shader deformation remains only for the legacy variants
(`predator_reef_shark.glb`, `predator_v3_phase*.glb`) and the procedural
fallback; the rigged path does **not** apply the old swim shader, otherwise the
displacement would be skinned twice.

### 4.1 Bone hierarchy (Blender coordinates, head −Y)

```
Predator_Root            (0, 0, -0.40)                 # whole-model anchor
└─ Spine_00             -2.55 → -1.85 (head/neck)
   └─ Spine_01          -1.85 → -1.10
      └─ Spine_02       -1.10 → -0.35
         └─ Spine_03    -0.35 →  0.40
            └─ Spine_04  0.40 →  1.15
               └─ Spine_05 1.15 → 1.85
                  └─ Caudal_Peduncle 1.85 → 2.25
                     └─ Tail_Fin      2.25 → 2.62 (swept up)
   ├─ Pectoral_L_Root  (-0.55, -0.60, -0.63) → (-1.31, -0.10, -0.66)
   └─ Pectoral_R_Root  ( 0.55, -0.60, -0.63) → ( 1.31, -0.10, -0.66)
```

`Pectoral_*_Root` is parented to `Spine_02` (body region around y = −0.6), so
the fins follow the body but can also be posed independently.

A `Jaw_Lower` bone is intentionally **not** added in this stage: the shayu
source has a painted, permanently open mouth and upper/lower teeth modelled in
one static band; there is no clean lower-jaw split. Jaw animation is a P2 item.

### 4.2 Weighting rules

- Head (`y < −1.9`): 100 % `Spine_00`.
- Body chain: each vertex projects to its position along the joint sequence
  `−2.55, −1.85, −1.10, −0.35, 0.40, 1.15, 1.85, 2.25, 2.62`; weights are
  interpolated between the two adjacent bones with a smooth blend zone around
  each joint, so curvature is continuous and the split body halves stay closed.
- Caudal fin (`y > 2.25`): blends from `Caudal_Peduncle` into `Tail_Fin`, with
  the tip fully on `Tail_Fin`.
- Pectoral fins: `finWeight = smoothstep(0.55, 0.72, |x|)` inside the pectoral
  box, transferred from the chain weights to the corresponding pectoral bone.
  Root vertices stay partly on the body so the fin root does not tear.
- All weights normalised to sum 1; max 2 influences per vertex (well inside the
  glTF 4-influence limit).

### 4.3 Runtime animation model

`PredatorAnimationController` will produce a pose from
`{velocity, acceleration, angular velocity, speed, state}`:

- **Travelling wave** per bone:
  `theta_i = A(s_i) * sin(phase − k*s_i) + turnBias_i`,
  `A(s) = A_max * smoothstep(0.35, 1.0, s)^1.1`, `s ∈ [0,1]` head→tail.
- **Frequency** smoothly follows speed (and attack), phase is integrated
  (`phase += 2πf·dt`) and never reset.
- **Turn**: delayed turn signal distributed along the body (head leads, tail
  lags), amplitude clamped; bank around the local forward axis.
- **Pitch**: target `atan2(vy, horizontalSpeed)` with a max pitch rate and
  critically damped smoothing; yaw and pitch are composed explicitly instead
  of `setFromUnitVectors`.
- **Pectoral fins**: vertical velocity drives a small symmetric angle of
  attack; banking adds a small asymmetric component, clamped to a few degrees
  (not a bird-like flap).
- **Attack**: short frequency/amplitude boost, then natural decay.

### 4.4 Verification plan

1. Blender pose tests: bend each spine joint and the tail/pelvic fins; check
   for cracks along the split midline and at fin roots.
2. GLB structural verifier: skin present, joint names/hierarchy, weights sum,
   triangle/material/length contract, no animation clips.
3. Vitest: envelope monotonicity, frequency mapping, phase continuity across a
   state change, pitch rate limit, bank sign/clamp, turn sign.
4. Browser smoke: measure actual bone quaternions over time (tail must move
   while cruising; left/right turns symmetric; no NaN), capture side/top/front
   screenshots and a continuous manoeuvre sequence.
5. Regression: `npm test`, `tsc --noEmit`, `npm run build`, existing
   `smoke:predator` / `smoke:predator:shayu` must stay green with the legacy
   asset path.
