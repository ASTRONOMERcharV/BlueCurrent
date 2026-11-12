# Blue Current — Architecture

> 核实日期：2026-11-12。本文记录稳定模块边界和数据流，不记录阶段完成状态；接口细节在 `systems/` 维护。

## 1. 系统上下文

```text
URL / ControlPanel / diagnostic API
                 │ actions and config only
                 ▼
index.html → src/main.ts ── assets and SceneManager assembly
                 │
                 ▼
        SimulationWorld
        ├─ main FlockData + BoidSystem
        ├─ clownfish FlockData + BoidSystem
        ├─ ObstacleSystem + optional ReefProxySet
        ├─ KelpRefugeField + shared kelpLayout
        ├─ one PredatorSystem
        ├─ FixedStepScheduler
        └─ real metrics / obstacle metrics
                 │ read-only state + interpolation alpha
                 ▼
           SceneManager
        ├─ Fish / Predator renderers
        ├─ Environment and asset scatter
        ├─ CameraController
        ├─ UnderwaterMedium / lighting
        └─ debug visualizers → one WebGL render
                 │
                 ▼
        StatisticsPanel / ControlPanel / captures
```

依赖方向是“生产入口组装 → 模拟拥有事实 → 呈现读取事实”。渲染层可以调用显式 actions 改配置或重置世界，但不在每帧更新中直接写鱼的位置、速度、存活集合或捕食者决策。

## 2. 帧循环与固定步顺序

`src/main.ts` 将帧差限制为 0.15 s，通过 `FixedStepScheduler.advance()` 以 1/60 s 固定步推进，最多补 8 步，超额步骤丢弃并计数，返回插值 `alpha`。

`SimulationWorld.step()` 的实际顺序：

```text
obstacleMetrics.beginStep
mainFlock.beginStep → main BoidSystem.update
clownfish.beginStep → clownfish BoidSystem.update
mainFlock.swap + clownfish.swap
PredatorSystem.update(mainFlock)
obstacleMetrics.endStep
simulation time/step counters → 30-step detailed metrics → timing
```

`SceneManager.update()` 随后依次更新鱼、 clownfish、捕食者动画、网格和碰撞诊断、相机、环境与光照，最后调用一次 `renderer.render()`。暂停只停止固定步推进，渲染和交互相机仍工作。详细指标与 `world.center` 每 30 步更新，不是逐帧数据。

## 3. 模块职责与接口

| 边界 | 所有者 / 入口 | 输入与输出 | 深入文档 |
| --- | --- | --- | --- |
| 生产组装 | `src/main.ts` | URL、场景、资产 → world、scene、UI actions、诊断 API | 本文件与 `PROJECT.md` |
| 鱼群与捕食者 | `SimulationWorld`、`BoidSystem`、`PredatorSystem` | 邻居、环境力、障碍 → 双缓冲状态、真实捕获与指标 | `systems/simulation.md` |
| 邻居搜索 | `UniformGrid3D`、`BruteForceSearch` | FlockData + radius → 相同精确邻居集合 | `systems/simulation.md` |
| 礁石碰撞 | `ObstacleSystem`、`ReefCollisionProxy` | 位置/速度/config → 预测力、安全投影、LOS | `systems/collision.md` |
| 软生态环境 | `KelpRefugeField`、`OceanCurrentField`、`HabitatZoneSystem` | 共享布局、海流、位置 → 遮蔽、覆盖、视觉运动 | `systems/simulation.md` |
| 场景渲染 | `SceneManager`、`Environment`、各类 Renderer/Scatter | 只读模拟、visualTime、资产 → Three.js 场景 | `systems/rendering.md` |
| 相机 | `CameraController`、`cameraStability` | 中心、速度、目标、视口 → 稳定位姿与诊断 | `systems/camera.md` |
| 资产与放置 | `*Asset.ts`、`ReefSample`、placement/scatter | GLB 契约、种子、地形 → 实例、LOD、世界变换 | `systems/assets.md` |
| UI 与诊断 | `ControlPanel`、`StatisticsPanel`、`window.__blueCurrent` | actions、真实 metrics → DOM、debug、验收快照 | `systems/rendering.md`、`validation/test-guide.md` |

## 4. 模拟内部边界

`FlockData` 使用连续类型化数组保存位置、速度、previous/next 状态、存活、相位和变体。一个固定步内读取当前缓冲并写 next，完成后统一 swap；外部代码不得假设 next 已是当前状态，也不得在步中修改数组。

主鱼与小丑鱼拥有独立配置和 `BoidSystem`，共享捕食者、障碍和海带场。捕食者只接收主鱼群用于捕获，小丑鱼可产生威胁响应但不被捕获。`Scenarios` 用固定种子、配置和预热构造可复现初始状态。

Uniform Grid 的 `cellStart/cellCounts/cellItems` 是连续单元存储；27 单元只产生候选，之后仍做精确距离筛选。网格保存构造时的 bounds 引用，替换整个 bounds 对象会造成失配。

## 5. 碰撞与视觉变换边界

`REEF_OBSTACLES` 固定五个 Sphere 和逻辑顺序。ReefProxy 模式不修改这份历史数据，而是根据五个 `ReefSample.collisionTransform` 构建复合 SDF，替代距离和法线来源。视觉网格移动或缩放后，如不同步重建 Proxy，就会与碰撞脱节。

`ReefSample` 负责 GLB 视觉变换与 LOD，`reefVariantSpecs` 负责资产前缀、目标尺寸和放置规格，`reefCollisionProxySpecs` 负责碰撞图元。三者是必须同步审查的不同文件，不是一个配置源。

`world.kelpLayout` 是唯一海带布局，渲染与 `KelpRefugeField` 共用。珊瑚、表生物、装饰岩和海草的视觉散布不自动创建硬碰撞。

## 6. 渲染与水体边界

`SceneManager` 在材质编译前安装 `UnderwaterMedium`。默认 WebGLRenderer 使用 ACES Filmic、sRGB 输出、曝光 1.05，主相机为 48° vFOV、near 0.1、far 400；`?terrain=legacy` 将 far 改为 180。阴影是 PCFSoft 且 `autoUpdate=false`，新 caster 必须触发 dirty。

默认 `clear` 水体通过一次性 ShaderChunk 注入，在 `<tonemapping_fragment>` 前完成吸收、散射和合成，没有后处理 composer。`legacy-display` 只用于旧公式诊断。焦散、光柱、海雪和水面属于局部效果；`setWaterEffects(false)` 不等于关闭介质，`lighting=base` 才是完整 base 验收路径。

相机统一采用“期望位姿 → 稳定参考系 → 位置/目标阻尼 → 安全上向量 → 世界保护 → 渲染”。生物资产约定 Y-up、+Z forward；Three.js 相机自身观察方向为局部 −Z，两者不要混淆。

## 7. 核心源码导航

| 需要确认的问题 | 首先打开 |
| --- | --- |
| 默认 URL、资产回退、Proxy 安装、帧循环 | `src/main.ts` |
| 参数与鱼群所有权 | `SimulationConfig.ts`、`SimulationWorld.ts`、`FlockData.ts` |
| 行为规则与捕食 FSM | `BoidSystem.ts`、`PredatorSystem.ts`、`EnvironmentForces.ts` |
| 两种碰撞路径 | `ObstacleSystem.ts`、`ReefCollisionProxy.ts`、`reefCollisionProxySpecs.ts` |
| 场景组装与渲染顺序 | `SceneManager.ts`、`Environment.ts` |
| 礁石视觉身份与变换 | `reefVariantSpecs.ts`、`ReefSample.ts` |
| 相机数学 | `CameraController.ts`、`cameraStability.ts`、`terrain.ts` |
| 水体与灯光唯一参数源 | `UnderwaterMedium.ts`、`lighting/UnderwaterLightingConfig.ts` |
| UI 真实数据与 actions | `ControlPanel.ts`、`StatisticsPanel.ts`、`main.ts` 诊断 API |

跨模块修改前先读 `DECISIONS.md`。具体接口陷阱、相关测试和验收命令在对应 `systems/*.md`，不要从文件名推断数据流。
