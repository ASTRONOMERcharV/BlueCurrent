# Blue Current Development Roadmap

> 采纳日期：2026-11-12  
> 当前阶段：**A/B/C Integration Gate：通过（带限制，2026-11-13）**；WP0–WP4 已在新锁重跑，Isolation/Determinism 与持续闪烁观察已补齐；判定见 `../test-artifacts/integration-abc/2026-11-13T06-33-00Z/gate-verdict.md`  
> 后续阶段：D → E → F → G。除整合验收所需的修复外，暂停新增礁石、珊瑚和生物品种。

本文件是后续开发与优先级的总入口。A、B、C 的单项报告只证明各自实验结果，不证明三者组合后已经通过验收。Phase D–G 目前均为计划，不得写成已交付能力。

**命名说明：** 本路线图的 Phase D 指 Environment Look Development。`BLENDER_AGENT_PROMPTS.md` 和 `MEMORY_ARCHIVE.md` 中旧的“Phase D / School Fish”是历史资产任务；既有光照 P2.x、视觉 Phase 3/4 也是历史记录，均不代表本路线图的新 Phase D 已完成。

## 1. 总体路线与当前基线

P0 的目标整合版本是富默认场景：500 条主鱼、100 条小丑鱼、1 条 shayu 捕食者、B1 Hero/D 礁石和实验 C 相机。现有规模足以展示基础生态，不以继续增加资产数量作为下一阶段目标。此目标版本尚不等于已签核基线；只有本文件 Integration Gate 全部通过后才建立稳定基线。

| 阶段 | 目标 | 当前状态 | 进入条件 |
| --- | --- | --- | --- |
| A/B/C Integration Gate | 证明碰撞、B1 礁石、相机和 UI 组合正确 | **P0，通过（带限制，2026-11-13）；Phase D 可启动** | 已完成 |
| D — Environment Look Development | 统一水体、材质、植被与光照，建立视觉基线 | 两轮完成（2026-11-13） | Integration Gate 通过并保存基线 |
| E — Ecosystem Behavior | 提升游动、群体动态、捕食事件和局部环境交互 | 两轮完成（E1+E3 / E2+E4，2026-11-14） | D 视觉基线稳定 |
| F — Performance & Validation | 真实 GPU、CPU/GPU 分项、压力测试和优化 | 进行中：F1 测量与 F2 第一轮优化完成（2026-11-15） | A–E 主要功能稳定 |
| G — Release & Presentation | 完整观察流程、演示、文档和发布 | 未启动 | F 验收完成，展示内容稳定 |

总原则是先把现有系统做成可验证的实时生态模拟，再扩充内容。任何阶段都不得为了画面或演示结果改写模拟事实；不可测数据保持 `N/A`，参考图片只用于美术方向，不能作为项目验收截图。

## 2. A/B/C Integration Gate — P0

### 2.1 统一测试基线

验收必须锁定同一份源码、构建、资产和参数，记录实际 URL、随机种子、预热步数、时间点、浏览器、视口和 WebGL renderer。默认采用 500 主鱼 + 100 小丑鱼 + 1 捕食者的富场景，不能用 bare/environment 降级场景替代。

碰撞验收分成两条路径：默认 `sphere` 用于确认旧基线未被破坏，`reefProxy` 作为 B1 + C 的候选整合路径。不得借整合验收擅自改变默认 `obstacleShapeMode`；若要切换默认值，需单独记录决策、验收和回归结果。

固定时间点沿用 17 / 43 / 44.15 / 52 / 60 / 63 s。Sphere 保留历史 checksum 对照；B1 的 ReefProxy 必须在当前同版场景重新采样并两次运行比对，不能复用实验 A 旧代理的 checksum。CPU 重负载测试、SwiftShader 捕获和烘焙必须串行执行。

**WP0 执行记录（2026-11-12）：** 旧版本与参数 manifest 位于 `test-artifacts/integration-abc/2026-11-12T08-22-20Z/`，含源码/资产/文档 SHA-256、源码归档、URL/种子/视口/renderer 基线和失效规则。WP0 未运行测试、构建或截图；WP1 开始前先重验哈希，任一文件变化必须新建 run。**2026-11-12 Predator FSM 修改后该源码锁失效，旧锁只作历史证据；当前源码的新锁位于 `test-artifacts/integration-abc/2026-11-12T14-30-00Z/manifest.json`。**

**WP1 执行记录（2026-11-12）：** 证据位于同一 run 的 `wp1/summary.json` 与 `wp1/summary.md`。Vitest 39/39 文件、302/302 tests；独立 tsc 通过；生产构建 100 modules、11 个 HTML 入口、128 个 dist 文件；Sphere 回归 `deterministic=true` 且与上一版一致；Sphere/ReefProxy 各双跑，`rerunMatches=[true,true]`，10/10 checksum 与 `experiment-b.json` 基线一致；富默认 smoke 与生产 dist 探针 `browserErrors=[]`。碰撞脚本使用内置 5 个时间点（17/43/52/60/63），44.15 s 由 WP3 相机回归覆盖。WP1 不提供视觉三机位、UI 状态、Debug 画面或硬件 renderer。

**WP2 执行记录（2026-11-12）：** 证据位于同一 run 的 `wp2/summary.json` 与 `wp2/summary.md`。五礁覆盖与既有 B1 基线逐位一致（B 5.20%/0.387 m、C 0.50%/0.118 m、Hero 0.18%/0.234 m、D 13.78%/0.596 m、E 0.91%/0.119 m）；Sphere/ReefProxy 再次双跑 `rerunMatches=[true,true]`、两模式 `deterministic=true`，10/10 checksum 与基线一致；ReefProxy 在 17/43/52/60/63 s 均 0 穿透、0 深穿透、0 假避障、0 卡鱼，四条通道均有非零计数；D 双柱保持 0.31 m 几何间隙、0 鱼通过；B1 Overview（1920×1080）Hero/D 高度比 1.172、面积比 1.168、Hero 横向中心 56.54%，均达目标。新增当前 ReefProxy Debug 9 张、俯视/斜视通道 2 张、B1 Overview/近景 4 张，均无浏览器错误。Debug/俯视是诊断降级场景，层级捕获使用 Vite dev server 与默认 Sphere；全部为 SwiftShader 软件证据，用户已签核 WP4 硬件画面/交互，但 Experiment B 人工审美签核仍待构图评审。

**WP3 执行记录（2026-11-12，旧源码）：** 证据位于同一 run 的 `wp3/summary.json` 与 `wp3/summary.md`。相机单元测试 41/41；当前 encounter 六时间点 School 可见率 0.904/0.972/0.988/0.996/0.986/0.940，`invariants=0`、`browserErrors=0`；18 次模式切换最低净空 1.879 m；浏览器目标轨迹 7 次切换、12 次状态变化，覆盖 index→null、null→新 index、真实死亡目标（51.32 s，captures=2）和 attack→patrol/search；三机位、六时间点、Console 开/关、800×560 与 390×844 移动抽屉均截图归档，UI 状态不改变模拟 checksum。WP3 未观察到直接 index→index；旧 FSM 的 300 s 探针确认当时不可直接切换；2026-11-12 已修改 FSM 并捕获 4 次 direct（见下方 FSM 记录）。School 构图已按 D016 决定保留 fit 上限 1.4；`accept:observatory` 全套在 checks/mobile 阶段超时，未产生 results JSON，不计为通过。

**WP4 执行记录（2026-11-12）：** 证据位于同一 run 的 `wp4/summary.json` 与 `wp4/summary.md`。实际 renderer 为 Intel Iris Xe D3D11（headed Chrome，非 SwiftShader）；`accept:gpu` rich-default 短测 120 帧、40.66 FPS、P95 66.20 ms、1 dropped step、61 draw calls；180 s School 相机 189.8 s、412 采样，最低净空 1.100 m、最大角变化 0.0815、最低可见率 0.565、0 finite/净空/浏览器错误；30 分钟 Overview 1813.8 s、644 采样，相机位置漂移 0 m、姿态漂移约 1.7e-6°、最低可见率 0.966、0 finite/净空/浏览器错误，FPS 首/末十分位中位 53.1/54.9。起止截图非空白；用户已于 2026-11-12 签核通过硬件画面与交互。持续闪烁仍未 instrument；帧率优化已于 2026-11-12 决定留到 Phase F（D014）。无 GPU timestamp，不能声称稳定 60 FPS 或 Gate 通过。

**FSM direct-retarget 变更记录（2026-11-12）：** 用户决定修改 Predator FSM（D015）。`pursuit` 中每 0.35 s 检查，若另一条存活鱼至少近 15% 且当前目标在 attack radius 外，直接替换目标并重置 `stateTime`；attack 不换目标。Predator 定向测试 5/5、全量 Vitest 304/304、tsc 与生产构建通过；`sim-regression` `deterministic=true`，但 17/43/52/60/63 s checksum 全部变化（43–63 s alive 496 vs 498）。300 s CPU 探针 139 次切换、42 direct；浏览器 0–30 s 捕获 4 次 direct（5.08/12.42/12.78/30.38 s），0 错误。证据见 `test-artifacts/fsm-retarget/2026-11-12T14-05-00Z/summary.md` 与 `docs/validation/fsm-retarget.md`。该变更使旧 WP0 锁与 WP1–WP4 证据失效，必须先新建 WP0 run 再重跑受影响项。

### 2.2 组合验收矩阵

下表除已标注完成项外，其余是**待执行的整合验收**，不是对现有单项结果的重新盖章。**2026-11-12 FSM direct-retarget 后，下表 WP1–WP4 的旧状态均基于 pre-FSM 源码，不得复用；需在新 WP0 run 重跑。**

| 项目 | 通过标准与检查重点 | 证据 | 状态 |
| --- | --- | --- | --- |
| Build / Regression | 当前全量 Vitest、`tsc --noEmit`、生产构建通过；记录实际测试数，无浏览器脚本错误 | `wp1/summary.md`、Vitest/build/tsc/regression 日志 | **已通过（WP1，2026-11-12；post-FSM 新锁 304/304）** |
| Collision Proxy | GLB 与代理版本、五个逻辑 ID 和世界变换一致；无深穿透、无卡鱼，ReefProxy 无假避障；外露残差处于已接受 margin 内，并以 debug 视图检查明显穿模和空气墙 | 碰撞 JSON、逐礁指标、代理/GLB 对照截图 | **已通过（WP2，2026-11-12；post-FSM 新锁 107/107；SwiftShader 软件证据）** |
| Reef Hierarchy | Overview 中 Hero 主导性明确；复核 B1 高度比 1.15–1.25、面积比 >1、Hero 横向中心 53–58%，同时进行真实画面人工确认 | Overview、Hero/D 近景、轮廓指标 | **数值与软件画面通过（WP2）；人工审美签核待构图评审** |
| Reef Passage | B–C、C–Hero、Hero–D、B–Hero 等主要水道无意外堵塞；通道计数与空间观察一致 | 通道计数、俯视/自由机位、异常记录 | **已通过（WP2，2026-11-12）；D 双柱间隙仍为未决设计** |
| School Camera | 航向稳定、无翻转和跳变；记录六个时间点的可见率、fit、留白和主体尺寸，确认 90–95% 目标与构图取舍 | 六时间点截图、逐帧诊断、轨迹数据 | **证据已采集（WP3）；已按 D016 保留 fit 上限 1.4、接受 t17/t63 约 0.85 可见率** |
| Predator Camera | 垂直追逐不翻转；索引到索引、索引到 null、死亡目标和 pursuit→patrol 切换均连续；浏览器补获真实索引切换样本 | 垂直/目标切换轨迹、视频或帧序列 | **已通过（WP3 post-FSM：0–30 s 4 次 direct、0–60 s 11 次 direct，0 错误）** |
| Overview | 礁石、鱼群和 UI 层级协调，主体不被 HUD 遮挡；Console 打开和关闭均检查 | 两种 Console 状态的实际截图 | **已通过（WP3，软件证据）** |
| Responsive | 桌面 Console 开/关、窄视口和移动抽屉正常；相机与模拟无异常，Console 不改变模拟 | 桌面/窄屏/移动截图与检查结果 | **已通过（WP3，软件证据）** |
| Isolation / Determinism | Observation/Laboratory、三机位与相机更新只读模拟；同种子重跑一致，Sphere 历史路径无意外变化，B1 ReefProxy 新 checksum 可复现 | 双跑 checksum、模式对照数据 | **已通过（2026-11-13）：7 种 view/camera 组合同一 checksum `52ed2ff65445d74e46b0051b`；证据 `2026-11-13T06-33-00Z/isolation/isolation-results.json`** |
| Runtime / Visual Sign-off | 记录实际 renderer；软件渲染只用于正确性证据，本机 GPU 用于视觉和交互确认。补实验 C 缺少的硬件 180 s 稳定性，并完成 30 分钟本机长时观察；无持续闪烁、相机漂移或错误累积，完整性能分析仍归 F | 运行记录、实际截图、长时观察日志 | **WP4 完成（19/19，post-FSM 新锁）；用户 2026-11-13 签核硬件画面/交互；持续闪烁观察待确认；帧率优化留到 Phase F（D014）** |

### 2.3 已知的整合决策点

| 决策点 | 当前事实 | 整合时的处理 |
| --- | --- | --- |
| D 双柱间隙 | 已决定（D017）：保持封闭。B1 间隙约 0.31 m，当前 margin 下 0 鱼通过 | 不改柱体、margin 或代理；若要通行，必须作为独立变更并重跑覆盖与通道回归 |
| School 可见率上界 | 已决定（D016）：保留 fit 上限 1.4。post-FSM 六点为 0.8517/0.9355/0.9254/0.9375/0.9718/0.8528；上限 1.8 的候选可到 0.916/0.982/1.000/0.972/0.976/0.998，但相机后移抬高、主体明显变小 | t17/t63 约 0.85 是已接受结果，不再作为回归失败；今后改上限或 side/up 必须重做同版六点对比并单独决策 |
| 浏览器目标索引切换 | 已按 D015 修改 FSM 并完成 post-FSM 重跑：浏览器 0–30 s 4 次 direct、0–60 s 11 次 direct；D022 接受 0.85 阈值与 captures 18→25 | 阈值不再作为 Gate 未决项；若观感或捕获率出问题，再作为独立变更调整 |
| Hero 低前 shelf | 已决定（D018）：不加低前 shelf。Hero 相对 D 已有主导性，自身轮廓面积比 baseline 少 5.5% 作为已知差异保留 | 视觉打磨留到 Phase F，届时重拍层级证据 |
| B 基座避障力与代理成本 | 已决定（D020）：留到 Phase F。实验 A 记录 B 基座力偏强、代理 CPU 查询增加 | Gate 内不标定、不改模拟；与 D014 的帧率/压力矩阵一起处理 |

### 2.4 验收材料与稳定基线

整合验收应输出到独立目录，例如 `test-artifacts/integration-abc/<timestamp>/`，至少包含：

| 文件 | 内容 |
| --- | --- |
| `overview.png` / `school.png` / `predator.png` | 同版、同种子、同时间规范下的项目实际三机位画面 |
| `integration-contact-sheet.png` | 三机位及必要的 Console/窄屏对照，不使用参考图代替 |
| `collision-results.json` | 当前 B1 的 Sphere/ReefProxy、通道、穿透、假避障、卡鱼与 checksum |
| `camera-results.json` | 可见率、垂直追逐、目标切换、净空和轨迹诊断 |
| `results.json` / `summary.md` | 环境、版本、参数、通过/失败项、已知限制和原始证据索引 |

WP3 已输出 `overview.png` / `school.png` / `predator.png`、`camera-results.json`、`integration-contact-sheet.png`、UI 响应式截图和 `summary.md`；`collision-results.json` 由 WP1/WP2 的碰撞证据提供。WP4 已补真实硬件运行记录与 180 s/30 分钟观察，用户已签核硬件画面/交互；2026-11-12 FSM direct-retarget 后浏览器已捕获 4 次 direct index→index；上述 WP1–WP4 均已在 post-FSM 锁 `2026-11-12T14-30-00Z` 重跑完成。

P0 已通过（带限制，2026-11-13），`reef-camera-integration-v1` annotated tag 在收尾提交上创建。证据目录 `test-artifacts/` 被 Git 忽略，tag 不包含证据本体；判定见 `../test-artifacts/integration-abc/2026-11-13T06-33-00Z/gate-verdict.md`。

**Gate 规则（历史，Gate 已于 2026-11-13 关闭）：** 任一 P0 项失败，修复后重跑该项及受影响回归；在矩阵通过、材料归档和基线建立前，不启动 Phase D 的实现。

## 3. Phase D — Environment Look Development

**状态：两轮完成（2026-11-13）。** 第一轮 D4 全局光照与 D1 水体（D023），第二轮 D2 海床程序化材质与 D3 海草受流摆动/成簇分布（D024）；两轮均完成 10 机位 × base/fog/final 同版对照、全量回归与 Intel Iris Xe 硬件视觉签核（`test-artifacts/phase-d/2026-11-13t12-16-00z/`）。D2 剩余碎石/附着细节未做，是否补做由后续确认。目标是让现有场景形成可信的近、中、远水下层次，而不是把所有物体统一染成相同蓝色或依靠不断加雾制造氛围。

| 模块 | 工作范围 | 验收重点 |
| --- | --- | --- |
| D1 水体渲染 | 深化 Beer–Lambert 距离吸收、波长衰减、体积散射、深度雾、焦散和悬浮颗粒；校准清澈度与景深 | 近景轮廓/材质清晰，中景适度吸收，远景低对比偏蓝；无光带、重复雾或双重色调映射 |
| D2 海床与礁石材质 | 优先消除海床重复纹理，补充地形起伏、接触关系、局部粗糙度和附着细节；不以增加岩石数量代替材质质量 | 重复感降低，礁石与海床接触自然，近景细节真实，远景成本不增加失控 |
| D3 海草动画与分布 | 高度相关弯曲、株间/叶间相位差、轻微方向变化、尺寸密度变化和统一水流响应；优先顶点动画 | 运动协调但不同步，无根部滑移，不为每株引入重型独立物理 |
| D4 光照与色彩统一 | 统一色彩管理、曝光、环境光、主光、体积光、焦散和远景衰减 | 不靠单独打亮 Hero 制造主角感；视觉层级来自局部受光、轮廓与材质 |

**轮次划分：** 第一轮 D1 水体 + D4 全局光照；第二轮 D2 海床材质 + D3 海草动画与分布。两轮均已定稿（D023、D024）。每轮只变一组视觉变量并保留独立 before/after 目录；D2 的碎石/附着细节若继续，须作为独立轮次评审。

技术上必须深化现有 `UnderwaterMedium`、`UnderwaterLightingConfig` 和既有焦散/颗粒/植被路径，不新增第二条水体或雾合成链。水体保持线性空间、tonemapping 前合成，`?lighting=base` 必须真正关闭水体介质与局部效果。D 阶段原则上只改呈现；相机与固定种子模拟 checksum 不应因视觉调整而变化。

**D 交付物：** 同机位、同种子、同时间点的 Base/Final 与修改前后对照，近/中/远层次检查，统一参数表和固定场景视觉基线。软件截图可用于对照，但不得据此作硬件性能结论。

## 4. Phase E — Ecosystem Behavior

**状态：两轮完成（2026-11-14，D025/D026）。** 第一轮 E1 在渲染层深化主鱼俯仰平滑/限幅与转弯弯曲，E3 把真实 FSM/捕获映射为只读事件流与 `predator-watch` 单行，两者只改呈现，固定种子 checksum 不变。第二轮 E2 用一致度加权对齐、密度自适应分离、群体流地形预判、阈值门控惊扰传播与恐惧缩放边缘逃逸产生可复现的 split/merge 结构，并新增 30 步结构遥测与 `predator-watch` school 行；E4 把小丑鱼软栖息中心迁到最近海葵 `anemone-b` 上方（环形死区、无传送/硬约束），并用真实近底位置/速度与共享海流驱动确定性沙尘/悬浮颗粒。E2/E4 是有意的行为改动，建立新 checksum 基线，并提供 `?schoolDynamics=legacy`、`?habitat=legacy`、`?sediment=0` 同版回滚/对照。目标是把现有群体算法提升为可观察的生态行为，不用脚本化结果替代真实模拟。D2 剩余碎石/附着细节仍未做，未阻塞本轮入口。

| 模块 | 工作范围 | 验收重点 |
| --- | --- | --- |
| E1 鱼类运动动画 | 身体纵轴行波、尾鳍摆动、转弯 banking、自然 pitch；频率随速度增加，转弯影响弯曲，尾鳍与身体保持相位 | 鲨鱼不再像刚性棍体转向，鱼体无断骨/突跳，上下游动姿态连续，动画只读模拟状态 |
| E2 鱼群动态结构 | 分裂与重聚、局部惊扰传播、边缘逃逸、密度变化、子群协调和主动地形避让 | 鱼群不是永久规则团块；结构由局部规则产生，同种子可复现，无强制整群轨迹 |
| E3 捕食生态事件 | 将 Cruising → Detection → Pursuit → Attack → Recovery 与现有 FSM 对齐，表现目标逃逸、群体压缩/分裂、捕食者转向和恢复 | 成败由实际状态与捕获事件决定，不为演示强制成功；UI 事件与真实状态一致 |
| E4 环境与生物交互 | 近底沙尘扰动、水流与植被协调、悬浮颗粒、明确的小丑鱼—海葵栖息区域 | 效果由真实位置/速度/水流驱动；栖息关系稳定但非钉死轨迹，不借交互新增无必要物种 |

E1 应深化现有主鱼 `_TAILWEIGHT` 顶点动画、转弯倾斜和 shayu 的 11 骨 `PredatorAnimationController`，不得再引入一套同时写骨骼或位置的动画控制器。程序化脊柱弯曲可采用 \(\theta_i(t)=A_i\sin(\omega t+\phi_i)\)，幅度向尾部递增，但实际参数必须通过视觉与稳定性测试确定。

E3 是对现有 Patrol / Pursuit / Attack / Search 和真实捕获规则的表现深化，不要求为重命名而重写状态机。E4 优先把已有 100 条小丑鱼与海葵区域的关系做清晰，不扩大资产范围。

**E 交付物：** 主鱼与鲨鱼游动对照、鱼群分裂/重聚轨迹、完整捕食事件记录、小丑鱼栖息观察和环境交互证据；固定 60 Hz、双缓冲、网格等价性和固定种子回归必须保持。第一轮（E1+E3）已交付 12 对同版鱼体运动对照、慢动作片段、70 s 真实捕食事件记录与 UI 证据，见 `../test-artifacts/phase-e/2026-11-14t00-13-00z/summary.md`。第二轮（E2+E4）已交付 70 s dynamic/legacy 结构事件与固定机位对照、3600 步压力与确定性、`predator-watch` school 行桌面/窄屏证据、calm 900 步栖息指标、沙尘 on/off 同机位对照与 checksum 不变证明，以及 Intel Iris Xe 硬件签核，见 `../test-artifacts/phase-e/2026-11-14t08-31-46z/summary.md`。两轮均完成软件评审与硬件签核。

## 5. Phase F — Performance & Validation

**状态：进行中（F1 测量与瓶颈审计完成 2026-11-14；F2 第一轮位相同优化完成 2026-11-15）。** F1 只测量、不改优化参数；四档矩阵与 GPU timer 已落地，standard 档已在干净复测中验证 D028，干净四档矩阵中 base/standard 的 P50 可重复（FPS mean 受长尾影响仍有波动）；2026-11-15 关闭 Chrome/DeepSeek 重试后 extreme 两种模式与 pressure telemetry-on 可重复，pressure telemetry-off 仍有 cadence decay（180 s cooldown 重跑改善但未消除），3/5 捕食者完整矩阵待后续。F2 第一轮只做保持逐位相同的 CPU 热路径优化，稳定 A/B 约 −3% wall / −3–8% CPU，标准档 telemetry-off 优化后复核一次 3/3 达 D028、另一次 r3 热漂移；tests 50/370、tsc、构建与 checksum 不变（D029）。2026-11-09 的 Iris Xe 历史结果不能替代当前 B1 + C 富场景复测，SwiftShader 数据不能替代真实 GPU 验收。

**F1 执行记录（2026-11-14）：** 新增 `scripts/phase-f-baseline.ts`（`npm run baseline:phase-f`）、默认关闭的 `PhaseEmaRecorder` CPU 相位遥测、真实 WebGL2 `EXT_disjoint_timer_query_webgl2` GPU 计时与 `getRendererStats()`；完成 base/standard/pressure/extreme 四档 ×3 repeats、standard 1440×900 spot 与 telemetry-off 对照。结论：CPU 模拟是随规模单调放大的主瓶颈，渲染提交次之，GPU 在高负载下未先饱和；pressure/extreme 先用 1 捕食者代理，并因动态壁纸/并发负载与整机漂移未达重复性。同日暂停 Wallpaper Engine、关闭用户 Chrome 后复测 standard telemetry-off 3 repeats，3/3 达到 D028；补测的干净四档矩阵中 base/standard 的 P50 可重复（FPS mean 受长尾影响仍有波动）；2026-11-15 关闭 Chrome/DeepSeek 重试后 extreme 两种模式与 pressure telemetry-on 可重复，pressure telemetry-off 仍有 cadence decay（180 s cooldown 重跑改善但未消除），未形成签核基线。telemetry-on 诊断显示逐鱼计时与 GPU query polling 有明显测量开销，不作为产品路径性能。数值、采样条件和缺口只在 `../test-artifacts/phase-f/2026-11-14T11-26-00Z/rows/analysis.md`、`../test-artifacts/phase-f/2026-11-14T13-38-06Z-clean/acceptance.md`、`../test-artifacts/phase-f/2026-11-14T13-38-06Z-clean/matrix.md`、`../test-artifacts/phase-f/2026-11-14T18-25-37Z-retry/matrix-retry.md` 与 `validation/performance.md`；D027/D028 记录本轮范围与目标。

**F2 优化第一轮执行记录（2026-11-15）：** 只做位相同 CPU 热路径优化（D029）：`BoidSystem` 提升每步常量、减少邻居速度重复读取、predator 关闭时跳过 fear 读取、每步预计算鱼速；`UniformGrid3D` 内联 cell 坐标并移除临时数组；`ObstacleSystem`/`EnvironmentForces` 提升循环外常量。稳定 A/B 在临时 Performance 电源方案下交替 baseline/optimized（Wallpaper Engine 暂停、Chrome/DeepSeek 关闭、各状态先预热），500/1000/2000 主鱼 wall mean 3.146/7.945/20.462 → 3.043/7.673/19.868 ms（约 −3%），P95 改善 1.8–5.1%；绝对值不能与 Balanced 下的 F1 基线直接比较。标准档 telemetry-off 优化后复核 run A 3/3 达 D028（P50 12.0/12.1/12.1、P95 18.2/18.2/18.3、0 dropped），run B r3 热漂移到 P50 18.2 但 P95 30.2、0 dropped；没有同会话 baseline/optimized 浏览器 A/B。被否决的邻居几何缓存（慢 12–15%）、cell 位置缓存（噪声内）与 Float32 距离缓存（改变 checksum）未进入代码。证据见 `../test-artifacts/phase-f/optimization/`；数值只在 `validation/performance.md` 维护。

### 5.1 真实硬件基线

至少分别记录 CPU Simulation / Fish Update、CPU Render Submission、GPU Frame Time、Frame Time P50/P95、Draw Calls、Triangle Count、可测的 CPU/GPU Memory。60 FPS 对应 \(T_{frame}\leq16.67\text{ ms}\)，但不能用单一 FPS 判断瓶颈。没有真实 GPU timestamp 时，GPU 时间必须写 `N/A`，不能用 Render CPU 或 FPS 推算后冒充实测。

报告需记录硬件、驱动、浏览器、renderer、电源状态、分辨率、URL、鱼数、资产层和构建版本。先执行当前富默认场景的 `rich-default` 验收，再按实验需要扩展组合；不得为通过测试而降低默认场景质量。

### 5.2 压力矩阵

| 场景 | 主鱼群 | 小丑鱼 | 捕食者 | 用途 |
| --- | ---: | ---: | ---: | --- |
| 基础 | 200 | 50 | 1 | 对照与回归 |
| 标准 | 500 | 100 | 1 | 当前默认生态验收 |
| 压力 | 1000 | 200 | 3 | 性能实验 |
| 极限 | 2000 | 300 | 5 | 性能实验 |

后两组只用于测量扩展性，不代表已经支持多捕食者完整生态行为。每组保存原始逐轮数据、P50/P95 和失败原因，不只保留平均 FPS。

### 5.3 优化顺序

先依据 CPU/GPU 分项定位瓶颈，再选择 Instanced Rendering、几何/材质共享、LOD、Frustum Culling、粒子 GPU 更新、减少逐帧分配、阴影投射控制和远景降级。项目已有实例化与部分 LOD 时，应先审计实际覆盖和收益，不重复实现。优化必须让细节成本随距离递减，不能将近景礁石和鱼群一并简化。

F2 第一轮的实测瓶颈是 CPU 模拟中的 `UniformGrid3D.collect`（2000 鱼约 49% profile）与 `BoidSystem.update`（约 40%），因此先做了不改变邻居顺序和浮点求和的常量提升、重复读取消除与速度预计算；约 3% 的收益不足以改变压力档实时性。继续优化若采用 Worker/WASM、改变邻居求和顺序、复用跨步邻居或降低默认质量，必须另立决定并重建 checksum、碰撞/相机与同版性能证据，不能作为“无害微优化”直接合入。

**F 交付物：** 当前真实硬件报告、CPU/GPU 分项、四档压力矩阵、优化前后同版对照和仍未通过的限制。历史 500 鱼通过与当前富默认通过必须分开陈述。

## 6. Phase G — Release & Presentation

**状态：未启动，等待 F 与展示内容稳定。** 四种展示体验复用同一个模拟世界：Overview、School Observation、Predator Encounter 属于 Observation 的观察路径，Laboratory 独立展示参数、生态数据、性能和诊断，不复制四套场景。

| 展示路径 | 主要内容 |
| --- | --- |
| 01 · Overview | 整体海底世界、鱼群分布、礁石层级和生态环境 |
| 02 · School Observation | 聚集、分散、转向、避障、分裂与重聚 |
| 03 · Predator Encounter | 由真实状态机驱动的捕食者与鱼群互动 |
| 04 · Laboratory | 参数控制、真实生态数据、性能指标和调试工具 |

现有 Pause/Resume、Reset、Speed、鱼数/行为参数、固定种子场景和 Observation/Laboratory 已具备，G 阶段先审计并补齐完整流程，不重复造控件。后续完善真实生态事件记录、可复现演示、截图/录屏和发布说明。正式 Observation 界面不暴露 Collision Debug、SDF 数值和调试线框；这些保留在 Laboratory。

**G 交付物：** 四种展示路径的完整交互验收、统一 UI、最终项目说明、真实运行截图、正式演示视频和发布版本。演示视频尚未录制，不能将录制脚本当作视频交付。

## 7. 开发收益优先级

| 顺序 | 工作 | 优先级 | 原因 |
| ---: | --- | --- | --- |
| 1 | A/B/C 综合回归 | P0 | 保证组合后的基础系统正确 |
| 2 | 水体与光照深化 | P0 | 对整体画面影响最大 |
| 3 | 鲨鱼和鱼类游动动画 | P0 | 直接提升主体运动表现 |
| 4 | 海床和环境材质 | P1 | 提升真实感与接触细节 |
| 5 | 捕食行为及鱼群反馈 | P1 | 建立核心生态特色 |
| 6 | 海草与环境交互 | P1 | 增强生态完整度 |
| 7 | GPU 性能优化 | P1 | 完成真实硬件验收 |
| 8 | UI 和演示包装 | P2 | 完成最终交付 |

优先级表示收益顺序，不取消阶段依赖。例如 GPU 正确性/视觉记录可在 Integration Gate 先行采集，但完整性能优化与压力验收仍归入 F；若整合发现阻断性性能问题，则先修复阻断问题并记录例外。

## 8. Agent 执行约束与完成定义

1. 每次只启动当前 Gate 或阶段的一个明确工作包，先写验收口径，再改实现；不得同时展开 D–G。
2. 保留固定 60 Hz、SoA 双缓冲、Uniform Grid 等价性、真实 FSM/捕获事件和只读相机/动画边界。任何模拟变化都必须有确定性回归和原因说明。
3. 保留富默认场景、B1 资产、当前相机和单一路径线性水体，除非验收明确证明需要修改；不以降级换取表面通过。
4. 所有截图必须来自项目实际运行，所有指标来自真实状态。区分 CPU、GPU、软件和硬件证据；缺失数据写 `N/A`，参考图不得进入正式验收材料。
5. 每个阶段完成后更新对应 docs 报告、本文件状态和项目活记忆的指针；阶段细节只留在仓库 docs，不新增重复的阶段记忆。
6. 当前目录无 Git 元数据时先备份再修改。捕获、测试和烘焙串行执行，保留原始数据、失败项和剩余限制。

一个阶段只有在其交付物、回归、实际证据和已知限制全部记录后才算完成。Gate 已关闭，Phase D 两轮、Phase E 两轮均已完成并签核；Phase F F1 测量与瓶颈审计已完成，standard 档 D028 目标已在干净复测中验证，干净四档矩阵中 base/standard 的 P50 可重复；关闭 Chrome/DeepSeek 重试后 extreme 与 pressure telemetry-on 可重复，pressure telemetry-off 仍有 cadence decay（180 s cooldown 重跑改善但未消除）；F2 第一轮位相同优化已完成（D029，约 −3% CPU 模拟 wall，checksum 不变）。下一入口是 pressure telemetry-off 热/节奏复测、3/5 捕食者完整矩阵、是否继续非位相同优化，并需确认 D2 剩余碎石/附着细节是否补做。
