# Blue Current Blender 资产契约

版本：v0.3（2026-11-08）
状态：v0.1 历史文档。School Fish 的条款已被 [ASSET_SPEC.md](ASSET_SPEC.md) v1.1 取代；礁石、珊瑚、海藻条款在各自升级前继续有效。实际实现与验收以 ASSET_SPEC 和 ASSET_PIPELINE 为准。

本项目当前实现以 `src/rendering/FishRenderer.ts`、`src/rendering/Environment.ts`、`src/rendering/PredatorRenderer.ts` 为准。本文档中的尺寸均由代码推导，不是估计值。

## 0. 一句话总结

鱼必须是局部 +Z 朝前、尾在 −Z、总长约 1.65 个局部单位、尾部顶点落在 `z ≤ −0.95` 的全摆区间、不超过 300–400 个三角形；静态资产必须 Y 向上、原点按约定放置、低模单材质。不符合的模型不进入项目。

## 1. 坐标系与单位

- Three.js 世界为右手系、Y 向上，1 单位约等于 1 米。
- 所有 GLB 以 +Y up、米制、缩放 1.0 导出。Blender glTF 导出器默认就是 Y up，保持默认即可。
- 生物类资产（鱼、捕食者）的局部 +Z 为前向，与 `FishRenderer.ts` 和 `PredatorRenderer.ts` 中的 `FORWARD = (0, 0, 1)` 一致：头朝 +Z，尾朝 −Z。
- 不要在 Blender 里把模型旋转成“看起来朝前”的其他朝向再导出。Blender 视图里请直接让鱼头指向 +Z 轴。

## 2. 鱼类尺寸与顶点契约

当前程序化鱼由 `createFishGeometry()` 生成：

| 项目 | 数值 |
| --- | --- |
| 身体 | 半径 0.5 的球体缩放 (0.54, 0.38, 1.24)，理论半长 z = 0.62，离散网格实际最大 z ≈ 0.590 |
| 尾鳍中心 | z = −0.82 |
| 尾尖 | z ≈ −1.060 |
| 包围盒总长 | ≈ 1.650 局部单位（实测） |
| 实例缩放 | 0.72–0.92（世界长度约 1.19–1.52） |
| 当前三角形数 | 124 个/条（实测） |

尾摆是顶点着色器，不是骨骼（`FishRenderer` 中的 `onBeforeCompile`）：

```text
tailWeight = 1.0 - smoothstep(-0.95, 0.12, position.z)
transformed.x += sin(...) * tailWeight * 0.16
```

含义：

- `z ≤ −0.95`：全幅摆动（尾部）。
- `−0.95 < z < 0.12`：平滑过渡。
- `z ≥ 0.12`：完全静止（头部与胸鳍）。

硬性要求：

1. 尾部几何位于 `z ≤ −0.6` 区域，尾尖在 `z ≈ −1.060`，误差不超过 5%。若模型整体缩放，必须同步修改 shader 阈值，或按 1.65 总长导出。
2. 背鳍、胸鳍若位于 `z < 0.12` 会跟着摆尾一起动。要么固定在 `z ≥ 0.12`，要么明确接受轻微摆动。
3. 新模型尺寸不同时，必须把 `−0.95` 和 `0.12` 改成 uniform（建议 `uTailStart` / `uTailEnd`），并更新本文档。禁止在 shader 里硬编码另一组数值。
4. 禁止骨骼、形态键、GLB 内置动画。尾摆完全由 shader 完成。
5. 顶点法线必须存在。材质在代码中为 `flatShading: true`，请保持硬边低模风格，不要导出平滑着色后依赖代码改平。
6. 材质必须是 `MeshStandardMaterial` 兼容的 PBR 基础参数；`InstancedMesh` 的 `setColorAt` 会给每条鱼叠加 `instanceColor`，模型不要自带强烈颜色倾向，否则调色会失真。

## 3. 捕食者契约（Phase E）

当前 `PredatorRenderer` 不使用顶点 shader，而是用独立的 `tailPivot` 组绕 Y 轴正弦旋转尾鳍：

- 局部 +Z 为前向，主体为缩放 (1.25, 0.72, 3.2) 的椭球。
- 含吻部与尾鳍的总长约 5.1 个局部单位。
- 尾鳍由独立节点旋转，不是网格形变。

如果替换为 GLB：尾鳍必须保留为独立对象（命名为 `Tail`），原点在尾柄旋转轴；或者改为与鱼相同的顶点 shader。不要把尾鳍合并进单一网格，否则现有摆动逻辑失效。

## 4. 静态资产契约

### 礁石

- 原点：包围球中心；导出前归一化到半径 1，渲染时按 `obstacle.radius` 缩放。
- 当前等效几何为 Icosahedron detail 1（约 80 个三角形）。预算 ≤ 400 个三角形/块。
- 远景非碰撞礁石可以更低。
- 材质：单材质、粗糙度 0.9 以上、金属度 0、硬边低模。

### 珊瑚

- 原点：底部中心，`y = 0` 为接触面。
- 高度 1.0–1.5 个世界单位。
- 预算 ≤ 600 个三角形/株；当前为圆柱茎加球顶，新模型可以分枝，但保持低模。
- 材质：单材质，允许轻微 emissive，不要透明。

### 海藻

- 原点：底部中心，`y = 0` 为接触面；高度 2–4 个世界单位。
- 竖向叶片或条带，顶点沿 Y 轴分布；摆动由 shader 完成（已实现，见 `ASSET_SPEC.md` 第 15 节），不使用骨骼。
- 预算 ≤ 200 个三角形/株；UV 可选。
- 必须导出 `_SWAYWEIGHT`（0 基部 → 1 叶尖）与 `_BLADEPHASE`（每片叶 0..2π）两个 POINT FLOAT 自定义属性；材质双面、单材质、无内嵌贴图。
- `kelp_a` / `kelp_b` 的目标路径为 `public/models/kelp_a.glb`、`kelp_b.glb`；实际交付为 184 / 168 三角形，底部原点，高度 3.550 / 2.800。

## 5. 材质、贴图与实例化

- 每个 GLB 只用一个材质；优先纯色加代码着色（`instanceColor` 或 `material.color`）。
- 如必须使用贴图：单张不超过 1024×1024，优先共享图集，禁止透明排序；每个使用贴图的资产需在变更记录中说明理由。
- 鱼使用 `InstancedMesh` 加 `setColorAt`，因此 GLB 材质必须兼容 `instanceColor`。不要给鱼导出每实例独立贴图。
- GLB 内不要包含相机、灯光、Empty、约束和修改器残留。

## 6. 导出规范

- 目标版本：Blender 5.2（当前本机为 5.2.4 candidate）。
- 格式：glTF 2.0 Binary（`.glb`）。
- 导出前：应用修改器；`Ctrl+A` 应用全部变换；删除未使用材质与图像；只导出选中对象。
- 命名与路径：

| 资产 | 路径 |
| --- | --- |
| School Fish | `public/models/fish_school.glb` |
| Predator | `public/models/predator.glb` |
| Reef Rock A/B/C | `public/models/reef_rock_a.glb`、`_b.glb`、`_c.glb` |
| Branching Coral | `public/models/coral_branching.glb` |
| Kelp A/B | `public/models/kelp_a.glb`、`kelp_b.glb` |

- 文件大小：单资产不超过 200 KB，鱼不超过 100 KB。
- `.blend` 源文件放在 `assets_src/blender/`（待建），与 GLB 同名，便于复现。

## 7. 加载与验收（实现阶段）

- 新增 `GLTFLoader` 与资产缓存；GLB 缺失或超预算时回退到程序化几何，保持当前版本可运行。
- 加载时校验：三角形数是否超预算；包围盒尺寸是否符合契约；动画与骨骼数量是否为 0。
- 每个资产先通过 feature flag 接入，默认关闭；通过截图与性能采样后再默认开启。
- 验收需要：视觉 A/B 截图、控制台无错误、2000 条鱼规模下不低于现有 CPU 基准的帧时间预算。硬件 GPU 浏览器验收目前仍未完成，GLB 接入后必须补做。

## 8. 资产顺序与风险

风险从低到高，前一阶段通过前不要开始下一阶段：

| 阶段 | 资产 | 风险 | 验证目标 |
| --- | --- | --- | --- |
| A | 礁石 ×3 | 低 | 导出 → 加载 → 比例 → 材质链路 |
| B | 枝状珊瑚 | 低–中 | 原点、高度、合并与 draw call |
| C | 海藻 ×2 | 中 | Y 轴顶点摆动 shader |
| D | School Fish | 高 | +Z 朝向、尾摆区间、instanceColor、三角形预算 |
| E | Predator | 高 | 独立尾节点或替代 shader |

鱼是集成风险最高的资产，不是最低的。先用静态资产验证链路。

## 9. 变更记录

- v0.1（2026-11-08）：初稿，依据 `FishRenderer.ts`、`Environment.ts`、`PredatorRenderer.ts` 当前实现。
- v0.2（2026-11-08）：Phase A `reef_rock_a` 完成。Blender 侧 162 顶点、320 三角形，包围盒 `[-1.0, -0.711, -0.641]` 至 `[1.0, 0.711, 0.641]`；GLB 为 Y-up，包围盒 `[-1.0, -0.641, -0.711]` 至 `[1.0, 0.641, 0.711]`；单材质 base color `(0.15, 0.27, 0.24)`、roughness 0.95、metallic 0、单面；26,060 字节；无动画、骨骼、相机、灯光。文件：`public/models/reef_rock_a.glb`、`assets_src/blender/reef_rock_a.blend`。
- v0.3（2026-11-08）：Three.js 接入完成。`Environment.loadGlbRocks()` 在 `?glbRocks=1` 时用 GLB 替换 5 块主礁石，保留 variant 色调与原有变换，失败自动回退程序化几何；`npm run smoke:glb` 通过（`glbRocks: true`，无浏览器错误），16 个 Vitest 测试通过。
