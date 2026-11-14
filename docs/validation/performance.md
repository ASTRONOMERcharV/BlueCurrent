# Validation — Performance

> 当前性能结论核实：2026-11-14。本文区分历史硬件、软件和 CPU 数据；2026-11-14 Phase F F1 已用真实 `EXT_disjoint_timer_query_webgl2` 测到 GPU EMA 并完成四档压力矩阵（1 捕食者代理），但采样期间存在动态壁纸/并发负载与整机漂移，尚未形成空闲、固定电源/热状态的签核基线。

## 指标定义

CPU Simulation、Fish Update、CPU Render Submission、Obstacle Query、Camera Math 和 GPU Frame Time 是不同指标。`renderMs` 是 CPU 提交侧值，不是 GPU timestamp；FPS 与 Frame P50/P95 必须结合样本数、丢步、分辨率和 renderer 解读。没有真实 GPU timestamp 时写 **N/A**，不能由 FPS 或 Render CPU 推算冒充实测。

## 历史真实硬件：2026-11-09 Iris Xe

原始证据：`test-artifacts/gpu-acceptance/2026-11-09T12-09-45-899Z/results.json`。Windows、Intel Iris Xe / ANGLE D3D11、1280×720、有界面浏览器，`hardwareGpu=true`、`softwareRendering=false`。该运行 seaweed=off，早于 B1 和 Experiment C，只能作为旧路径历史基线。

| 场景 | 主鱼 | FPS | Mean / P95 frame | Simulation CPU | Dropped steps |
| --- | ---: | ---: | ---: | ---: | ---: |
| Procedural fish + shayu | 500 | 60.03 | 16.66 / 16.90 ms | 8.07 ms | 0 |
| 同上 | 1000 | 6.12 | 163.28 / 200.00 ms | 17.09 ms | 14 |
| 同上 | 2000 | 2.36 | 423.12 / 483.10 ms | 42.34 ms | 19 |
| Combo GLB | 500 | 60.02 | 16.66 / 16.70 ms | 7.61 ms | 0 |
| 同上 | 1000 | 6.74 | 148.43 / 166.60 ms | 15.85 ms | 12 |
| 同上 | 2000 | 2.38 | 419.83 / 499.80 ms | 40.92 ms | 19 |

结论是旧 500 鱼路径通过实时目标，1000/2000 受 CPU 模拟与密集邻居查询限制。不能据此声称当前富默认 500+100+1 已通过，也不能把压力矩阵中的多捕食者设想当作现有能力。

## 当前真实硬件：2026-11-12 Intel Iris Xe

原始证据：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp4/gpu-acceptance/results.json`。Windows、Chrome 157、ANGLE Intel Iris Xe D3D11、1280×720、有界面浏览器、`hardwareGpu=true`、`softwareRendering=false`、lighting=full、rich-default 500 主鱼 + 100 小丑鱼 + B1 礁石/48 珊瑚/6 海菜/海带。

| 场景 | 主鱼 | FPS | Mean / P50 / P95 frame | Simulation CPU | Render CPU | Draw calls | Dropped steps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rich-default | 500 | 40.66 | 24.59 / 18.20 / 66.20 ms | 8.34 ms | 6.33 ms | 61 | 1 |

这是 1 次、约 2.9 s、120 帧的最小 Integration 硬件检查，不是 Phase F 的完整压力矩阵；1000/2000 鱼、GPU timestamp 和 CPU/GPU 分项仍未完成。P95 66.2 ms 说明当前 Intel Iris Xe 在 1280×720 富默认下并非稳定 60 FPS，不能在演示中声称满帧。该短测包含启动/着色器编译阶段，不能直接与下面的长跑中位帧率比较。历史 2026-11-09 的 Iris Xe 60 FPS 数据使用 seaweed=off、早于 B1/C，不能与本行混合。

### 180 s School 与 30 分钟 Overview

`wp4/hardware-180s.json` 与 `wp4/hardware-30min.json` 使用同一台 Intel Iris Xe、headed Chrome（`channel=chrome`，拒绝 SwiftShader）、1280×720、`?scenario=encounter&lighting=full&obstacleShape=sphere`。180 s 运行 School 相机，30 分钟运行 Overview 相机；两者都在页面内用 rAF 采样，不是 Playwright 软件截图。

| 运行 | 相机 | 实际时长 | 采样 | FPS min / P50 / P95 | P95 frame max | Dropped steps | 结果 |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- |
| 180 s | School | 189.8 s | 412 | 25.5 / 67.9 / 107.4 | 127.1 ms | 3 | 0 finite/净空/浏览器错误 |
| 30 min | Overview | 1813.8 s | 644 | 16.9 / 63.6 / 106.1 | 145.5 ms | 8 | 0 finite/净空/浏览器错误；位置漂移 0 m |

30 分钟运行的 FPS 首/末十分位中位数为 53.1/54.9，未显示持续下降；`captures` 从 0 增至 86，predator 经历 patrol/pursuit/attack/search。最低 FPS 16.9 是长尾瞬时值，不是中位帧率；P95 frame 也出现 145.5 ms 尖峰。因此这些数据支持“无错误累积、固定 Overview 无漂移”，不支持“稳定 60 FPS”或“无卡顿”。180 s School 的最低可见率 0.565、fit 1.019–1.400，属于动态追逐中的构图波动，不能替代固定六时间点验收。起止截图 `hardware-180s-start.png` / `hardware-180s-end.png`、`hardware-30min-start.png` / `hardware-30min-end.png` 均非空白；未做人工交互签核，持续闪烁也没有自动测量。

**2026-11-12 Predator FSM direct-retarget 修改后，以上 WP4 硬件数字均为 pre-FSM**；FSM 改变 captures 和模拟负载（300 s CPU captures 18→25），当前源码必须在新 WP0 锁上重跑硬件短测与长跑，才能更新本节性能结论。

## Phase F 基线：2026-11-14 Intel Iris Xe（F1）

原始证据：`test-artifacts/phase-f/2026-11-14T11-26-00Z/`（Git 忽略）。主矩阵在 `rows/`（`results.json`、`analysis.md`、`conditions.md`、逐样本 `frames/` 与 `screenshots/`）；同 run 还保留更早的交错探索 `final/`、`stability-standard/`、`stability-pressure/` 与两次 `probe/`。采样脚本是 `scripts/phase-f-baseline.ts`（`npm run baseline:phase-f`），未改 `gpu-acceptance.ts` 的既有语义。

### 方法与场景

headed Chrome 157、ANGLE Intel Iris Xe Graphics D3D11、1280×720、DPR 1，URL 为 `?scenario=encounter&lighting=full&obstacleShape=sphere&predator=blender&perfTelemetry=1`。每个 sample 使用新页面：等待 `__blueCurrent.ready` 与 GLB 鱼/小丑鱼/鲨鱼/珊瑚/海带/海菜层 → 60 帧预热 → `setFishCount`/`setClownfishCount` → 暂停、`predatorEnabled=false`、`step(150)` → `releasePredator()`、`step(180)` → 相机固定为 `[30,18,29]→[0,6.5,-2]` 并 settle → `resetPerformanceSamples()` → `resume()` 后按 rAF 采样。base/standard 采样 10 s 且 ≥120 帧（上限 30 s），pressure/extreme 30 s 且 ≥60 帧（上限 90 s）；每行 3 repeats、90 s cooldown，逐行独立进程；standard 另做 1440×900 spot 与 telemetry-off 对照。

CPU 分项来自默认关闭的 `PhaseEmaRecorder`：`boidsMain`、`boidsClown`、`predator`、每 30 步的 `metrics`、`obstacleQuery` 与差值 `other`；渲染分项为 `fish`、`clownfish`、`predator`、`debug`、`camera`、`environment`、`draw` 与 `other`。GPU 时间来自 WebGL2 `EXT_disjoint_timer_query_webgl2`，丢弃 disjoint 样本，报告 EMA；telemetry 关闭时 GPU 时间为 N/A。`renderMs` 仍是 CPU 提交侧值。

压力档与极限档的目标捕食者数量为 3/5，但本轮实际只放 1 个捕食者作为代理（intended-vs-measured 已写入每个 sample 与 `summary.md`）；这是 D027 记录的范围缺口，不能当作已支持多捕食者生态。

### 四档矩阵（repeats 中位；硬件 Iris Xe）

| 行 | 主鱼/小丑/捕食者（目标→实测） | n | FPS mean | FPS median | P50 ms | P95 ms | GPU EMA ms | Sim EMA ms | Render EMA ms | Dropped | FPS spread | P50 spread |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 200/50/1 → 198/50/1 | 3 | 73.1 | 82.0 | 12.2 | 24.2 | 4.33 | 3.48 | 5.92 | 0 | 1.021 | 1.000 |
| standard | 500/100/1 → 499/100/1 | 3 | 38.8 | 41.2 | 24.3 | 36.7 | 5.33 | 9.45 | 7.84 | 0 | 1.088 | 1.017 |
| pressure | 1000/200/3 → 999/200/1 | 3 | 4.3 | 4.3 | 230.3 | 278.8 | 13.47 | 28.85 | 10.63 | 131 | 5.663 | 18.614 |
| extreme | 2000/300/5 → 1999/300/1 | 3 | 2.7 | 2.7 | 374.8 | 521.4 | 11.87 | 37.25 | 9.74 | 82 | 1.465 | 1.542 |

base 与 standard 的重复性达标（FPS spread ≤1.09、P50 spread ≤1.02、0 dropped）。pressure 与 extreme 未达标：pressure r1 呈现混合/瞬时状态（722 帧、P50 12.7 ms，但已有 99 dropped steps），r2/r3 回落到 4.2/4.3 FPS、P50 236.4/230.3 ms；extreme r1/r2 为 2.66 FPS、r3 降到 1.82 FPS / P50 563.4 ms。跨档比较因此混合了场景负载与整机漂移，不能把 pressure/extreme 的 FPS 当作稳定的硬件能力值。

各档固定负载：candidates 14,276–14,378 / 60,701–60,993 / 289,927–302,739 / 608,001–643,511；平均邻居 32.2 / 52.4–52.6 / 100.0–110.4 / 94.8–104.2；四档均为 62 draw calls，三角形 819,745 / 1,374,095 / 2,337,995 / 4,025,895；renderer.info.memory 为 53 geometries / 39 textures、28 programs（spot 因宽屏剔除少 1 draw）。

### 分项与瓶颈排序

| 行 | Sim total ms | boidsMain 占比 | obstacleQuery 占比 | Render total ms | draw 占比 | GPU / sim step |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 3.96 | 69.1% | 13.1% | 5.99 | 52.4% | 1.24 |
| standard | 10.74 | 72.5% | 11.8% | 7.70 | 42.3% | 0.56 |
| pressure | 31.58 | 78.8% | 8.7% | 10.53 | 34.1% | 0.47 |
| extreme | 40.45 | 83.1% | 7.4% | 10.05 | 24.4% | 0.32 |

分项中位数（ms）：

| 行 | boidsMain | boidsClown | predator | metrics | obstacleQuery | fish | clownfish | environment | draw |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | 2.74 | 0.59 | 0.03 | 0.07 | 0.52 | 0.78 | 0.22 | 1.80 | 3.13 |
| standard | 7.78 | 1.46 | 0.04 | 0.18 | 1.26 | 1.76 | 0.35 | 2.19 | 3.26 |
| pressure | 24.90 | 3.77 | 0.04 | 0.13 | 2.74 | 3.39 | 0.68 | 2.71 | 3.59 |
| extreme | 33.63 | 3.46 | 0.06 | 0.31 | 2.98 | 4.89 | 0.72 | 1.83 | 2.45 |

结论：CPU 模拟是唯一随规模单调放大的主瓶颈，`boidsMain` 占 sim 的 69–83%，障碍查询占 7–13%；渲染提交（draw + environment + fish）在 6–10.5 ms 量级，draw 本身约 2.5–3.6 ms，除 extreme 因可见面减少略低外基本稳定；GPU 在本矩阵为 4.33–13.47 ms 中位，单样本尾部到 32.4/26.3 ms（pressure r3 / extreme r3），与共享 iGPU 竞争一致，GPU/sim 比从 base 的 1.24 降到 extreme 的 0.32，说明高负载下不是 GPU 先饱和。pressure/extreme 的低 FPS 还叠加了固定步长调度：当单步成本超过帧预算时，每帧跑满 8 个追赶步，帧时间接近 `8 × simStep`，dropped steps 因而累积到 82–131。这是 `Scheduler` 的固定步长语义，不是新增模拟错误，但也意味着 FPS 不能线性外推 CPU 成本。

### Spot、telemetry 对照与测量开销

- standard 1440×900 spot：FPS mean 34.2、P50 30.2 ms、P95 42.6 ms、GPU 8.29 ms、sim 9.41 ms、render 7.37 ms、0 dropped、61 draws。宽屏剔除少了 1 个 draw，绝对 FPS 不与 1280×720 直接比较。
- standard telemetry-off 对照（1280×720）：FPS mean 45.2、P50 18.4 ms、P95 36.3 ms、GPU N/A（timer 随遥测关闭）、sim 7.47 ms、render 7.12 ms、0 dropped。
- 与同场景 telemetry-on 的 standard 行相比，逐鱼障碍计时的测量开销约为 sim +2.0 ms、render +0.7 ms，P50 从 18.4 ms 抬到 24.3 ms（一个刷新档）。该对照是测量开销参考，不是产品路径性能结论。

### 环境、会话漂移与刷新量化（必须与矩阵一起读）

同一标准场景（500/100/1、1280×720、相同 counts/candidates/draws/triangles）在同一晚测到两个不同状态：

| 会话 | FPS mean（3 repeats） | P50 ms | Sim EMA ms | Render EMA ms | GPU EMA ms |
| --- | --- | --- | --- | --- | --- |
| `stability-standard`（20:00 本地） | 91.6 / 89.1 / 67.7 | 12.1 / 12.1 / 12.2 | 5.90 / 7.69 / 5.68 | 4.33 / 4.68 / 3.62 | 5.26 / 5.25 / 5.25 |
| `rows` standard（20:43–20:53） | 38.8 / 35.9 / 39.0 | 24.3 / 24.6 / 24.2 | 9.40 / 9.45 / 9.69 | 7.02 / 7.94 / 7.84 | 6.71 / 5.22 / 5.33 |

同一场景的 CPU 分项在约 40 分钟内慢了 1.5–2×，FPS 因此整档下降；这不是场景内容差异。采样期间 Wallpaper Engine（`wallpaper64`）占用 33.6–42.3% 的 iGPU 3D engine，用户自己的 Chrome 窗口也在活动；电源为 AC、Balanced scheme、无 overlay，`Win32_Processor.CurrentClockSpeed` 报 1520 MHz（Max 2400，WMI 对 boost 不可靠）。系统空闲超时为 180 s，早期交错 run 期间 Windows 记录过 Modern Standby 进入/退出；从 21:08 起用 `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_DISPLAY_REQUIRED)` 保持显示与系统唤醒。extreme/spot/control 的页面可见性与焦点均已 instrument，采样前后为 `visible/focused`；base/standard/pressure 的样本早于该字段，显示 N/A，但 base/standard 的内部重复性正常。

P50 落在 12.2 / 18.2 / 24.3 / 30.2 ms 等 6.06 ms 的整数倍上（165 Hz 面板的 82.5/55/41.25/33 fps 档），因此 P50 与 FPS 是离散档位，小量 CPU 变化可能整档跳变；P95 与 dropped steps 才描述尾部。综合以上，`rows/` 矩阵可作为本机晚间的实测基线，但还不是“空闲、固定电源/热状态”的签核基线；在设定验收目标前，需要在关闭动态壁纸、无并发用户负载、记录电源/热状态的同一台机器上用同一 harness 重跑一次。

### Phase F 验收目标（D028）

标准档（500/100/1、1280×720、Iris Xe D3D11、telemetry-off 对照）的验收目标为 P50 ≤ 16.7 ms、P95 ≤ 33 ms、0 dropped steps，并在 3 repeats 中稳定复现；pressure/extreme 只作扩展性诊断，不要求实时。该目标需在关闭动态壁纸与并发负载、固定电源/热状态的同一台机器上用同一 harness 复测确认。当前 `rows/` 的 telemetry-off 对照为 45.2 FPS / P50 18.4 ms / P95 36.3 ms、0 dropped，未达目标；更早 `stability-standard` 会话在同一场景达到 P50 12.1 ms，但未做 telemetry-off 对照且未关闭动态壁纸。目标本身不据 degraded session 判定通过或失败；下一步是干净复测，若仍未达标再按以 `boidsMain` 为主的实测分项进入优化工作包。

### Phase F 仍缺

- pressure/extreme 的 3/5 捕食者完整矩阵未测，只有 1 捕食者代理（D027）。
- GPU 内存只有 `renderer.info.memory` 的资源计数，没有字节级 GPU memory counter；`performance.memory` 是 JS heap，不能当 GPU 内存。
- 本轮没有优化代码，也没有优化前后同版对照；优化项必须等目标签核后另开工作包。
- SwiftShader 未参与本矩阵；所有四档与 spot/control 均为 Iris Xe D3D11 硬件路径。


## 当前可用 CPU 实验数据

B1 `test-artifacts/reef-collision/experiment-b.json` 在 t63 记录 Sphere/ReefProxy 障碍查询平均 0.539/0.954 ms per step，约 +77%。它只覆盖障碍查询，不是整帧或 GPU 成本。Experiment C 文档记录 School 0.040 ms/帧、Predator 0.007 ms/帧，属于纯 JS 相机数学基准。

历史 Uniform Grid A/B 显示连续 `cellItems` 对 500/1000/2000 有有限加速，但并未让 1000/2000 硬件目标通过。不同日期和环境的 CPU 数字不能放在同一排行榜直接比较。

## 软件数据，禁止当作硬件性能

`test-artifacts/gpu-acceptance/latest.json` 虽名为 latest，实际是 Linux SwiftShader，500 鱼 1.57 FPS。B1/C 截图与浏览器回归同样主要使用 SwiftShader，其 FPS/P95 只反映软件捕获环境，不能用于本机 GPU 验收。

## 当前 N/A 项

Phase F F1 已把 GPU timestamp 从 N/A 变为实测（4.33–13.47 ms EMA，0 disjoint），并完成 1000/2000 鱼的 1 捕食者代理矩阵；仍为 N/A 的是 3/5 捕食者完整矩阵、字节级 GPU memory、空闲且固定电源/热状态的签核基线。帧率优化与压力矩阵已于 2026-11-12 决定留到 Phase F（`../DECISIONS.md` D014）；F1 只测量与审计，不改优化参数（D027）。1000/2000 是否需要 Worker/WASM、邻居上限或降频，必须先由当前分项测量和用户验收目标决定；不得通过降低默认质量绕过。验收目标已由 D028 签核为标准档 60 FPS（P50 ≤ 16.7 ms、P95 ≤ 33 ms、0 dropped），但尚未在干净基线上验证。

## 当前硬件复测命令

在 Windows 主机、接通电源并关闭其他重负载程序后运行：

```bash
npm run accept:gpu -- --scenarios=rich-default --counts=500 --warmup-ms=3000 --sample-ms=10000 --channel=chrome
```

脚本支持 `--counts`、`--scenarios`、`--warmup-ms`、`--sample-ms`、`--max-sample-ms`、`--channel` 和 `--allow-software`；软件模式仅可用于 smoke，正式硬件结果不得加 `--allow-software` 绕过。

记录硬件、驱动、浏览器、renderer、电源、分辨率、URL、鱼数、资产层、构建版本和逐轮原始数据。先测 rich-default，再按 Phase F 的批准范围扩展压力矩阵。完整性能优化属于后续 Phase F；Integration 中只采集必要正确性和阻断性性能证据。

WP4 的 180 s / 30 分钟观察使用 run 目录内的 `wp4/tools/hardware-monitor-180s.mjs`、`hardware-monitor-30min.mjs`，30 分钟分析用 `summarize-30min.mjs`。这些工具是本地证据脚本，不是稳定 npm script；运行前确认 `dist/` 与 WP1 构建一致，并与其他 Playwright/SwiftShader 捕获串行，避免污染硬件采样。
