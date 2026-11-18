# Blue Current — Visual Quality V1（Phase 1 + Phase 2）

日期：2026-11-09  
范围：鱼群初始化、局部密度、捕食扰动、鱼体姿态；温带海藻森林构图、海床、连续流场摆动与海底光线观感。  
未包含：完整 Phase 3 体积光/材质统一、Phase 4 UI 重排、School Density Map、硬件 GPU 最终验收。

本次没有修改 `Project/ElementalWorld`，没有重写 Boids 核心，没有另建一套渲染用模拟。Uniform Grid 与 Brute Force 仍共用同一套行为计算，固定步长、双缓冲和真实 telemetry 边界保持不变。

## 1. 修改前基线问题

对固定种子数据的复核确认了两个具体原因：

1. 初始鱼群是约 14 × 6.4 × 14 m 的扁平圆柱。500 条鱼在这个体积内高度重叠，初始最小中心距可低至约 0.56 m。
2. `Average Neighbors` 统计的是最大邻居半径内的数量。基线 6 m 半径下 Calm 预热后为 164.08，不能直接解释为 1.4 m Separation 范围内过密。新增的局部指标显示，当时 1.4 m 内平均仅约 1.55 条邻居。
3. 长时间运行后，鱼群先被吸引成小团，再游到软边界并沿边界拉成长条；这一形状问题不能只靠提高 Separation Weight 解决。

基线截图：[Predator Encounter 修改前](../test-artifacts/visual-quality-v1/before/encounter-console.png)

## 2. Phase 1：鱼群行为与形态

### 2.1 初始化

`FlockData.initialize()` 改为三维椭球体积采样，并根据鱼数扩大采样体积；采样使用固定种子的 best-candidate 拒绝采样，目标最小间距为 `min(0.9, separationRadius × 0.6)`。初始速度方向从单一 ±31.5° 扇区扩展到 ±48.7°，同时保留群体总体朝向。个体相位与外观变体仍然固定种子生成。

500 鱼、Calm 预热后：

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| Average Neighbors（5–6 m） | 164.08 | 76.68 |
| 1.4 m 内平均邻居 | 1.55 | 0.59 |
| Radius of Gyration | 5.72 m | 7.03 m |
| 最近邻中位数 | 1.34 m | 约 1.40 m |

### 2.2 密度感知聚合与运动限制

保留已经测过的 `Separation Weight 2.4`、`Cohesion Weight 0.32`、`Separation Radius 1.4`，没有靠无依据地加大 Separation 来掩盖聚集。

新增或调整：

| 参数 | 值 | 作用 |
| --- | ---: | --- |
| Alignment Radius | 4 m | 保持不变 |
| Cohesion Radius | 5 m | 由 6 m 缩小，减少大范围向心拉力 |
| Density Target | 24 alignment neighbors | 超过目标后按比例降低 Cohesion |
| Density Min Scale | 0.15 | 高密度时仍保留弱聚合 |
| Max Turn Rate | 2 rad/s | 抑制低速时的瞬时大幅转向 |
| Boundary Margin | 5 m | 更早开始转向 |
| Boundary Tangential Weight | 1.0 | 靠近水平边界时加入切向分量，避免整群压墙 |

密度系数只缩放 Cohesion 力，不删除邻居，不硬限制鱼数，也不改变 Grid / Brute Force 的邻居计算方式。

### 2.3 捕食者扰动

`BoidSystem` 的逃逸响应新增：

- 按捕食者接近速度扩展威胁半径（0.3 s 预测），逃离中的鲨鱼不会继续触发同等威胁。
- 逃逸力加入确定性的横向分量，改变个体避让方向。
- 捕食者与鱼之间被礁石遮挡时，直接恐惧降到 25%。
- 邻鱼恐惧以每步 0.8 系数传播，并使用双缓冲 `fear / nextFear` 避免鱼索引顺序影响结果。
- 捕食者选目标时跳过被礁石遮挡的鱼。

`threatenedCount` 仍只统计直接处于捕食者威胁范围且未被遮挡的鱼，没有把传播恐惧冒充成 Escape Wave。真实捕获仍由 FSM 追击—攻击—捕获流程完成；30 秒 Encounter 实测发生 2 次真实捕获。

### 2.4 鱼体姿态

`FishRenderer` 的实例 Shader 升级为 v3：

- 尾鳍波动频率随个体速度与恐惧增加。
- 摆动幅度随速度与恐惧增加，并增加次级体侧波。
- 每条鱼保留独立相位。
- 4 个比例变体通过非均匀实例缩放产生轻微体长/体高差异。
- 原有转弯侧倾（bank）继续由真实 yaw rate 驱动。

仍是单个 InstancedMesh + GPU 顶点位移，没有逐鱼骨骼或预制轨迹。

### 2.5 三个固定场景结果

Calm 和 Obstacle 各执行场景预热后再运行 12 秒；Encounter 运行 6 秒后移除捕食者并恢复 10 秒。

| 场景与指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| Calm：12 s 平均邻居 | 86.3 | 72.7 |
| Calm：12 s Rg | 9.78 m | 9.21 m |
| Calm：12 s 三轴标准差 | 1.81 : 4.69 : 8.39 | 7.79 : 3.09 : 3.84 |
| Obstacle：12 s Rg | 9.31 m | 7.89 m |
| Obstacle：12 s 三轴标准差 | 1.69 : 4.62 : 7.90 | 6.71 : 2.98 : 2.90 |
| Encounter：威胁峰值 | 155 | 65 |
| Encounter：最多连通子群 | 2 | 5 |
| Encounter：最大子群最小值 | 484 | 460 |
| Encounter：威胁移除后 10 s 群体数 | 2 | 2 |
| Encounter：威胁移除后最大子群 | 487 | 491 |

Encounter 的威胁峰值下降是初始群体更分散后的结果，不表示响应变弱。子群从 2 个增加到 5 个，说明分裂来自局部逃逸，而不是固定拆成两组。原始时间序列见 `test-artifacts/visual-quality-v1/phase-1-final-behavior.json` 和 `baseline-behavior.json`。

## 3. Phase 2：温带海藻森林

### 3.1 构图

海藻布局从 reef 环形 + 全场景随机点改为 6 个确定性群落：

| 区域 | 数量 | 比例范围 |
| --- | ---: | ---: |
| 左前景 | 14 | 1.45–2.55 |
| 左中景 | 24 | 1.05–2.15 |
| 左远景 | 10 | 0.82–1.35 |
| 右前景 | 13 | 1.40–2.50 |
| 右中景 | 23 | 1.00–2.05 |
| 右远景 | 9 | 0.80–1.30 |

总计 91 株（`kelp_a` 51、`kelp_b` 40），左右分别为 47 / 44。前景最高冠层约 8.69 m，远景最高低于 5 m，并在 `KelpScatter` 中降低背景实例亮度。

中央游泳走廊半宽 7 m。测试按每株的冠层半径加摆动包络计算，所有实例都在走廊之外；当前最小包络边缘为 9.78 m。91 株中 16 株位于模拟边界外，作为前景/远景装饰；其余位于模拟范围内但不参与碰撞。

保留五个 `ObstacleSystem` 碰撞球和对应的 `reef_large` GLB。海藻不是刚体碰撞体，但现在通过 `KelpRefugeField` 提供软性的生态庇护：每株按 authored canopy 半径的 0.8 倍近似为垂直圆柱，计算平滑 cover、遮挡捕食者视线，并让直接受威胁且尚未处于 cover 中的鱼获得恐惧门控的就近庇护转向；cover 内同时施加速度与加速度惩罚。该场不改变固定步长、双缓冲或 Grid / Brute Force 的共享行为计算。基准数据见 `test-artifacts/kelp-refuge/kelp-refuge-benchmark.json`。

### 3.2 海床

`floorHeightAt()` 现在是渲染地板和全部岩石/海藻/珊瑚放置的唯一高度源。地形从单一 ±0.17 m 波纹改为三层波叠加，采样范围约 −0.76 m 到 +0.24 m（总起伏约 1.0 m）。Observation 模式继续隐藏海床参考网格和模拟边界线框，Laboratory 才显示。

同时把海床焦散从规则干涉方格改为随时间扭曲的多尺度光斑，并降低了亮度，避免观测画面继续像三维网格实验室。

### 3.3 连续海流

`OceanCurrentField` 首次接入主场景：

- 使用现有基础流、连续周期湍流和 5 个 reef 涡旋。
- 每株海藻在自身 55% 冠层高度处采样世界流场。
- 世界方向经实例 yaw 反变换为局部摆动方向，再由 GPU 顶点 Shader 施加主摆与次摆。
- 每个实例仍保留相位、频率、幅度差异，但相邻海藻的摆动方向来自同一连续流场。

### 3.4 环境截图

- [Calm / 修改后完整界面](../test-artifacts/visual-quality-v1/calm-console.png)
- [Predator Encounter / 修改后](../test-artifacts/visual-quality-v1/encounter-console.png)
- [Obstacle Navigation / 修改后](../test-artifacts/visual-quality-v1/obstacles-console.png)
- [Calm / 隐藏控制台视图](../test-artifacts/visual-quality-v1/calm-environment.png)

截图来自真实 Three.js 运行和 GLB 资产，但由 SwiftShader 软件渲染生成，不是硬件性能证据。

## 4. 性能对照

### 4.1 CPU 模拟 A/B

同一脚本分别运行修改前归档源码与当前源码。Obstacle Navigation 固定种子，场景预热后再执行 30 步预热，测量 120 个固定步，重复 2 次；无渲染。

| 鱼数 | 修改前平均步耗时 | 修改后平均步耗时 | 改善 | 邻居候选检查/步（前 → 后） |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 10.59 ms | 6.92 ms | 1.53× | 200,530 → 132,477 |
| 1000 | 34.80 ms | 17.81 ms | 1.95× | 719,561 → 402,283 |
| 2000 | 97.99 ms | 55.04 ms | 1.78× | 2,381,408 → 1,250,739 |

修改后单步 P95：500 鱼 9.99 ms、1000 鱼 24.65 ms、2000 鱼 75.94 ms。数据见 `performance-baseline.json` 与 `performance-current.json`。

这些是沙箱 Node CPU 测量，不是浏览器 FPS，也不是 GPU 时间。候选数下降主要来自最大邻居半径从 6 m 改为 5 m，以及群体分布变化。

### 4.2 浏览器

真实 Chromium 场景加载 91 株海藻、48 个珊瑚、完整岩石集和 shayu 鲨鱼，500 鱼，无浏览器错误。截图阶段 draw calls 为 47–53，渲染三角形约 23.1–24.1 万；海藻为 16,104 个实例三角形。

SwiftShader 读数仅用于发现软件渲染问题，不能用于 60 FPS 判断。真实硬件验收已在 Windows 主机完成：ANGLE / Intel Iris Xe / Direct3D11，500 鱼四组资产均为 0 丢步、P95 约 12 ms；1000 鱼约 7 FPS、平均模拟步 17.3–17.9 ms；2000 鱼约 1.7 FPS、模拟步约 56 ms。结论是 500 鱼达标，1000/2000 未达标，瓶颈在 CPU 固定步模拟而不是 GLB 或 draw calls。完整证据见 `docs/archive/GPU_ACCEPTANCE_2026-11-09.md`。

加固后的 `accept:gpu` 命令、CPU 优化 A/B 与 1000/2000 的明确限制见 `docs/archive/PERFORMANCE_OPTIMIZATION_V1.md`。

## 5. 自动化验证

| 检查 | 结果 |
| --- | --- |
| Vitest | 24 个测试文件、167 项测试全部通过（沙箱按文件串行运行） |
| TypeScript `tsc --noEmit` | 通过 |
| Vite production build | 通过；仅有 Three.js core chunk 体积提示 |
| `accept:gpu` 沙箱冒烟 | 通过；SwiftShader 被正确标记，采样帧数与报告生成正常 |
| Observatory browser `--stage=checks` | 通过；Observation / Laboratory 模拟状态一致，0 浏览器错误 |
| Visual capture（Calm / Encounter / Obstacle） | 通过；0 浏览器错误 |
| 91 株海藻走廊与群落测试 | 通过 |
| 海床高度统一测试 | 通过 |
| 网格 / 暴力搜索等价性 | 既有测试继续通过 |
| 捕食者真实捕获 | 30 秒 Encounter 实测 2 次捕获 |

## 6. 可回退版本

| 版本 | 文件 | 校验 |
| --- | --- | --- |
| 修改前 | `test-artifacts/visual-quality-v1/phase-0-source.tar.gz` | SHA-256 `899f13a6a810c869b2fdcc5b99936b57829d5c471df18d9241e4f8f050ba655d` |
| Phase 1 + 2 后 | `test-artifacts/visual-quality-v1/phase-2-source.tar.gz` | 同目录 `.sha256` sidecar |

环境改动集中在 `Environment.ts`、`kelpPlacement.ts`、`KelpScatter.ts`、`rockPlacement.ts`，可与行为层分开回退。行为层改动集中在 `FlockData.ts`、`BoidSystem.ts`、`SimulationConfig.ts`、`EnvironmentForces.ts`、`ObstacleSystem.ts`、`PredatorSystem.ts` 和 `FishRenderer.ts`。

## 7. 尚未完成

- 用加固后的 `accept:gpu` 在 Windows 上重采 1000/2000 鱼数据：至少 120 帧、3 次重复，并另加真实 GPU timestamp；500 鱼已有硬件结论。
- 珊瑚已降为默认 12 株温带点缀（2 个 `InstancedMesh`、33,720 三角形），`?coral=full` 保留 48 株完整展示层；海藻现在提供 `KelpRefugeField` 物理庇护场（圆柱遮蔽、恐惧衰减、覆盖拖速与真实 `shelteredCount`），但仍不是刚体碰撞。
- 1000/2000 鱼的 CPU 固定步预算仍未解决，需要 Worker/WASM、行为可验证的邻居上限或降低高密度更新频率等架构级方案。
- 正式 Phase 3：鲨鱼轮廓光、相机距离雾/颜色衰减、低分辨率体积光、粒子随流场运动、统一材质色调。该阶段已于 2026-11-09 交付，见 `docs/archive/VISUAL_QUALITY_PHASE3.md`。
- 正式 Phase 4：Escape Wave 可读性、捕食者警示状态、School Density Map 体素可视化。
- 鱼群在极长窗口和 2000 鱼密度下的稳定性仍需硬件长跑验证。
