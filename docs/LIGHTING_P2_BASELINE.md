# Underwater Lighting P2.0 + P2.1 — 固定光照基线与岩石审计

日期：2026-11-11
范围：只做 P2.0（固定光照基线）与 P2.1（岩石材质/法线/实例审计 + 岩石 mask）。本轮**没有修改任何视觉参数、灯光强度、曝光、地形范围或模拟代码**；P2.2（补光）、P2.3（雾/曝光/地平线收敛）、P2.4（焦散/光柱 A/B）均未开始。

## 1. 结论

- 47 个岩石对象 / 113 个实例 / 125,579 个岩石三角形全部通过材质与法线审计：**没有缺失 normal、没有反向法线、没有负行列式实例、没有错误纹理色彩空间、没有 DoubleSide/透明岩石、没有异常压暗的实例 tint**。
- Final 模式 7 个含岩石 mask 的机位中，**岩石 mask 内纯黑像素（RGB ≤ 2/255）占比为 0.000%–0.044%**，全部低于 1% 门槛；高光裁切（RGB ≥ 250）在岩石 mask 和整帧中均为 **0.000%**。
- 俯视机位左右半画面平均亮度差：Base +1.26、Fog +0.93、Final +0.78（/255），没有垂直分界线或单侧过曝/过暗。
- Base → Fog 的平均亮度提升 2.9–10.3/255，Fog → Final 再提升 1.0–2.9/255；三者几何一致，没有 base 泄漏、双重 sRGB 或色调映射异常的迹象。
- **按当前证据，P2.2 的补光不应启动**：没有发现“岩石材质 bug 造成的黑色剪影”。仍建议先在 Windows 硬件 GPU 上跑同一套采集（见 §7），若硬件结果仍出现 >1% 黑像素，再按 P2.2 第一轮只调 `hemisphere` / `environmentIntensity`。
- 注意：本次采集期间并行会话修改了 `ObstacleSystem.ts`（礁石碰撞球半径 2.1→3.4 等）、`SimulationConfig.ts`、`kelpPlacement.ts` 和 `ReefSample` 视觉缩放。这些不是本阶段改动，但使 17 s 生态 checksum 从 P1 归档的 `5fc49b68…` 变为 `e9343dcd…`。浏览器与当前 headless 基线完全一致（见 §6）。

## 2. 新增与修改

新增：

- `src/rendering/lighting/RockDiagnostics.ts`：只读岩石审计。逐对象报告几何（顶点/三角形、normal 属性、单位长度比例、朝外比例、bbox 中心平均对齐、包围盒）、材质（side、roughness、metalness、底色、emissive、flatShading、vertexColors、transparent、map/normalMap/aoMap/roughnessMap/metalnessMap 的存在与 colorSpace、normalScale、aoMapIntensity）、实例（数量、负行列式、零缩放、tint 最小/最大亮度与暗实例数）与 flags。
- `scripts/lighting-baseline-capture.ts`：P2.0 固定基线采集脚本；支持 Base/Fog/Final 三模式、10 个机位、岩石 mask、页面内像素统计、分块续跑与硬件/软件浏览器切换。
- `tests/RockDiagnostics.test.ts`：8 项纯几何/材质诊断测试（不依赖 WebGL）。

修改：

- `src/rendering/Environment.ts`：登记所有实心岩石对象（5 个礁核、10 个程序化巨石、13 个 GLB 岩石/沙丘实例、2 个前景岩、地形装饰、5 套礁石变体的 near/mid/far + apron），新增 `getRockDiagnostics()`、`getRockMeshes()`、`setRockDebugMode('normal'|'off')` 与 `rockDebugMode` getter。默认路径不改变任何材质或可见性。
- `src/rendering/SceneManager.ts`：转发岩石诊断；新增 `captureRockMask()` 与 `settleVisual()`。`captureRockMask()` 用当前相机做两遍渲染：第一遍用黑色 Basic 覆盖全场景写入真实深度，第二遍只把岩石层染成白色并通过同一深度测试，因此 mask 只包含最终画面中可见的岩石像素；透明/不写深度/不测深度的水面、光柱、海雪、接触环在 mask 期间临时隐藏，实例 tint 临时摘除以保证二值覆盖率准确。所有状态在 `finally` 中恢复。
- `src/main.ts`：`?rockdebug=normal|normals`、`getRockDiagnostics()`、`captureRockMask()`、`setRockDebugMode()`、`settleVisual()` 调试接口；`Diagnostics` 增加 `rockDebugMode`。无默认视觉变化。
- `package.json`：新增 `npm run capture:lighting`。
- `src/rendering/lighting/UnderwaterLightingConfig.ts` 等灯光/水体参数**未改动**。

回滚：本阶段只新增只读接口与调试路径；删除新增模块/脚本/测试并回退上述三个文件的接口即可。`?rockdebug` 默认 off；不调用 `captureRockMask()` 时对正常渲染无影响。改动前的 `Environment.ts` / `SceneManager.ts` / `main.ts` / `package.json` 副本在 `test-artifacts/p2-baseline/backup/`（注意其中不含并行会话的礁石放大改动）。

## 3. P2.0 固定基线

场景：Encounter（种子 `0x9e71c0de`），暂停后 `setScenario('encounter')` + 显式步进到 17.00 s，`setVisualTime(17)`；500 学校鱼 + 100 小丑鱼；默认富场景（含 `?reef=set` 的 5 套礁石变体）。

10 个机位（Final 实际相机，三模式共用同一序列）：

| 机位 | 相机位置 | 目标 | 距离 | Final draw / 三角形 |
| --- | --- | --- | --- | --- |
| overview | (28.0, 18.0, 31.0) | (-2.0, 9.0, 0.0) | 44.1 m | 61 / 1,263,739 |
| school | (-19.1, 21.6, 1.7) | (0.4, 13.2, -11.0) | 24.7 m | 58 / 1,401,507 |
| predator | (-17.1, 7.7, 3.5) | (-4.1, 10.4, 0.7) | 13.6 m | 58 / 1,489,379 |
| free | (61.6, 9.0, 63.6) | (-2.0, 9.0, 0.0) | 90.0 m | 58 / 1,255,431 |
| reef-0 | (6.0, 6.6, -5.2) | (-7.0, 3.7, -3.0) | 13.5 m | 64 / 1,512,289 |
| reef-1 | (17.3, 6.7, -0.9) | (5.0, 3.8, 4.0) | 13.6 m | 68 / 1,499,901 |
| reef-2 | (11.1, 6.8, -16.4) | (0.0, 3.9, -9.0) | 13.6 m | 71 / 1,497,757 |
| reef-3 | (20.2, 6.4, -16.4) | (11.0, 3.5, -7.0) | 13.4 m | 72 / 1,446,842 |
| reef-4 | (-4.9, 6.6, -2.2) | (-12.0, 3.7, 9.0) | 13.5 m | 48 / 1,351,073 |
| top | (-2.0, 46.0, 0.1) | (-2.0, 4.0, 0.0) | 42.0 m | 63 / 1,267,883 |

5 个礁石近景：以每个礁核为圆心，相机放在太阳水平方向的**背光侧**，每个礁核加 −24°/−12°/0°/+12°/+24° 的变化；距离 13.1–13.3 m、高度约 6.4–6.8 m，避免相机落入珊瑚/海草层，同时保留背光轮廓。截图只裁 WebGL canvas（480×270，UI 全部隐藏）。

三模式：

- Base：`?lighting=base`。真实关闭水体介质（`waterMediumActive=false`、`domeLit=false`）、雾、焦散（effective 0）、光柱、海雪、水面光。
- Fog：`?lighting=full` 后仅开启 `sceneFog` / `waterAttenuation` / `volumetricScattering`；焦散、光柱、海雪、水面光全关。`domeLit=true`，作为水体介质的一部分保留。
- Final：全部开启（默认）。

证据目录：`test-artifacts/lighting-p2-baseline/`

- `baseline-{base,fog,final}-{pose}.png`：30 张 480×270 软件截图。
- `baseline-final-{overview,reef-0..4,top}-mask.png`：7 张可见岩石 mask。
- `baseline-{mode}.json`：每模式 10 个机位的相机、draw call、三角形、灯光诊断、`colorSpaceIssues`、岩石诊断、模拟快照与 mask 统计。
- `p2-baseline-metrics.json`：离线 PNG 亮度/黑像素/裁切统计。
- 岩石法线调试：`test-artifacts/lighting-p2-rockdebug/normals-final-reef-0.png`（`?rockdebug=normal`）。

## 4. P2.1 岩石审计结果

汇总（Final，47 对象 / 113 实例 / 125,579 三角形）：

| 项目 | 结果 |
| --- | --- |
| 缺失 normal | 0 |
| 反向法线（bbox 中心平均对齐 ≤ −0.3） | 0 |
| 法线混合/凹陷（平均对齐 −0.3…0.3） | 8（礁石 apron 与部分变体主体，非翻转） |
| 法线非单位长度 | 0 |
| 负行列式（世界或实例） | 0 |
| 零缩放实例 | 5（`?reef=set` 隐藏 5 个锚定 large 实例，属预期） |
| 纹理色彩空间问题 | 0 |
| DoubleSide / BackSide | 0 / 0 |
| 透明岩石 | 0 |
| 受审计岩石的暗实例 tint | 0 |
| flags 总数 | 3（全部是上述 5 个零缩放实例的 `transform:zero-scale-instances`） |

材质抽样（均为 FrontSide）：

- `glb_reef_large_a`：roughness 0.93、metalness 0、map sRGB、normalMap/aoMap NoColorSpace、instance tint `#b8d1de`（线性亮度 0.61）。
- `glb_seabed_dune_a`：roughness 0.97、metalness 0、map sRGB、normal/ao NoColorSpace、tint `#bfd3da`–`#cadde3`。
- `reef-hero-near`：roughness 1、metalness 0、map sRGB、normal/ao NoColorSpace。
- `reef-hero-apron`：roughness 0.95、metalness 0、map sRGB、normal/ao NoColorSpace。
- 程序化前景/巨石：无贴图、flatShading，符合既有设计。

归一化法线调试图（`?rockdebug=normal`）显示礁石法线连续、外表面完整，没有黑色背面或整块翻转剪影。

> 说明：8 个“混合”对象是凹陷/环形几何在 bbox 中心测试下的预期结果（apron 由多块碎石环绕合并而成，不是星形）。它们的平均对齐为正，不是翻转；因此没有对 `side`、法线或材质做任何修改。

## 5. 黑像素与高光统计

Final 模式，岩石 mask 内：

| 机位 | mask 占画面 | 纯黑（RGB≤2） | 近黑（RGB≤8） | 高光裁切（RGB≥250） |
| --- | --- | --- | --- | --- |
| overview | 7.50% | 0.000% | 0.000% | 0.000% |
| reef-0 | 29.97% | 0.044% | 0.234% | 0.000% |
| reef-1 | 12.67% | 0.000% | 0.000% | 0.000% |
| reef-2 | 15.82% | 0.000% | 0.000% | 0.000% |
| reef-3 | 15.94% | 0.000% | 0.000% | 0.000% |
| reef-4 | 12.27% | 0.000% | 0.000% | 0.000% |
| top | 6.60% | 0.000% | 0.000% | 0.000% |

整帧纯黑比例在三模式全部机位中最高为 0.157%（Base reef-2）；Final 全部为 0.000%。整帧高光裁切在所有 30 张截图中均为 0.000%。

平均亮度（0–255，整帧）：

| 机位 | Base | Fog | Final | Fog−Base | Final−Fog |
| --- | --- | --- | --- | --- | --- |
| overview | 45.4 | 50.6 | 51.8 | +5.2 | +1.2 |
| school | 53.2 | 56.7 | 59.6 | +3.4 | +2.9 |
| predator | 50.5 | 54.9 | 56.3 | +4.4 | +1.5 |
| free | 46.7 | 53.1 | 54.2 | +6.4 | +1.1 |
| reef-0 | 35.8 | 44.3 | 45.5 | +8.5 | +1.2 |
| reef-1 | 36.3 | 46.6 | 47.9 | +10.3 | +1.2 |
| reef-2 | 42.7 | 52.1 | 53.1 | +9.4 | +1.0 |
| reef-3 | 36.4 | 46.2 | 47.3 | +9.8 | +1.2 |
| reef-4 | 38.6 | 47.7 | 48.7 | +9.1 | +1.0 |
| top | 56.3 | 59.2 | 61.8 | +2.9 | +2.6 |

俯视左右半画面：

| 模式 | 左半 | 右半 | 右−左 |
| --- | --- | --- | --- |
| Base | 55.69 | 56.95 | +1.26 |
| Fog | 58.75 | 59.68 | +0.93 |
| Final | 61.43 | 62.22 | +0.78 |

结论：不存在“主光右侧过亮/左侧过暗”的垂直分界；Base/Fog/Final 的几何与亮度排序一致，差异来自水体介质与局部效果，符合预期。

## 6. 工程与基线

- `npx tsc --noEmit` 通过。
- Vitest：35 文件 / 233 tests 全部通过（含新增 8 项 `RockDiagnostics`）。
- Vite 生产构建通过（输出到 `/tmp`；项目 `dist/` 仍受挂载盘 EPERM 删除限制）。
- 浏览器控制台错误：三个模式均为 0（生产构建，默认富场景共 30 次页面采集）。
- `npm run smoke`（Vite dev + SwiftShader）在本环境 170 s 窗口内未完成，未作为通过证据；其覆盖的默认场景加载已由上面的生产构建采集替代，UI 行为由既有测试覆盖。
- 三个模式的模拟快照完全一致：17.00 s、1020 步、checksum `e9343dcdbe6cd223e385070e`、捕获 1。说明新增诊断/mask/调试接口没有扰动模拟。
- 当前 headless 基线（`scripts/simulation-regression.ts`）17 s checksum 同为 `e9343dcd…`，`deterministic=true`。P1 归档值 `5fc49b68…` 已因并行会话的模拟/碰撞改动而过期；P1 原文件已另存为 `test-artifacts/world-continuity-p1/simulation-headless-p1-archive.json`。
- 软件截图与数字只作**功能证据**；实际 GPU 的视觉确认、180 s 采样与 30 分钟稳定性仍待用户在 Windows 主机执行。

## 7. 复现

软件（本次使用，Linux VM）：

```bash
npm run build   # 或输出到 /tmp 备用 outDir
npx tsx scripts/lighting-baseline-capture.ts \
  --out=lighting-p2-baseline --tag=baseline \
  --modes=base,fog,final --poses=all \
  --width=480 --height=270 \
  --mask-poses=overview,reef-0,reef-1,reef-2,reef-3,reef-4,top \
  --serve-dist=/tmp/blue-current-dist-p2-final
```

Windows 硬件 GPU（建议用于 P2.2 决策与视觉验收）：

```bash
npm run build
npx tsx scripts/lighting-baseline-capture.ts \
  --channel=chrome \
  --out=lighting-p2-gpu --tag=gpu \
  --modes=base,fog,final --poses=all \
  --width=1920 --height=1080 \
  --serve-dist=dist
```

`--channel=chrome` 时不添加 SwiftShader 参数，JSON 的 `renderer` 字段会标记为硬件截图。分块运行会自动合并同一 `tag`/`mode` 的 JSON 条目，并在每个机位后写检查点；中途被杀不会丢失已完成机位。

法线调试：

```bash
npx tsx scripts/lighting-baseline-capture.ts --channel=chrome \
  --out=lighting-p2-rockdebug --tag=normals --modes=final --poses=reef-0 \
  --extra-query=rockdebug=normal
```

## 8. 下一步建议

1. 先在硬件 GPU 上重跑 §7 的 10×3 矩阵，重点看 reef-0..4 的 Final mask 黑像素比例与高光裁切；软件结果为 0.044% 上限。
2. 若硬件仍 >1% 黑像素：按 P2.2 第一轮只调 `hemisphere.intensity` / `groundColor` / `environmentIntensity`（0.8→0.95、`0x15414c`→`0x1d4c58`、0.55→0.62），再复测同一矩阵。
3. P2.3 的“海床地平线 4–8/255”仍存在：Base 图中最明显，Fog/Final 被水体介质部分掩盖但没有完全消除。此项留给 P2.3，不在本轮加浓全屏雾。
4. P3 的 checksum 对比需使用**当前**基线 `e9343dcd…`（或并行会话结束后的新基线），不能再用 P1 的 `5fc49b68…`。
