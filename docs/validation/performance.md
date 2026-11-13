# Validation — Performance

> 当前性能结论核实：2026-11-12。本文区分历史硬件、软件和 CPU 数据；当前 B1+C 富默认已有一次硬件短测、180 s School 长跑和 30 分钟 Overview 观察，但仍无 GPU timestamp 或完整压力矩阵。

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

## 当前可用 CPU 实验数据

B1 `test-artifacts/reef-collision/experiment-b.json` 在 t63 记录 Sphere/ReefProxy 障碍查询平均 0.539/0.954 ms per step，约 +77%。它只覆盖障碍查询，不是整帧或 GPU 成本。Experiment C 文档记录 School 0.040 ms/帧、Predator 0.007 ms/帧，属于纯 JS 相机数学基准。

历史 Uniform Grid A/B 显示连续 `cellItems` 对 500/1000/2000 有有限加速，但并未让 1000/2000 硬件目标通过。不同日期和环境的 CPU 数字不能放在同一排行榜直接比较。

## 软件数据，禁止当作硬件性能

`test-artifacts/gpu-acceptance/latest.json` 虽名为 latest，实际是 Linux SwiftShader，500 鱼 1.57 FPS。B1/C 截图与浏览器回归同样主要使用 SwiftShader，其 FPS/P95 只反映软件捕获环境，不能用于本机 GPU 验收。

## 当前 N/A 项

GPU timestamp、可测 CPU/GPU Memory、1000/2000 鱼硬件矩阵和完整压力测试仍为 N/A。180 s 与 30 分钟观察已记录，但它们是单机长跑，不是满帧/无卡顿证明，也不是压力矩阵。帧率优化与压力矩阵已于 2026-11-12 决定留到 Phase F（`../DECISIONS.md` D014）；Integration 只记录实测与限制，不把 60 FPS 作为门槛。1000/2000 是否需要 Worker/WASM、邻居上限或降频，必须先由当前分项测量和用户验收目标决定；不得通过降低默认质量绕过。

## 当前硬件复测命令

在 Windows 主机、接通电源并关闭其他重负载程序后运行：

```bash
npm run accept:gpu -- --scenarios=rich-default --counts=500 --warmup-ms=3000 --sample-ms=10000 --channel=chrome
```

脚本支持 `--counts`、`--scenarios`、`--warmup-ms`、`--sample-ms`、`--max-sample-ms`、`--channel` 和 `--allow-software`；软件模式仅可用于 smoke，正式硬件结果不得加 `--allow-software` 绕过。

记录硬件、驱动、浏览器、renderer、电源、分辨率、URL、鱼数、资产层、构建版本和逐轮原始数据。先测 rich-default，再按 Phase F 的批准范围扩展压力矩阵。完整性能优化属于后续 Phase F；Integration 中只采集必要正确性和阻断性性能证据。

WP4 的 180 s / 30 分钟观察使用 run 目录内的 `wp4/tools/hardware-monitor-180s.mjs`、`hardware-monitor-30min.mjs`，30 分钟分析用 `summarize-30min.mjs`。这些工具是本地证据脚本，不是稳定 npm script；运行前确认 `dist/` 与 WP1 构建一致，并与其他 Playwright/SwiftShader 捕获串行，避免污染硬件采样。
