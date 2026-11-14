# Blue Current — Roadmap

> 当前优先级核实：2026-11-14。本文件只做短导航；详细验收标准与阶段范围以 `DEVELOPMENT_ROADMAP.md` 为准，两份文件在阶段变化时同步。

## 当前唯一活跃阶段：Phase E — Ecosystem Behavior（第二轮完成，2026-11-14）

A/B/C Integration Gate 已于 2026-11-13 通过（带限制），`reef-camera-integration-v1` 标签建立在收尾提交上。Phase D 第一轮完成 D4 全局光照与 D1 水体（D023），第二轮完成 D2 海床程序化材质与 D3 海草受流摆动/成簇分布（D024）；两轮均完成同版对照与 Intel Iris Xe 硬件签核。Phase E 第一轮完成 E1 鱼体俯仰平滑/限幅与转弯弯曲、E3 捕食事件只读呈现与 `predator-watch` 单行（D025）；第二轮完成 E2 鱼群动态结构（split/merge 遥测、局部惊扰、边缘逃逸、密度响应、地形预判）与 E4 环境/生物交互（小丑鱼海葵栖息、近底沙尘/悬浮颗粒），建立新 checksum 基线并完成软件与 Intel Iris Xe 硬件签核（D026）。D2 剩余碎石/附着细节仍未做。证据见 `../test-artifacts/phase-e/2026-11-14t08-31-46z/summary.md` 与第一轮 `2026-11-14t00-13-00z/summary.md`，当前未决清单见 `CURRENT_STATE.md` 第 5 节。

### Gate 完成记录（2026-11-13 关闭，仅作历史导航）

以下为 Gate 的工作包与证据索引，不再代表当前活跃工作：

| 顺序 | 工作包 | 完成证据 | 状态 |
| --- | --- | --- | --- |
| 0 | 锁定版本与验收 manifest | 源码/资产快照、URL、种子、构建、视口、renderer、固定时间点和参数；无 Git 时先备份。 | **已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/` |
| 1 | Build / Regression | 当前全量 Vitest、`tsc --noEmit`、生产构建、Sphere 回归和 B1 ReefProxy 双跑 checksum。 | **已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp1/summary.md` |
| 2 | Collision / Reef | 五 ID 与 GLB 变换、当前 Proxy 覆盖、穿透/假避障/卡鱼、通道计数、当前 Debug 与视觉对照。 | **已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/summary.md` |
| 3 | Camera / UI / Responsive | 同版三机位、六个 School 时间点、垂直追逐、index→index 与 index→null、Console 开/关、窄屏和移动抽屉。 | **已完成 2026-11-12（有开放决策）**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp3/summary.md` |
| 4 | Runtime sign-off | 实际硬件 renderer、人工视觉/交互、180 s 相机稳定性和 30 分钟观察；保留失败项与限制。 | **已完成（pre-FSM 2026-11-12；post-FSM 2026-11-13 重跑并签核）**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp4/summary.md`、`2026-11-12T14-30-00Z/wp4/summary.md`；帧率优化留到 Phase F（D014） |

> **2026-11-12 Predator FSM direct-retarget 修改（D015）后：上表 WP0–WP4 的“已完成”均指 pre-FSM 源码；旧 WP0 源码锁与 WP1–WP4 结果失效。新 WP0 run `2026-11-12T14-30-00Z` 上 WP1–WP4 已重跑完成，WP4 硬件画面/交互于 2026-11-13 签核；Isolation/Determinism 与持续闪烁观察同日补齐，D014–D022 决策已记录，Gate 判定为通过（带限制）。判定见 `../test-artifacts/integration-abc/2026-11-13T06-33-00Z/gate-verdict.md`；docs 已由 `2026-11-13T06-33-00Z` 重新锁定。** 变更证据见 `../test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/summary.md`。

任一 P0 项失败，修复后重跑该项和受影响回归。完整矩阵与输出文件要求见 `DEVELOPMENT_ROADMAP.md` 第 2 节，现有缺口见 `CURRENT_STATE.md`。

## Gate 中的决策边界

当前未决清单只在 `CURRENT_STATE.md` 第 5 节维护，详细验收背景见 `DEVELOPMENT_ROADMAP.md`。Agent 不得自行替用户决定，也不得通过缩小柱体、降低富默认场景或修改遥测制造通过。

P0 已通过（带限制，2026-11-13），`reef-camera-integration-v1` annotated tag 在收尾提交上创建；证据目录被 Git 忽略，tag 不包含证据本体。

## 后续阶段入口

| 阶段 | 进入条件 | 第一轮范围 | 状态 |
| --- | --- | --- | --- |
| D — Environment Look Development | Integration Gate 通过并保存基线 | 两轮完成：D4/D1（D023）与 D2/D3（D024）；D2 剩余碎石/附着细节未做。 | 两轮完成 2026-11-13 |
| E — Ecosystem Behavior | D 视觉基线稳定 | 两轮完成：第一轮 E1 鱼体运动 + E3 捕食事件呈现（D025）；第二轮 E2 鱼群动态结构 + E4 环境/生物交互（D026）；不重写第二套控制器。 | 两轮完成 2026-11-14 |
| F — Performance & Validation | A–E 主要功能稳定 | 当前硬件 CPU/GPU 分项、富默认与压力矩阵、同版优化对照；无 GPU timestamp 写 N/A。 | 未启动 |
| G — Release & Presentation | F 验收完成、展示稳定 | 复用同一世界完成 Overview、School、Predator、Laboratory 四展示路径、正式截图、视频和发布说明。 | 未启动 |

历史文档中的“Phase D / School Fish”、光照 P2.x 和视觉 Phase 3/4 不等于本路线的新 Phase D 已完成。

## 完成定义

一个工作包只有在实现、受影响回归、原始证据、文档更新和剩余限制全部记录后才完成。阶段完成还需更新 `CURRENT_STATE.md`、本文件和 `DEVELOPMENT_ROADMAP.md`；长期新决策进入 `DECISIONS.md`，过程细节进入对应专项报告，不扩充 `AGENTS.md`。
