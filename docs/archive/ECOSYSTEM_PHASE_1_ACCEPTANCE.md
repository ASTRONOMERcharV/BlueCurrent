# Blue Current 2.0 — Phase 1 Acceptance

**日期：** 2026-11-09  
**阶段：** 统一海流场与连续栖息地基础模块  
**结论：** 通过独立模块、完整回归、生产构建和浏览器 smoke 验收；尚未接入实体行为。

## 1. 本阶段交付

设计文档为 [ECOSYSTEM_DESIGN.md](./ECOSYSTEM_DESIGN.md)，包含目标生态系统、物种清单、食物关系、空间分层、环境变量与单位、行为状态、生态数据流、计算频率、指标口径、性能风险和分阶段计划。

| 文件 | 内容 |
| --- | --- |
| `src/environment/OceanCurrentField.ts` | 基础流、显式礁石涡流、连续周期扰动、近底衰减、稳定速度限幅；调用方提供模拟时间和复用输出数组 |
| `src/environment/HabitatZoneSystem.ts` | 四层连续权重、深度/离底高度、相对光照、海藻几何密度、礁石邻域、冠顶和边界查询 |
| `tests/OceanCurrentField.test.ts` | 29 项海流与配置测试 |
| `tests/HabitatZoneSystem.test.ts` | 31 项栖息地与真实布局测试 |
| `docs/ECOSYSTEM_DESIGN.md` | 2.0 总体设计及接口契约 |

没有修改 `BoidSystem.ts`、`SimulationWorld.ts`、`PredatorSystem.ts`、`ObstacleSystem.ts`、`SimulationConfig.ts`、现有渲染、UI、场景或资产文件。新模块没有被主应用导入，因此本阶段不改变鱼群轨迹、捕食行为、画面或面板指标。

## 2. 数值与接口验证

海流测试验证默认方向、确定性、空间连续性、时间周期、右手涡流方向、轴心零速度、强度反向、径向与轴向衰减、近底衰减、未衰减湍流散度、速度上限、极大时间值、输出数组边界和非法配置。速度截断测试使用 10 与 `1e200` m/s 输入，确实执行截断分支，而不是仅验证默认低速度。

栖息地测试验证默认与重叠过渡区的权重归一性、过渡连续性、光照单调性、49 株真实布局转换、26/23 资产分类、6 株水平越界标记、冠层垂直范围、软边缘冠顶一致性、礁石三维邻域、退化零面积锚点、输出对象复用和非有限输入拒绝。

独立复核后，水层权重改为 `1-s0`、`s0-s1`、`s1-s2`、`s2`，确保自定义过渡区重叠时仍非负且总和为 1。海流使用周期取模和缩放后的稳定限幅，避免极大相位或速度平方造成溢出。两个模块默认复用现有 `floorHeightAt`。

## 3. 执行结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 定向单元测试 | `npx vitest run tests/OceanCurrentField.test.ts tests/HabitatZoneSystem.test.ts` | 2 个文件，60/60 通过 |
| 完整回归 | `npm test` | 12 个文件，99/99 通过 |
| 类型检查 | `npx tsc --noEmit` | 通过 |
| 生产构建 | `npm run build` | 通过，Vite 58 个模块完成构建 |
| 浏览器回归 | `npm run smoke` | `passed: true`，`browserErrors: []` |

首次生产构建在清理旧 `dist` 时遇到挂载目录 `EPERM`；获得目录删除权限后，同一命令完整重跑成功。该问题不是 TypeScript 或应用代码错误。构建仍有 Three.js 主 chunk 超过 500 kB 的提示，本阶段未改变代码分包策略。

浏览器截图：

| 视口 | 文件 |
| --- | --- |
| 桌面 | [blue-current-desktop.png](../test-artifacts/blue-current-desktop.png) |
| 移动 | [blue-current-mobile.png](../test-artifacts/blue-current-mobile.png) |
| 真实诊断输出 | [smoke-results.json](../test-artifacts/smoke-results.json) |

沙箱 Chromium 使用软件渲染。其 FPS、P95 帧时间和绘制耗时不能作为用户硬件 GPU 的性能结论；本次仅接受启动、交互、截图和浏览器错误检查。

## 4. 明确未完成项与后续门槛

当前没有鱼类/鲨鱼海流阻力、资源场、觅食、避难、海胆、海藻生物量、生态事件统计、新场景按钮或水下光谱渲染。相关 UI 未添加，因此没有伪造实时数据。

现有海藻冠顶约 2.18–3.80 m，而鱼群初始高度约 6.8–13.2 m，且低于 4 m 会受向上软边界力。避难行为接线前必须明确处理高度/边界尺度，不得仅提高海藻吸引权重。当前默认场景仍混合温带海藻与热带珊瑚资产，温带生态场景需要在后续组合层处理。

下一阶段应先建立 `EcosystemManager` 组合边界，用可开关方式接入海流，并验证默认关闭时轨迹完全不变、grid/brute-force 结果一致、固定种子可重复。视觉与硬件 GPU 性能验收仍需在用户本机执行。
