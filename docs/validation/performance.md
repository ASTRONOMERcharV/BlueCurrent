# Validation — Performance

> 当前性能结论核实：2026-11-12。本文区分历史硬件、软件和 CPU 数据；当前 B1+C 富默认硬件性能尚未测量。

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

## 当前可用 CPU 实验数据

B1 `test-artifacts/reef-collision/experiment-b.json` 在 t63 记录 Sphere/ReefProxy 障碍查询平均 0.539/0.954 ms per step，约 +77%。它只覆盖障碍查询，不是整帧或 GPU 成本。Experiment C 文档记录 School 0.040 ms/帧、Predator 0.007 ms/帧，属于纯 JS 相机数学基准。

历史 Uniform Grid A/B 显示连续 `cellItems` 对 500/1000/2000 有有限加速，但并未让 1000/2000 硬件目标通过。不同日期和环境的 CPU 数字不能放在同一排行榜直接比较。

## 软件数据，禁止当作硬件性能

`test-artifacts/gpu-acceptance/latest.json` 虽名为 latest，实际是 Linux SwiftShader，500 鱼 1.57 FPS。B1/C 截图与浏览器回归同样主要使用 SwiftShader，其 FPS/P95 只反映软件捕获环境，不能用于本机 GPU 验收。

## 当前 N/A 项

当前 B1+C 富默认真实 GPU FPS/P50/P95、GPU timestamp、可测 CPU/GPU Memory、180 s 硬件相机稳定性和 30 分钟长时观察均为 N/A。1000/2000 是否需要 Worker/WASM、邻居上限或降频，必须先由当前分项测量和用户验收目标决定；不得通过降低默认质量绕过。

## 当前硬件复测命令

在 Windows 主机、接通电源并关闭其他重负载程序后运行：

```bash
npm run accept:gpu -- --scenarios=rich-default --counts=500 --warmup-ms=3000 --sample-ms=10000 --channel=chrome
```

脚本支持 `--counts`、`--scenarios`、`--warmup-ms`、`--sample-ms`、`--max-sample-ms`、`--channel` 和 `--allow-software`；软件模式仅可用于 smoke，正式硬件结果不得加 `--allow-software` 绕过。

记录硬件、驱动、浏览器、renderer、电源、分辨率、URL、鱼数、资产层、构建版本和逐轮原始数据。先测 rich-default，再按 Phase F 的批准范围扩展压力矩阵。完整性能优化属于后续 Phase F；Integration 中只采集必要正确性和阻断性性能证据。
