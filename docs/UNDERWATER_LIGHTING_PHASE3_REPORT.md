# Blue Current — Underwater Lighting Phase 3 Report

日期：2026-11-10  
范围：海床焦散的尺度与强度微调，以及全部焦散参数的中心化。  
状态：Phase 3 实现、软件浏览器验收、类型检查、生产构建与单元测试完成；硬件 GPU 性能验收未执行。

Phase 2 完成了受光 in-scattering 色与远近水色分层。Phase 3 只处理世界空间焦散：把所有可调数值收进 `UNDERWATER_LIGHTING_CONFIG.water.caustics`，并微调细胞尺度、丝网锐度与远景衰减。不修改模拟、Boids、固定步长、基础灯光、Phase 2 水色/散射、光柱（Phase 4）。

## 1. 交付结果

- **参数集中化**：`src/rendering/Environment.ts` 中不再有任何焦散魔法数字。海床、礁石、沙丘、珊瑚、远景/前景装饰岩的 intensity/scale，颜色，朝向遮罩，宏观包络，距离衰减，全部来自 `water.caustics`；`applyCaustics()` 的 `CausticOptions` 扩展为可选参数，默认值复现 Phase 2 行为，导出与调用 API 保持兼容。
- **尺度**：世界空间细胞整体放大约 12%（海床有效频率 0.42×4.2≈1.76 rad/m → 0.42×3.7≈1.55 rad/m，主波长约 1.8 m）。域扭曲增强、脊线锐度提高、细节八度权重下调，画面从“织物/鳞片”纹理改为更分离的细丝网；同一世界场继续覆盖海床与岩石，未退回按物体 UV 重复。
- **强度**：海床均值没有整体抬升（Calm overview −1.5%、Predator 近景 −1.1%）；焦散高光对比仍可读（近景 P95−P50 0.047–0.049）；鱼群仍是画面最亮层；全画面无裁白像素。
- **远景**：新增按视距的平滑衰减（26–64 m，远端保留 15%），远景焦散自然减弱，不再均匀铺满。
- **结构不变**：仍是注入 `MeshStandardMaterial` 的片段项，无后处理、无贴图、无新增 draw call、无每帧 CPU 计算。
- **门禁不变**：`?lighting=base`、关闭 Water Effects 或关闭 Caustics 调试层时，诊断 `caustics.effectiveStrength = 0`；`?water=legacy` 与默认线性水介质路径未改动。

## 2. 参数

参数集中在 `src/rendering/lighting/UnderwaterLightingConfig.ts` 的 `water.caustics`（`water.causticsStrength` 保留为 `caustics.strength` 的兼容镜像，`UnderwaterMedium` 读取的值不变）。

| 参数 | Phase 2 结束 | Phase 3 最终值 |
| --- | --- | --- |
| 总体强度 `strength` | `0.5` | `0.5`（未改） |
| 颜色 `color` | `(0.46, 0.88, 0.78)` | 同左（未改） |
| 基础频率 `pattern.baseFrequency` | GLSL 内 `0.42` | `0.42`（可配置） |
| 时间速度 `pattern.timeSpeed` | GLSL 内 `0.55` | `0.55`（可配置） |
| 域扭曲 `pattern.warpStrength` | GLSL 内 `0.38` | `0.50` |
| 脊线指数 `pattern.ridgePower` | GLSL 内 `7` | `9` |
| 细节权重 `pattern.fineMix` | GLSL 内 `0.45` | `0.30` |
| 细节频率 `pattern.fineFrequency` | GLSL 内 `5.1` | `5.1`（可配置） |
| 朝向遮罩 `facing` | GLSL 内 `0.12 / 1.6` | `0.12 / 1.6`（可配置） |
| 宏观包络 `macro` | GLSL 内 `0.62 ± 0.38` | `0.58 ± 0.42`，频率 `0.085 / 0.115`，速度 `0.07` |
| 距离衰减 `distanceFade` | 无 | `start 26 m / end 64 m / min 0.15` |

按表面强度与尺度（`scale` 是 `baseFrequency` 的乘数；有效频率 = 0.42×scale）：

| 表面 | 强度 | scale | 有效频率（rad/m，近似） |
| --- | ---: | ---: | ---: |
| 海床 `floor` | `0.075` | `3.7` | `1.55` |
| 礁石 `rock` | `0.06` | `3.5` | `1.47` |
| 沙丘 `dune` | `0.07` | `3.7` | `1.55` |
| 程序化珊瑚 `coral` | `0.045` | `3.3` | `1.39` |
| GLB 珊瑚 `glbCoral` | `0.04` | `3.3` | `1.39` |
| 远景装饰岩 `distant` | `0.025` | `3.0` | `1.26` |
| 前景装饰岩 `foreground` | `0.03` | `3.0` | `1.26` |

Phase 2 的对应值为 `0.075/4.2`、`0.06/4`、`0.07/4.2`、`0.045/3.6`、`0.04/3.6`、`0.025/3.5`、`0.03/3.5`（有效频率整体更高，视觉上更细、更均匀）。强度只做相对微调，没有改变“鱼群最亮、海床偏暗”的层级。

## 3. 模型与接入点

### 3.1 焦散场

`src/rendering/Caustics.ts` 仍是片元注入：

- 顶点阶段由 `instanceMatrix` 折算世界坐标与世界法线，普通网格与 InstancedMesh 共用同一世界场。
- 片元在 `<opaque_fragment>` 之后、色调映射之前加法合成；朝向遮罩 `0.12 + 0.88·up^1.6` 让水平面最明显、垂直面留少量环绕光。
- 新增按视距的平滑衰减：`1 − (1 − min) · smoothstep(start, end, |worldPos − cameraPos|)`，在高频丝网进入远景时先自然减弱，避免远景摩尔纹。
- 宏观包络（慢速大尺度正弦）改为可配置参数，抑制平铺感；细节八度权重降低，减少细密闪烁。
- `customProgramCacheKey` 编码全部新常量，避免不同表面的 shader 程序被错误共享。

### 3.2 门禁

`Environment.applyEffectVisibility()` 是唯一开关：`visible && waterLayers.caustics` 成立时取 `water.caustics.strength`，否则为 0。`?lighting=base`（`lightingMode='base'`）与 Water Effects/Caustics 调试层共用这条路径。诊断新增：

```json
"caustics": { "strength": 0.5, "effectiveStrength": 0, "color": [...], "pattern": {...}, "distanceFade": {...}, "surfaces": {...} }
```

## 4. 实测对比

所有截图来自真实 Chromium（SwiftShader 软件渲染），1440×900，固定 pause + step；先抓 Phase 2 基线，再抓 Phase 3 最终态。焦散与海藻随渲染时间动画，两次捕获的相位不同，因此 A/B 以区域统计量为准，单帧像素 diff 会显示丝网相位差。

### 4.1 Calm Overview

![Phase 2 / Phase 3 / diff](../test-artifacts/underwater-lighting-phase3/final/before-after-calm-overview.png)

区域线性亮度（显示空间，0–1）：

| 区域（1440×900） | Phase 2 | Phase 3 | 变化 | P95−P50 对比 |
| --- | ---: | ---: | ---: | ---: |
| 左上远水 | 0.1705 | 0.1705 | 0.00% | 0.0185 → 0.0185 |
| 鱼群 | 0.2966 | 0.2957 | −0.32% | 0.2768 → 0.2801 |
| 近景海床 | 0.2167 | 0.2135 | −1.47% | 0.0353 → 0.0294 |
| 右侧远景海床 | 0.2262 | 0.2222 | −1.76% | 0.0258 → 0.0154 |

- 海床均值没有抬升，右侧远景的对比降幅更大，对应新增的视距衰减。
- 鱼群均值几乎不变（−0.32%），P95−P50 对比略升；鱼群仍是画面最亮层。
- 全画面最大亮度 0.912（UI 文本），裁白像素 0；焦散没有溢出。

### 4.2 Predator 近景

![近景海床 x3 对比](../test-artifacts/underwater-lighting-phase3/final/seabed-near-crop-before-after.png)

| 区域 | Phase 2 | Phase 3 | 变化 |
| --- | ---: | ---: | ---: |
| 远水 | 0.2146 | 0.2144 | −0.08% |
| 鱼群 | 0.3084 | 0.3079 | −0.14% |
| 鲨鱼 | 0.3106 | 0.3101 | −0.15% |
| 近景海床 | 0.2370 | 0.2345 | −1.08% |
| 中景海床 | 0.2393 | 0.2376 | −0.69% |

近景海床的焦散丝网仍清晰可辨（P95−P50 `0.0490 → 0.0470`），线条更细、更分离，起伏更不规则；中景衰减后仍保留 `0.0355` 的局部对比。鱼群与鲨鱼亮度基本不变，两者仍明显高于海床。

### 4.3 Calm School（鱼群亮度层级）

![Phase 2 / Phase 3 / diff](../test-artifacts/underwater-lighting-phase3/final/before-after-calm-school.png)

| 区域 | Phase 2 | Phase 3 | 变化 |
| --- | ---: | ---: | ---: |
| 远水 | 0.1160 | 0.1161 | +0.05% |
| 鱼群 | 0.3213 | 0.3204 | −0.26% |

鱼群对远水的均值对比约 `2.76×`，P99 为 `0.622`，仍是画面最亮层。海床底部焦散丝网可见但保持低调。

### 4.4 基础模式门禁与像素一致性

![基础模式 A/B](../test-artifacts/underwater-lighting-phase3/final/before-after-calm-overview-base.png)

`?lighting=base` 实测诊断：`mode: base`、`waterMediumActive: false`、`caustics.effectiveStrength: 0`，浏览器错误 0。

基础模式 Phase 2/Phase 3 同区域逐像素对比：

| 区域 | mean abs diff | max abs diff |
| --- | ---: | ---: |
| 水面左上背景 | 0.0000 | 0 |
| 近景海床 | 0.0000 | 0 |
| 鱼群 | 2.6e−08 | 1/255 |

焦散在所有位置严格为零；仅鱼群 ROI 有 1/255 级别的栅格化抖动，不构成视觉差异。

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| Vitest | 29 个文件、193 项测试全部通过（新增 `tests/Caustics.test.ts` 5 项） |
| TypeScript `tsc --noEmit` | 通过 |
| Vite production build | 通过（因 Windows 侧 `dist/` 旧产物在本机不可清空，构建输出到 `dist-check/phase3`） |
| Calm 完整/基础模式真实浏览器截图 | 通过，0 错误 |
| Calm School 截图 | 通过，0 错误 |
| Predator 近景截图 | 通过，0 错误 |
| 材质色彩空间审计 | `colorSpaceIssues: []` |
| 基础模式焦散 | `effectiveStrength: 0` |
| 完整模式焦散 | `effectiveStrength: 0.5` |
| 固定模拟状态 | 500 鱼；截图等待不改变鱼数/模拟状态 |

截图诊断：

| 指标 | Full Calm | Base Calm | Full School | Full Predator |
| --- | ---: | ---: | ---: | ---: |
| Fish | 500 | 500 | 500 | 500 |
| Draw calls | 48 | 39 | 41 | 45 |
| Render triangles | 143,025 | 143,009 | 143,025 | 152,371 |
| 浏览器错误 | 0 | 0 | 0 | 0 |

Draw call 与 Phase 2 相同（48/39/45），焦散没有新增几何或材质通道。

新增/调整的单元测试：

- 配置完整性：`strength` 与 `water.causticsStrength` 镜像、包络上界、距离衰减区间、各表面正值、海床强度高于珊瑚/远景。
- 配置到 shader 的映射：`causticOptionsFor()` 不再有魔法数字；uniform 值与 `water.caustics` 一致。
- 注入内容：世界位置/法线 varying、距离衰减项、宏观包络 uniform、实例化矩阵折算。
- 保留“注入点缺失即抛错”的行为。
- 门禁：`Environment` 在 base 模式为零；关闭 Caustics 调试层、关闭 Water Effects、切回 full 时正确恢复。

## 6. 性能与已知限制

- 本环境只有 SwiftShader 软件渲染。截图里的 FPS/P95 不是硬件成绩；500/1000/2000 鱼的硬件 GPU FPS、P95 与 GPU timestamp 仍需在 Windows 主机执行：

```bash
npm run accept:gpu -- --counts=500,1000,2000 --warmup-ms=3000 --sample-ms=10000 --max-sample-ms=60000 --min-frames=120 --repeats=3 --channel=chrome
```

- 片元成本相对 Phase 2 只增加一个 `length()`、一次 `smoothstep` 与少量乘加（宏观包络/距离衰减参数化不改变指令量级）；没有新增 draw call，无每帧 CPU 计算。
- 焦散仍是程序化域扭曲+脊线近似，不是波动光学；这是美术可控的近似，不是物理正确的水面聚焦。
- 距离衰减是美术参数（26–64 m），不是吸收系数推导值；它只压缩远景高频，不替代水介质的消光。
- 两次捕获的焦散/海藻动画相位不同，A/B 以区域统计量为准；基础模式不受影响（焦散为零、逐像素一致除外）。
- Phase 4（光柱噪声、边缘衰减、遮挡）未开始。
- Phase 1/2 报告的历史结论未改写；Phase 2 的 near/far 水色与受光散射以当前代码为准，未回退。

## 7. 文件

修改：

- `src/rendering/Caustics.ts` — `CausticOptions` 扩展（颜色、频率、时间、扭曲、脊线、细节、朝向、宏观包络、距离衰减），GLSL 参数化，缓存键更新。
- `src/rendering/lighting/UnderwaterLightingConfig.ts` — 新增 `CAUSTICS_CONFIG` 与 `water.caustics`；`causticsStrength` 保留为镜像。
- `src/rendering/Environment.ts` — 新增 `causticOptionsFor()`；9 处 `applyCaustics` 调用改用配置；强度初始化/gate 读取 `water.caustics.strength`；新增 `causticStrengthValue` getter。
- `src/rendering/SceneManager.ts` — 诊断新增 `lighting.caustics`（含实时 `effectiveStrength`）。

新增：

- `tests/Caustics.test.ts`
- `vitest.config.ts`（排除 `.task-locks/**` 的接力备份副本，避免 `npm test` 误扫）
- `docs/UNDERWATER_LIGHTING_PHASE3_REPORT.md`
- `test-artifacts/underwater-lighting-phase3/`（baseline、final、`metrics.json`、before/after 面板、近景 x3 对比）

回退：`.task-locks/backups/phase3-20261110-044713/` 保留改动前 `src/rendering/` 与 `tests/` 全量副本；`.task-locks/phase2-baseline.sha1` 记录改动前 154 个文件的哈希。
