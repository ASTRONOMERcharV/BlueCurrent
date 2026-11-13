# Blue Current — Roadmap

> 当前优先级核实：2026-11-12。本文件只做短导航；详细验收标准与阶段范围以 `DEVELOPMENT_ROADMAP.md` 为准，两份文件在阶段变化时同步。

## 当前唯一活跃阶段：A/B/C Integration Gate — 通过（带限制，2026-11-13）；Phase D 可启动

目标是证明碰撞、B1 礁石、Experiment C 相机和 UI 在同一版本组合正确，而不是重新盖章单项实验。Gate 全通过并保存稳定基线前，不启动新的 Phase D 实现，不继续增加礁石、珊瑚或生物品种。

建议将 Gate 拆成以下顺序，每次只做一个明确工作包：

| 顺序 | 工作包 | 完成证据 | 状态 |
| --- | --- | --- | --- |
| 0 | 锁定版本与验收 manifest | 源码/资产快照、URL、种子、构建、视口、renderer、固定时间点和参数；无 Git 时先备份。 | **已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/` |
| 1 | Build / Regression | 当前全量 Vitest、`tsc --noEmit`、生产构建、Sphere 回归和 B1 ReefProxy 双跑 checksum。 | **已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp1/summary.md` |
| 2 | Collision / Reef | 五 ID 与 GLB 变换、当前 Proxy 覆盖、穿透/假避障/卡鱼、通道计数、当前 Debug 与视觉对照。 | **已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/summary.md` |
| 3 | Camera / UI / Responsive | 同版三机位、六个 School 时间点、垂直追逐、index→index 与 index→null、Console 开/关、窄屏和移动抽屉。 | **已完成 2026-11-12（有开放决策）**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp3/summary.md` |
| 4 | Runtime sign-off | 实际硬件 renderer、人工视觉/交互、180 s 相机稳定性和 30 分钟观察；保留失败项与限制。 | **旧源码已完成 2026-11-12**：`test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp4/summary.md`；用户已签核硬件画面/交互，帧率优化留到 Phase F（D014）；FSM 后需重跑 |

> **2026-11-12 Predator FSM direct-retarget 修改（D015）后：上表 WP0–WP4 的“已完成”均指 pre-FSM 源码；旧 WP0 源码锁与 WP1–WP4 结果失效。新 WP0 run `2026-11-12T14-30-00Z` 上 WP1–WP4 已重跑完成，WP4 硬件画面/交互于 2026-11-13 签核；Isolation/Determinism 与持续闪烁观察同日补齐，D014–D022 决策已记录，Gate 判定为通过（带限制）。判定见 `../test-artifacts/integration-abc/2026-11-13T06-33-00Z/gate-verdict.md`；docs 已由 `2026-11-13T06-33-00Z` 重新锁定。** 变更证据见 `../test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/summary.md`。

任一 P0 项失败，修复后重跑该项和受影响回归。完整矩阵与输出文件要求见 `DEVELOPMENT_ROADMAP.md` 第 2 节，现有缺口见 `CURRENT_STATE.md`。

## Gate 中的决策边界

当前未决清单只在 `CURRENT_STATE.md` 第 5 节维护，详细验收背景见 `DEVELOPMENT_ROADMAP.md`。Agent 不得自行替用户决定，也不得通过缩小柱体、降低富默认场景或修改遥测制造通过。

P0 已通过（带限制，2026-11-13），`reef-camera-integration-v1` annotated tag 在收尾提交上创建；证据目录被 Git 忽略，tag 不包含证据本体。

## 后续阶段入口

| 阶段 | 进入条件 | 第一轮范围 | 状态 |
| --- | --- | --- | --- |
| D — Environment Look Development | Integration Gate 通过并保存基线 | 只做 D1 水体、D2 海床材质部分、D4 全局光照；固定视觉基线后再做 D3 海草和其余接触细节。 | 未启动 |
| E — Ecosystem Behavior | D 视觉基线稳定 | 深化现有鱼体/鲨鱼动画、分裂重聚、真实捕食事件和环境交互；不重写第二套控制器。 | 未启动 |
| F — Performance & Validation | A–E 主要功能稳定 | 当前硬件 CPU/GPU 分项、富默认与压力矩阵、同版优化对照；无 GPU timestamp 写 N/A。 | 未启动 |
| G — Release & Presentation | F 验收完成、展示稳定 | 复用同一世界完成 Overview、School、Predator、Laboratory 四展示路径、正式截图、视频和发布说明。 | 未启动 |

历史文档中的“Phase D / School Fish”、光照 P2.x 和视觉 Phase 3/4 不等于本路线的新 Phase D 已完成。

## 完成定义

一个工作包只有在实现、受影响回归、原始证据、文档更新和剩余限制全部记录后才完成。阶段完成还需更新 `CURRENT_STATE.md`、本文件和 `DEVELOPMENT_ROADMAP.md`；长期新决策进入 `DECISIONS.md`，过程细节进入对应专项报告，不扩充 `AGENTS.md`。
