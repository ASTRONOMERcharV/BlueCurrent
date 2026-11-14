# System — Simulation

> 核实日期：2026-11-14。修改 Boids、捕食者、固定步、场景、鱼群结构或小丑鱼栖息行为前阅读；跨模块结构见 `../ARCHITECTURE.md`。

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
| `src/environment/AnemoneHabitat.ts` | 海葵放置公式的唯一副本、稳定 ID 与小丑鱼悬停锚点。 |
| `src/environment/SedimentField.ts` | 近底沙尘只读粒子池；读取鱼位置/速度与共享海流，绝不写模拟。 |

## 固定步协议

主鱼和小丑鱼都先 `beginStep()`，分别更新 next 状态，再统一 `swap()`；随后捕食者只接收主鱼群并更新。障碍 metrics 在步开始/结束观测，不反馈行为。详细指标和 `world.center` 每 30 步重算。

主鱼每步从邻居、捕食者、障碍、海带和边界计算合力，经过加速度/速度限制、转向限制和积分后，再执行障碍与世界安全投影。渲染通过 previous/current 与 alpha 插值，不参与这些写入。

## Boids 与海带行为边界

分离、对齐和聚合使用独立半径；默认主鱼为 1.4 / 4 / 5 m。聚合带密度感知缩放，逃逸含预测接近、个体横向差异和邻居恐惧传播。礁石或海带视线遮蔽会改变直接恐惧，受威胁且覆盖不足时才主动寻找海带。

`world.kelpLayout` 同时供 `KelpRefugeField` 和 `KelpScatter` 使用。不得重新随机生成一套视觉海带，也不得把装饰植物加入硬碰撞。主配置只把 `predatorEnabled`、`obstaclesEnabled` 和 `obstacleShapeMode` 同步到小丑鱼配置，其余半径、速度和 home 参数保持独立。

E2 在默认路径加入五个局部项：按朝向一致度加权的对齐（`alignmentAgreementBlend`）、按邻居数超过 `cohesionDensityTarget` 后放大的分离（`separationDensityBoost`，上限 1.75）、用邻居平均速度预判障碍的群体流（`obstacleAnticipationBlend`）、只在邻居恐惧 ≥ `startlePropagationThreshold` 时传播的一跳惊扰、以及按自身恐惧放大边界切向分量的边缘逃逸（`edgeEscapeBoost`；法向不变）。这些项默认开启，`schoolDynamicsEnabled=false` 时跳过新算术并逐步复现旧路径。它们只改变转向与加速度，不引入逐鱼 school ID、强制轨迹或捕获。

### E2 鱼群结构遥测

`computeMetrics()` 每 30 步用现有并查集生成 `SchoolStructureSnapshot`：roots/sizes、≥5 鱼的 schools、median、largest、largestPolarization、startleCount（fear ≥ 0.35）与 edgePressureCount。快照是只读副本，`getSchoolStructureSnapshot()` 不参与转向。`SchoolStructureTracker` 比较前后分量的共享鱼索引，派生 `split`/`merge`/`subgroup-emerged`/`subgroup-dissolved`（1.5 s 冷却、24 条上限），并维护规模直方图；它只观察，不写模拟。`predator-watch` 第二行读取该状态。

### E4 小丑鱼栖息

`AnemoneHabitat.ts` 是 CoralScatter 礁基海葵 x/z 公式的唯一来源，`CoralScatter` 改为读取同一 helper，渲染实例与模拟锚点不会漂移。`SimulationWorld` 选距原 spawn 最近的海葵（当前 `anemone-b`），把 `hover = (x, groundY + 5.5, z)` 写入 `clownfishConfig.habitatCenter`。`BoidSystem` 用环形软力：距离 > `habitatAttractRadius` 向内吸引、< `habitatCoreRadius` 向外轻推、中间死区；吸引力乘 `(1 - 0.5*fear)`，威胁可暂时压过栖息。没有传送、硬约束或逐鱼目标。`?habitat=legacy` 删除锚点并回到旧 home；`applyScenario` 不重建 `clownfishConfig`，所以该实验开关跨场景保留。

## 捕食者边界

检测半径受 aggression 影响。目标在 `patrol/search` 获取；`pursuit` 中每 0.35 s 检查一次，若另一条存活鱼距离小于当前目标距离 × `predatorRetargetAdvantage`（默认 0.85）且当前目标在 attack radius 外，可直接替换 `targetIndex` 并重置 `stateTime`；`attack` 阶段不换目标。追踪含有限预测，Attack 有持续时间，Search 使用前方搜索点以避免自身位置作为目标。捕获只从主鱼群移除，UI 捕获数来自真实事件。

海带和礁石会影响目标视线，但近距离仍可能捕获。相机和动画可以读取 `targetIndex`、目标和速度，不得强制目标、捕获或 FSM 状态来制造演示。

## 只读呈现遥测边界
鱼体俯仰平滑、转弯弯曲和捕食事件都只属于呈现层。`FishRenderer` 的 pitch/heading 状态与 `instanceTurn` 只写实例矩阵和 shader 属性，不写回 `FlockData`、`PredatorSystem` 或任何 alive/捕获状态；`?fishMotion=legacy` 只是渲染选项。

`PredationEventTracker`（`src/ui/PredationEventTracker.ts`）只消费每帧真实快照：`predatorState`、`targetIndex`、`captures`、`captureSerial`、`aliveCount`、school count 与 radius of gyration。它产生 `state-change`、`target-acquired`、`target-switch`、`target-lost`、`attack-missed`、`capture`、`group-compression`、`group-release`、`recovery` 和 `reset`，仅保留最近 24 条；`capture` 只按 `captureSerial` 增量产生，绝不从鱼数反推或强制捕获。时间回退只重置基线并发一条 `reset`，不产生假捕获。`window.__blueCurrent.getPredationEvents()` 在返回前 observe，便于 `step()` 取证；事件是观察 UI 与证据，不是模拟输入。

`SchoolStructureTracker`（`src/ui/SchoolStructureTracker.ts`）同样只消费 `SchoolStructureSnapshot`；`window.__blueCurrent.getSchoolStructure()` 在返回前 observe。`SedimentField` 是呈现层的确定性粒子池：每 1/30 s 读取主鱼群位置/速度、`floorHeightAt` 与共享海流，按近底距离和速度概率产生悬浮颗粒；它不写 `FlockData`、捕食者或任何 alive/捕获状态，`?sediment=0` 只关闭呈现。

### Phase F 性能遥测

`SimulationWorld.performance` 是默认关闭的 `PhaseEmaRecorder`（`src/simulation/PerformanceTelemetry.ts`），按固定步记录 `boidsMain`、`boidsClown`、`predator`、`metrics` 与子项 `obstacleQuery`，并派生 `other`。只有 `?perfTelemetry=1` 或 `setPerformanceTelemetryEnabled(true)` 才启用；关闭时 `performance.now()` 不计时，默认运行路径与 Phase E 相同。`BoidSystem` 的障碍查询小计只在遥测或 obstacle metrics 开启时逐鱼计时。`resetPerformanceCounters()` 清空并重新播种 EMA，`getPerformanceSnapshot()` 只读。`metrics.lastStepMs/averageStepMs` 仍是整步权威值；遥测不得改变 checksum（`tests/PerformanceTelemetry.test.ts` 验证 on/off 轨迹逐位一致）。

## 容易误改的细节

`UniformGrid3D` 保存构造时的 bounds 引用，替换整个 `config.bounds` 会使网格与世界边界失配。`world.center` 最多滞后约 0.5 s，School 相机和 UI 不能声称它是逐帧中心。

`main.ts` 在 `applyScenario` 后处理 `?fishCount`，而 `setFishCount()` 会 `reset()`；因此 URL 指定鱼数会清除场景预热与 predator release，但 `activeScenario` 仍保留。这是代码顺序推导出的风险，未见专门测试，修改前应补验证而不是默认当作预期行为。

`applyScenario` 只重建 `world.config` 并保留 `schoolDynamicsEnabled`；小丑鱼 `clownfishConfig` 不被替换，因此 `?habitat=legacy` 跨场景保留。回滚对照必须同时设置两个通道才能复现 pre-E2 的完整组合 checksum（只关 E2 时栖息仍会改变小丑鱼段）。`SchoolStructureSnapshot` 每 30 步更新，短于 0.5 s 的分裂可能不产生事件；事件冷却不是模拟冷却。

死亡鱼保留实例槽，渲染时零缩放；实例数量不等于 `aliveCount`。最近邻接线和 school count 是观测指标，不是额外行为状态。

## 相关测试与命令

核心测试包括 `SimulationWorld`、`Scenarios`、`SchoolInitialization`、`ClownfishSchool`、`SchoolStructureDynamics`、`SchoolStructureTracker`、`AnemoneHabitat`、`SedimentField`、`PredatorSystem`、`UniformGrid3D`、`DensityAwareCohesion`、`EvasionResponse`、`TurnRate`、`EnvironmentForces`、`KelpRefugeField`、`KelpRefugeIntegration`。

```bash
npx vitest run tests/SimulationWorld.test.ts tests/Scenarios.test.ts tests/UniformGrid3D.test.ts
npx vitest run tests/PredatorSystem.test.ts tests/KelpRefugeIntegration.test.ts
npm run sim:regression
npm run sim:regression -- --school-dynamics=legacy --habitat=legacy
npm run benchmark
npm run experiment:ablation
npm run experiment:predator
```

命令是否产生文件、覆盖哪个目录，要先读脚本。跨脚本 checksum 的尾部口径不同，不能把所有 24 位值直接互称同口径。

## 修改完成条件

保留固定步、双缓冲、网格精确等价、真实捕获和只读呈现边界；运行受影响测试与确定性回归，记录场景、种子、时间点和 checksum。E2/E4 行为改动必须同时记录 dynamic 新基线与 legacy 回滚值，并确认 `sediment=0` 不改变 checksum；E4 栖息测试要覆盖距离、扩散、平均速度、捕食者释放后返回与主鱼群不变。接口或规则变化更新本文件，状态/基线变化再更新 `../CURRENT_STATE.md`，长期策略变化才更新 `../DECISIONS.md`。
