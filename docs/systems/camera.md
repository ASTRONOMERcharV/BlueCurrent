# System — Camera

> 核实日期：2026-11-12。修改相机数学、模式切换、构图或目标跟踪前阅读。视觉目标见 `../visual/composition.md`。

## 文件与职责

`src/rendering/CameraController.ts` 拥有模式、期望/阻尼位姿、OrbitControls 和诊断；`cameraStability.ts` 提供可测试的稳定参考系、School 航向、P95 拟合、Predator forward、目标有效性和上向量数学；`terrain.ts` 提供目标/位置世界保护。

所有预设共用：

```text
desired pose → stable frame → position/target damping
→ safe up → world guard → render camera
```

相机只读 `SimulationWorld`。不得写鱼或捕食者状态，也不得用瞬移、重置模拟或强制目标来掩盖轨迹不连续。

## 坐标与机位

Three.js 为右手、Y-up；生物资产的局部 forward 是 +Z，而相机世界 forward 从矩阵 −Z 读取。默认 PerspectiveCamera 为 48° vFOV，near 0.1、far 400，`?terrain=legacy` 为 far 180。

| 模式 | 当前规则 |
| --- | --- |
| Overview | `(30,18,29) → (0,6.5,-2)`；response 3.2。 |
| School | 主鱼群中心 + 可靠航向；baseline back/side/up=23.5/9/9.5 m，lead 0.6；P95 拟合、1.17 屏幕留白、scale 1.0–1.4。 |
| Predator | 根据目标距离计算 lead/back；目标无效时 forward 依次回退 target → velocity → previous heading → initial。 |
| Free / Orbit | 从当前姿态接管；OrbitControls 距离 8–90 m，damping 0.065。 |

`viewportFit()` 根据画布 aspect 调整距离。桌面 Console 是独立列，开/关会改变画布 aspect，所以不能只验一种 UI 状态。

## 稳定性细节

School 航向来自活体主鱼速度之和；一致性不足时降低信任并保持最近有效方向。P95 拟合使用预分配数组和周期更新，抗单鱼离群，但 1.4 上限意味着扩散群仍可能有一部分出框。

Predator 只有状态和目标存活均有效时才使用 target displacement。目标丢失、死亡或进入 patrol/search 后仍走同一阻尼管线，不另写跳变分支。

`controls.target` 最终可保存用于 HUD 的 `overlayTarget`，而 `lookTarget/dampedTarget` 是实际观察目标。诊断同时输出两者，不能混用。上向量优先采用与世界 up 一致的安全投影，接近垂直奇异点时使用稳定参考系。

世界保护限制目标范围、地形净空和相机活动半径，但不通过缩短 Orbit 距离解决问题。新增保护规则必须检查模式切换和目标切换时的连续性。

## 指标口径

`world.center` 每 30 个固定步更新，School 中心可能滞后约 0.5 s。`schoolVisibleFraction` 是实际屏幕投影估计，`schoolFitRawScale` 与阻尼后的 `schoolFitScale` 不同；报告必须写明时间点和视口。

相机数学基准只测 CPU JS，不是 GPU 帧率。角变化、平移速度、净空、目标来源和 visible fraction 都要从实际诊断读取，不能用截图猜测。

## 当前证据限制

`camera-regression-final` 是 **B1 Hero + 旧 D** 混合版本，不能作为完整 B1+C 验收；当前还缺浏览器 index→index、B1 后 School/Predator 截图和硬件长时轨迹。

具体可见率、净空、目标切换和截图版本只在 `../validation/visual-baseline.md` 维护，CPU 数学基准只在 `../validation/performance.md` 维护，功能状态由 `../CURRENT_STATE.md` 维护。本文件不复制这些易变数字。

## 测试与复现

```bash
npx vitest run tests/CameraController.test.ts tests/cameraStability.test.ts
npx tsx scripts/camera-regression.ts --out=<new-camera-run>
npx tsx scripts/camera-target-switch.ts --out=<new-target-run>
npx tsx scripts/camera-benchmark.ts
```

两个脚本的 `--out` 都只接受 `test-artifacts/` 下的目录名，不要重复传完整前缀。端口、视口和其他参数先读脚本。CPU 重负载捕获与其他测试串行；新结果使用独立目录并记录实际 renderer、资产版本和轨迹范围。

## 修改完成条件

至少覆盖水平、垂直、近垂直、反向、退化参考系、目标有效/失效、模式切换和窄宽视口。相机代码变更还需证明模拟 checksum 不变；构图变化更新 `../visual/composition.md` 和视觉基线，数学/接口变化更新本文件。
