# System — Simulation

> 核实日期：2026-11-12。修改 Boids、捕食者、固定步、场景或海带行为前阅读；跨模块结构见 `../ARCHITECTURE.md`。

## 所有权与核心文件

`SimulationWorld` 是唯一模拟事实所有者，持有主鱼/小丑鱼 `FlockData`、两套 `BoidSystem`、一个 `PredatorSystem`、`ObstacleSystem`、`KelpRefugeField`、固定步 scheduler 和真实 metrics。

| 文件 | 职责 |
| --- | --- |
| `src/simulation/FlockData.ts` | SoA、previous/current/next、存活、相位和固定种子初始化。 |
| `FixedStepScheduler.ts` | 1/60 s、最多 8 补步、丢弃超额、插值 alpha。 |
| `SimulationWorld.ts` | reset、固定步顺序、配置同步、30-step metrics。 |
| `BoidSystem.ts` | 分离/对齐/聚合、密度感知、恐惧、逃逸、庇护、避障、边界、转向与积分。 |
| `PredatorSystem.ts` | Patrol/Pursuit/Attack/Search、粘性目标、pursuit direct retarget、预测追踪和真实捕获。 |
| `EnvironmentForces.ts` | 世界边界的软力与切向引导。 |
| `SimulationConfig.ts` | 主鱼和小丑鱼独立参数；主鱼默认 500、小丑鱼 100。 |
| `Scenarios.ts` | 内部 ID 为 `calm` / `encounter` / `obstacles`，负责固定种子、基线和预热；UI 将 obstacles 显示为 Navigation。 |
| `src/spatial/UniformGrid3D.ts` | 连续单元候选搜索，精确距离筛选。 |
| `src/environment/KelpRefugeField.ts` | 共享海带布局的覆盖、遮蔽和庇护方向。 |

## 固定步协议

主鱼和小丑鱼都先 `beginStep()`，分别更新 next 状态，再统一 `swap()`；随后捕食者只接收主鱼群并更新。障碍 metrics 在步开始/结束观测，不反馈行为。详细指标和 `world.center` 每 30 步重算。

主鱼每步从邻居、捕食者、障碍、海带和边界计算合力，经过加速度/速度限制、转向限制和积分后，再执行障碍与世界安全投影。渲染通过 previous/current 与 alpha 插值，不参与这些写入。

## Boids 与海带行为边界

分离、对齐和聚合使用独立半径；默认主鱼为 1.4 / 4 / 5 m。聚合带密度感知缩放，逃逸含预测接近、个体横向差异和邻居恐惧传播。礁石或海带视线遮蔽会改变直接恐惧，受威胁且覆盖不足时才主动寻找海带。

`world.kelpLayout` 同时供 `KelpRefugeField` 和 `KelpScatter` 使用。不得重新随机生成一套视觉海带，也不得把装饰植物加入硬碰撞。主配置只把 `predatorEnabled`、`obstaclesEnabled` 和 `obstacleShapeMode` 同步到小丑鱼配置，其余半径、速度和 home 参数保持独立。

## 捕食者边界

检测半径受 aggression 影响。目标在 `patrol/search` 获取；`pursuit` 中每 0.35 s 检查一次，若另一条存活鱼距离小于当前目标距离 × `predatorRetargetAdvantage`（默认 0.85）且当前目标在 attack radius 外，可直接替换 `targetIndex` 并重置 `stateTime`；`attack` 阶段不换目标。追踪含有限预测，Attack 有持续时间，Search 使用前方搜索点以避免自身位置作为目标。捕获只从主鱼群移除，UI 捕获数来自真实事件。

海带和礁石会影响目标视线，但近距离仍可能捕获。相机和动画可以读取 `targetIndex`、目标和速度，不得强制目标、捕获或 FSM 状态来制造演示。

## 容易误改的细节

`UniformGrid3D` 保存构造时的 bounds 引用，替换整个 `config.bounds` 会使网格与世界边界失配。`world.center` 最多滞后约 0.5 s，School 相机和 UI 不能声称它是逐帧中心。

`main.ts` 在 `applyScenario` 后处理 `?fishCount`，而 `setFishCount()` 会 `reset()`；因此 URL 指定鱼数会清除场景预热与 predator release，但 `activeScenario` 仍保留。这是代码顺序推导出的风险，未见专门测试，修改前应补验证而不是默认当作预期行为。

死亡鱼保留实例槽，渲染时零缩放；实例数量不等于 `aliveCount`。最近邻接线和 school count 是观测指标，不是额外行为状态。

## 相关测试与命令

核心测试包括 `SimulationWorld`、`Scenarios`、`SchoolInitialization`、`ClownfishSchool`、`PredatorSystem`、`UniformGrid3D`、`DensityAwareCohesion`、`EvasionResponse`、`TurnRate`、`EnvironmentForces`、`KelpRefugeField`、`KelpRefugeIntegration`。

```bash
npx vitest run tests/SimulationWorld.test.ts tests/Scenarios.test.ts tests/UniformGrid3D.test.ts
npx vitest run tests/PredatorSystem.test.ts tests/KelpRefugeIntegration.test.ts
npm run sim:regression
npm run benchmark
npm run experiment:ablation
npm run experiment:predator
```

命令是否产生文件、覆盖哪个目录，要先读脚本。跨脚本 checksum 的尾部口径不同，不能把所有 24 位值直接互称同口径。

## 修改完成条件

保留固定步、双缓冲、网格精确等价、真实捕获和只读呈现边界；运行受影响测试与确定性回归，记录场景、种子、时间点和 checksum。接口或规则变化更新本文件，状态/基线变化再更新 `../CURRENT_STATE.md`，长期策略变化才更新 `../DECISIONS.md`。
