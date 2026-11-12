# Blue Current — Current State

> 最后核实：2026-11-12。此文件是当前阶段、功能状态、测试基线、证据缺口和未决清单的唯一短入口；实测数字按第 3 节指定的唯一文档维护。

## 1. 当前阶段与目标版本

当前唯一活跃阶段是 **P0 — A/B/C Integration Gate，待执行**。A/B/C 单项结果不能代替组合验收；Gate 通过前不启动新的 Phase D 实现。详细矩阵见 `DEVELOPMENT_ROADMAP.md`，短优先级见 `ROADMAP.md`。

P0 目标版本是富默认场景：500 主鱼 + 100 小丑鱼 + 1 shayu，B1 Hero/D，Experiment C 相机，单一路径线性水体。默认碰撞仍为 `sphere`，`reefProxy` 是候选 opt-in 路径，不得在验收中 silently 改成默认。

项目目录无 Git 元数据。修改前备份；已签核的稳定基线尚不存在，`reef-camera-integration-v1` 只有 Gate 全通过后才建立，文档中的名称不代表 Git tag 已存在。

## 2. 功能状态

| 项目 | 当前状态 | 证据范围与剩余限制 |
| --- | --- | --- |
| Experiment A — Collision Proxy / SDF | 已实现；代码、单元测试和 CPU/软件实验已验证 | 当前 B1 回归记录达到单项实验预期。默认仍 Sphere；B1 Proxy 双跑确定性、当前 Debug 画面和联合验收未完成。实测由 `validation/visual-baseline.md` 与 `validation/performance.md` 维护。 |
| Experiment B — Reef hierarchy B1 | 已实现；轮廓指标和软件截图已验证 | 当前轮廓指标达到 Experiment B 目标，但 Hero 自身面积、D Proxy 覆盖和人工主从读法仍需整合确认。实测与图片版本见 `validation/visual-baseline.md`。 |
| Experiment C — Camera stability | 已实现，但未完整验证 | 相机单元测试通过；`camera-regression-final` 是 **B1 Hero + 旧 D** 混合版本，不是完整 B1+C。缺浏览器 index→index、当前三机位、硬件 180 s 和 30 分钟观察。 |
| 连续地形、水体、光照、焦散、光柱 | 组件和软件范围已实现 | Phase D Environment Look Development 未启动；海床重复、材质统一和硬件视觉仍待处理。 |
| 主鱼动画 | 已实现，验证不完整 | 尾权重、速度和 banking 已接入；有资产 smoke，无专门主鱼动画单元测试。 |
| shayu 骨骼动画 | 已实现；单元与软件 smoke 已验证 | 11 骨程序化游动；P2 下颌/胸鳍仍未完成，正式演示视频未录制。 |
| 海流、栖息区、海带庇护 | 模块级实现并部分接线 | 不是完整食物网；Phase E 生态行为深化未启动。 |
| Uniform Grid / CPU 优化 V1 | 已实现；历史 CPU A/B | 当前为连续 `cellItems`；1000/2000 鱼历史硬件目标未达成，需当前分项测量后再优化。 |
| 多捕食者生态、资源/食物网、WebGPU | 未实现 / 计划 | 压力测试设想不能写成现有生态能力。 |

## 3. 最近可核实验证基线

以下是现存原始证据，不表示本次知识库整理重新运行了测试或浏览器。

| 项目 | 当前可用证据 | 限定与唯一数据所有者 |
| --- | --- | --- |
| Vitest | `test-artifacts/reef-hierarchy/vitest-b1-final.log`：2026-11-12 02:40:51，39/39 文件、302/302 tests，15.75 s | 本文件管理当前测试基线。日志后无 `src/`、`tests/`、`scripts/` 更新；后续代码改动必须重跑。 |
| 生产构建 | `test-artifacts/reef-hierarchy/build-b1.log`：Vite 7.3.7、99 modules、6.52 s | three-core 543.56 kB 是大小警告；独立 `tsc --noEmit` 只有文档记录，无单独原始日志。 |
| Sphere 确定性 | `test-artifacts/reef-hierarchy/sim-regression-b1.log`：`deterministic=true` | 五个时间点与历史状态快照完整 24 位一致；跨障碍脚本尾部 checksum 口径不同。 |
| B1 碰撞 | `test-artifacts/reef-collision/experiment-b.json`、`proxy-coverage.json` | `rerunMatches=null`、两模式 `deterministic=null`。覆盖/通道由 `validation/visual-baseline.md` 维护，查询性能由 `validation/performance.md` 维护。 |
| 相机回归 | `test-artifacts/camera-regression-final/camera-regression.json`、`camera-target-switch/camera-target-switch.json` | 混合版本与统计范围由 `validation/visual-baseline.md` 维护，相机数学性能由 `validation/performance.md` 维护。 |
| 真实硬件 | `test-artifacts/gpu-acceptance/2026-11-09T12-09-45-899Z/results.json` | 历史 Iris Xe，seaweed=off，早于 B1/C。当前富默认性能与 GPU timestamp 为 N/A；数值只在 `validation/performance.md` 维护。 |

命令与复现注意事项见 `validation/test-guide.md`。复测后先更新对应 validation 文档，再只在本文件更新状态与证据指针，不复制整组实测数字。

## 4. 当前证据缺口

当前不存在同版 B1+C 的 Overview/School/Predator 三机位套图，也没有当前 B1 ReefProxy Debug 套图。B1 Overview 使用 Sphere；School/Predator 截图是 pre-B1；碰撞 Debug 是旧实验 A Proxy。具体图片索引和版本见 `validation/visual-baseline.md`。

Integration 还需补：当前 ReefProxy 双跑 checksum、GLB/Proxy/通道空间对照、浏览器 index→index 目标切换、Console 开/关与窄屏、真实 GPU 视觉/交互、180 s 相机稳定性和 30 分钟观察。

## 5. 当前未决清单（唯一维护处）

| 决策点 | 待确认内容 |
| --- | --- |
| D 双柱通道 | 当前封闭是刻意设计还是应允许通行；不能由 Agent 直接缩柱体或改 margin 代替决策。 |
| School 构图 | 90–95% 可见率与 15–20% 留白的优先级。 |
| Hero 主从读法 | 是否需要低前 shelf；只有整合构图未通过才调整。 |
| 默认碰撞 | ReefProxy 验收后是否从 opt-in 改为默认。 |
| B 基座力与 Proxy 成本 | 在 Integration 标定还是留到 Phase F。 |
| 扩展性目标 | 1000/2000 鱼是否仍是硬验收目标。 |
| 多捕食者 | 压力矩阵中的多捕食者只是性能场景，还是未来真实生态需求。 |

以上均未决定。长期已确定边界见 `DECISIONS.md`；某项决定后，在本表移除或更新状态，并在 `DECISIONS.md` 新增对应 ADR。

## 6. 旧文档使用限制

`docs/report/FINAL_REPORT.md`、`docs/VALIDATION_REPORT.md` 和早期视觉/验证报告保留作历史证据，不能提供当前测试数或默认资产范围。`README.md` 的运行说明仍可使用，但 `head/next` 网格、cohesionRadius=6、海带 48+43、完全无 LOD、31 tests 等描述已过期。

实验 A 的覆盖率和 D 间隙是旧代理数据；`gpu-acceptance/latest.json` 实际是 SwiftShader；B1 `capture.json` 的 aggregate `renderTriangles` 不宜作为版本证明。当前任务先读本文件和对应子系统文档，不通读全部历史报告。

## 更新规则

任何工作包结束后，只更新实际变化的状态、测试基线、未决清单和证据指针。性能数字只改 `validation/performance.md`，视觉/碰撞/相机实测只改 `validation/visual-baseline.md`，过程尝试写入专项报告。阶段完成还必须同步 `ROADMAP.md` 与 `DEVELOPMENT_ROADMAP.md`。
