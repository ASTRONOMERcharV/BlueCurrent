# Blue Current — 海藻物理庇护与珊瑚分档

日期：2026-11-09  
范围：`KelpRefugeField`、`BoidSystem` / `PredatorSystem` 接入、真实 `shelteredCount`、珊瑚默认温带层与 `?coral=full` 回归入口。  
结论：功能与自动化测试通过；本机硬件 GPU 帧率验收仍未执行，本文所有性能数字均为沙箱 CPU 固定步测量，不是 FPS 或 GPU 时间。

## 1. 海藻庇护场

### 1.1 一份布局，两处使用

`SimulationWorld` 在构造时只调用一次 `generateKelpLayout(REEF_OBSTACLES)`，结果存放在 `world.kelpLayout`，并用它构造 `KelpRefugeField`。`main.ts` 在场景初始化时把**同一个数组**传给 `Environment.loadGlbKelp(world.kelpLayout)`，`KelpScatter` 不再自行生成随机布局。

- 渲染与模拟共享 91 株（`kelp_a` 51 / `kelp_b` 40）。
- `tests/KelpRefugeIntegration.test.ts` 断言：`world.kelpLayout` 与 `generateKelpLayout(REEF_OBSTACLES)` 完全相等；`KelpScatter` 每个实例矩阵的平移与缩放逐项等于该布局。
- `?kelp=0`、`?environment=bare` 或 GLB 加载失败时，`world.kelpRefuge.enabled = false`，避免出现“看不见的碰撞体”。

### 1.2 圆柱近似

每株海藻是一个竖直圆柱：

| 参数 | 取值 |
| --- | --- |
| 锚点 | 布局的 `x` / `z`，底面 `baseY = placement.y` |
| 半径 | `KELP_GEOMETRY_PROFILES[name].canopyRadius × scale × 0.8` |
| 顶面 | `baseY + profile.height × scale`（`kelp_a` 3.55 m、`kelp_b` 2.8 m 的原型高度） |
| 覆盖衰减 | 核心 70% 半径内为 1，外缘平滑到 0；冠层顶部 0.45 m 与底部 0.25 m 平滑衰减 |

`src/environment/KelpRefugeField.ts` 提供：

- `coverAt(x, y, z)`：返回 0–1 的归一化覆盖度。
- `blocksSegment(x0, y0, z0, x1, y1, z1)`：解析求交，判断线段是否穿过任一圆柱体积。
- `nearestRefuge(x, y, z, maxDistance, out)`：写入朝向最近圆柱体积的单位方向，返回 0–1 的接近度。
- 纯函数 `kelpCoverAt`、`segmentIntersectsKelpCylinder`、`closestPointOnKelpCylinder` 供单测与空间哈希实现共用。

空间哈希按 2.5 m 水平单元插入每株的包围足迹。`coverAt` 只查询点所在单元；`blocksSegment` 只遍历线段 AABB 覆盖的单元，并用 stamp 去重；`nearestRefuge` 按 `maxDistance + maxRadius` 扩大单元扫描。单测用 40 株随机布局、500 组随机点/线段与全量 brute-force 结果逐项对比，覆盖度误差 < 1e-12，遮挡布尔值完全一致。

### 1.3 行为接入

| 规则 | 实现 |
| --- | --- |
| 海藻遮挡视线 | `directFear ×= 0.30`（需求区间 25%–35%）；礁石遮挡仍为 0.25，两者取更强遮蔽 |
| 高覆盖拖速 | 最大速度 `×(1 − 0.18 × cover)`，最大加速度 `×(1 − 0.12 × cover)` |
| 寻找遮蔽 | 仅当 `directFear > 0.35`、`cover < 0.40` 且 10 m 内存在海藻时生效；力为 `maxAcceleration × 1.1 × fear² × proximity`，正常群游不向海藻聚集 |
| 捕食者目标选择 | `findNearest()` 跳过被海藻完全遮挡的目标；3 m 内保留近距离目标与真实捕获，海藻不是绝对安全区 |
| 鲨鱼进入海藻 | 不增加任何排斥或禁入力 |

新增配置项（`SimulationConfig`）：`kelpFearMultiplier`、`kelpCoverSpeedPenalty`、`kelpCoverAccelerationPenalty`、`kelpShelterWeight`、`kelpShelterFearThreshold`、`kelpShelterRadius`、`kelpCoverThreshold`、`kelpOcclusionMinDistance`。

### 1.4 真实指标

- `BoidSystem.shelteredCount`：本步 `coverAt ≥ 0.40` 的存活鱼数。
- `BoidSystem.shelterSeekingCount`：本步实际获得寻找遮蔽力的鱼数，用于验证“正常群游不聚集”。
- `SimulationMetrics.shelteredCount` 与 `getDiagnostics().shelteredCount` 同步输出。
- Ecology 面板新增 “Sheltered in kelp” 读数，来源为上述真实 cover，不是根据恐惧或捕食者状态推算。

## 2. 珊瑚分档

| 模式 | 物种 | 实例 | InstancedMesh | 三角形 | 入口 |
| --- | --- | --- | --- | --- | --- |
| `temperate`（默认） | 扇状 `coral_fan`、脑珊瑚 `coral_brain` | 12（5 礁石 × 2 + 2 前景点缀） | 2 | 33,720 | 默认 |
| `full` | 原 6 种 | 48 | 6 | 121,728 | `?coral=full`（兼容旧 `?coral=1` / `?coral=blender`） |
| `off` | — | 0 | 0 | 0 | `?coral=0` / `?coral=off`；`?environment=bare` 也会关闭 |

温带层只加载两种 GLB，缩放 0.55–0.85，只放在五个礁石基部和两个 +Z 边界外前景点，不生成背景珊瑚。温带 GLB 加载失败时会隐藏原有 25 组程序化热带珊瑚，避免静默回退；`full` 模式保留原有程序化回退。

`CoralScatter` 的 `mode` 默认值为 `temperate`；`CoralScatterOptions.mode` 显式选择 `full`。`CoralScatter.test.ts` 覆盖默认 12 株 / 2 mesh、显式 48 株 / 6 mesh、以及缺少温带物种时的明确报错。

## 3. 验证与证据

- Vitest：24 个测试文件 / 167 个测试全部通过（本次新增 19 个 KelpRefuge 与珊瑚测试）。
- `tsc --noEmit`：通过。
- Vite 生产构建：通过。由于沙箱对既有 `dist/` 目录没有删除权限，构建输出到隔离临时目录（`/tmp/bluecurrent-build`），不影响项目现有产物。
- Chromium（SwiftShader 软件渲染，非硬件 GPU）：
  - 默认页：`coralModel = temperate`、12 个珊瑚实例、海藻 51 + 40 = 91、`shelteredCount` 为有限实数、0 浏览器错误。
  - `?coral=full`：48 个实例、121,728 个珊瑚三角形、0 浏览器错误。
  - 截图：`test-artifacts/kelp-refuge/temperate.png`、`test-artifacts/kelp-refuge/full-coral.png`。
- 固定步 CPU A/B（无渲染，`scripts/kelp-refuge-benchmark.ts`，120 步 × 3 次；使用 `process.cpuUsage` 排除宿主调度让出的时间）：

| 鱼数 | 庇护关闭最小 CPU ms/步 | 庇护开启最小 CPU ms/步 | 配对中位数变化 |
| --- | --- | --- | --- |
| 500 | 5.277 | 5.318 | +0.8% |
| 1000 | 15.403 | 14.316 | −5.7%（噪声内，庇护侧更快） |
| 2000 | 40.044 | 40.144 | +0.3% |

宿主是 2 vCPU 且负载波动明显。上表取每次运行的最小 CPU 时间作为无争用估计，并用同一 repeat 内 off/on 配对比值的中位数复核；跨运行中位数分别为 +1.6% / +7.8% / +4.8%，波动来自宿主负载，不作为回归结论。500/1000/2000 的群体平均邻居数在 A/B 两侧相同（71.47 / 89.42 / 111.50）。查询微基准：`coverAt` 约 250–300 万次/CPU 秒，`blocksSegment` 约 31 万次/CPU 秒。原始数据：`test-artifacts/kelp-refuge/kelp-refuge-benchmark.json`。

**未完成**：针对本次海藻庇护与珊瑚分档改动的 Windows 本机硬件 GPU 复测。已有 2026-11-09 Iris Xe 基线（改动前，见 `docs/archive/GPU_ACCEPTANCE_2026-11-09.md`）为 500 鱼通过、1000/2000 鱼未达 60 Hz；本次不把 SwiftShader 或沙箱 CPU 数据当作硬件性能结论，也不把旧基线当作改动后的验收结果。
