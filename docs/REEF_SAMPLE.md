# 礁石样板 Hero Reef Sample

日期：2026-11-11  
范围：样板先行，用于确认“风格化生物礁石”方向；现已默认加载样板 + 4 个变体（见 `docs/REEF_VARIANTS.md`）。  
接入方式：默认场景加载 5 礁石组；`?reef=sample` 只加载本样板，`?reef=off` 回退旧岩石。

## 1. 结论与当前状态

样板已替换中央礁体（碰撞体 `REEF_SAMPLE_ANCHOR_INDEX = 2`，中心 `(0, 2.45, -9)`，半径 2.45 m）的**视觉网格**，碰撞球、避险半径、海草避难与鱼群参数不变。

本轮证据全部来自软件渲染（SwiftShader）。视觉方向已成立并派生 4 个变体，默认场景已启用整套；但**硬件 GPU 的 5% FPS / 10% P95 性能门禁尚未验证**，需要实物 GPU 复测后再决定是否保留默认。

同机位对比（同种子、同暂停时间、同镜头）：

- 基线：`test-artifacts/reef-sample/game-off-close.png`
- 样板：`test-artifacts/reef-sample/game-sample-close.png`
- 拼图：`test-artifacts/reef-sample/ab-close.png`

对比中，原礁石是两块光滑浅色巨石；样板具备复合轮廓、裂隙/洞穴、坡面结壳分区、珊瑚簇和底部碎石沉积带。

## 2. 资产结构

样板是一个 authored-at-scene-scale 的复合体，不再从单个椭球加噪波：

- 11 个不规则岩体：宽基座、主岩体、后部高脊、悬挑岩架、右侧扶壁、前部露头、左侧低裙、侧翼块、后部礁舌、顶部岩瘤、破碎薄板。
- 体素融合后统一雕刻：3 条地层断带、8 条主侵蚀沟、8 条窄溶蚀槽、3 条岩体间深裂隙、2 个洞穴凹腔、8 个孔蚀、顶部浅盆。
- 高模约 37 万三角形，仅用于法线烘焙；近景视觉网格 11,976 三角形。
- 尺寸：资产 authored 宽 4.80 m × 深 4.41 m × 高 4.64 m；P3 当前运行时按 `visualScale` 调整为 **9.40 × 7.00 × 6.30 m**，作为唯一高主礁；碰撞球仍为 r 3.6 m。底部在 y = 0，运行时嵌入沙面 0.07 m。主从布局见 `docs/REEF_COMPOSITION.md`。

LOD（同一套 UV 与材质）：

| LOD | 三角形 | 距离 | 说明 |
|---|---:|---:|---|
| near | 11,976 | < 18 m | 完整结构 + 法线/AO/粗糙度 |
| mid | 3,500 | 18–38 m | 保留轮廓与主要裂隙 |
| far | 900 | ≥ 38 m | 只保留大形 |

文件：

- `public/models/reef/reef_sample_near.glb`
- `public/models/reef/reef_sample_mid.glb`
- `public/models/reef/reef_sample_far.glb`
- `public/textures/reef_sample_basecolor.jpg`
- `public/textures/reef_sample_normal.png`
- `public/textures/reef_sample_ao.png`
- `public/textures/reef_sample_roughness.png`

四张 1024² 贴图，UV 岛外做了边缘颜色扩展（`compose_reef_sample_textures.py`），避免 mipmap 把背景黑色拉进接缝。

## 3. 生态分区材质

材质不是一张噪声随机混色，而是四个由几何量驱动的区域：

| 区域 | 驱动量 | 表现 |
|---|---|---|
| 裸岩/裂隙 | 坡度、凹度、高度 | 低饱和石灰岩，裂隙更深、细孔更多 |
| 朝上结壳 | 法线朝上 + 中高 AO + 大尺度斑块 | 低饱和紫红、赭色、暖灰珊瑚藻结壳 + 浅色钙质斑点 |
| 侧面/岩架 | 陡坡 + 噪声斑块 + 中低 AO | 暗橄榄绿藻膜、赭色海绵膜 |
| 底部沉积 | 低高度 + 朝上平台 | 更暗的沙色、贝壳/碎石斑点，向沙地过渡 |

烘焙流程写入顶点遮罩后再烤到 UV：

1. `bake_reef_sample.py` 先烤 AO；
2. 按坡度/凹度/AO/高度计算区域权重；
3. 以顶点色烤 basecolor，以顶点标量烤 roughness；
4. `compose_reef_sample_textures.py` 做 gutter 填充与发布。

当前区域占比（顶点主权重）：结壳约 25%，侧膜约 15%，沉积约 13%，裸岩/裂隙约 47%。裸岩始终保留，不会被装饰覆盖满。

## 4. 生物覆盖

三层覆盖：

1. **结壳层**：烘焙进材质，不增加几何。
2. **低矮层**：球状/桌面珊瑚，压扁后贴附表面；24 个散布补充个体。
3. **立体层**：少量枝状珊瑚、海扇、管状海绵簇，负责轮廓；另有 10 个侧壁小型附着体。

分布规则：

- 只在朝上或侧向可附着面；沉积带以下不放置。
- 7 个主簇，每簇 6–8 个个体，簇间保留裸岩；簇半径 0.58 m、簇间距 ≥1.05 m。
- 主簇物种按簇分配，不是每株随机换种；避免每块礁石出现同样的“小树”。
- 共 77 个附着个体，估算覆盖 17.4%，基岩仍占多数。
- 附着体使用 620–780 三角形的专用低模（`epibiont_*.glb`），全部合并为一个**静态批**，只增加 1 个 draw call；总和 50,276 三角形。

## 5. 落地与尺度

- 18 块非交互碎石组成贴近碰撞体的崩落裙，半径约 0.8–1.5 倍碰撞半径，全部按沙面高度嵌入。
- 一层跟随地形高度的接触 AO 环（64 段、4 圈渐隐），深色低对比，用来减轻“直接摆在沙面上”的感觉；不参与碰撞。
- 基础材质在底部保留更暗的沉积带，不出现亮白“沙饼”。
- 小型珊瑚、碎石与贝壳提供尺度参照。

## 6. 运行时接入

- `src/rendering/ReefSampleAsset.ts`：加载 3 个 LOD + 4 张贴图，校验三角形预算与 y=0 基面。
- `src/rendering/ReefSample.ts`：`THREE.LOD`、附着体规划、碎石裙、接触 AO；按距离隐藏附着体/裙边。
- `src/rendering/reefEpibiontPlacement.ts`：纯数学的簇/散点/侧壁规划，可单测。
- `src/rendering/EpibiontScatter.ts`：把 77 个低模附着体静态合批为 1 个 Mesh。
- `src/rendering/EpibiontAsset.ts`：加载附着体低模。
- `Environment.loadReefSample()` / `SceneManager.loadReefSample()` / `main.ts ?reef=sample`：只在 GLB 岩石集模式下启用；调用 `RockScatter.hideAnchoredLarge(2)` 隐藏该碰撞体对应的旧视觉实例。
- 不修改 `ObstacleSystem`、`KelpRefugeField`、`BoidSystem`、`SimulationWorld`。
- 即使 `?coral=off`，样板也自带附着体低模和珊瑚图集，不依赖展示珊瑚是否加载。

## 7. 重建命令

在 Blender 中按顺序执行（MCP 或脚本编辑器的 `exec(open(...).read())`）：

1. `assets_src/scripts/build_reef_sample.py`
2. `assets_src/scripts/bake_reef_sample.py`（`REEF_BAKE_STEP=all`）
3. `assets_src/scripts/finalize_reef_sample.py`
4. `assets_src/scripts/build_epibiont_lods.py`（如附着体低模需更新）

然后命令行：

```bash
python3 assets_src/scripts/compose_reef_sample_textures.py
npm run capture:reef-sample
npx tsx scripts/reef-sample-game-capture.ts --mode=off --coral=temperate
npx tsx scripts/reef-sample-game-capture.ts --mode=sample --coral=temperate
```

独立预览：`reef-sample-preview.html`（`npm run dev` 后访问 `/reef-sample-preview.html`）。

## 8. 证据清单

`test-artifacts/reef-sample/`：

- `studio-three-quarter.png`、`studio-front.png`、`studio-top.png`
- `studio-three-quarter-no-epibionts.png`
- `silhouette-three-quarter.png`、`silhouette-top.png`
- `thumbnail-silhouette.png`（320 px 灰度/剪影检查）
- `game-off-close.png` / `game-sample-close.png` / `ab-close.png`
- `game-sample-overview.png`（`coral=full` 默认生态下的一览）
- `studio-results.json`、`game-off-results.json`、`game-sample-results.json`

资产统计：

- `assets_src/blender/reef_sample_build_stats.json`
- `assets_src/blender/reef_sample_export_stats.json`
- `assets_src/blender/epibiont_lod_stats.json`
- `assets_src/textures/_reef_sample/texture_stats.json`

## 9. 验收对照

### 视觉

- [x] 320 px 剪影仍能看出多级平台、裂隙和顶部附着体，不是椭圆巨石（`thumbnail-silhouette.png`）。
- [x] 近景可见裂隙、洞穴、结壳斑块、低矮附着体与枝状轮廓。
- [x] 生物呈簇分布，簇间保留裸岩；覆盖估算 17.4%。
- [x] 底部有碎石裙与接触 AO，无悬空。
- [x] 与现有鱼、珊瑚、海草保持同一低多边风格。
- [ ] **硬件 GPU 近/中/远 LOD 切换检查**：待实物 GPU。
- [ ] **用户视觉确认**：待确认后再派生 4–6 个变体。

### 工程

- [x] `npx vitest run`：34 个测试文件、225 个测试全部通过（含新增 `ReefEpibiontPlacement.test.ts` 与 `ReefVariantSpecs.test.ts`）。
- [x] `npx tsc --noEmit` 通过。
- [x] Vite 生产构建通过（本沙箱不能删除旧 `dist/`，构建到 `dist-reef-sample/` 验证）。
- [x] 默认场景 browser smoke 通过（`test-artifacts/smoke-results.json`，0 浏览器错误）。
- [x] 默认 `?reef=off` 不加载样板：岩石实例数仍为 5 large/16 medium/33 debris/5 dunes，布局与碰撞数据不变。
- [x] `ObstacleSystem`、`KelpRefugeField` 文件哈希与既有基线一致；本轮未修改任何模拟/避难逻辑。
- [ ] 端到端同种子 60 秒生态比对：本轮为纯渲染改动，但项目内其他会话已在此前改过 `BoidSystem`/`SimulationWorld`，应在合并后统一跑一次，避免把历史差异算到本轮。

### 性能（软件证据，不等于硬件验收）

近景同机位（900×640、SwiftShader）：

| 指标 | 基线 | 样板 | 差值 |
|---|---:|---:|---:|
| draw calls | 34 | 38 | +4 |
| render triangles | 515,577 | 581,973 | +66,396（+12.9%） |

其中样板贡献：near 11,976 + 附着体 50,276 + 碎石 3,760 + 接触 AO 384。  
**中位 FPS 与 P95 尚未在实物 GPU 上测量，不能据此声称满足 5%/10% 门禁。**

## 10. 已知差距 / 下一步

1. 样板已确认并派生 4 个变体（Spire / Platform / Twin / Terraces），整套由 `?reef=set` 加载；细节见 `docs/REEF_VARIANTS.md`。后续仍可继续增加第 5–6 个变体。
2. 附着体覆盖 17.4%，视觉上仍偏“岩多、生物少”；变体覆盖已扩展到 24%–57%，可在硬件性能允许后回头提高样板密度，或把结壳斑块进一步做大。
3. 基座仍偏平，变体中已用更窄的礁台/更多崩落块做了对比（见 `variant-sheet.png`），样板本身可保持不动。
4. 默认镜头（Overview）里样板被中央珊瑚树遮挡，属于构图问题，不是样板本身；P3 镜头阶段再处理。
5. 硬件验收：`npm run accept:gpu` 需要在 Windows 实物 GPU 上重复 180 秒，并额外做近/中/远 LOD 切换和 30 分钟稳定性检查。
