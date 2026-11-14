# BlueCurrent Demo Video — Project Audit

> 审查日期：2026-11-14  
> 审查对象：`Project/BlueCurrent` 当前工作树  
> 结论适用范围：演示脚本、录制准备、Demo Mode 与基于真实运行画面的剪辑

## 1. 总体判断

BlueCurrent 已具备制作一支 **60–90 秒技术验收短片**的基础：它有真实运行的群体模拟、捕食者状态机、空间网格、避障、固定种子场景、四种相机路径、可切换技术视图和真实性能读数。

当前版本适合的定位是：

> **A real-time 3D marine ecosystem simulation with local schooling behavior, predator–prey interaction and CPU uniform-grid neighbor search.**

它不适合被包装成：

- 写实级海底电影；
- WebGPU Compute 项目；
- 多捕食者食物网；
- 稳定 60 FPS 的 1080p 广告片；
- 已完成最终 MP4 的交付状态。

本审查区分“代码存在”“测试通过”“真实硬件画面签核”和“最终视频已制作”。四者不能互相替代。

## 2. 已核对证据

| 证据 | 当前结论 | 使用限制 |
| --- | --- | --- |
| `docs/CURRENT_STATE.md` | Integration Gate 已关闭；Phase D 环境视觉完成；Phase E 正在做鱼体运动与捕食事件呈现 | 该文件同时保留历史锁与当前状态，引用时需看日期 |
| `test-artifacts/integration-abc/2026-11-12T14-30-00Z/wp1/summary.md` | post-FSM 304/304 测试、tsc、生产构建、确定性回归通过 | 是 2026-11-12 的源码锁 |
| `test-artifacts/phase-e/2026-11-14t00-13-00z/summary.md` | 鱼体俯仰平滑、转弯弯曲、70 秒捕食事件链通过软件验证 | 报告中的 83 文件 / 642 tests 历史口径混入了嵌套工作树副本；审查时隔离项目测试为 45 文件 / 342 tests（Phase E 第二轮后为 49 文件 / 365 tests） |
| `test-artifacts/demo-mode/results.json` | 新增 90 秒 Demo Mode 在 1920×1080 SwiftShader 中完成 5 项布局/时间线检查，0 浏览器错误 | 是功能与布局证据，不是硬件帧率证据 |
| `test-artifacts/integration-abc/2026-11-12T14-30-00Z/wp2/summary.md` | Sphere 与 ReefProxy 双路径确定性、0 穿透、0 卡鱼；ReefProxy 五礁齐全 | 默认碰撞仍是 Sphere；Debug 场景不是最终美术场景 |
| `test-artifacts/integration-abc/2026-11-12T14-30-00Z/wp3/summary.md` | 四相机、School 构图、目标切换与响应式 UI 已测 | School 六时间点可见率约 0.85–0.97，追逐中会波动 |
| `test-artifacts/integration-abc/2026-11-12T14-30-00Z/wp4/summary.md` | Intel Iris Xe、1280×720 短测 120 帧为 91.25 FPS、P95 18.30 ms | 约 1.3 秒短测；无 GPU timestamp；不覆盖 1920×1080 |

历史截图 `screenshots/final-01` 至 `final-10` 来自 SwiftShader，画面可作构图参考，但不能用其中的 FPS 证明硬件性能。Phase E 的 `review-e1-*` 与 `review-e3-*` 联系表更接近当前呈现，但仍属软件证据。

本次审查修正了测试口径：Vitest 原先未排除 `.claude/**`，会把嵌套工作树中的整套测试再次执行，既重复计数又造成并发超时。`vitest.config.ts` 现已排除该目录；审查时为 **45 文件 / 342 tests 通过**，Phase E 第二轮新增测试后当前为 **49 文件 / 365 tests 通过**（2026-11-14）。

## 3. 功能状态清单

### 3.1 已实现，可作为主展示

| 能力 | 证据与说明 | 录制建议 |
| --- | --- | --- |
| TypeScript + Three.js 实时 WebGL 场景 | `src/main.ts`、`src/rendering/SceneManager.ts` | 明确写 WebGL，不写 WebGPU |
| 500 主鱼 + 100 小丑鱼的固定种子场景 | `src/simulation/Scenarios.ts`、`docs/CURRENT_STATE.md` | 全片保持默认富场景；不要随意改到 1500 鱼 |
| SoA、双缓冲、1/60 s 固定步长与插值 | `FlockData.ts`、`FixedStepScheduler.ts`、`SimulationWorld.ts` | 技术段可展示固定步和插值 |
| Separation / Alignment / Cohesion | `BoidSystem.ts`、相关 Vitest | 用行为结果解释局部规则，不宣称直接控制群体中心 |
| 三维 Uniform Grid 与 Brute Force 可切换 | `UniformGrid3D.ts`、`BruteForceSearch.ts` | 展示网格占用、候选来源和相同行为规则 |
| Patrol / Pursuit / Attack / Search | `PredatorSystem.ts`、`PredationEventTracker.ts` | 用真实状态和捕获事件做字幕，不强制成功 |
| 距离相关逃逸、预测追踪、捕获后恢复 | 预测器测试、Phase E 70 秒时间线 | 可展示群体压缩、分裂和重新组织 |
| Sphere 避障、软边界和安全投影 | `ObstacleSystem.ts`、`EnvironmentForces.ts` | 主片使用默认 Sphere，不把 Proxy 伪装成默认 |
| 五礁复合 SDF ReefProxy | `ReefCollisionProxy.ts`、`reefCollisionProxySpecs.ts` | 可在短技术镜头中开启，但注明实验路径 |
| Overview / School / Predator / Free 相机 | `CameraController.ts`、`CameraController.test.ts` | 主片主要使用预设相机，减少手动运镜 |
| Observation / Laboratory 双视图 | `src/ui/layout.ts`、`ControlPanel.ts` | 技术段用 Laboratory，正式片隐藏控制台 |
| 真实指标面板与 Predation Event Tracker | `StatisticsPanel.ts`、`PredationEventTracker.ts` | 只展示当前运行值；不得把模拟值换成固定数字 |
| 海底环境、GLB 鱼/鲨鱼、珊瑚、海藻、焦散与光束 | `src/rendering/`、`public/models/`、`docs/CURRENT_STATE.md` | 以低多边形风格为审美前提 |
| 固定种子与三种场景 | `calm`、`encounter`、`obstacles` | Demo Mode 已把它们串成 90 秒时间线 |

### 3.2 已实现，但需控制镜头与文案

| 问题 | 实证限制 | 演示决策 |
| --- | --- | --- |
| 鱼体运动和转向 | Phase E 已限制俯仰、加入转弯弯曲；硬件视觉签核仍待完成 | 以中景/侧后方跟随为主；近景先做人工审片 |
| 鲨鱼游动 | 11 骨程序化驱动已实现，P2 下颌/胸鳍仍未完成 | 避免过近、过长的头部特写；优先侧后方追逐 |
| School 构图 | post-FSM 六点可见率约 0.852–0.972；180 秒动态追逐曾出现瞬时低可见率 | 不在目标切换尖峰处硬切；必要时延长稳定画面 |
| 水体 | Phase D 已改善清晰度、雾效、散射和对比度 | 用项目内实时效果，不用高对比滤镜掩盖；避免宣称写实 |
| 技术叠加 | 网格与碰撞代理能解释算法，但同屏过多会遮挡鱼群 | Demo Mode 已关闭碰撞线框森林，只保留网格、邻居和单鱼向量 |
| 性能 | 当前硬件证据是 Intel Iris Xe、1280×720；1920×1080 录制尚未测 | 最终 FPS 卡片必须在录制现场实测 |
| 捕食事件 | Phase E 70 秒内出现 5 次真实捕获；时间与目标来自固定种子 | 可展示事件，但不能保证每条随机录取都有相同捕获时刻 |

### 3.3 未实现或不足以成为主展示

| 能力 | 现状 | 禁止文案 |
| --- | --- | --- |
| WebGPU Compute | 未实现；当前为 Three.js WebGL + CPU 模拟 | “GPU 群体计算”“WebGPU ecosystem” |
| 多捕食者完整生态 | 当前只有一只捕食者 | “multi-predator ecology” |
| 食物网、资源/饥饿系统 | 海流、栖息区和海带庇护只是部分生态响应 | “complete food web” |
| 写实鱼类皮肤/鳞片/骨骼水动力学 | 当前为风格化 GLB 和程序动画 | “photoreal marine simulation” |
| 稳定 1080p 60 FPS | 无对应硬件证据 | “runs at 60 FPS in 1080p” |
| 自动高质量相机导演 | 本次只新增时间线控制，仍复用现有四种相机 | “cinematic camera path solver” |
| Remotion 工程 | 仓库中没有已安装/可运行的 Remotion 工程 | “video packaging complete” |
| OBS 正式录制与 DaVinci 成片 | 均未在仓库中完成 | “final video delivered” |

## 4. 本次最小 Demo Mode 改动

新增 `src/demo/DemoDirector.ts`，提供一个严格 90 秒的展示时间线：

- `00–08` Calm / Overview / Cinematic
- `08–23` Calm / School / Cinematic
- `23–39` Encounter / Predator / Cinematic
- `39–44` Encounter 延续 / School / Cinematic
- `44–53` Navigation / Overview / Cinematic
- `53–62` Calm / Laboratory / Uniform Grid
- `62–67` 同一模拟 / Laboratory / Brute Force
- `67–70` 同一模拟 / Laboratory / 返回 Uniform Grid
- `70–90` Calm / Overview / Cinematic

导演只调用：

- 固定种子场景重置；
- 相机模式；
- Observation / Laboratory；
- 搜索模式；
- 真实网格显隐；
- 调试层显隐；
- UI 呈现模式和播放状态。

它不写鱼的位置、速度、存活状态、捕食目标或 FSM 状态。场景切换只发生在明确的剪辑点；片内运动仍由模拟更新。

已知限制：`applyScenario()` 会在主线程执行固定预热步。23、44、53 秒的场景重置在一次性连续录制中可能出现短暂停顿。正式母版应把章节切换放在黑场/硬切上，或分别录制章节后再剪辑；不能把停顿解释为实时计算的高帧率表现。

录制入口：

```text
/?demo=cinematic
```

调试接口：

```js
window.__blueCurrent.getDemoState()
window.__blueCurrent.restartDemo()
window.__blueCurrent.stopDemo()
window.__blueCurrent.seekDemo(53)
```

`seekDemo()` 只用于找机位和预检，不应用于伪造一段连续生态运动。

验证证据：

- `tests/DemoDirector.test.ts`
- `scripts/demo-smoke.ts`
- `test-artifacts/demo-mode/results.json`
- `test-artifacts/demo-mode/cinematic-opening.png`
- `test-artifacts/demo-mode/technical-grid.png`
- `test-artifacts/demo-mode/technical-brute-force.png`

## 5. 推荐制作边界

### 主片

制作一支 **60–90 秒技术叙事片**，真实录屏占时长主体。允许使用：

- 黑场、淡入淡出；
- 真实运行画面的轻微裁切和稳定；
- 标题、状态字幕、算法示意；
- 通过 Remotion 叠加的真实指标；
- 基于真实 Debug 画面的网格/Brute Force 对照。

### 技术验收版

优先交付一版 60–90 秒“真实运行 + 简单标注”的视频，先证明：

- 场景可运行；
- 鱼群和捕食事件真实发生；
- 网格及性能读数来自运行；
- 镜头和编码稳定。

### 宣传加强版

第二轮再做：

- 更自然的鱼体/鲨鱼近景；
- 更精细的自动相机路径；
- Remotion 技术包装；
- 调色、音效和节奏精修。

## 6. 必须遵守的真实性规则

1. 所有生态运动来自 `SimulationWorld`，不得手工改鱼群轨迹制造漂亮队形。
2. 所有 FPS、步耗时、邻居数、占用单元和捕获数来自实际录制运行。
3. SwiftShader 画面可作布局检查，不可作为硬件性能卡片。
4. 1920×1080 录制时未测得的性能，不能借用 1280×720 数字并省略分辨率。
5. 未实现的行为不出现在画面上；如果 Remotion 画的是算法解释，应明确标为 schematic，而不是实时画面。
6. 不用外部写实海底素材冒充 BlueCurrent。

## 7. 可安全使用的宣传句

- “BlueCurrent is a real-time 3D predator–prey schooling simulation built with TypeScript and Three.js.”
- “Hundreds of fish coordinate through local separation, alignment and cohesion.”
- “A CPU uniform grid accelerates neighbor queries while preserving the same behavior rules.”
- “A predator state machine produces pursuit, escape, capture and recovery inside the live simulation.”
- “Fixed-step simulation and deterministic scenarios make the presentation repeatable.”

宣传时应优先强调“生态行为真实生成”和“运行时可交互”，而不是声称写实程度或未测量的帧率。
