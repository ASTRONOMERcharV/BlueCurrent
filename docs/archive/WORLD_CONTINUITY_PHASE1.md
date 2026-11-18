# World Continuity Phase 1 — P0 + P1 Delivery

日期：2026-11-11
范围：仅 P0（固定基线）与 P1（世界边界 / 悬浮感）。P2 岩石照明与 P3 构图未在本轮修改。

## 1. 结论

- 70 m × 70 m 的矩形生态缸已被连续地形替换：中心 70 m 保持原 `floorHeightAt` 高度与全部既有摆放，外围以非均匀网格延伸到约 **870 m**，外缘缓慢下降。
- 相机远平面由 180 m 调整为 400 m；最远相机 90 m + 400 m 远平面 = 490 m，小于地形半径 870 m，因此任何允许的环绕机位都看不到地形外缘、薄板侧面或地形下方虚空。
- 背景穹顶改为跟随相机（无限远水体代理），下半球与水体远距散射色对齐；远景地形顶点色从礁砂色过渡到 `scatterFarColor`，再过渡到深水背景色。
- 纯装饰中景/远景岩石使用独立种子 `0x51ed7a3`，全部经 `terrainHeightAt` 落地并嵌入地形；不参与碰撞，不消耗生态模拟随机流。
- 相机仅增加世界范围保护：不低于地形 +1.1 m、水平半径不超过 280 m、观察目标限制在礁区 ±28 m；`minDistance` / `maxDistance` 未缩短。
- `?terrain=legacy` 可恢复旧 70 m 方板、旧远平面与旧远景岩石，用于 A/B 与回滚。

## 2. P0 固定基线

场景：Encounter，种子 `0x9e71c0de`，warmup 150 步，500 鱼 + 100 小丑鱼，海草避难开启，固定 60 Hz。
时间点：17 / 43 / 52 / 60 / 63 s。
截图机位：Overview / School / Predator / Free(max)（17 s 另含 Free top/side）。

浏览器与 headless 模拟状态（相同种子、相同步数）逐项一致：

| 时间 | 浏览器 checksum | headless checksum | 存活 | 捕获 | 鲨鱼状态 |
| --- | --- | --- | --- | --- | --- |
| 17 s | `5fc49b68d382438d9bab50dd` | 同左 | 498 | 2 | patrol |
| 43 s | `fe3a62033d93b0edcdf510f0` | 同左 | 494 | 6 | pursuit |
| 52 s | `78df728a965daa58a17a9d96` | 同左 | 494 | 6 | pursuit |
| 60 s | `f50e0db9d777c4a449fc5072` | 同左 | 494 | 6 | pursuit |
| 63 s | `c991bdf33ad3ddd5026c3254` | 同左 | 494 | 6 | pursuit |

`npx tsx scripts/simulation-regression.ts --compare=test-artifacts/world-continuity-p1` 输出 `deterministic=true` 且五个时间点全部 `MATCH`。

P1 未修改任何 `src/simulation` 文件；`SimulationWorld` 只引用 `rendering/kelpPlacement` 的纯布局函数，不引用 `terrain`、`CameraController` 或 `Environment`。

## 3. P1 改动

新增：
- `src/rendering/terrain.ts`：`terrainHeightAt`（中心 34 m 内严格等于 `floorHeightAt`）、非均匀连续地形网格（14,641 顶点 / 28,800 三角形）、解析法线、顶点色远距过渡、相机范围约束；`createLegacySeabedGeometry` 为 A/B 路径。
- `src/rendering/terrainDecor.ts`：10 个中景 + 12 个远景装饰岩，独立种子、落位嵌入、两个 InstancedMesh。
- `src/rendering/lighting/CausticOptions.ts`：把 `causticOptionsFor` 从 Environment 抽出，供地形装饰复用。
- `scripts/world-continuity-capture.ts`：P0/P1 确定性截图（固定场景、时间、机位，冻结 rAF，逐帧显式渲染）。
- `scripts/simulation-regression.ts`：headless 固定步长回归与浏览器快照比对。
- `tests/TerrainContinuity.test.ts`：11 项地形连续性、法线、相机保护、装饰确定性测试。

修改：
- `Environment.ts`：连续地形 / 顶点色 / 装饰 / 穹顶跟随相机 / `terrainMode`。
- `SceneManager.ts`：远平面 400、`terrainMode` 选项、阴影诊断开关。
- `CameraController.ts`：地面、水平半径、目标范围保护。
- `UnderwaterLightingConfig.ts`：`domePhase2MidColor` `0x0a3343 → 0x0a3f58`，使背景下半球与远距水体散射在允许机位下接近（P2 仍会继续统一）。
- `main.ts`：只增调试快照、相机截图、`?terrain=legacy` 与地形装饰计数；不改变模拟数据来源。

## 4. 验收证据

目录：`test-artifacts/world-continuity-p1/`

- `acceptance/01..28-*.png`：4 个预设机位 + 24 个边界机位（8 方位角 × 极角 84°/89°/94°，距离 90 m，目标 (-2, 9, 0)），960×540 软件渲染。
- `sheets/acceptance-28.png`：28 张联系表。
- `sheets/boundary-before.png` / `boundary-after.png`：P1 前后 24 机位联系表。
- `sheets/presets-before-after-t17.png`：17 s 四组机位前后对比（左：`?terrain=legacy`，右：P1）。
- `state-t17/43/52/63.json`：浏览器完整鱼群/小丑鱼位置、速度、存活、恐惧、捕食者与校验和。
- `simulation-headless.json`：headless 基线与确定性结果。

检查结果：
- 24 张边界图均无矩形外轮廓、直角、薄板侧面、地形下方黑虚空；远景地形在远裁剪前已与水体颜色过渡。
- 装饰岩底部均低于 `terrainHeightAt`（测试断言），无悬浮；既有五块可碰撞礁石与 GLB 岩石未移动。
- 近景礁区、中景延伸地形、远景低对比轮廓三层可辨；远景装饰在 42-70 m 与 120-260 m 两带，未进入中央游泳区。
- 残留在部分平视机位可见的“海床地平线”色差：在 School 机位约 5/255 绿、8/255 蓝，最小极角边界机位约 4/255 绿、8/255 蓝；不是几何边缘或远裁剪截断，P2 将用同一水体散射模型继续收敛。

## 5. 工程与性能

- Vitest：33 文件 / 220 tests 全部通过（含新增 11 项）。
- `tsc --noEmit` 通过。
- 生产构建通过；输出到 `/tmp/blue-current-dist`。项目 `dist/` 目录在挂载盘上无法被 Vite 删除（`EPERM unlink dist/assets/...`），这是挂载权限问题，不是编译错误。Windows 本机 `npm run build` 仍需最终执行。
- 浏览器 smoke：`passed: true`，`browserErrors: 0`，desktop + mobile 截图已更新。
- 渲染预算（同 Overview 机位，44.07 m）：三角形 1,225,463 → 1,250,775（+25,312，+2.1%）；新增 2 个 InstancedMesh 装饰 draw call。地形自身 28,800 三角形。
- 以上为 SwiftShader 软件渲染证据；按验收要求，**实际 GPU 的 180 s 采样、30 分钟稳定性、P95/FPS 与 1000/2000 鱼扩展性仍需在 Windows 主机执行**，本轮不作硬件性能声明。

## 6. 回滚与遗留

回滚：
- `?terrain=legacy` 恢复旧地形、旧远平面、旧远景岩石。
- P1 的渲染改动集中在 `terrain.ts`、`terrainDecor.ts`、`CausticOptions.ts`、`Environment.ts`、`SceneManager.ts`、`CameraController.ts` 与一处穹顶色配置，可独立回退。
- `?lighting=base`、`?water=legacy` 保持原有诊断路径。

遗留 / 未修复：
1. 平视机位的海床地平线仍有轻微色差（见 §4），需要 P2 用统一的水体散射背景继续收敛。
2. 自由相机未限制在水面以下；允许机位（24 张验收）均在水下，但用户手动上抬仍可越过 y≈20.2 m。
3. 实际 GPU 视觉、FPS/P95、30 分钟稳定性未验证。
4. P2 岩石背光、焦散/光柱 A/B、P3 构图均未开始。
5. 期间并行会话新增的 ReefSample 相关文件不属于本阶段改动，构建/测试状态以其完成后的工作树为准。
