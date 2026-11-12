# Blue Current — Underwater Lighting Phase 2 Report

日期：2026-11-10  
范围：受光 in-scattering 颜色与远近水色分层。  
状态：Phase 2 实现、软件浏览器验收、类型检查、生产构建与单元测试完成；硬件 GPU 性能验收未执行。

Phase 1 完成了太阳主光、半球填充、共享轮廓与静态阴影，并把 `?lighting=base` 收紧为真正的基础灯光验收。Phase 2 只改水体散射项与远景水体穹顶，不修改模拟、Boids、固定步长、基础灯光数值、消光曲线、焦散或光柱算法。

## 1. 交付结果

水体仍然只有一次线性合成，发生在 `<tonemapping_fragment>` 之前。Phase 2 在这同一遍里加入三层：

- **近/远水色分层**：近景水色偏青绿，远景向深蓝过渡；混合只改变 in-scattering 的色相，不改变 Beer-Lambert 消光曲线。
- **受光上层水体**：用相机到片元视线路径的中点高度估计水柱受光程度；浅水柱混入更多受光色，深水柱保持环境水色。
- **太阳方向弱前向散射**：使用归一化 Henyey-Greenstein 相对相位函数的正瓣，只在朝向太阳时加入少量暖青散射色；背向太阳不会人为压暗。

远景穹顶同步接入同一套 Phase 2 调色：

- Phase 2 专用的深/中/上三段色只在 `uPhase2 = 1` 时启用；基础模式保持 Phase 1 的原始穹顶色和原始 upperMix。
- 上层水增加一个窄的、弱的太阳方向光晕，作为远景受光散射色。
- 穹顶光晕与介质散射受同一个水体散射 gate 控制（`?lighting=base`、关闭 `Volumetric Scattering`、`?water=legacy`）。

这不是一次整体提亮，也不是用更亮的散射掩盖暗岩石。海床与近景材质没有改动；远景岩石变暗是深蓝水色的空气透视结果，右侧背光岩体仍保留深阴影。

## 2. 参数

参数集中在 `src/rendering/lighting/UnderwaterLightingConfig.ts` 的 `water` 段。

| 参数 | 最终值 |
| --- | --- |
| Near scatter colour | `#1A6878` |
| Far scatter colour | `#0A3A66` |
| Scatter colour distance | `28 m` |
| Surface scatter colour / strength | `#2F7F8C` / `0.32` |
| Surface / deep height | `18 m` / `1 m` |
| Sun scatter colour / strength | `#AEE6EC` / `0.20` |
| Scattering anisotropy (g) | `0.35` |
| Scattering strength | `0.9`（与 Phase 1 相同） |
| Absorption density / RGB multipliers | `0.0055 /m` / `1.38, 1.06, 0.78`（未改） |
| Dome Phase 1 mid / upper | `#0A3546` / `#146078` |
| Dome Phase 2 mid / upper | `#0A3343` / `#13596A` |
| Dome sun colour / strength / power | `#4A98A5` / `0.80` / `4.0` |
| Exposure / environment intensity | `1.05` / `0.55`（未改） |

这些仍是 Three.js 美术调色值，不是实测海水吸收光谱。密度、吸收乘数和散射强度保持 Phase 1 的值，避免用更亮的散射改动基础地表可读性。

## 3. 模型与接入点

### 3.1 水体介质

`src/rendering/UnderwaterMedium.ts` 在片元着色器中计算：

```text
T(d)        = exp(-absorption * d)
layerMix    = 1 - exp(-d / 28)
layerColor  = mix(nearColor, farColor, layerMix)
height      = cameraY + worldViewDirY * d * 0.5
surface     = smoothstep(1, 18, height)
litColor    = mix(layerColor, surfaceColor, surface * 0.32)
phase       = (1 - g^2) / (1 + g^2 - 2 g cosTheta)^1.5
sunLobe     = clamp((phase - 1) / (phasePeak - 1), 0, 1)
scatter     = mix(litColor, sunColor, sunLobe * 0.20)
inScatter   = scatter * (1 - T) * 0.9
result      = transmitted + inScatter
```

`d` 是相机到片元的视深。`cosTheta` 是视空间视线方向与视空间太阳方向的夹角；`viewMatrix` 和 `cameraPosition` 都是 Three r180 内建 uniform。世界位置在 `<project_vertex>` 之后由 `transformed` 重建，实例化网格乘一次 `instanceMatrix`，蒙皮网格使用当前蒙皮后的 `transformed`。

没有新增后处理、没有第二次 sRGB 编码、没有逐鱼灯光、没有新增 draw call。介质仍由 `uWaterMediumEnabled` 统一关闭；Phase 2 所有新 uniform 都声明在原有 `#ifdef USE_FOG` / `#ifndef USE_FOG` 两条互斥路径内，不产生重复声明。

### 3.2 远景穹顶

`src/rendering/Environment.ts` 的穹顶 shader：

- `uPhase2 = 0` 时严格回到 Phase 1：原始 mid/upper 色、原始 `smoothstep(0.05, 0.9)`、无太阳光晕。
- `uPhase2 = 1` 时启用 Phase 2 mid/upper 色、`smoothstep(0.0, 0.85)` 和太阳光晕。
- 太阳光晕为 `pow(max(dot(viewDir, sunDir), 0), 4.0) * 0.80`，混向 `#4A98A5`。

`uPhase2` 的唯一状态来源是 `SceneManager` 的水体 gate：

- `?lighting=base` → 介质关闭，`domeLit: false`。
- 关闭 Water Debug 的 `Volumetric Scattering` → 介质 in-scattering 关闭，`domeLit: false`。
- `?water=legacy` → `domeLit: false`，保持水体清晰度 A/B 回滚路径干净。
- 切回 `clear` 或 full 模式时按当前调试开关恢复。

## 4. 实测对比

### 4.1 完整模式：Calm

![Phase 1 / Phase 2 / diff / upper-left water](../test-artifacts/underwater-lighting-phase2/final/before-after-four-panel.png)

上排为同一 Calm 场景、500 鱼、固定步后的完整模式；左下为 8 倍差异图；右下为 Phase 2 上左水体放大。

同区域线性亮度 `meanY`（0–1）：

| 区域（1440×900） | Phase 1 | Phase 2 | 变化 | B/G 比 |
| --- | ---: | ---: | ---: | --- |
| 左上远水 | 0.0327 | 0.0353 | +7.9% | 1.43 → 1.34 |
| 右侧中景 | 0.0262 | 0.0257 | −1.9% | 1.48 → 1.42 |
| 右侧背光岩 | 0.0231 | 0.0197 | −14.6% | 1.33 → 1.38 |
| 左侧近岩 | 0.0196 | 0.0176 | −10.1% | 1.14 → 1.15 |
| 中部礁石 | 0.0823 | 0.0749 | −9.0% | 1.15 → 1.19 |
| 近景海床 | 0.0249 | 0.0241 | −3.2% | 1.16 → 1.17 |
| 鱼群 | 0.1062 | 0.1021 | −3.9% | 1.15 → 1.16 |

可确认的变化：

- 左上远水获得明确的受光提亮，右侧中景基本不变；同一张画面里出现了左亮右深的横向受光层次。
- 远景岩石在亮度略降的同时 B/G 从 `1.327` 升到 `1.384`，即更偏深蓝；近景海床只变化 `−3.2%`。这形成“近景保留、远景入水”的远近层次，而不是整体蒙层。
- 鱼群均值只下降 `3.9%`，但鱼群/左上远水对比仍为 `2.89×`；高光 P95 对比为 `7.06×`（Phase 1 为 `7.73×`）。鱼群仍是画面最亮层。

### 4.2 完整模式：Predator 近景（最终态 sanity check）

![Predator Full / Base](../test-artifacts/underwater-lighting-phase2/final/predator-full-vs-base-two-panel.png)

本轮进行期间，并行的 predator 会话更新了鲨鱼姿态的时间积分，因此 Phase 1 与 Phase 2 的 predator 截图不是同一姿态，不能作为 Phase 2-only A/B。这里只把最终合并态的 Full/Base 作为可读性检查：

| 区域 | Full | Base | Full/Base |
| --- | ---: | ---: | ---: |
| 远水 | 0.0582 | 0.0504 | 1.155 |
| 鱼群 | 0.0964 | 0.0913 | 1.055 |
| 鲨鱼 | 0.0977 | 0.0926 | 1.055 |
| 近景海床 | 0.0312 | 0.0276 | 1.132 |

Full/Base 的差异来自水体合成与局部水效，不是鲨鱼材质变化；两种模式下鱼群与鲨鱼都可辨认，攻击提示仍只在轮廓上。Calm 场景不受该 predator 时间积分更新的影响：旧/新 Phase 2 Calm 截图的平均差异为 `0.0427/255`，因此 4.1 的 Calm A/B 仍可用于 Phase 2 水色结论。

### 4.3 基础模式与完整模式

![Full / Base × Calm / Predator](../test-artifacts/underwater-lighting-phase2/final/full-vs-base-four-panel.png)

`?lighting=base` 的实测诊断：

- `waterMediumActive: false`
- `domeLit: false`（Phase 2 穹顶受光关闭）
- `waterEffectsVisible: false`
- 焦散、光柱、水面、颗粒全部关闭
- 鱼群、鲨鱼、海藻、海床和礁石仍可辨认

基础模式背景与 Phase 1 基础截图的对应区域逐像素一致：

| 区域 | mean diff | max diff |
| --- | ---: | ---: |
| 左上背景 | 0.0000 | 0 |
| 右侧背景 | 0.0000 | 0 |
| 顶部背景 | 0.0000 | 0 |

这证明 Phase 2 的穹顶调色和太阳光晕没有污染基础灯光验收。

### 4.4 调试层与 legacy 回滚

`scattering-off` 状态（关闭 `Volumetric Scattering`）的诊断：

- `volumetricScattering: false`
- `domeLit: false`
- 浏览器错误 0

`?water=legacy` smoke：

- `passed: true`
- 浏览器错误 0
- 画面尺寸 960×600，完整水体层

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| Vitest | 28 个文件、188 项测试全部通过（其中 Phase 2 新增 7 项；其余为并行 predator 会话新增测试） |
| TypeScript `tsc --noEmit` | 通过 |
| Vite production build | 通过 |
| Calm 完整/基础模式真实浏览器截图 | 通过，0 错误 |
| Predator 完整/基础模式截图 | 通过，0 错误 |
| 材质色彩空间审计 | `colorSpaceIssues: []` |
| 基础模式水介质 | `waterMediumActive: false` |
| 基础模式穹顶受光 | `domeLit: false` |
| 完整模式穹顶受光 | `domeLit: true` |
| legacy 水体路径 smoke | `passed: true`，0 错误 |
| 固定模拟状态 | 500 鱼；截图等待不改变鱼数/模拟状态 |

截图诊断：

| 指标 | Full Calm | Base Calm | Full Predator | Base Predator |
| --- | ---: | ---: | ---: | ---: |
| Fish | 500 | 500 | 500 | 500 |
| Draw calls | 48 | 39 | 45 | 36 |
| Render triangles | 143,025 | 143,009 | 152,371 | 152,355 |
| 浏览器错误 | 0 | 0 | 0 | 0 |

Phase 2 没有新增 draw call；相对于 Phase 1 的 full 48 / base 39，只有场景状态导致的三角形计数差异，没有新的几何或灯光。

## 6. 文件

新增：

- `docs/UNDERWATER_LIGHTING_PHASE2.md`
- `test-artifacts/underwater-lighting-phase2/`（before、after、base、legacy、scattering-off、final 与 `metrics.json`）
- `tests/UnderwaterOptics.test.ts` 中 5 项 Phase 2 纯函数测试
- `tests/UnderwaterMedium.test.ts` 中 1 项分层散射注入测试
- `tests/UnderwaterLighting.test.ts` 中 1 项参数边界测试

修改：

- `src/rendering/lighting/UnderwaterLightingConfig.ts`
- `src/environment/UnderwaterOptics.ts`
- `src/rendering/UnderwaterMedium.ts`
- `src/rendering/Environment.ts`
- `src/rendering/SceneManager.ts`
- `src/ui/layout.ts`（调试层文案改为 “lit in-scattering”）

## 7. 限制与下一步

- 本轮只有 SwiftShader 软件渲染。截图中的 FPS/P95 不是硬件成绩；500/1000/2000 鱼的硬件 GPU FPS、P95 与 GPU timestamp 仍未测量。
- Phase 2 是受控的远景水色细化，不是整体重打光。主要可见变化集中在上左远水、远景岩石的深蓝化与鱼群对比；近景 Predator 画面基本不变。
- 本轮截图对应合并后的项目树，包含并行 predator 会话的姿态时间积分更新；Calm A/B 已验证不受其影响（旧/新 Phase 2 Calm 平均差异 `0.0427/255`），Predator 仅作最终态 Full/Base 可读性检查。
- 右侧背光岩亮度下降 `14.6%` 是深蓝远水色的空气透视结果，不是材质变暗。若需要重新提亮岩石，应调整 Phase 1 的太阳/半球/地表材质，不应提高散射亮度。
- 新增片元计算包含 `exp`、`pow`、`normalize` 与少量点积；没有新增 draw call，但真实 GPU 的片元成本仍需在 Iris Xe 上复测。
- Phase 3（海床焦散尺度/强度）与 Phase 4（光柱噪声、边缘衰减、遮挡）没有开始。
- 硬件验收命令仍为：

```bash
npm run accept:gpu -- --counts=500,1000,2000 --warmup-ms=3000 --sample-ms=10000 --max-sample-ms=60000 --min-frames=120 --repeats=3 --channel=chrome
```

原始证据：[metrics.json](../test-artifacts/underwater-lighting-phase2/final/metrics.json)、[before](../test-artifacts/underwater-lighting-phase2/before/calm-environment.png)、[after](../test-artifacts/underwater-lighting-phase2/after/calm-environment.png)、[base](../test-artifacts/underwater-lighting-phase2/base/calm-environment.png)、[legacy report](../test-artifacts/underwater-lighting-phase2/legacy/report.json)、[scattering-off report](../test-artifacts/underwater-lighting-phase2/scattering-off/report.json)。
