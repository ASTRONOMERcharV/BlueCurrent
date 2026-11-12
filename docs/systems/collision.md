# System — Collision

> 核实日期：2026-11-12。修改 Sphere、SDF、Proxy、避障、通道或碰撞 Debug 前阅读。当前状态摘要在 `../CURRENT_STATE.md`。

## 五个稳定逻辑障碍

`src/simulation/ObstacleSystem.ts` 的 `REEF_OBSTACLES` 顺序不可与视觉规格错配：

| 顺序 / ID | 中心 x,y,z (m) | Sphere 半径 (m) | 视觉身份 |
| --- | --- | ---: | --- |
| 0 / `b` | -7, 3.4, -3 | 3.4 | Spire |
| 1 / `c` | 5, 3.5, 4 | 3.5 | Platform |
| 2 / `hero` | 0, 3.6, -9 | 3.6 | Hero B1 |
| 3 / `d` | 11, 3.2, -7 | 3.2 | Twin D B1 |
| 4 / `e` | -12, 3.4, 9 | 3.4 | Terraces |

装饰岩、珊瑚、表生物和海草不在这份硬障碍集合中。`KelpRefugeField` 是软生态环境，不是第六类硬碰撞。

## 两条碰撞路径

默认 `obstacleShapeMode='sphere'`。Sphere 路径使用中心距离、`obstacleLookAhead` 预测位置、`obstacleMargin` 和切向项计算避障，积分后按 `radius + padding` 做安全投影。它保留历史行为，不因 B1 视觉网格变化而自动改形。

`?obstacleShape=reefProxy` 启用候选路径。`main.ts` 在五个 Reef GLB 变换齐全时调用 `buildReefProxySet()`；`ReefCollisionProxy.ts` 使用局部圆角盒、胶囊、椭球、YXZ 旋转和非均匀缩放。`ObstacleSystem` 沿用相同预测公式，只把距离/法线来源换成 SDF，margin 在 SDF 外只应用一次，投影则使用 SDF surface + padding。

Proxy 缺失或不完整时 `usesProxy` 为 false，会回退 Sphere。验收必须同时读取 `obstacleShapeMode`、`reefProxyActive` 和 `reefProxyReefCount`，不能只看 URL。

## 规格与视觉同步

视觉身份在 `src/rendering/reefVariantSpecs.ts`，实际世界变换来自 `ReefSample.collisionTransform`，碰撞图元在 `src/simulation/reefCollisionProxySpecs.ts`。这三处必须一起审查；`REEF_NEAR_LOCAL_SIZE` 是参考测量值，运行时代理使用加载资产的 `transform.localSize`。

当前 B1 Hero 使用 5 个图元，D 使用 10 个局部圆角盒。移动、旋转、缩放或更换 GLB 后必须重建 Proxy，并重新测量近景顶点覆盖、通道和行为回归。不要从视觉包围盒直接推断 SDF 覆盖。

## 观测与诊断

`ReefObstacleMetrics.ts` 记录穿透、深穿透、Sphere 相对 Proxy 的假避障、避障力、卡鱼、通道和 CPU 查询时间；`CollisionDebugVisualizer.ts` 显示 Proxy/margin/SDF/穿透。它们只读，不反馈 steering。

`blocksSegmentProxy` 在包围球剔除后按至多约 0.6 m 间隔采样，用于 LOS，不是连续碰撞求解。`queryNearestProxy` 返回诊断用最近 Proxy，UI 中的 Reef ID 可能来自所选鱼附近，不是全场景唯一对象。

## 校准证据与未决项

当前 B1 的顶点覆盖、63 s 行为、D 通道和截图版本只在 `../validation/visual-baseline.md` 维护，查询耗时只在 `../validation/performance.md` 维护；功能状态与双跑缺口由 `../CURRENT_STATE.md` 维护。本文件不复制这些易变数字。

复测或更换 Proxy 后，先更新对应 validation 文档和原始证据，再检查五个 ID、GLB 世界变换和本文件规则是否仍成立。旧实验 A 报告与 Debug 图片属于旧代理，不得覆盖当前 B1 口径。D 通道是否开放、ReefProxy 是否成为默认均属于未决决策。

## 测试与实验入口

```bash
npx vitest run tests/ObstacleSystem.test.ts tests/ReefCollisionProxy.test.ts tests/Sdf.test.ts tests/ReefObstacleMetrics.test.ts
npx tsx scripts/measure-reef-collision.ts --bins
npx tsx scripts/reef-collision-experiment.ts --mode=both --out=test-artifacts/reef-collision/<new-file>.json
npx tsx scripts/reef-collision-capture.ts --serve-dist=<existing-dist>
```

脚本参数、服务目录和输出路径以当前脚本为准；不要复用已不存在的 `dist-reef-collision-6`。运行新实验时使用新证据路径，避免再次覆盖旧 A/B 数据。

## 修改完成条件

同时核对五 ID、GLB 世界变换、Proxy 版本、覆盖、穿透、假避障、卡鱼和通道；视觉变化附当前 Debug 与 GLB 对照，模拟变化附 Sphere 与 ReefProxy 各自确定性回归。不得自行决定 D 通道开放或默认模式切换。
