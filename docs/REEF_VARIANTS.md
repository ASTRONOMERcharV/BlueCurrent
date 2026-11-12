# 礁石变体 Reef Variants B–E

日期：2026-11-11  
范围：在已确认的样板礁石（Hero sample）之后派生 4 个变体，替换其余 4 个碰撞礁体的**视觉网格**。  
接入方式：默认场景加载 5 礁石组；`?reef=off` 回退旧岩石视觉，`?reef=sample` 只加载主角样板。

> **当前运行时尺寸更新（2026-11-11 P3）**：主从构图已改为 Hero 9.4 m、次礁 6.3/6.7 m、低礁 4.3/4.9 m，并加入次礁倾斜、珊瑚层级和水道负空间。碰撞球仍未移动。当前权威记录见 `docs/REEF_COMPOSITION.md`；本文其余内容保留资产制作与当时验收记录，旧截图中的 8–9 m 标签不再代表当前运行时布局。

## 1. 结论

4 个变体已完成，并与样板共同组成 5 礁石组：

- 当前运行时高度覆盖 **4.30–9.40 m**：一个高主礁、两个次礁、两个横向低礁；不再要求每块都达到同一高度。
- 每个变体使用独立结构、独立 UV/贴图、独立附着体种子；共享同一套材质分区规则和低模附着体资产。
- 5 个碰撞球保持 r 3.2–3.6 m，P3 未改变中心或半径；海草共享布局不变，full 珊瑚只调整视觉尺度。
- 默认场景加载 5 个礁石；`?reef=off` 回退旧大型岩石。
- 当前全量测试为 35 文件 / 240 tests，类型检查与生产构建通过；**硬件 GPU 的 FPS/P95 与近/中/远 LOD 切换仍未验收**。

## 2. 变体一览

| ID | 名称 | 碰撞体 | 尺寸（高 × 宽 × 深） | near / mid / far | 附着体 | 估算覆盖 |
|---|---|---|---:|---:|---:|---:|
| hero | Hero sample | 2（0, 3.6, -9）r 3.6 | 9.40 × 7.00 × 6.30 m | 11,976 / 3,500 / 900 | 77 | 17% |
| b | Spire 尖塔 | 0（-7, 3.4, -3）r 3.4 | 6.30 × 6.20 × 5.50 m | 11,800 / 3,400 / 880 | 59 | 24% |
| c | Platform 平台 | 1（5, 3.5, 4）r 3.5 | 4.30 × 7.00 × 5.80 m | 11,496 / 3,298 / 860 | 63 | 35% |
| d | Twin 双柱 | 3（11, 3.2, -7）r 3.2 | 6.70 × 6.10 × 5.20 m | 11,400 / 3,200 / 820 | 47 | 57% |
| e | Terraces 台地 | 4（-12, 3.4, 9）r 3.4 | 4.90 × 6.80 × 6.00 m | 11,674 / 3,350 / 868 | 53 | 38% |

尺寸是 P3 当前运行时本地目标尺寸；网格在 `ReefSample` 内按目标尺寸做非均匀 `visualScale`，次礁另有小幅 Euler 倾斜。碰撞球未随 P3 改变。

## 3. 结构差异

- **B Spire**：保留窄基座、偏心高脊和薄岩架，但降为 6.3 m 次级尖礁并小幅倾斜，不再与 Hero 争夺最高点。
- **C Platform**：恢复为 4.3 m 低矮横向平台，宽/高比约 1.63，负责打开水道和形成低谷。
- **D Twin**：6.7 m 次级双柱，转向展示柱间鞍部和裂隙，作为 Hero 的呼应而非另一根同高石柱。
- **E Terraces**：4.9 m 低矮退台，强调水平地层与侧向扶壁，和 Platform 共同承担前景低矮体量。

所有变体都经过同一套体素融合/宏观雕刻/减面/UV 流程，差异来自岩体组合与裂隙/凹槽参数，而不是整体缩放；运行时再按各自目标尺寸缩放。

## 4. 材质与生物覆盖

- 每个变体使用 512² 的 basecolor / normal / AO / roughness 四张图；主角仍为 1024²。
- 分区规则沿用样板：坡度、凹度、AO、高度驱动裸岩/裂隙、朝上结壳、侧膜、底部沉积。
- UV 岛外做 gutter 填充；UV 覆盖率 23%–29%。
- 附着体使用同一套 620–780 三角形低模，每个礁石仍合并为**一个静态 draw call**；5 个礁石共 194,992 三角形（全部可见时），但受 LOD/视锥/距离剔除影响，实际远低于总和。
- 覆盖从 17%（hero）到 57%（D），刻意让不同礁石有“岩多/生物多”的差别；D 已接近偏密的上限。

## 5. 碰撞包络

碰撞球半径同步放大到 **3.2–3.6 m**，球心 y = 半径；视觉网格按目标尺寸做 `visualScale`。这样底部与中段的视觉体量落在球体附近，鱼群不会直接穿过主岩体。

需要说明的是：礁石顶部 0.4–2.2 m 的细尖可能略高于球顶（尤其 B Spire），鱼群在顶部极近距离掠过时仍可能出现轻微穿模。旧 4–5 m 尺度的逐顶点包络表不再适用；硬件 GPU 验收时应重点观察顶部细尖。

海草布局已按新碰撞半径重排（保持 91 株、左/右各 ≥40），珊瑚和装饰岩也使用同一组障碍定义重新避让。

## 6. 运行时接入

- `src/rendering/reefVariantSpecs.ts`：5 个变体的锚点、目标尺寸、LOD 距离、附着体参数、apron seed。
- `ReefSampleAsset.ts`：按 `assetPrefix` 加载 `${prefix}_near/mid/far.glb` 与 `${prefix}_*.jpg/png`。
- `ReefSample.ts`：新增 `visualScale`（按目标尺寸缩放网格）；接触 AO 半径按碰撞半径缩放；apron seed、LOD 距离、附着体 seed/参数可配置；stats 增加 `id/label/anchorIndex/height/width/depth`。
- `Environment.loadReefSet()`：加载 5 套资产，共享表生生物材质与 apron 材质，隐藏 5 个 anchored large 实例；失败时恢复被隐藏的旧岩石。
- `ObstacleSystem` 的 5 个球半径同步放大到 3.2–3.6 m；`kelpPlacement` 保持 91 株并重排 grove，`CLOWNFISH_SPAWN` 上移到英雄礁顶部附近。
- 默认加载整套 5 块（`?reef=off` 回退旧岩石，`?reef=sample` 只加载 hero）。
- `?coral=0` 时仍会加载表生生物专用图集，不依赖展示珊瑚。

## 7. 重建命令

Blender 脚本通过 `assets_src/blender/_variant_job.txt` 选择单个变体（`b`/`c`/`d`/`e`/`all`）：

1. `build_reef_variants.py`：体素融合、雕刻、减面、UV、保存 `reef_variant_<id>.blend`。
2. 先打开对应 `.blend`，再执行 `bake_reef_variants.py`（512²、AO 16 samples、UV mask）。
3. 先打开对应 `.blend`，再执行 `finalize_reef_variants.py`：导出 3 个 GLB、做包络校验、写 stats。
4. 命令行运行：

```bash
python3 assets_src/scripts/compose_reef_variant_textures.py
python3 scripts/compose_reef_variant_sheet.py
```

独立预览：`npm run dev` 后访问 `/reef-variants-preview.html`。  
工作室画廊捕获：`npm run capture:reef-variants:gallery`。

游戏内捕获（新尺度下 5 块礁石在 SwiftShader 里很吃填充率，建议分开捕获并降低分辨率）：

```bash
npx tsx scripts/reef-sample-game-capture.ts --mode=default --variant=hero --coral=temperate --view=overview --size=800x560
npx tsx scripts/reef-sample-game-capture.ts --mode=default --variant=hero --coral=off --bare --view=overview --size=800x560
```

## 8. 证据

`test-artifacts/reef-variants/`：

- `variant-sheet.png`：5 个变体的同尺寸对比，含高度/宽度/三角形/附着体标注（新 8–9 m 尺度）。
- `variant-thumbnails-320.png`：每块 240×320 的缩略图可读性检查。
- `gallery-front.png` / `gallery-three-quarter.png`：无鱼、无海带、无水介质的 5 礁石工作室排列（真实烘焙材质，锁定 near LOD）。
- `gallery-front-labeled.png` / `gallery-silhouette-labeled.png`：带名称与尺寸标签的版本。
- `gallery-silhouette.png`：纯黑剪影，用于检查 5 个轮廓是否重复。
- `gallery-results.json`：5 块、58,346 near 三角形、299 个附着体、194,992 附着体三角形、21 draw calls。

`test-artifacts/reef-sample/`：

- `game-default-hero-overview.png`：默认生态总览（含鱼、珊瑚、海草），5 块礁石明显高于海带/海草。
- `game-default-hero-overview-bare.png`：关闭展示珊瑚/海带/细节海草和鱼群后的 5 礁石总览，用于判断体量与间距。
- `game-default-hero-close.png`：英雄礁近景；鱼群会贴近镜头遮挡，当前只作集成检查，不作为资产细节证据。
- `game-off-results.json`、`game-sample-results.json`：旧岩石基线 / 单样板对照。

资产统计：

- `assets_src/blender/reef_variant_<id>_build_stats.json`
- `assets_src/blender/reef_variant_<id>_export_stats.json`
- `assets_src/textures/_reef_variant_<id>/zone_stats.json`
- `assets_src/textures/reef_variant_texture_stats.json`

## 9. 验收对照

### 视觉

- [x] 5 个轮廓可区分：高塔、高台地、双柱、退台、样板复合体（`variant-sheet.png`）。
- [x] 320 px 缩略图仍能读出高塔/台地/双柱/台阶差异（`variant-thumbnails-320.png`）。
- [x] 近景可见裂隙、洞穴、结壳分区、附着体簇和底部碎石。
- [x] 附着体成簇，簇间保留裸岩；覆盖 17%–57%。
- [x] 底部碎石裙与接触 AO 随碰撞半径缩放，无明显悬空。
- [x] 与现有鱼、珊瑚、海草保持同一低多边风格。
- [ ] 硬件 GPU 近/中/远 LOD 切换检查：待实物 GPU。

### 工程

- [x] 5 套资产全部通过加载校验：near 8k–15k、mid 2k–5k、far 300–1k，底面 y≈0。
- [x] 碰撞球同步放大到 r 3.2–3.6 m；底部/中段覆盖，顶部细尖可能略高于球顶（见 §5）。
- [x] `npx tsc --noEmit` 通过。
- [x] `npx vitest run`：34 个测试文件 / 225 tests 通过（新增 `ReefVariantSpecs.test.ts`）。
- [x] Vite 生产构建通过（备用 outDir）。
- [x] 默认场景 browser smoke 通过，0 浏览器错误。
- [x] `?reef=off` 回退诊断与旧基线一致：34 draw calls / 515,577 triangles（近景同机位）。
- [x] 默认场景加载 5 个礁石，`glbRockInstances.large` 仍为 5，旧大型岩石实例仍被隐藏。
- [x] 模拟层改动仅限 `REEF_OBSTACLES` 半径/球心、`CLOWNFISH_SPAWN`、`kelpPlacement`；`KelpRefugeField`、`BoidSystem`、`SimulationWorld` 逻辑未改。
- [ ] 合并后同种子 60 秒生态比对：碰撞范围已变，必须重新跑一次。

### 性能（软件证据，不等于硬件验收）

默认生态、同一 overview 机位（800×560、SwiftShader）：

| 指标 | `?reef=off` | 默认（5 礁石） | 差值 |
|---|---:|---:|---:|
| draw calls | 44 | 53 | +9 |
| render triangles | 515,741 | 528,705 | +12,964（+2.5%） |

新尺度下近景会让 5 块高礁石占满画面，SwiftShader 单张 close 捕获经常超过 shell 时间上限，因此没有可靠的 close A/B 数字；资产细节用 `gallery`（21 draw calls、near LOD）判断。  
**中位 FPS 与 P95 尚未在实物 GPU 上测量，不能据此声称满足 5%/10% 门禁。**

## 10. 已知差距 / 下一步

1. 硬件 GPU 验收：`npm run accept:gpu` 之外，还需近/中/远 LOD 切换和 30 分钟稳定性检查。
2. 合并后同种子 60 秒生态比对。
3. 变体贴图为 512²；若近景特写需要更高细节，可对单变体改回 1024²。
4. D 的附着体覆盖 57%，接近上限；若视觉上偏密，可减少 `clusterCount`/`encrustingCount`。
5. 顶部细尖略高于碰撞球，鱼群在顶部近距离掠过时可能轻微穿模；硬件验收时重点看 B Spire。
6. 资产证据使用 `gallery`（无鱼无海草），生态证据使用 `game-default-hero-overview.png`。
7. 当前默认开启；如需回退用 `?reef=off`。最终是否保留默认需等硬件 GPU 与用户确认。
