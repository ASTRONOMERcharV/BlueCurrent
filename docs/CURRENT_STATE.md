# Blue Current — Current State

> 最后核实：2026-11-14。此文件是当前阶段、功能状态、测试基线、证据缺口和未决清单的唯一短入口；实测数字按第 3 节指定的唯一文档维护。

## 1. 当前阶段与目标版本

当前活跃阶段是 **Phase F — Performance & Validation 第一轮：已完成测量与瓶颈审计（2026-11-14）**。F1 建立 `baseline:phase-f` 矩阵 harness、默认关闭的 `PhaseEmaRecorder` CPU 相位遥测、真实 WebGL2 `EXT_disjoint_timer_query_webgl2` GPU 计时与 `getRendererStats()`，完成 base/standard/pressure/extreme 四档 ×3 repeats、standard 1440×900 spot 与 telemetry-off 对照；pressure/extreme 先用 1 捕食者代理，共享桌面负载下的 `rows/` 矩阵只作诊断，标准档已按 D028 在 2026-11-14 干净复测中验证通过（暂停 Wallpaper Engine、关闭用户 Chrome，D027/D028；证据见 `test-artifacts/phase-f/2026-11-14T11-26-00Z/` 与 `test-artifacts/phase-f/2026-11-14T13-38-06Z-clean/`，性能数字只在 `docs/validation/performance.md`）。Phase E 第一轮 E1 在渲染层加入鱼体俯仰平滑/限幅与转弯弯曲，E3 把真实捕食 FSM/捕获映射为只读事件流并在 `predator-watch` 单行显示；软件对照、全量回归与 Intel Iris Xe 硬件视觉签核均完成，证据见 `test-artifacts/phase-e/2026-11-14t00-13-00z/summary.md`（D025）。第二轮完成 E2 鱼群动态结构（一致度加权对齐、密度自适应分离、地形预判、阈值门控惊扰、边缘逃逸、split/merge 结构遥测与 UI 行）与 E4 环境/生物交互（小丑鱼迁至 `anemone-b` 上方、近底沙尘/悬浮颗粒），建立新 checksum 基线并完成软件/Intel Iris Xe 硬件签核，证据见 `test-artifacts/phase-e/2026-11-14t08-31-46z/summary.md`（D026）。D2 剩余碎石/附着细节未做。A/B/C Integration Gate 已通过（带限制，2026-11-13），判定见 `test-artifacts/integration-abc/2026-11-13T06-33-00Z/gate-verdict.md`。详细矩阵见 `DEVELOPMENT_ROADMAP.md`，短优先级见 `ROADMAP.md`。

WP0 版本锁定位于 `test-artifacts/integration-abc/2026-11-12T08-22-20Z/manifest.json`（同目录含 `manifest.md`、源码/资产/文档 SHA-256、源码归档和 renderer 探测）。锁定对象是 Git `f2eeab5` 加未提交的 HTML 整理工作树；Node 24.14.1（非推荐 Node 22）与 SwiftShader 软件 renderer 是已记录限制。WP0 未运行测试、构建或截图，不代表任何 Gate 矩阵项通过。**2026-11-12 Predator FSM 修改后，该锁的 source.sha256 与 WP1–WP4 结果已失效；见 `INVALIDATED-BY-FSM-RETARGET.md`。** 当前源码的新锁位于 `test-artifacts/integration-abc/2026-11-12T14-30-00Z/manifest.json`，旧 run 只作历史证据；D016 文档更新后，当前锁为 `test-artifacts/integration-abc/2026-11-13T06-33-00Z/manifest.json`（source/assets/dist 与前一锁逐位一致，docs 重新锁定）。

WP1 Build / Regression 已通过（旧源码），证据位于同 run 的 `wp1/summary.json` 与 `wp1/summary.md`：Vitest 39/39 文件、302/302 测试；独立 tsc 与生产构建通过（100 modules、11 个 HTML 入口）；Sphere 回归 `deterministic=true` 且与上一版一致；Sphere/ReefProxy 双跑 `rerunMatches=[true,true]`，10/10 checksum 与 B1 基线一致；富默认 smoke 与 dist 探针均无浏览器错误。WP1 未提供三机位、UI 状态、Debug 画面或硬件 renderer；最终判定见 `2026-11-13T06-33-00Z/gate-verdict.md`（通过，带限制）。2026-11-12 FSM 修改后已在新锁 `2026-11-12T14-30-00Z` 重跑，见下方 post-FSM 记录。

WP2 Collision / Reef 已完成（31/31 项检查通过，旧源码），证据位于同 run 的 `wp2/summary.json` 与 `wp2/summary.md`：五礁覆盖率与 B1 基线逐位一致；Sphere/ReefProxy 再次双跑 `rerunMatches=[true,true]`，10/10 checksum 与 `experiment-b.json` 一致；ReefProxy 在 17/43/52/60/63 s 均 0 穿透、0 深穿透、0 假避障、0 卡鱼；B1 Overview 的 Hero/D 高度比 1.172、面积比 1.168、Hero 横向中心 56.54%，均达目标；新增当前 ReefProxy Debug 9 张、俯视通道 2 张和 B1 Overview/近景 4 张，浏览器无错误。WP2 本身不提供同版三机位、UI 响应式或硬件 renderer；硬件与长时观察由 WP4 另行完成。2026-11-12 FSM 修改后已在新锁 `2026-11-12T14-30-00Z` 重跑，见下方 post-FSM 记录。

WP3 Camera / UI / Responsive 已完成（22/22 项检查通过，有开放决策，旧源码），证据位于同 run 的 `wp3/summary.json` 与 `wp3/summary.md`：相机单元测试 41/41；当前 encounter 六时间点 School 可见率 0.904/0.972/0.988/0.996/0.986/0.940，`invariants=0`、`browserErrors=0`；18 次模式切换最低净空 1.879 m；浏览器目标轨迹 7 次切换、12 次状态变化，覆盖 index→null、null→新 index、真实死亡目标（51.32 s，captures=2）和 attack→patrol/search；三机位、六时间点、Console 开/关、800×560 与 390×844 移动抽屉均已截图并归档，UI 状态不改变模拟 checksum。旧 FSM 的 300 s CPU 探针 60/60 经 null；2026-11-12 FSM 修改后已在浏览器捕获 4 次 direct index→index（5.08/12.42/12.78/30.38 s），见 `validation/fsm-retarget.md`。School 构图已按 `DECISIONS.md` D016 决定：保留 fit 上限 1.4，优先主体尺寸；post-FSM 重跑（同一 run 的 `wp3/summary.json`，122/122）六点可见率为 0.8517/0.9355/0.9254/0.9375/0.9718/0.8528，t17/t63 约 0.85 属已接受结果。

WP4 Runtime sign-off 已完成（旧源码），证据位于同 run 的 `wp4/summary.json` 与 `wp4/summary.md`：实际 renderer 为 Intel Iris Xe D3D11（headed Chrome，非 SwiftShader）；`accept:gpu` rich-default 短测 120 帧、40.66 FPS、P95 66.20 ms、1 dropped step；180 s School 相机 189.8 s、412 采样，最低净空 1.100 m、最大角变化 0.0815、最低可见率 0.565、0 finite/净空/浏览器错误；30 分钟 Overview 观察 1813.8 s、644 采样，相机位置漂移 0 m、姿态漂移约 1.7e-6°、最低可见率 0.966、0 finite/净空/浏览器错误。用户已于 2026-11-12 签核通过硬件画面与交互（`wp4/human-signoff.md`）；持续闪烁仍未 instrument；帧率优化已于 2026-11-12 决定留到 Phase F（`DECISIONS.md` D014）。无 GPU timestamp，不能声称稳定 60 FPS 或 Gate 通过。FSM 修改后已在新锁 `2026-11-12T14-30-00Z` 重跑硬件项，见下方 post-FSM 记录。

2026-11-12 **Predator FSM direct-retarget 变更**：`pursuit` 中若另一条活鱼至少近 15%，可直接换目标，不再必须经过 null（`DECISIONS.md` D015）。定向 Predator 测试 5/5、全量 Vitest 304/304、tsc 与生产构建通过；`sim-regression` `deterministic=true` 但五个 checksum 全部变化（43–63 s alive 496 vs 498）；浏览器 0–30 s 捕获 4 次 direct（5.08/12.42/12.78/30.38 s），0 错误。旧 WP0 锁与 WP1–WP4 结果因此失效；证据见 `validation/fsm-retarget.md` 与 `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/summary.md`。

post-FSM WP1–WP4（新锁 `2026-11-12T14-30-00Z`）：WP1 39 文件 304/304、tsc 0、生产构建 100 modules/128 dist 文件、Sphere/ReefProxy `rerunMatches=[true,true]`（10/10 checksum 与 pre-FSM 基线不同，已记录为 post-FSM 基线）；WP2 107/107，五礁覆盖与碰撞行为与 WP1 一致；WP3 122/122，六点 School 可见率 0.8517/0.9355/0.9254/0.9375/0.9718/0.8528，18 次切换 `invariants=0`，浏览器 0–30 s 4 次 direct、0–60 s 11 次 direct；WP4 19/19，Intel Iris Xe D3D11 短测 91.25 FPS / P95 18.30 ms，180 s 586 采样、30 分钟 798 采样且固定 Overview 漂移 0 m，用户于 2026-11-13 签核硬件画面/交互（`wp4/human-signoff.md`）。证据分别位于同 run 的 `wp1/`–`wp4/summary.md`。2026-11-13 补做 Isolation/Determinism：Observation/Laboratory × Overview/School/Predator 共 7 种组合在同一 reset 轨迹上 checksum 完全一致（`52ed2ff65445d74e46b0051b`，`2026-11-13T06-33-00Z/isolation/isolation-results.json`）；用户同日做 10–15 分钟真实显示观察，未发现持续闪烁。文档更新后的当前锁为 `2026-11-13T06-33-00Z`（docs 重新锁定，source/assets/dist 不变）。

P0 目标版本是富默认场景：500 主鱼 + 100 小丑鱼 + 1 shayu，B1 Hero/D，Experiment C 相机，单一路径线性水体。默认碰撞仍为 `sphere`，`reefProxy` 是候选 opt-in 路径，不得在验收中 silently 改成默认。

项目 Git 已存在（`main`）。Gate 已通过（带限制，2026-11-13），annotated tag `reef-camera-integration-v1` 在本收尾提交上创建；证据仍以 `test-artifacts/` 为准，tag 本身不包含被 Git 忽略的证据目录。

## 2. 功能状态

| 项目 | 当前状态 | 证据范围与剩余限制 |
| --- | --- | --- |
| Experiment A — Collision Proxy / SDF | 已实现；代码、单元测试和 CPU/软件实验已验证 | 当前 B1 覆盖、穿透/假避障/卡鱼与 ReefProxy Debug 已在 WP2 完成；默认仍 Sphere，是否切换 ReefProxy 未决。实测由 `validation/visual-baseline.md` 与 `validation/performance.md` 维护。 |
| Experiment B — Reef hierarchy B1 | 已实现；轮廓指标和软件截图已验证 | WP2 的 1920×1080 Overview 与 Hero/D 近景达到高度比 1.15–1.25、面积比 >1、Hero 中心 53–58%；最终人工审美签核和低前 shelf 决策仍待人工构图评审。实测与图片版本见 `validation/visual-baseline.md`。 |
| Experiment C — Camera stability | 已实现；当前版本六时间点、三机位与目标轨迹已验证 | WP3 已完成当前三机位、六时间点、目标切换和 UI；WP4 已补硬件 180 s 与 30 分钟观察，用户已签核硬件画面/交互；2026-11-12 FSM direct retarget 已在浏览器捕获 4 次 direct；Gate 已在新锁重跑并关闭；持续闪烁未 instrument。 |
| Predator FSM direct retarget | 已实现并验证（当前源码） | `pursuit` 中 15% 优势直接重选；Predator 5/5、全量 304/304、tsc/build 通过；回归 deterministic 但 checksum 改变；浏览器 4 次 direct。新 WP0 锁与后置 WP1–WP4 重跑均已完成，Gate 已关闭。 |
| 连续地形、水体、光照、焦散、光柱 | 第一轮 D4/D1 与第二轮 D2/D3 均已定稿并通过硬件视觉签核 | Phase D 两轮完成：礁石/海床可读性、海床程序化斑块/颗粒、海草受流摆动与 14 株成簇分布；D2 剩余碎石/附着细节未做。 |
| 主鱼动画 | 已实现并签核（E1） | 尾权重、速度、banking、俯仰平滑/限幅与转弯弯曲；`FishMotion`/`FishRendererMotion` 覆盖平滑、限幅与 legacy 对照；软件 12 对同版对照与 Intel Iris Xe 硬件签核（D025）。`?fishMotion=legacy` 仅作同版对照。 |
| 捕食事件呈现（E3） | 已实现并签核 | `PredationEventTracker` 只从真实快照派生事件；70 s 软件 111 事件/5 次真实捕获、硬件 108/5，均与 `captures=5` 一致；`predator-watch` 单行桌面可见、390×844 隐藏；不改 FSM/目标/捕获。 |
| 鱼群动态结构（E2） | 已实现并签核 | 一致度加权对齐、密度自适应分离、群体流地形预判、阈值门控惊扰传播、恐惧缩放边缘逃逸默认开启；每 30 步并查集结构遥测 + `SchoolStructureTracker` split/merge/subgroup 事件；`predator-watch` 第二行显示 `School N · median M`；`?schoolDynamics=legacy` 同版回滚。70 s dynamic 8 split/11 merge，legacy 12/12；3600 步无 NaN/越界。 |
| 小丑鱼海葵栖息（E4） | 已实现并签核 | `AnemoneHabitat` 单点拥有海葵公式；小丑鱼软栖息中心在 `anemone-b` 上方 5.5 m，环形 3.4 m 吸引 / 1.1 m 核心 / 死区，恐惧可压制；calm 17–52 s 质心距 3.56–3.67 m、spread 1.31–1.73 m；`?habitat=legacy` 回滚旧 home。 |
| 近底沙尘/悬浮颗粒（E4） | 已实现并签核 | `SedimentField` 320 粒确定性池，读取真实近底位置/速度与共享海流；`SedimentPlume` 单 `Points` draw；63 s 151 粒 vs `sediment=0` 0 粒，checksum 完全相同；8 m 距离衰减影响高度。 |
| shayu 骨骼动画 | 已实现；单元与软件 smoke 已验证 | 11 骨程序化游动；P2 下颌/胸鳍仍未完成，正式演示视频未录制。 |
| 海流、栖息区、海带庇护 | 模块级实现并部分接线 | 不是完整食物网；Phase E 第一轮完成 E1/E3，第二轮完成 E2 鱼群结构与 E4 海葵栖息/沙尘；D2 剩余碎石/附着细节未做。 |
| Uniform Grid / CPU 优化 V1 | 已实现；历史 CPU A/B | 当前为连续 `cellItems`；1000/2000 鱼历史硬件目标未达成，需当前分项测量后再优化。 |
| 多捕食者生态、资源/食物网、WebGPU | 未实现 / 计划 | 压力测试设想不能写成现有生态能力。 |

## 3. 最近可核实验证基线

以下为现存原始证据。WP1–WP4 已在 post-FSM 锁 `2026-11-12T14-30-00Z` 重跑完成；表中指向 `2026-11-12T08-22-20Z` 的行只作 pre-FSM 历史对照，不能作为当前版本证据。

| 项目 | 当前可用证据 | 限定与唯一数据所有者 |
| --- | --- | --- |
| Vitest | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp1/vitest.log`：2026-11-12 08:53:37Z，39/39 文件、302/302 tests，30.91 s | 旧源码；FSM 修改后失效。 |
| FSM 变更验证 | `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/vitest.log`、`predator-tests.log`、`tsc.log`、`build-retry.log`、`sim-regression.log` | 2026-11-12 候选源码：39/39 文件、304/304；tsc 与构建通过；回归 `deterministic=true` 但 5 个 checksum 全变；旧 Gate 结果不可复用。 |
| 生产构建 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp1/build.log`：Vite 7.3.7、100 modules、9.27 s、11 个 HTML 入口、128 个 dist 文件 | three-core 543.56 kB 是大小警告；`wp1/tsc.log` 为独立类型检查原始日志。 |
| Sphere 确定性 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp1/sim-regression.log`、`sim-regression.json`：`deterministic=true` | 五个时间点与上一版 `simulation-headless.json` 完整 states 对象一致；跨障碍脚本尾部 checksum 口径不同。 |
| B1 碰撞 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/collision-behavior.json`（基线 `test-artifacts/reef-collision/experiment-b.json`） | WP2 再次双跑：`rerunMatches=[true,true]`、两模式 `deterministic=true`，10/10 checksum 与基线一致；ReefProxy 5 点均 0 穿透/深穿透/假避障/卡鱼。覆盖/通道由 `validation/visual-baseline.md` 维护，查询性能由 `validation/performance.md` 维护。 |
| 相机回归 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp3/camera-regression/camera-regression.json`、`wp3/target-trace-long/camera-target-switch-long.json` | WP3 当前版本：六时间点、18 次模式切换、7 次目标切换与死亡样本；混合旧版 `camera-regression-final` 仅作历史对照。统计由 `validation/visual-baseline.md` 维护，CPU 数学性能由 `validation/performance.md` 维护。 |
| Predator 目标索引 | `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/probe/target-index-probe.json`、`browser/browser-target-switch.json` | CPU 300 s/18,000 步：139 次切换、42 direct；浏览器 0–30 s：4 direct（5.08/12.42/12.78/30.38 s）、0 错误；SwiftShader；Gate 已关闭。 |
| 真实硬件 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp4/gpu-acceptance/results.json`、`wp4/hardware-180s.json`、`wp4/hardware-30min.json` | 2026-11-12 Intel Iris Xe D3D11 硬件短测、180 s School 和 30 分钟 Overview 观察已记录；历史 2026-11-09 数据保留为历史。数值只在 `validation/performance.md` 维护，当前仍无 GPU timestamp 和完整压力矩阵。 |
| Phase D 第一轮（D1+D4） | `test-artifacts/phase-d/2026-11-13t10-45-43z/summary.md`、`metrics.json`、`metrics-before.json`、`metrics-after-d4-r3.json`、`metrics-after-d1-r2.json`、`compare-d4-r3.json`、`compare-d1-r2.json`、`metrics-hardware.json` | 2026-11-13：SwiftShader 同版 10 机位 × base/fog/final before/after；D4 礁石近景 P50 +10.8–14.0%、宽景 +3.5–4.0%、俯视海床 +20.9%，D1 岩石对比度 +0.7–3.6%，水面 patch ≤0.23（多数 0.00）、色相 ≤0.91°、零裁剪；全量 608 tests、tsc、构建与 sim 回归通过（checksum `535bf8835258bcf1b2e9e696`）；Intel Iris Xe 硬件画面签核（`human-signoff.md`）。画面细节只在 `validation/visual-baseline.md` 维护。 |
| Phase D 第二轮（D2+D3） | `test-artifacts/phase-d/2026-11-13t12-16-00z/summary.md`、`metrics.json`、`metrics-after-d2d3.json`、`compare-d2d3.json`、`metrics-hardware.json` | 2026-11-13：海床顶点+片元程序化细节，亮度分布 +2.1…+8.3、P50 漂移 ≤1.77、零裁剪；海草 14 株 6 簇接入共享海流，t=17.0/17.5 s 摆动两帧；三角形 +110,336（+8.7%）、draw calls 不变；80 文件 623 tests（含嵌套副本）、tsc、构建、sim 回归（checksum 不变）与三个 smoke 通过；Intel Iris Xe 硬件画面签核。海草 +110k 三角形未做帧时间评估，归 Phase F。 |
| Phase E 第一轮（E1+E3） | `test-artifacts/phase-e/2026-11-14t00-13-00z/summary.md`、`metrics-e1.json`、`metrics-e3.json`、`metrics-e1-hardware.json`、`metrics-e3-hardware.json`、`human-signoff.md` | 2026-11-14：E1 12 对同版对照 checksum/相机/三角形一致（`535bf8835258bcf1b2e9e696`），smooth max\|pitch\| 0.900 vs legacy 1.408–1.517、max\|turn\| 0.259–0.264 vs 0；E3 70 s 软件 111 事件/5 捕获、硬件 108/5，`values.captures` 1–5 与 final `captures=5` 一致；45 文件 342 tests（排除嵌套 worktree 重复副本）、tsc、构建、sim 回归（checksum 不变）、rich smoke 与 observatory 通过；Intel Iris Xe 硬件画面签核。画面细节只在 `validation/visual-baseline.md` 维护。 |
| Phase E 第二轮（E2+E4） | `test-artifacts/phase-e/2026-11-14t08-31-46z/summary.md`、`metrics-e2.json`、`metrics-e2-hardware.json`、`metrics-e4.json`、`metrics-e4-hardware.json`、`e2/stress-dynamic.json`、`e2/collision-behavior-e2.json`、`e4/drawcalls.json`、`human-signoff.md` | 2026-11-14：新 checksum 基线 `8a4ebd80…`/`69d993ea…`/`251d7c0f…`/`937cdfef…`/`42e40651…`，`?schoolDynamics=legacy` + `?habitat=legacy` 逐位复现旧 `535bf883…`；E2 dynamic 8 split/11 merge vs legacy 12/12，五时间点相机一致；E4 栖息距离 3.56–3.67 m、spread 1.31–1.73 m，仅小丑鱼段变化；沙尘 151 vs 0 粒、checksum 相同、+1 draw call；3600 步无 NaN/越界（max\|pos\| 19.92）且两次一致；49 文件 365 tests、tsc、构建、sim 回归、rich smoke、observatory、`accept:gpu` 通过；Intel Iris Xe 硬件画面签核。碰撞净空与画面细节只在 `validation/visual-baseline.md` 维护。 |
| Phase F 第一轮（F1 基线） | `test-artifacts/phase-f/2026-11-14T11-26-00Z/rows/analysis.md`、`results.json`、`metadata.json`、`conditions.md`、`final/`、`stability-standard/`、`stability-pressure/`；`test-artifacts/phase-f/2026-11-14T13-38-06Z-clean/acceptance.md`、`standard-off/results.json` | 2026-11-14：四档 ×3 repeats、1440×900 spot、telemetry-off 对照与真实 GPU timer query 完成；base/standard 可重复，pressure/extreme 受整机漂移影响未达重复性且仍为 1 捕食者代理；CPU 模拟为主瓶颈，GPU 时间已实测。同日干净复测（暂停 Wallpaper Engine、关闭用户 Chrome）中 standard telemetry-off 3/3 达到 D028 标准档目标。数值、条件与缺口只在 `validation/performance.md` 维护；D027/D028 记录测量范围与目标。 |
| Integration Gate WP0 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/manifest.json`、`manifest.md` | 旧源码锁，FSM 修改后失效；保留为历史证据。Node 24.14.1 与 SwiftShader 为限制。 |
| Integration Gate WP0（post-FSM） | `test-artifacts/integration-abc/2026-11-12T14-30-00Z/manifest.json`、`manifest.md` | 当前源码锁；source/assets/docs 快照、源码归档与 renderer 探测；WP1–WP4 已在该锁重跑完成。 |
| Integration Gate WP1 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp1/summary.json`、`summary.md` | pre-FSM 历史：全量测试、类型检查、构建、Sphere 回归、ReefProxy 双跑、富默认 smoke 与 dist 探针通过；post-FSM 重跑结果见 §1。 |
| Integration Gate WP2 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp2/summary.json`、`summary.md` | pre-FSM 历史：31/31 项通过；仅 SwiftShader 与诊断降级场景；post-FSM 重跑结果见 §1。 |
| Integration Gate WP3 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp3/summary.json`、`summary.md` | pre-FSM 历史：22/22 项通过；旧 FSM 无直接 index→index；post-FSM 重跑结果见 §1。 |
| Integration Gate WP4 | `test-artifacts/integration-abc/2026-11-12T08-22-20Z/wp4/summary.json`、`summary.md` | pre-FSM 历史：Intel Iris Xe 短测、180 s 与 30 分钟观察、人工签核完成；post-FSM 重跑结果见 §1。 |

命令与复现注意事项见 `validation/test-guide.md`。复测后先更新对应 validation 文档，再只在本文件更新状态与证据指针，不复制整组实测数字。

## 4. 当前证据缺口

WP0 锁定版本、WP1 完成 build/regression、WP2 补齐 B1 层级/碰撞 Debug/通道、WP3 补齐同版三机位、六时间点、目标轨迹和 UI 响应式、WP4 补齐真实 Intel Iris Xe 短测与 180 s/30 分钟长跑；这些结果均基于 pre-FSM 源码，仅作历史对照。2026-11-12 FSM direct-retarget 修改已实现并捕获浏览器 4 次 direct；WP1–WP4 已在 post-FSM 锁 `2026-11-12T14-30-00Z` 重跑完成，Gate 于 2026-11-13 关闭。具体图片索引和版本见 `validation/visual-baseline.md`，FSM 变更见 `validation/fsm-retarget.md`，Phase D 两轮证据见 `test-artifacts/phase-d/2026-11-13t10-45-43z/summary.md` 与 `test-artifacts/phase-d/2026-11-13t12-16-00z/summary.md`；Phase E 两轮证据见 `test-artifacts/phase-e/2026-11-14t00-13-00z/summary.md` 与 `test-artifacts/phase-e/2026-11-14t08-31-46z/summary.md`。E2/E4 已完成并签核；D2 剩余碎石/附着细节未做；持续闪烁在本轮后未重新观察。

Integration 还需补：无（Gate 已关闭）。WP1–WP4 已在新锁重跑；School 构图由 D016、D 通道由 D017、Hero shelf 由 D018、默认碰撞由 D019、B 基座力由 D020、扩展目标由 D021、retarget 阈值由 D022 关闭。持续闪烁观察已由用户完成并在 `2026-11-13T06-33-00Z/flicker-observation.md` 记录（未观察到）。旧 `accept:observatory` 全套在 checks/mobile 阶段超时，无 results JSON；其覆盖的 UI 行为已由独立 UI 工具验证；Phase E 期间已修复环境问题并四跑通过。Phase D 两轮、Phase E 两轮均已完成并签核；D2 剩余碎石/附着细节是否补做未定。Phase F F1 已完成四档测量与瓶颈审计，标准档验收目标已由 D028 签核并在干净复测中验证（standard telemetry-off 3/3）；pressure/extreme 的干净矩阵与 3/5 捕食者完整矩阵仍未完成。当前 `rows/` 矩阵在动态壁纸/并发负载下采集，pressure/extreme 重复性不达标。测试计数口径：`vitest.config.ts` 已排除 `.claude/worktrees` 与 `.task-locks` 的重复测试副本，当前项目自身为 50 文件/370 tests（含 Phase F 遥测测试）；旧的 80/623、83/642 与 45/342 含不同阶段或副本，不可直接比较。

## 5. 当前未决清单（唯一维护处）

| 决策点 | 待确认内容 |
| --- | --- |
| Phase F pressure/extreme 干净矩阵 | standard 档已在干净复测中验证；pressure/extreme 仍需在暂停动态壁纸/关闭并发负载的相同条件下复测，并完成 3/5 捕食者（D027）。 |
| 3/5 捕食者完整矩阵 | pressure/extreme 当前只有 1 捕食者代理；完整多捕食者测量是独立工作包（D027）。 |
| D2 剩余碎石/附着细节 | 是否补做碎石/附着细节，以及是否作为独立轮次进入后续路线。 |
| 持续闪烁 | 用户 2026-11-13 观察未发现持续闪烁，但未 instrument；Phase D 两轮与 Phase E 两轮改动后未重复长时观察。 |

已于 2026-11-12 决定：帧率优化与压力矩阵留到 Phase F（`DECISIONS.md` D014）；Predator FSM 允许 pursuit direct index→index（D015）。已于 2026-11-13 决定：School 构图保留 fit 上限 1.4（D016）；D 双柱保持封闭（D017）；Hero 不加低前 shelf（D018）；默认碰撞保持 Sphere（D019）；B 基座力与 Proxy 成本留 Phase F（D020）；1000/2000 与多捕食者不作为 Gate 目标（D021）；接受 retarget 0.85（D022）；Phase D 第一轮 D4/D1 参数定稿并保持当前风格（D023）；第二轮 D2/D3 定稿（D024）；Phase E 第一轮 E1/E3 定稿（D025）；第二轮 E2/E4 定稿并建立新 checksum 基线（D026）；Phase F 第一轮只做测量与瓶颈审计，压力档先用 1 捕食者代理（D027）；标准档验收目标已签核（D028），并在 2026-11-14 干净复测中验证通过。除上述 ADR 外无其他未决设计项；持续闪烁仍未 instrument。长期已确定边界见 `DECISIONS.md`；某项决定后，在本表移除或更新状态，并在 `DECISIONS.md` 新增对应 ADR。

## 6. 旧文档使用限制

`docs/report/FINAL_REPORT.md`、`docs/VALIDATION_REPORT.md` 和早期视觉/验证报告保留作历史证据，不能提供当前测试数或默认资产范围。`README.md` 的运行说明仍可使用，但 `head/next` 网格、cohesionRadius=6、海带 48+43、完全无 LOD、31 tests 等描述已过期。

实验 A 的覆盖率和 D 间隙是旧代理数据；`gpu-acceptance/latest.json` 实际是 SwiftShader；B1 `capture.json` 的 aggregate `renderTriangles` 不宜作为版本证明。当前任务先读本文件和对应子系统文档，不通读全部历史报告。

## 更新规则

任何工作包结束后，只更新实际变化的状态、测试基线、未决清单和证据指针。性能数字只改 `validation/performance.md`，视觉/碰撞/相机实测只改 `validation/visual-baseline.md`，过程尝试写入专项报告。阶段完成还必须同步 `ROADMAP.md` 与 `DEVELOPMENT_ROADMAP.md`。
