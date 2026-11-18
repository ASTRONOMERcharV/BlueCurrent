# Blue Current — Underwater Lighting Phase 4 Report

日期：2026-11-10  
范围：光柱（light shafts）的程序化噪声、边缘/远近衰减与遮挡近似精修，以及全部光柱参数的中心化。  
状态：Phase 4 实现、软件浏览器验收（真实 Chromium/SwiftShader）、类型检查、生产构建与单元测试完成；硬件 GPU 视觉/性能验收未执行，待用户本人验证。

Phase 1–3 分别完成了基础灯光层级、水色层次和世界空间焦散。Phase 4 只处理 6 个十字交叉的光柱平面：参数集中进 `UNDERWATER_LIGHTING_CONFIG.water.shafts`，用无贴图的两八度程序化噪声调制亮度与宽度，重做横向轮廓/纵向两端/近端与远端衰减，并新增海底高度带与礁核球壳的解析淡出。不修改模拟、Boids、固定步长、基础灯光、水色/散射、焦散与默认线性水介质路径。

## 1. 交付结果

- **参数集中化**：`Environment.ts` 中不再有任何光柱魔法数字。位置/尺寸/朝向、颜色、不透明度、噪声（尺度、纵向尺度、速度、对比度、宽度调制、第二八度）、横向核心+肩部轮廓、纵向两端、近端/远端距离衰减、海底高度带、礁核外壳余量全部来自 `water.shafts`；`water.shaftColor/shaftOpacity` 保留为兼容镜像，`volumetricStrength` 仍乘在最终不透明度上。原有导出的 `waterEffectsVisible`、`setWaterDebugLayer('lightShafts')`、`setWaterEffects`、`setLightingMode` 行为不变。
- **噪声**：片元内的世界空间两八度 value noise（无贴图、无采样），缓慢漂移；同时调制亮度（`contrast`）与宽度（`widthAmount`，只放大不收缩，避免四边形边缘回硬）。粗八度约 2.4 m、细八度约 1.2 m 世界尺度，时间漂移约 22 s 一个噪声单元，帧间差在 0.01 灰度以下，不会抽搐或高频闪烁。
- **边缘衰减**：横向为“紧核心 + 宽肩部”的归一化幂函数，两个幂次都 >1，轮廓与斜率在四边形边界都归零；纵向两端 smoothstep 淡出；近端 3–16 m 视距淡出（相机进入光柱不出现硬边）；远端 38–100 m 平滑降到 12% 提示光。未改动曝光、太阳、半球光或水介质。
- **遮挡**：真实深度遮挡保持不变（`depthTest: true`、`depthWrite: false`、Additive、双面，不使用深度纹理/后处理/新渲染通道）。另加两类**解析近似**：世界高度带 `seabedFade`（1.2–6.4 m，覆盖地形波峰 y≈0.31 m 以上）避免光柱硬切进海床；每个礁核的球壳淡出（半径 + `rockMargin` 1.1 m）避免光柱片元在岩体内部被画到前面。两者都是解析近似，不是逐像素体积遮挡。
- **结构不变**：仍是 6 个平面（3 锚点 × 2 交叉面），共享 1 个几何、1 个材质；draw call 与 Phase 3 完全一致；无每帧 CPU 计算/分配，动画仍使用现有 `waterTime` uniform。
- **门禁不变**：`?lighting=base`、关闭 Water Effects、关闭 Light Shafts 调试层时 `waterEffectsVisible=false`，光柱组 `visible=false`；base 模式的整帧与改动前逐像素完全一致（见 §4.4）。

## 2. 参数（`water.shafts`）

| 参数 | Phase 3 结束 | Phase 4 最终值 | 说明 |
| --- | --- | --- | --- |
| `color` / `opacity` | `0x57b8c7` / `0.06` | 同左 | 兼容镜像 `shaftColor/shaftOpacity` |
| `positions` | GLSL 外的 `[-12,-8,0.2] [9,-3,1.1] [-19,13,0.7]` | 同左（结构化） | 每锚点 2 面 |
| `crossAngle` | `π/2` | `π/2` | 十字交叉 |
| `width` / `height` / `centerHeight` / `tilt` | `5.5` / `26` / `11.5` / `-0.18` | 同左 | 尺寸未改 |
| `noise.scale` | 无 | `0.42` | 水平世界频率（/m） |
| `noise.verticalScale` | 无 | `0.55` | 纵向频率比 |
| `noise.speed` | 无 | `0.045` | 噪声漂移（单元/秒） |
| `noise.contrast` | 无 | `0.55` | 亮度调制 ±55% |
| `noise.widthAmount` | 无 | `0.42` | 宽度只放大 0–42% |
| `noise.octaveScale` / `octaveWeight` | 无 | `2.03` / `0.35` | 两八度 |
| `lateral.corePower / coreWeight` | 横向 `pow(·,2.4)` 单幂 | `3.0 / 0.74` | 紧核心 |
| `lateral.shoulderPower / shoulderWeight` | 无 | `1.35 / 0.42` | 宽肩部 |
| `vertical.bottomFadeEnd` / `topFadeStart` | `0.30` / `0.82` | 同左 | UV 两端淡出 |
| `nearFade.start / end` | `3` / `16` m | 同左 | 相机进入光柱淡出 |
| `farFade.start / end / minimum` | 无 | `38` / `100` m / `0.12` | 远处只留提示 |
| `seabedFade.start / end` | 无 | `1.2` / `6.4` m | 世界高度带 |
| `occlusion.rockMargin` | 无 | `1.1` m | 礁核球壳外壳 |

## 3. 实现与接入点

- `src/rendering/lighting/LightShafts.ts`（新）：`createShaftMaterial()` 生成唯一 ShaderMaterial（把配置编译成 GLSL 浮点字面量、礁核球作为 `vec4[]` uniform）；`createLightShaftGroup()` 生成 6 个共享几何/材质的平面。世界坐标由 `modelMatrix` 计算，噪声与十字面在世界空间一致，不随 UV 拉伸。
- 片元流程：世界位置 → 两八度噪声 → 亮度与宽度调制 → 横向核心+肩部轮廓 → 纵向两端 → 近端/远端视距 → 海底高度带 → 礁核球壳（循环乘性 smoothstep）→ Additive 输出（保留 three.js 的 tonemapping/colorspace 注入）。
- `src/rendering/Environment.ts`：删除内联 ShaderMaterial 与循环，改为 `createLightShaftGroup(this.obstacleDefinitions, this.waterTime)`；可见性门禁不变。
- `src/rendering/SceneManager.ts`：`getLightingDiagnostics()` 的 `lighting` 增加 `lightShafts: { config, effectiveVisible }`，便于验收与回归。
- `src/main.ts`：新增仅测试用的 `advanceVisualTime(seconds)` / `setVisualTime(seconds)` 渲染时钟钩子（推进光柱/海藻/悬浮颗粒的视觉时钟，不推进模拟），以及已有 `pause/step/setCameraPose` 的确定性捕获路径。
- `scripts/visual-quality-capture.ts`：新增 `--camera/--pose/--temporal/--visual-time/--lighting` 与真实渲染帧计数等待；为软件渲染补充可选的渲染循环冻结（`BLUE_CURRENT_CAPTURE_FREEZE=1`，冻结后立即重绘一帧再截图）与写盘后强制退出（`BLUE_CURRENT_CAPTURE_FORCE_EXIT=1`），并把握手缓存移到系统临时目录（挂载盘上无法删除 Vite 旧缓存）。

## 4. 验收与证据

所有截图来自真实 Chromium（Playwright 1.65 headless shell，SwiftShader 软件渲染，1440×900），固定 `pause()` + `step()` + `setVisualTime()`，基线（Phase 3 代码）与改后（Phase 4）使用同一捕获协议；先抓 baseline 再改后。

### 4.1 截图

证据目录：`test-artifacts/underwater-lighting-phase4/{baseline,final}/`；对比面板：`test-artifacts/underwater-lighting-phase4/panels/`。

| 视角 | 配置 | 文件 |
| --- | --- | --- |
| Calm Overview | `calm` / overview / full / t=1.0 | `calm-overview/calm-environment.png` |
| Calm School（近景鱼群） | `calm` / school / full / t=1.0 | `calm-school/calm-school-environment.png` |
| Predator 跟随 | `encounter` / predator / full / t=1.0（step 18） | `encounter-predator/encounter-predator-environment.png` |
| 岩石遮挡（自由相机） | `calm` / free `(-3.5,2.6,0.5)→(-12,7,-8)` | `rock-occlusion/calm-free-environment.png` |
| 相机进入光柱（自由相机） | `calm` / free `(7,9,1)→(10,9,-4)` | `inside-shaft/calm-free-environment.png` |
| Base 门禁 | `calm` / overview / base / t=1.0 | `calm-overview-base/calm-environment.png` |
| 噪声时间序列 | overview / full / t=1.25、1.50 | `calm-overview-t125/`、`calm-overview-t150/` |

### 4.2 PIL 定量（`metrics-phase4.json`）

| 指标 | Phase 3 | Phase 4 | 变化 |
| --- | ---: | ---: | --- |
| 左侧光柱峰值相对局部背景增益（overview，y 250–450） | 13.47 | 13.88 | +3%（核心不降亮） |
| 左光柱边缘最大梯度（左/右） | 1.289 / 1.262 | 1.001 / 0.748 | **−22% / −41%（边缘更软）** |
| 左光柱 FWHM | 21 px | 21 px | 不变 |
| School 近景光柱峰值（无鱼水带 y 140–250） | 9.16 | 8.52 | −7% |
| School 近景光柱 FWHM | 29 px | 31 px | **+7%（肩部更宽）** |
| 海底高度带增益（y 480–560，光柱列 vs 两侧背景） | 6.24 | 5.37 | **−14%（贴地更淡）** |
| 远景水带 y 120–200 均值 | 45.526 | 45.494 | −0.07% |
| 远景水带 y 200–260 均值 | 41.964 | 41.854 | −0.26% |
| 时间平滑度 \|t1.00−t1.25\| / \|t1.25−t1.50\|（光柱 ROI） | 0.000 / 0.000（静态） | 0.009 / 0.008 | 平滑、无跳变 |

整画布逐像素差（canvas 区域 16–1408 × 68–820）：overview 0.044/255、base **0.000**、rock-occlusion 0.086、inside-shaft 0.015；school 3.07、predator 4.60 —— 这两组近景的差值主要来自**鱼群泳姿不同**（baseline 与 final 两次会话在 `pause()` 前的模拟时长不同，鱼位姿略有差异，差分图集中在鱼的轮廓而非光柱），因此光柱定量指标改用无鱼水体 ROI，近景截图仅作“无四边形硬边”的定性证据。

### 4.3 结构/门禁/质量

- draw call 与 Phase 3 逐视角一致：overview 48/48、base 39/39、school 41/41、predator 45/45、inside-shaft 29/29、rock-occlusion 31/31；无新增材质变体。
- base 模式 `lighting.mode=base`、`lightShafts.effectiveVisible=false`，整帧与 Phase 3 逐像素相同（diff 0.000）。
- 所有 8 组截图 JSON：`browserErrors` 为空、`colorSpaceIssues` 为空。
- `npm test`：30 个文件 / 198 项全部通过（`--isolate=false` 单次全绿约 29 s；默认并发运行在本机超出单命令 3 分钟窗口，分片结果一致）。新增 `tests/LightShafts.test.ts` 覆盖参数镜像与排序、噪声慢速约束、材质属性（Additive/depthWrite=false/depthTest=true/无贴图）、6 面共享几何材质、base/调试层/Water Effects 门禁。
- `tsc --noEmit`：通过。`vite build`：通过（输出 `dist-check/phase4-final`，24.5 s；`dist/` 旧产物本机不可清空，沿用 dist-check 方案）。

## 5. 已知限制

- **软件渲染**：全部截图与数值来自 SwiftShader 软件渲染，不代表硬件 GPU 性能或最终观感；硬件 GPU 下的光柱观感与帧率待用户本人验证。
- **改动幅度偏渐进**：光柱不透明度本就只有 `0.06×0.7`，在 30–50 m 的 overview 距离上，Phase 4 的噪声/肩部/远淡主要是“渐进精修”而不是大幅重绘；数值上体现为边缘梯度 −22%~−41%、贴地 −14%、近景肩部 +7%。近景（相机进入光柱、岩石遮挡）画面被鱼群/岩石主导，光柱本身难以单独取景。
- **遮挡边界**：岩石/海床对光柱的遮挡仍是**真实深度测试**；海底高度带与礁核球壳是**解析近似淡出**，用于掩盖深度测试无法处理的“零厚度平面沉入沙面 / 穿过岩体”情形，不是逐像素体积遮挡，也不等同于屏幕空间阴影。
- **噪声时变很慢**：约 22 s 一个世界噪声单元，帧间差 <0.01 灰度，符合“缓慢演化、不抽搐”的目标，但也意味着短时间内几乎静止。
- **捕获工具环境**：本会话的 Linux 侧 node_modules 缺少平台可选依赖（`@rollup/rollup-linux-x64-gnu`、`@esbuild/linux-x64`），已补装到 `node_modules`（不改 package.json，不影响 Windows 端）；并在系统临时目录安装了 Playwright Chromium headless shell 与 `libXdamage`；这些均为验收环境修复，不属于项目交付。

## 6. 文件清单

- `src/rendering/lighting/UnderwaterLightingConfig.ts`：新增 `water.shafts`（Phase 4 全部参数）。
- `src/rendering/lighting/LightShafts.ts`（新）：光柱材质与 6 面组创建。
- `src/rendering/Environment.ts`：改为调用 `createLightShaftGroup()`，移除内联材质与魔法数字。
- `src/rendering/SceneManager.ts`：光柱诊断快照（config + effectiveVisible）。
- `src/main.ts`：`advanceVisualTime` / `setVisualTime` 渲染时钟测试钩子。
- `tests/LightShafts.test.ts`（新，5 项）：配置/材质/结构/门禁。
- `scripts/visual-quality-capture.ts`：确定性捕获选项与软件渲染兼容（冻结/强制退出/临时缓存）。
- `docs/archive/UNDERWATER_LIGHTING_PHASE4_REPORT.md`：本报告。
- `test-artifacts/underwater-lighting-phase4/`：`baseline/`、`final/`（8 视角 PNG+JSON）、`panels/`（before/after 与放大对比）、`metrics-phase4.json`。

备份：`.task-locks/backups/phase4-20261110-113937`（Phase 4 改动前原文件）与 `.task-locks/backups/phase4-20261110-153946-takeover`（接管时快照）；临时对比图与未采用的批量捕获脚本在 `.task-locks/backups/phase4-tmp/`。
