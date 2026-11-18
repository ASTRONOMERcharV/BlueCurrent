# Experiment A 交付报告 — Reef Collision Proxy

日期：2026-11-11
范围：`Project/BlueCurrent`
状态：实现、单元测试、固定种子对比、Laboratory 截图均完成；仅剩本机硬件 GPU 视觉验收。

详细审计、设计与实现在 [`REEF_COLLISION_PROXY_EXPERIMENT.md`](REEF_COLLISION_PROXY_EXPERIMENT.md)。
本文对应任务要求的六项交付：文件结构、五块代理配置、Debug 截图、Sphere/ReefProxy 数据、
测试结果、遗留问题。

## 1. 修改文件和代码结构

### 新增

| 文件 | 作用 |
|---|---|
| `src/simulation/sdf.ts` | `sdRoundedBox` / `sdCapsule` / `sdEllipsoid` / `unionDistance` / 中心差分法线回退；正外负内、零在表面 |
| `src/simulation/reefCollisionProxySpecs.ts` | 五块礁石的数据化代理配置（局部比例）、实测近 LOD 尺寸 |
| `src/simulation/ReefCollisionProxy.ts` | 世界空间变换、带符号距离、最近表面法线、复合代理、代理集合 |
| `src/simulation/ReefObstacleMetrics.ts` | 逐礁指标、力直方图 p95、通道吞吐、卡鱼计时、CPU 查询计时 |
| `src/rendering/CollisionDebugVisualizer.ts` | 代理线框、margin 外壳、穿透标记、选中鱼法线箭头 |
| `tests/Sdf.test.ts` | SDF 基础测试（7） |
| `tests/ReefCollisionProxy.test.ts` | 变换 / 旋转 / 非均匀缩放 / 法线 / 退化 / 复合 / 覆盖测试（11） |
| `tests/ReefObstacleMetrics.test.ts` | 指标累加、通道计数、卡鱼判定、默认关闭（4） |
| `scripts/measure-reef-collision.ts` | 解析 GLB 顶点与真实节点变换，输出代理覆盖率 JSON |
| `scripts/reef-collision-experiment.ts` | 固定种子 Sphere vs ReefProxy 对比（17/43/52/60/63 s） |
| `scripts/reef-collision-capture.ts` | 静态 dist + Playwright/SwiftShader 的 Laboratory 截图 |

### 修改

| 文件 | 修改 |
|---|---|
| `src/simulation/SimulationConfig.ts` | 新增 `obstacleShapeMode: 'sphere' \| 'reefProxy'`，默认 `'sphere'` |
| `src/simulation/ObstacleSystem.ts` | 保留原球体路径；新增代理集合、模式分派、SDF 避障、SDF constrain、SDF 线段遮挡、指标钩子 |
| `src/simulation/SimulationWorld.ts` | 安装代理、切换模式、指标 begin/end、诊断输出、小丑鱼同步 |
| `src/simulation/Scenarios.ts` | 场景重置时保留显式指定模式，不静默切回 |
| `src/simulation/BoidSystem.ts` | 指标开启时的 CPU 计时；把 config 传给线段遮挡 |
| `src/simulation/PredatorSystem.ts` | 捕食者避障/约束不计入鱼类指标；线段遮挡传 config |
| `src/rendering/ReefSample.ts` | 暴露基于真实 group 位置/旋转/缩放的 `collisionTransform` |
| `src/rendering/Environment.ts` | 提供五块礁石的碰撞变换 |
| `src/rendering/SceneManager.ts` | 挂载 `CollisionDebugVisualizer`、调试层 API、选中鱼信息 |
| `src/rendering/DebugVisualizer.ts` | `setManualSampleIndex`，允许固定选中鱼 |
| `src/ui/layout.ts` | Laboratory 的模式选择、调试层开关、读数面板 |
| `src/ui/ControlPanel.ts` | 新控件绑定与同步 |
| `src/main.ts` | URL 参数、礁石加载后安装代理、诊断/调试 API |
| `src/style.css` | 碰撞读数样式 |
| `tests/ObstacleSystem.test.ts` | 4 → 7：球体基线、代理转向、代理约束、代理线段遮挡 |

关键结构关系：

```
ReefSample (真实 group T/R/S) ──► collisionTransform ──► buildReefCollisionProxy
                                                              │
SimulationWorld.obstacles (ObstacleSystem) ◄── setReefProxies ┘
        │
        ├─ computeAvoidance(mode=reefProxy): margin − sdf，最近表面法线
        ├─ constrain: sdf < padding 时沿法线推出
        └─ blocksSegment: 0.6 m 采样的 SDF 遮挡测试
```

球体实现未删除；`obstacleShapeMode = 'sphere'` 时仍走原来的中心-半径数学，校验和与实验前完全一致。
代理不可用时（`?reef=off`、GLB 加载失败）自动回退球体。

## 2. 五块礁石的代理形状配置

局部坐标约定：X/Z 为相对半宽/半深的比例，Y 为相对全高的比例（网格底部在 y=0）。
运行时按真实 GLB 尺寸与 group 的 `Euler YXZ + 非均匀缩放` 映射到世界空间。

实测近 LOD 局部尺寸（宽 × 高 × 深，m）：

| Reef | 局部尺寸 | 运行时缩放 | yaw / tiltX / tiltZ |
|---|---|---|---|
| B / Spire | 3.858 × 3.998 × 3.394 | 1.607 / 1.576 / 1.620 | −30° / 1.5° / −4° |
| C / Platform | 4.197 × 2.201 × 3.199 | 1.668 / 1.953 / 1.813 | 16° / −2° / 3° |
| Hero | 4.804 × 4.644 × 4.413 | 1.457 / 2.024 / 1.427 | −16° / 0° / 0° |
| D / Twin | 2.800 × 2.750 × 2.398 | 2.179 / 2.437 / 2.168 | 76° / 1° / 4° |
| E / Terraces | 3.290 × 2.952 × 2.898 | 2.067 / 1.660 / 2.070 | −38° / −1.5° / −3.5° |

形状明细（全部为局部比例）：

| Reef | 形状 |
|---|---|
| B | 底部圆角盒 center(0, .150, 0) half(.830, .075, .796) round .085；中部圆角盒 center(−.182, .488, 0) half(.441, .113, .365) round .075；下尖胶囊 a(−.259, .613, .147)→b(−.285, .763, .177) r .220；倾斜尖胶囊 a(−.415, .825, .324)→b(−.544, .881, .295) r .130 |
| C | 扁平基座圆角盒 center(0, .264, 0) half(.834, .250, .781) round .136；上平台圆角盒 center(0, .745, 0) half(.372, .227, .388) round .127 |
| Hero | 主体盒 center(−.021, .237, 0) half(.833, .140, .807) round .097；中层盒 center(−.125, .521, .023) half(.591, .075, .499) round .097；左肩胶囊 a(−.437, .603, .159)→b(−.416, .700, .181) r .226；右肩盒 center(.063, .657, −.249) half(.167, .054, .159) round .075；顶部椭球 center(−.354, .829, .181) radii(.458, .179, .372) |
| D | 低连接盒 center(0, .127, .042) half(.607, .018, .709) round .127；左柱胶囊 a(−.414, .200, .125)→b(−.457, .756, .125) r .255；右柱胶囊 a(.700, .200, .184)→b(.679, .709, .184) r .182；背部薄网盒 center(.143, .491, .542) half(.250, .127, .100) round .044；前侧双柱开口保留 |
| E | 基座板 center(0, .176, 0) half(.808, .102, .780) round .095；中层台地 center(−.201, .508, .138) half(.438, .119, .311) round .085；上层台地 center(−.091, .796, .117) half(.219, .119, .235) round .081 |

世界映射与数值处理：

- 圆角盒在 `S + R` 下是精确的有向盒，半尺寸为 `half × S`；圆角膨胀取 `rounding × max(Sx,Sy,Sz)`，
  避免高窄缩放导致覆盖不足。
- 胶囊端点在局部空间，直接对局部点求 `sdCapsule`，距离乘以最小缩放；法线经 `S⁻¹R`（逆转置）
  变换后归一化，非均匀缩放不会把法线拉离真实最近表面。
- 椭球半径逐轴缩放。
- `margin` 只在 SDF 之外应用一次：`clearance = obstacleMargin − sdf`；代理形状本身不含 margin。

对近 LOD 全部顶点、真实运行时变换的覆盖率（世界空间 SDF）：

| Reef | 代理外顶点 | > 5 cm | 最大外距 | 图元数 |
|---|---|---|---|---|
| B | 5.20 % | 454 | 0.39 m | 4 |
| C | 0.50 % | 13 | 0.12 m | 2 |
| Hero | 1.64 % | 108 | 0.25 m | 5 |
| D | 12.07 % | 1,145 | 0.62 m（内部薄网） | 4 |
| E | 0.91 % | 42 | 0.12 m | 3 |

所有残差都在 1.25 m margin 带内；D 的薄网是唯一超过 0.5 m 的局部，列为校准项。

## 3. Debug 截图

位置：`test-artifacts/reef-collision/`，由生产构建 `dist-reef-collision-6` 在 Laboratory、
全调试层、`?obstacleShape=reefProxy&obstacleMetrics=1` 下截取：

| 文件 | 内容 |
|---|---|
| `debug-overview.png` | 五块代理总览 + margin 外壳 |
| `debug-spire-b.png` | B 底部/中部盒 + 双胶囊，读数 B SDF +2.02 / clearance +0.77 |
| `debug-platform-c.png` | C 扁平基座与上平台，无双层 7 m 包络 |
| `debug-hero.png` | Hero 主体盒、肩部、顶部椭球 |
| `debug-hero-margin.png` | Hero margin 外壳 |
| `debug-hero-top.png` | Hero 顶部尖塔覆盖，读数 SDF +2.13 |
| `debug-twin-d.png` | D 双柱与连接体 |
| `debug-twin-gap.png` | D 前侧双柱开口近景 |
| `debug-terraces-e.png` | E 基座 + 两层台地 |

浏览器无 pageerror/console error；`capture-results.json` 记录诊断。SwiftShader 的 FPS
（约 0–9）只是软件渲染，不是 GPU 性能数据。E 截图读数显示 Reef B 是因为暂停的初始鱼群里
没有以 E 为最近代理的鱼，属于显示选择逻辑；不影响 E 代理本身的展示与仿真。

## 4. Sphere / ReefProxy 对比数据

固定种子 `encounter`，500 主鱼 + 100 小丑鱼，150 步球体 warm-up 后进入计时点。
`scripts/reef-collision-experiment.ts --verify` 每个模式跑两遍。

### 4.1 确定性

| 模式 | 17 s | 43 s | 52 s | 60 s | 63 s | 重跑 |
|---|---|---|---|---|---|---|
| Sphere | `e9343dcd` | `e1f550b7` | `b33d33b9` | `a372c9c0` | `b6009e0c` | 一致 |
| ReefProxy | `cefb0cd2` | `b1d13b00` | `3ef29a36` | `f025595c` | `493eb4f3` | 一致 |

Sphere 校验和与实验前 `simulation-regression.ts` 基线逐位一致，默认路径未改变。

### 4.2 63 s 总计

| 指标 | Sphere | ReefProxy |
|---|---|---|
| proxyPenetrationCount | 0 | 0 |
| deepPenetrationDuration | 0 | 0 |
| falseAvoidanceCount（累计） | 61,429 | **0** |
| averageObstacleForce | 2.13 | 2.06 |
| p95ObstacleForce | 7.50 | 6.88 |
| stuckFishCount | 0 | 0 |
| 通道 B–C / C–Hero / Hero–D / B–Hero | 679 / 539 / 1,109 / 674 | 646 / 554 / 948 / 623 |
| obstacleQueryTime（CPU ms/step 平均） | 0.495 | 0.773（+56 %） |
| Hero 越过旧球顶鱼数 | 1（瞬时） | 1（瞬时） |
| D 双柱间隙 SDF clearance | 0.436 m | 0.436 m |
| 进入 D 间隙的鱼 | 0 | 0 |

### 4.3 逐礁

| Reef | Sphere 假避障 | ReefProxy 假避障 | ReefProxy avg / p95 力 | 最小鱼-代理距离 |
|---|---|---|---|---|
| B / Spire | 11,015 | 0 | 3.40 / 11.25 | 0.28 m |
| C / Platform | 8,531 | 0 | 2.05 / 7.50 | 0.50 m |
| Hero | 16,890 | 0 | 1.82 / 6.25 | 0.28 m |
| D / Twin | 7,118 | 0 | 2.38 / 7.50 | 0.33 m |
| E / Terraces | 17,875 | 0 | 1.80 / 5.62 | 0.51 m |

假避障时间序列（累计）：Sphere 在 17/43/52/60/63 s 为
23,767 / 43,123 / 57,426 / 60,082 / 61,429；ReefProxy 各时刻均为 0。

被旧球体错误占据、现被鱼使用的空间（`open`，63 s）：C 8 条；运行中另有 Hero 2 条（43 s）、
E 1 条（17 s）、B 1 条 / D 1 条（60 s）。这说明代理确实打开了 C/E 上方的真实空域。
B 的力更高是因为真实基座在低处比球体更宽，鱼可以合法地更靠近岩石；属于几何修正而非回归。

### 4.4 结论

- C/E 上方提前绕行：球体高出真实岩顶 2.84 m / 2.47 m；新代理贴合平台，鱼进入打开的空域。
- Hero 顶部穿插：新代理用顶部椭球覆盖尖塔，运行中不再出现“鱼在碰撞体之外却在岩石内”。
- D 双柱：代理保留 0.44 m 间隙；当前 1.25 m margin 仍使鱼不进入，属于标定决策。
- 长时间停滞/异常避障：两种模式均为 0 卡鱼；球体假避障贯穿全程，代理为 0。
- 小丑鱼：计入 100 条，margin 仍为 0.55 m，无穿透。

## 5. 新增测试和原有测试结果

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过，无错误 |
| `npx vitest run --isolate=false` | 38 个文件 / **266 个测试全部通过**（Vitest 5.1.0） |
| 新增测试 | SDF 7 + ReefCollisionProxy 11 + ReefObstacleMetrics 4 + ObstacleSystem 新增 3 = **25** |
| 原有测试 | 241 个全部通过；球体模式校验和与实验前一致 |

测试覆盖：圆角盒内外/薄板圆角、胶囊端点/中段/零长度、复合最小值、旋转与非均匀缩放、
法线方向、退化几何、代理集合最近查询、C/E 垂直包络、Hero 顶部、D 间隙、指标累加/通道/卡鱼、
球体基线、代理转向/约束/线段遮挡。

复现命令：

```bash
npx tsx scripts/measure-reef-collision.ts
npx tsx scripts/reef-collision-experiment.ts --verify
npx vite build --outDir dist-reef-collision-6 --emptyOutDir
npx tsx scripts/reef-collision-capture.ts --serve-dist=dist-reef-collision-6 --only=debug-overview.png
```

运行时切换：`?obstacleShape=reefProxy` / `?obstacleShape=sphere`，指标
`?obstacleMetrics=1`，调试层 `?collisiondebug=1`；Laboratory 面板内亦可切换。

## 6. 已发现的问题与仍需人工校准的参数

1. **D 双柱间隙被 margin 封住。** 间隙 SDF 0.44 m，`obstacleMargin` 1.25 m。若希望鱼穿过，
   需要局部降低 margin 或增加间隙走廊例外，并重跑 Hero–D 通道计数；不要直接缩小两根胶囊
   而不复查覆盖率（当前 D 外露 12.07 %，最大 0.62 m）。
2. **B 基座力偏强。** 新代理低处比旧球宽，avg 3.40 vs 1.71、p95 11.25 vs 5.63。若鱼贴底
   过紧，可将 B 基座 half 缩小 5–10 % 或降低 `obstacleWeight`；margin 仍为 1.25 m。
3. **CPU 查询成本 +44–56 %。** Node 内 600 条鱼约 0.75–0.91 ms/step。可考虑按 N 步缓存
   每条鱼的最近代理，或收紧 broad phase。该数字不是 GPU 成本。
4. **D 内部薄网欠覆盖。** 最大 0.62 m，仍在 margin 内；将来可加一块薄网图元闭合。
5. **极端非均匀缩放的圆角偏保守。** 圆角按 `max(S)` 膨胀，高窄礁石的代理略“胖”，
   仿真安全但 debug 外壳看起来偏厚；可按礁石微调 rounding 比例。
6. **调试读数是“最近代理”语义。** 选中鱼会显示其最近代理所属礁石；初始稀疏状态下可能
   不是当前取景的礁石（E 截图即此情况）。仅显示层，不影响仿真。
7. **尚未做本机硬件 GPU 验收。** 全部截图来自 SwiftShader；仍需用户在 Windows 本机
   Chrome/Edge 做一次视觉与交互验收。本报告所有性能数字均为 CPU 模拟计时。
